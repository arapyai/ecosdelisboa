from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.models.entities import (
    AdminUser,
    AudioGenerationJob,
    ContentGenerationBatch,
    Text,
    Translation,
    TranslationGenerationJob,
    Voice,
)
from app.models.enums import TranslationStatus
from app.schemas.common import EnvelopeMeta, envelope
from app.services.audio_jobs import create_audio_job
from app.services.content_batches import queue_approved_translated_audio
from app.services.languages import get_active_language, get_source_language
from app.services.translation_jobs import create_translation_job

router = APIRouter(prefix="/api/v1/admin/automation/batches", tags=["admin-automation"])


class BatchCreateRequest(BaseModel):
    text_ids: list[UUID] = Field(min_length=1)
    target_languages: list[str] = Field(default_factory=list)
    audio_languages: list[str] | None = None
    generate_source_audio: bool = True
    generate_translated_audio: bool = False
    auto_approve_translations: bool = True
    policy: Literal["missing_only", "replace_automatic"] = "missing_only"
    source: Literal["texts", "csv"] = "texts"
    voice_overrides: dict[str, str] = Field(default_factory=dict)


def _create_audio_jobs_by_language(
    db: Session,
    requested_by: str | None,
    items: list[tuple[UUID, str]],
    *,
    batch: ContentGenerationBatch,
    batch_stage: str,
    policy: str,
) -> None:
    if not items:
        create_audio_job(
            db,
            requested_by,
            [],
            batch_id=batch.id,
            batch_stage=batch_stage,
            policy=policy,
        )
        return
    by_language: dict[str, list[tuple[UUID, str]]] = defaultdict(list)
    for item in items:
        by_language[item[1]].append(item)
    for language, language_items in by_language.items():
        create_audio_job(
            db,
            requested_by,
            language_items,
            preferred_voice_id=batch.voice_overrides.get(language),
            batch_id=batch.id,
            batch_stage=batch_stage,
            policy=policy,
        )


def _load_batch(db: Session, batch_id: UUID) -> ContentGenerationBatch:
    batch = db.scalar(
        select(ContentGenerationBatch)
        .options(
            selectinload(ContentGenerationBatch.translation_jobs).selectinload(
                TranslationGenerationJob.items
            ),
            selectinload(ContentGenerationBatch.audio_jobs).selectinload(AudioGenerationJob.items),
        )
        .where(ContentGenerationBatch.id == batch_id)
    )
    if batch is None:
        raise HTTPException(status_code=404, detail="Content generation batch not found")
    return batch


def _job_status(job: AudioGenerationJob) -> str:
    return job.status.value if hasattr(job.status, "value") else str(job.status)


def _item_status(item: object) -> str:
    status = getattr(item, "status", "")
    return status.value if hasattr(status, "value") else str(status)


def _effective_items(jobs: list[object]) -> list[tuple[object, object]]:
    latest: dict[tuple[str, object, object], tuple[object, object]] = {}
    for job in sorted(jobs, key=lambda value: (value.created_at, str(value.id))):
        kind = "audio" if isinstance(job, AudioGenerationJob) else "translation"
        for item in job.items:
            latest[(kind, item.text_id, item.lang)] = (job, item)
    return list(latest.values())


def _pending_reviews(db: Session, batch: ContentGenerationBatch) -> list[dict[str, str]]:
    completed_items = [
        item for job in batch.translation_jobs for item in job.items if item.status == "completed"
    ]
    if not completed_items:
        return []
    pairs = {(item.text_id, item.lang) for item in completed_items}
    translations = db.scalars(
        select(Translation).where(
            Translation.text_id.in_({pair[0] for pair in pairs}),
            Translation.lang.in_({pair[1] for pair in pairs}),
            Translation.status == TranslationStatus.PENDING,
        )
    ).all()
    return [
        {"text_id": str(item.text_id), "lang": item.lang, "translation_id": str(item.id)}
        for item in translations
        if (item.text_id, item.lang) in pairs
    ]


