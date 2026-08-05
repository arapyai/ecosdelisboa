from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    AudioGenerationJob,
    AudioGenerationJobItem,
    ContentGenerationBatch,
    Translation,
    TranslationGenerationJob,
    TranslationGenerationJobItem,
)
from app.models.enums import TranslationStatus
from app.services.audio_jobs import create_audio_job


def queue_approved_translated_audio(
    db: Session,
    batch: ContentGenerationBatch,
    requested_by: str | None,
    *,
    policy: str,
) -> int:
    completed_pairs = set(
        db.execute(
            select(TranslationGenerationJobItem.text_id, TranslationGenerationJobItem.lang)
            .join(
                TranslationGenerationJob,
                TranslationGenerationJob.id == TranslationGenerationJobItem.job_id,
            )
            .where(
                TranslationGenerationJob.batch_id == batch.id,
                TranslationGenerationJobItem.status == "completed",
            )
        ).all()
    )
    if not completed_pairs:
        return 0

    approved = db.scalars(
        select(Translation).where(
            Translation.text_id.in_({pair[0] for pair in completed_pairs}),
            Translation.lang.in_({pair[1] for pair in completed_pairs}),
            Translation.status == TranslationStatus.APPROVED,
        )
    ).all()
    queued_pairs = set(
        db.execute(
            select(AudioGenerationJobItem.text_id, AudioGenerationJobItem.lang)
            .join(AudioGenerationJob, AudioGenerationJob.id == AudioGenerationJobItem.job_id)
            .where(
                AudioGenerationJob.batch_id == batch.id,
                AudioGenerationJob.batch_stage == "translated_audio",
            )
        ).all()
    )
    eligible = {
        (translation.text_id, translation.lang)
        for translation in approved
        if (translation.text_id, translation.lang) in completed_pairs
        and (translation.text_id, translation.lang) not in queued_pairs
    }
    if not eligible and not queued_pairs:
        create_audio_job(
            db,
            requested_by,
            [],
            batch_id=batch.id,
            batch_stage="translated_audio",
            policy=policy,
        )
        return 0
    by_language: dict[str, list[tuple[UUID, str]]] = defaultdict(list)
    for pair in sorted(eligible, key=lambda item: (item[1], str(item[0]))):
        by_language[pair[1]].append(pair)
    for language, items in by_language.items():
        create_audio_job(
            db,
            requested_by,
            items,
            preferred_voice_id=batch.voice_overrides.get(language),
            batch_id=batch.id,
            batch_stage="translated_audio",
            policy=policy,
        )
    return len(eligible)
