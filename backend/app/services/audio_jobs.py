from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from threading import Event, Thread
from time import sleep
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload, sessionmaker

from app.core.config import get_settings
from app.models.entities import (
    AudioFile,
    AudioGenerationJob,
    AudioGenerationJobItem,
    PronunciationDictionary,
    RouteItem,
    RouteSegmentAudioFile,
    Text,
    Voice,
)
from app.models.enums import (
    AudioJobItemStatus,
    AudioJobStatus,
    RouteSegmentKind,
    TranslationStatus,
)
from app.services.audio_recipes import build_generation_spec, recipe_hash, sha256_bytes
from app.services.audio_storage import (
    AudioStorage,
    generated_audio_key,
    generated_route_bridge_audio_key,
)
from app.services.elevenlabs import (
    ElevenLabsService,
    GeneratedAudio,
    get_audio_source_text,
    resolve_voice_id,
    upsert_audio_file,
)
from app.services.languages import get_source_language

logger = logging.getLogger(__name__)


def create_audio_job(
    db: Session,
    requested_by: str | None,
    items: list[tuple[UUID, str]],
    preferred_voice_id: str | None = None,
    start_immediately: bool = False,
    batch_id: UUID | None = None,
    batch_stage: str | None = None,
    policy: str = "replace_automatic",
) -> AudioGenerationJob:
    initial_status = AudioJobStatus.RUNNING if start_immediately else AudioJobStatus.PENDING
    job = AudioGenerationJob(
        created_at=datetime.now(UTC),
        requested_by=requested_by,
        preferred_voice_id=preferred_voice_id,
        status=initial_status,
        total=len(items),
        processed=0,
        succeeded=0,
        failed=0,
        started_at=datetime.now(UTC) if start_immediately else None,
        batch_id=batch_id,
        batch_stage=batch_stage,
        policy=policy,
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


def create_bridge_audio_job(
    db: Session,
    requested_by: str | None,
    items: list[tuple[UUID, str]],
    preferred_voice_id: str | None = None,
    start_immediately: bool = False,
) -> AudioGenerationJob:
    initial_status = AudioJobStatus.RUNNING if start_immediately else AudioJobStatus.PENDING
    job = AudioGenerationJob(
        created_at=datetime.now(UTC),
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
    for segment_id, lang in items:
        db.add(
            AudioGenerationJobItem(
                job_id=job.id,
                route_segment_id=segment_id,
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
            generated = _process_audio_job_item(db, job, queued_item, elevenlabs, storage)
            queued_item.status = AudioJobItemStatus.COMPLETED
            queued_item.was_skipped = not generated
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
) -> bool:
    if item.route_segment_id is not None:
        return _process_bridge_audio_job_item(db, job, item, elevenlabs, storage)
    if item.text_id is None:
        raise ValueError("Audio job item has no content target")
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
        return False

    existing_audio = next((audio for audio in text.audio_files if audio.lang == item.lang), None)
    if existing_audio is not None and job.policy == "missing_only":
        return False

    voice_id = resolve_voice_id(db, text, item.lang, job.preferred_voice_id)
    source_text = get_audio_source_text(db, text, item.lang)
    pronunciation_dictionary = db.scalar(
        select(PronunciationDictionary).where(PronunciationDictionary.language_code == item.lang)
    )
    model_id = getattr(elevenlabs, "generation_model_id", get_settings().elevenlabs_model_id)
    output_format = getattr(elevenlabs, "output_format", get_settings().elevenlabs_output_format)
    spec = build_generation_spec(
        source_text=source_text,
        language=item.lang,
        voice_id=voice_id,
        model_id=model_id,
        output_format=output_format,
        pronunciation_dictionary=pronunciation_dictionary,
    )
    signature = recipe_hash(spec)
    key = generated_audio_key(text.id, item.lang, signature)
    cached = db.scalars(
        select(AudioFile).where(
            AudioFile.recipe_hash == signature,
            AudioFile.manually_uploaded.is_(False),
            AudioFile.r2_key.is_not(None),
        )
    ).first()
    generated = None
    if cached is not None and cached.r2_key and storage.has_audio(cached.r2_key):
        cached_content = storage.read_audio(cached.r2_key)
        cached_hash = sha256_bytes(cached_content)
        if cached.content_hash == cached_hash:
            generated = GeneratedAudio(
                content=cached_content,
                duration_s=cached.duration_s,
                voice_id=voice_id,
            )
    if generated is None and pronunciation_dictionary is None:
        generated = elevenlabs.generate_audio(source_text, voice_id)
    elif generated is None:
        generated = elevenlabs.generate_audio(
            source_text,
            voice_id,
            pronunciation_dictionary_locators=[
                {
                    "pronunciation_dictionary_id": pronunciation_dictionary.elevenlabs_id,
                    "version_id": pronunciation_dictionary.version_id,
                }
            ],
        )
    public_url = storage.upload_audio(key, generated.content)
    audio_file = upsert_audio_file(
        db,
        text,
        item.lang,
        generated,
        key,
        public_url,
        manually_uploaded=False,
        recipe_hash=signature,
        content_hash=sha256_bytes(generated.content),
        generation_spec=spec,
    )
    if audio_file.manually_uploaded:
        storage.delete_audio(key)
        return False
    return True


def _process_bridge_audio_job_item(
    db: Session,
    job: AudioGenerationJob,
    item: AudioGenerationJobItem,
    elevenlabs: ElevenLabsService,
    storage: AudioStorage,
) -> bool:
    segment = db.scalar(
        select(RouteItem)
        .options(selectinload(RouteItem.translations), selectinload(RouteItem.audio_files))
        .where(RouteItem.id == item.route_segment_id)
    )
    if segment is None or segment.kind != RouteSegmentKind.BRIDGE.value:
        raise ValueError("Route bridge not found")
    existing_audio = next((audio for audio in segment.audio_files if audio.lang == item.lang), None)
    if existing_audio is not None and existing_audio.manually_uploaded:
        return False
    if existing_audio is not None and job.policy == "missing_only":
        return False

    source_language = get_source_language(db).code
    if item.lang == source_language:
        source_text = segment.bridge_content_pt or ""
    else:
        translation = next(
            (
                candidate
                for candidate in segment.translations
                if candidate.lang == item.lang and candidate.status == TranslationStatus.APPROVED
            ),
            None,
        )
        if translation is None:
            raise ValueError("Approved bridge translation required before audio generation")
        source_text = translation.content
    if not source_text.strip():
        raise ValueError("Bridge content is empty")

    voice_id = _resolve_curatorial_voice_id(db, item.lang, job.preferred_voice_id)
    pronunciation_dictionary = db.scalar(
        select(PronunciationDictionary).where(PronunciationDictionary.language_code == item.lang)
    )
    model_id = getattr(elevenlabs, "generation_model_id", get_settings().elevenlabs_model_id)
    output_format = getattr(elevenlabs, "output_format", get_settings().elevenlabs_output_format)
    spec = build_generation_spec(
        source_text=source_text,
        language=item.lang,
        voice_id=voice_id,
        model_id=model_id,
        output_format=output_format,
        pronunciation_dictionary=pronunciation_dictionary,
    )
    signature = recipe_hash(spec)
    key = generated_route_bridge_audio_key(segment.id, item.lang, signature)
    locators = None
    if pronunciation_dictionary is not None:
        locators = [
            {
                "pronunciation_dictionary_id": pronunciation_dictionary.elevenlabs_id,
                "version_id": pronunciation_dictionary.version_id,
            }
        ]
    generated = elevenlabs.generate_audio(
        source_text,
        voice_id,
        pronunciation_dictionary_locators=locators,
    )
    public_url = storage.upload_audio(key, generated.content)
    if existing_audio is None:
        existing_audio = RouteSegmentAudioFile(segment_id=segment.id, lang=item.lang)
        db.add(existing_audio)
    if existing_audio.manually_uploaded:
        storage.delete_audio(key)
        return False
    existing_audio.r2_key = key
    existing_audio.public_url = public_url
    existing_audio.duration_s = generated.duration_s
    existing_audio.voice_id = generated.voice_id
    existing_audio.generated_at = datetime.now(UTC)
    existing_audio.manually_uploaded = False
    return True


def _resolve_curatorial_voice_id(
    db: Session,
    lang: str,
    preferred_voice_id: str | None,
) -> str:
    if preferred_voice_id:
        return preferred_voice_id
    configured = get_settings().route_curatorial_voice_ids.get(lang)
    if configured:
        return configured
    language_voice = db.scalar(
        select(Voice).where(Voice.languages.any(code=lang)).order_by(Voice.name).limit(1)
    )
    if language_voice is not None:
        return language_voice.elevenlabs_id
    default_voice = db.scalar(
        select(Voice).where(Voice.is_default.is_(True)).order_by(Voice.name).limit(1)
    )
    if default_voice is not None:
        return default_voice.elevenlabs_id
    fallback = get_settings().elevenlabs_default_voice_id
    if fallback:
        return fallback
    raise ValueError(f"No curatorial voice configured for language '{lang}'")


def _refresh_job_counts(db: Session, job: AudioGenerationJob) -> None:
    counts = dict(
        db.execute(
            select(AudioGenerationJobItem.status, func.count(AudioGenerationJobItem.id))
            .where(AudioGenerationJobItem.job_id == job.id)
            .group_by(AudioGenerationJobItem.status)
        ).all()
    )
    completed = counts.get(AudioJobItemStatus.COMPLETED, 0)
    job.skipped = (
        db.scalar(
            select(func.count(AudioGenerationJobItem.id)).where(
                AudioGenerationJobItem.job_id == job.id,
                AudioGenerationJobItem.status == AudioJobItemStatus.COMPLETED,
                AudioGenerationJobItem.was_skipped.is_(True),
            )
        )
        or 0
    )
    job.succeeded = completed - job.skipped
    job.failed = counts.get(AudioJobItemStatus.FAILED, 0)
    job.processed = completed + job.failed


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