def _batch_state(db: Session, batch: ContentGenerationBatch) -> tuple[str, str, dict[str, int]]:
    translation_active = [
        job for job in batch.translation_jobs if job.status in {"pending", "running"}
    ]
    translated_audio = [job for job in batch.audio_jobs if job.batch_stage == "translated_audio"]
    audio_active = [job for job in batch.audio_jobs if _job_status(job) in {"pending", "running"}]
    pending_reviews = _pending_reviews(db, batch)
    if translation_active:
        jobs = batch.translation_jobs
        return "running", "generating_translations", _aggregate(jobs)
    if pending_reviews:
        return (
            "awaiting_review",
            "awaiting_review",
            {
                "total": len(pending_reviews),
                "processed": 0,
                "succeeded": 0,
                "skipped": 0,
                "failed": 0,
            },
        )
    if audio_active:
        return "running", "generating_audio", _aggregate(audio_active)
    translation_counts = _aggregate(batch.translation_jobs)
    if (
        batch.translation_jobs
        and translation_counts["failed"]
        and not translation_counts["succeeded"]
        and not translation_counts["skipped"]
    ):
        return (
            "partial_failure",
            "completed",
            _aggregate([*batch.translation_jobs, *batch.audio_jobs]),
        )
    if batch.translation_jobs and not translated_audio:
        return "awaiting_review", "ready_for_translated_audio", translation_counts
    jobs = [*batch.translation_jobs, *batch.audio_jobs]
    counts = _aggregate(jobs)
    return ("partial_failure" if counts["failed"] else "completed"), "completed", counts


def _aggregate(jobs: list[object]) -> dict[str, int]:
    items = [item for _, item in _effective_items(jobs)]
    completed = [item for item in items if _item_status(item) == "completed"]
    failed = [item for item in items if _item_status(item) == "failed"]
    skipped = [item for item in completed if item.was_skipped]
    return {
        "total": len(items),
        "processed": len(completed) + len(failed),
        "succeeded": len(completed) - len(skipped),
        "skipped": len(skipped),
        "failed": len(failed),
    }


def _serialize_batch(
    db: Session, batch: ContentGenerationBatch, *, include_items: bool
) -> dict[str, object]:
    status, stage, progress = _batch_state(db, batch)
    effective_items = _effective_items([*batch.translation_jobs, *batch.audio_jobs])
    errors = [
        {
            "kind": "audio" if isinstance(job, AudioGenerationJob) else "translation",
            "text_id": str(item.text_id),
            "lang": item.lang,
            "message": item.error_message,
        }
        for job, item in effective_items
        if _item_status(item) == "failed"
    ]
    result: dict[str, object] = {
        "id": str(batch.id),
        "status": status,
        "current_stage": stage,
        "source": batch.source,
        "voice_overrides": batch.voice_overrides,
        "auto_approve_translations": batch.auto_approve_translations,
        "generate_translated_audio": batch.generate_translated_audio,
        "created_at": batch.created_at.isoformat(),
        "progress": progress,
        "pending_reviews": _pending_reviews(db, batch),
        "errors": errors,
    }
    if include_items:
        result["items"] = [
            {
                "kind": "audio" if isinstance(job, AudioGenerationJob) else "translation",
                "text_id": str(item.text_id),
                "lang": item.lang,
                "status": _item_status(item),
                "skipped": item.was_skipped,
            }
            for job, item in effective_items
        ]
    return result


