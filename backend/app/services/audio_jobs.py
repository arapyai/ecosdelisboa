from collections.abc import Iterator
from datetime import UTC, datetime
from time import sleep
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import AudioGenerationJob, AudioGenerationJobItem, Text
from app.models.enums import AudioJobItemStatus, AudioJobStatus, SupportedLanguage
from app.services.elevenlabs import (
    ElevenLabsService,
    get_audio_source_text,
    resolve_voice_id,
    upsert_audio_file,
)
from app.services.r2 import R2Service


def create_audio_job(
    db: Session,
    requested_by: str | None,
    items: list[tuple[UUID, SupportedLanguage]],
) -> AudioGenerationJob:
    job = AudioGenerationJob(
        requested_by=requested_by,
        status=AudioJobStatus.PENDING,
        total=len(items),
        processed=0,
        succeeded=0,
        failed=0,
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


def run_audio_job(
    db: Session,
    job_id: UUID,
    elevenlabs: ElevenLabsService,
    r2: R2Service,
) -> AudioGenerationJob:
    job = db.scalar(
        select(AudioGenerationJob)
        .options(
            selectinload(AudioGenerationJob.items),
            selectinload(AudioGenerationJob.items).selectinload(AudioGenerationJobItem.text),
        )
        .where(AudioGenerationJob.id == job_id)
    )
    if job is None:
        raise ValueError("Audio job not found")

    job.status = AudioJobStatus.RUNNING
    job.started_at = datetime.now(UTC)
    db.commit()

    for item in job.items:
        item.status = AudioJobItemStatus.RUNNING
        db.commit()
        try:
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
            voice_id = resolve_voice_id(db, text)
            source_text = get_audio_source_text(text, item.lang)
            generated = elevenlabs.generate_audio(source_text, voice_id)
            key = f"audio/{text.id}/{item.lang.value}.mp3"
            public_url = r2.upload_audio(key, generated.content)
            upsert_audio_file(db, text, item.lang, generated, public_url, manually_uploaded=False)
            item.status = AudioJobItemStatus.COMPLETED
            job.succeeded += 1
        except ValueError as exc:
            item.status = AudioJobItemStatus.FAILED
            item.error_message = str(exc)
            job.failed += 1
            job.last_error = str(exc)
        job.processed += 1
        db.commit()

    job.status = AudioJobStatus.COMPLETED if job.failed == 0 else AudioJobStatus.FAILED
    job.finished_at = datetime.now(UTC)
    db.commit()
    db.refresh(job)
    return job


def stream_job_events(db: Session, job_id: UUID) -> Iterator[str]:
    while True:
        job = db.get(AudioGenerationJob, job_id)
        if job is None:
            break
        yield (
            f"data: {{\"job_id\": \"{job.id}\", \"status\": \"{job.status.value}\", "
            f"\"processed\": {job.processed}, \"total\": {job.total}}}\n\n"
        )
        if job.status in {AudioJobStatus.COMPLETED, AudioJobStatus.FAILED}:
            break
        sleep(0.01)
