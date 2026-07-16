from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from threading import Event, Thread
from time import sleep
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload, sessionmaker

from app.models.entities import AudioGenerationJob, AudioGenerationJobItem, Text
from app.models.enums import AudioJobItemStatus, AudioJobStatus
from app.services.audio_storage import AudioStorage, generated_audio_key
from app.services.elevenlabs import (
    ElevenLabsService,
    get_audio_source_text,
    resolve_voice_id,
    upsert_audio_file,
)

logger = logging.getLogger(__name__)


def create_audio_job(
    db: Session,
    requested_by: str | None,
    items: list[tuple[UUID, str]],
    preferred_voice_id: str | None = None,
    start_immediately: bool = False,
) -> AudioGenerationJob:
    initial_status = AudioJobStatus.RUNNING if start_immediately else AudioJobStatus.PENDING
    job = AudioGenerationJob(
        requested_by=requested_by,
        preferred_voice_id=preferred_voice_id,
        status=initial_status,
        total=len(items),
        processed=0,
        succeeded=0,
        failed=0,
        started_at=datetime.now(UTC) if start_immediately else None,
    )
    db.add(job)
    db.flush()
    for text_id, lang in items:
        db.add(
            AudioGenerationJobItem(
                job_id=job.id,
                text_id=text_id,
                lang=lang,
                status=AudioJobItemStatus.PENDING,
            )
        )
    db.commit()
    db.refresh(job)
    return job


def recover_interrupted_audio_jobs(db: Session) -> int:
    jobs = list(
        db.scalars(
            select(AudioGenerationJob)
            .options(selectinload(AudioGenerationJob.items))
            .where(AudioGenerationJob.status == AudioJobStatus.RUNNING)
        ).unique()
    )
    for job in jobs:
        for item in job.items:
            if item.status == AudioJobItemStatus.RUNNING:
                item.status = AudioJobItemStatus.PENDING
                item.error_message = None
        _refresh_job_counts(db, job)
        has_pending = any(item.status == AudioJobItemStatus.PENDING for item in job.items)
        if has_pending:
            job.status = AudioJobStatus.PENDING
            job.finished_at = None
        else:
            job.status = AudioJobStatus.FAILED if job.failed else AudioJobStatus.COMPLETED
            job.finished_at = datetime.now(UTC)
    db.commit()
    return len(jobs)


def claim_next_audio_job(db: Session) -> UUID | None:
    job_id = db.scalar(
        select(AudioGenerationJob.id)
        .where(AudioGenerationJob.status == AudioJobStatus.PENDING)
        .order_by(AudioGenerationJob.created_at, AudioGenerationJob.id)
        .limit(1)
    )
    if job_id is None:
        return None

    result = db.execute(
        update(AudioGenerationJob)
        .where(
            AudioGenerationJob.id == job_id,
            AudioGenerationJob.status == AudioJobStatus.PENDING,
        )
        .values(
            status=AudioJobStatus.RUNNING,
            started_at=datetime.now(UTC),
            finished_at=None,
        )
    )
    db.commit()
    return job_id if result.rowcount == 1 else None


def process_audio_job(
    db: Session,
    job_id: UUID,
    elevenlabs: ElevenLabsService,
    storage: AudioStorage,
    should_stop: Callable[[], bool] | None = None,
) -> AudioGenerationJob:
    job = db.scalar(
        select(AudioGenerationJob)
        .options(selectinload(AudioGenerationJob.items))
        .where(AudioGenerationJob.id == job_id)
    )
    if job is None:
        raise ValueError("Audio job not found")
    if job.status != AudioJobStatus.RUNNING:
        raise ValueError("Audio job must be claimed before processing")

    for queued_item in sorted(job.items, key=lambda item: (item.created_at, str(item.id))):
        if queued_item.status != AudioJobItemStatus.PENDING:
            continue
        if should_stop is not None and should_stop():
            db.refresh(job)
            return job

        queued_item.status = AudioJobItemStatus.RUNNING
        queued_item.error_message = None
        db.commit()

        try:
            _process_audio_job_item(db, job, queued_item, elevenlabs, storage)
            queued_item.status = AudioJobItemStatus.COMPLETED
            queued_item.error_message = None
            _refresh_job_counts(db, job)
            db.commit()
        except Exception as exc:
            logger.exception("Audio job item failed", extra={"job_id": str(job_id)})
            db.rollback()
            job = db.get(AudioGenerationJob, job_id)
            queued_item = db.get(AudioGenerationJobItem, queued_item.id)
            if job is None or queued_item is None:
                raise
            queued_item.status = AudioJobItemStatus.FAILED
            queued_item.error_message = str(exc)
            job.last_error = str(exc)
            _refresh_job_counts(db, job)
            db.commit()

    job = db.get(AudioGenerationJob, job_id)
    if job is None:
        raise ValueError("Audio job not found")
    _refresh_job_counts(db, job)
    job.status = AudioJobStatus.FAILED if job.failed else AudioJobStatus.COMPLETED
    job.finished_at = datetime.now(UTC)
    db.commit()
    db.refresh(job)
    return job