@router.post("")
def create_batch(
    payload: BatchCreateRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    text_ids = list(dict.fromkeys(payload.text_ids))
    texts = list(db.scalars(select(Text).where(Text.id.in_(text_ids))).all())
    if len(texts) != len(text_ids):
        raise HTTPException(status_code=404, detail="One or more texts were not found")
    source_language = get_source_language(db).code
    target_languages: list[str] = []
    for language in dict.fromkeys(payload.target_languages):
        try:
            normalized = get_active_language(db, language).code
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if normalized == source_language:
            raise HTTPException(status_code=400, detail="Target language is the source language")
        target_languages.append(normalized)
    audio_languages: list[str] | None = None
    if payload.audio_languages is not None:
        audio_languages = []
        for language in dict.fromkeys(payload.audio_languages):
            try:
                normalized = get_active_language(db, language).code
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            if normalized != source_language:
                audio_languages.append(normalized)
    voice_overrides: dict[str, str] = {}
    for language, voice_id in payload.voice_overrides.items():
        try:
            normalized = get_active_language(db, language).code
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        voice = db.scalar(
            select(Voice)
            .options(selectinload(Voice.languages))
            .where(Voice.elevenlabs_id == voice_id)
        )
        if voice is None:
            raise HTTPException(status_code=400, detail=f"Voice not found: {voice_id}")
        supported_languages = {item.code for item in voice.languages}
        if supported_languages and normalized not in supported_languages:
            raise HTTPException(
                status_code=400,
                detail=f"Voice {voice.name} is not available for language {normalized}",
            )
        voice_overrides[normalized] = voice.elevenlabs_id
    if (
        not target_languages
        and not payload.generate_source_audio
        and not payload.generate_translated_audio
    ):
        raise HTTPException(status_code=422, detail="Select translations or audio generation")
    approved_translations = (
        list(
            db.scalars(
                select(Translation).where(
                    Translation.text_id.in_(text_ids),
                    Translation.status == TranslationStatus.APPROVED,
                    *(
                        [Translation.lang.in_(audio_languages)]
                        if audio_languages is not None
                        else []
                    ),
                )
            ).all()
        )
        if payload.generate_translated_audio
        else []
    )
    if (
        payload.generate_translated_audio
        and not approved_translations
        and not target_languages
        and not payload.generate_source_audio
    ):
        raise HTTPException(
            status_code=422, detail="No approved translations are available for audio generation"
        )
    batch = ContentGenerationBatch(
        created_at=datetime.now(UTC),
        requested_by=current_admin.email,
        source=payload.source,
        voice_overrides=voice_overrides,
        auto_approve_translations=payload.auto_approve_translations,
        generate_translated_audio=payload.generate_translated_audio,
        status="running",
        current_stage="generating_translations" if target_languages else "generating_audio",
    )
    db.add(batch)
    db.flush()
    if target_languages:
        create_translation_job(
            db,
            current_admin.email,
            [(text.id, language) for text in texts for language in target_languages],
            batch_id=batch.id,
            policy=payload.policy,
        )
    if payload.generate_source_audio:
        _create_audio_jobs_by_language(
            db,
            current_admin.email,
            [(text.id, source_language) for text in texts],
            batch=batch,
            batch_stage="source_audio",
            policy=payload.policy,
        )
    if approved_translations:
        _create_audio_jobs_by_language(
            db,
            current_admin.email,
            [(translation.text_id, translation.lang) for translation in approved_translations],
            batch=batch,
            batch_stage="existing_translated_audio",
            policy=payload.policy,
        )
    batch = _load_batch(db, batch.id)
    return envelope(_serialize_batch(db, batch, include_items=True), EnvelopeMeta())


@router.get("")
def list_batches(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    active: bool = True,
) -> dict[str, object]:
    batches = list(
        db.scalars(
            select(ContentGenerationBatch)
            .options(
                selectinload(ContentGenerationBatch.translation_jobs).selectinload(
                    TranslationGenerationJob.items
                ),
                selectinload(ContentGenerationBatch.audio_jobs).selectinload(
                    AudioGenerationJob.items
                ),
            )
            .order_by(ContentGenerationBatch.created_at.desc())
            .limit(20)
        ).unique()
    )
    serialized = [_serialize_batch(db, batch, include_items=False) for batch in batches]
    if active:
        serialized = [item for item in serialized if item["status"] != "completed"]
    return envelope(serialized, EnvelopeMeta(total=len(serialized)))


@router.get("/{batch_id}")
def get_batch(
    batch_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    return envelope(
        _serialize_batch(db, _load_batch(db, batch_id), include_items=True), EnvelopeMeta()
    )


@router.post("/{batch_id}/translated-audio")
def create_translated_audio(
    batch_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    batch = _load_batch(db, batch_id)
    if _pending_reviews(db, batch):
        raise HTTPException(status_code=409, detail="Review all generated translations first")
    policy = batch.translation_jobs[-1].policy if batch.translation_jobs else "missing_only"
    queue_approved_translated_audio(db, batch, current_admin.email, policy=policy)
    return envelope(
        _serialize_batch(db, _load_batch(db, batch_id), include_items=True), EnvelopeMeta()
    )


@router.post("/{batch_id}/retry-failed")
def retry_failed(
    batch_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    batch = _load_batch(db, batch_id)
    translation_items = [
        (item.text_id, item.lang)
        for _, item in _effective_items(batch.translation_jobs)
        if _item_status(item) == "failed"
    ]
    audio_items = [
        (item.text_id, item.lang)
        for _, item in _effective_items(batch.audio_jobs)
        if _item_status(item) == "failed"
    ]
    policy = batch.translation_jobs[-1].policy if batch.translation_jobs else "missing_only"
    if translation_items:
        create_translation_job(
            db,
            current_admin.email,
            translation_items,
            batch_id=batch.id,
            policy=policy,
        )
    if audio_items:
        _create_audio_jobs_by_language(
            db,
            current_admin.email,
            audio_items,
            batch=batch,
            batch_stage="retry_audio",
            policy=policy,
        )
    return envelope(
        _serialize_batch(db, _load_batch(db, batch_id), include_items=True), EnvelopeMeta()
    )