def _process_audio_job_item(
    db: Session,
    job: AudioGenerationJob,
    item: AudioGenerationJobItem,
    elevenlabs: ElevenLabsService,
    storage: AudioStorage,
) -> None:
    text = db.scalar(
        select(Text)
        .options(
            selectinload(Text.translations),
            selectinload(Text.audio_files),
            selectinload(Text.author),
            selectinload(Text.point),
        )
        .where(Text.id == item.text_id)
    )
    if text is None:
        raise ValueError("Text not found")

    manual_audio = next(
        (
            audio
            for audio in text.audio_files
            if audio.lang == item.lang and audio.manually_uploaded
        ),
        None,
    )
    if manual_audio is not None:
        return

    voice_id = resolve_voice_id(db, text, item.lang, job.preferred_voice_id)
    source_text = get_audio_source_text(db, text, item.lang)
    generated = elevenlabs.generate_audio(source_text, voice_id)
    key = generated_audio_key(text.id, item.lang)
    public_url = storage.upload_audio(key, generated.content)
    audio_file = upsert_audio_file(
        db,
        text,
        item.lang,
        generated,
        key,
        public_url,
        manually_uploaded=False,
    )
    if audio_file.manually_uploaded:
        storage.delete_audio(key)


def _refresh_job_counts(db: Session, job: AudioGenerationJob) -> None:
    counts = dict(
        db.execute(
            select(AudioGenerationJobItem.status, func.count(AudioGenerationJobItem.id))
            .where(AudioGenerationJobItem.job_id == job.id)
            .group_by(AudioGenerationJobItem.status)
        ).all()
    )
    job.succeeded = counts.get(AudioJobItemStatus.COMPLETED, 0)
    job.failed = counts.get(AudioJobItemStatus.FAILED, 0)
    job.processed = job.succeeded + job.failed


def stream_job_events(
    db: Session,
    job_id: UUID,
    poll_interval_s: float = 1.0,
) -> Iterator[str]:
    while True:
        db.expire_all()
        job = db.scalar(
            select(AudioGenerationJob)
            .where(AudioGenerationJob.id == job_id)
            .execution_options(populate_existing=True)
        )
        if job is None:
            break
        yield (
            f'data: {{"job_id": "{job.id}", "status": "{job.status.value}", '
            f'"processed": {job.processed}, "total": {job.total}}}\n\n'
        )
        if job.status in {AudioJobStatus.COMPLETED, AudioJobStatus.FAILED}:
            break
        sleep(poll_interval_s)


class AudioJobWorker:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        elevenlabs: ElevenLabsService,
        storage: AudioStorage,
        poll_interval_s: float = 1.0,
    ) -> None:
        self.session_factory = session_factory
        self.elevenlabs = elevenlabs
        self.storage = storage
        self.poll_interval_s = poll_interval_s
        self._stop_event = Event()
        self._thread: Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = Thread(target=self.run_forever, name="audio-job-worker", daemon=True)
        self._thread.start()

    def stop(self, timeout_s: float = 5.0) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout_s)

    def run_forever(self) -> None:
        try:
            with self.session_factory() as db:
                recovered = recover_interrupted_audio_jobs(db)
                if recovered:
                    logger.info("Recovered %s interrupted audio jobs", recovered)
        except Exception:
            logger.exception("Could not recover interrupted audio jobs")

        while not self._stop_event.is_set():
            try:
                with self.session_factory() as db:
                    job_id = claim_next_audio_job(db)
                    if job_id is not None:
                        process_audio_job(
                            db,
                            job_id,
                            self.elevenlabs,
                            self.storage,
                            should_stop=self._stop_event.is_set,
                        )
                        continue
            except Exception:
                logger.exception("Audio worker iteration failed")
            self._stop_event.wait(self.poll_interval_s)
