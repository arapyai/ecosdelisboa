from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from starlette.responses import StreamingResponse

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.models.entities import AdminUser, AudioFile, Text, Translation, Voice
from app.models.enums import SupportedLanguage, TranslationStatus
from app.schemas.common import EnvelopeMeta, envelope
from app.services.audio_jobs import create_audio_job, run_audio_job, stream_job_events
from app.services.elevenlabs import ElevenLabsService
from app.services.llm import LLMTranslationService, request_translation
from app.services.r2 import R2Service

router = APIRouter(prefix="/api/v1/admin", tags=["admin-automation"])

translation_service = LLMTranslationService()
elevenlabs_service = ElevenLabsService()
r2_service = R2Service()


class TranslationReviewRequest(BaseModel):
    content: str
    phonetic_content: str | None = None
    status: TranslationStatus


class TranslationUpsertRequest(BaseModel):
    content: str
    phonetic_content: str | None = None
    status: TranslationStatus = TranslationStatus.PENDING


class AudioUploadRequest(BaseModel):
    public_url: str
    duration_s: float | None = None
    voice_id: str | None = None


class AudioJobRequest(BaseModel):
    items: list[dict[str, str]]


def get_text_or_404(db: Session, text_id: UUID) -> Text:
    text = db.scalar(
        select(Text)
        .options(
            selectinload(Text.translations),
            selectinload(Text.audio_files),
            selectinload(Text.point),
        )
        .where(Text.id == text_id)
    )
    if text is None:
        raise HTTPException(status_code=404, detail="Text not found")
    return text


@router.post("/translations/{text_id}/{lang}")
def trigger_translation(
    text_id: UUID,
    lang: SupportedLanguage,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    if lang == SupportedLanguage.PT:
        raise HTTPException(status_code=400, detail="Portuguese is the source language")
    text = get_text_or_404(db, text_id)
    translation = request_translation(db, text, lang, translation_service)
    db.commit()
    db.refresh(translation)
    return envelope(
        {
            "id": str(translation.id),
            "text_id": str(translation.text_id),
            "lang": translation.lang.value,
            "content": translation.content,
            "status": translation.status.value,
        },
        EnvelopeMeta(),
    )


@router.put("/translations/{text_id}/{lang}/manual")
def upsert_translation(
    text_id: UUID,
    lang: SupportedLanguage,
    payload: TranslationUpsertRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    if lang == SupportedLanguage.PT:
        raise HTTPException(status_code=400, detail="Portuguese is the source language")
    text = get_text_or_404(db, text_id)
    translation = db.scalar(
        select(Translation).where(Translation.text_id == text.id, Translation.lang == lang)
    )
    if translation is None:
        translation = Translation(text_id=text.id, lang=lang)
        db.add(translation)
    translation.content = payload.content
    translation.phonetic_content = payload.phonetic_content
    translation.status = payload.status
    translation.auto_translated = False
    translation.reviewed_by = current_admin.email
    translation.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(translation)
    return envelope(
        {
            "id": str(translation.id),
            "text_id": str(translation.text_id),
            "lang": translation.lang.value,
            "content": translation.content,
            "phonetic_content": translation.phonetic_content,
            "status": translation.status.value,
            "auto_translated": translation.auto_translated,
            "reviewed_by": translation.reviewed_by,
        },
        EnvelopeMeta(),
    )


@router.put("/translations/{translation_id}/review")
def review_translation(
    translation_id: UUID,
    payload: TranslationReviewRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    translation = db.get(Translation, translation_id)
    if translation is None:
        raise HTTPException(status_code=404, detail="Translation not found")
    translation.content = payload.content
    translation.phonetic_content = payload.phonetic_content
    translation.status = payload.status
    translation.reviewed_by = current_admin.email
    translation.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(translation)
    return envelope(
        {
            "id": str(translation.id),
            "status": translation.status.value,
            "reviewed_by": translation.reviewed_by,
        },
        EnvelopeMeta(),
    )


@router.delete("/translations/{translation_id}")
def delete_translation(
    translation_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    translation = db.get(Translation, translation_id)
    if translation is None:
        raise HTTPException(status_code=404, detail="Translation not found")
    db.delete(translation)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.get("/translations")
def list_translations(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    status: TranslationStatus | None = None,
    lang: SupportedLanguage | None = None,
) -> dict[str, object]:
    query = select(Translation).order_by(Translation.created_at.desc())
    if status is not None:
        query = query.where(Translation.status == status)
    if lang is not None:
        query = query.where(Translation.lang == lang)
    translations = db.scalars(query).all()
    return envelope(
        [
            {
                "id": str(item.id),
                "text_id": str(item.text_id),
                "lang": item.lang.value,
                "status": item.status.value,
                "reviewed_by": item.reviewed_by,
            }
            for item in translations
        ],
        EnvelopeMeta(total=len(translations)),
    )


@router.get("/voices")
def list_voices(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    lang: SupportedLanguage | None = None,
) -> dict[str, object]:
    query = select(Voice).order_by(Voice.name)
    if lang is not None:
        query = query.where(Voice.lang == lang)
    voices = db.scalars(query).all()
    return envelope(
        [
            {
                "id": str(v.id),
                "elevenlabs_id": v.elevenlabs_id,
                "name": v.name,
                "preview_url": v.preview_url,
                "lang": v.lang.value if v.lang else None,
                "is_default": v.is_default,
            }
            for v in voices
        ],
        EnvelopeMeta(total=len(voices)),
    )


@router.post("/voices/sync")
def sync_voices(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    synced: list[Voice] = []
    for voice_data in elevenlabs_service.list_voices():
        existing = db.scalar(
            select(Voice).where(Voice.elevenlabs_id == voice_data["elevenlabs_id"])
        )
        if existing is None:
            existing = Voice(
                elevenlabs_id=str(voice_data["elevenlabs_id"]),
                name=str(voice_data["name"]),
                preview_url=str(voice_data["preview_url"]),
            )
            db.add(existing)
        else:
            existing.name = str(voice_data["name"])
            existing.preview_url = str(voice_data["preview_url"])
        synced.append(existing)
    db.commit()
    return envelope({"synced": len(synced)}, EnvelopeMeta())


@router.put("/voices/{voice_id}/lang")
def set_voice_lang(
    voice_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    lang: SupportedLanguage | None = None,
) -> dict[str, object]:
    voice = db.get(Voice, voice_id)
    if voice is None:
        raise HTTPException(status_code=404, detail="Voice not found")
    voice.lang = lang
    db.commit()
    db.refresh(voice)
    return envelope({"id": str(voice.id), "lang": voice.lang.value if voice.lang else None}, EnvelopeMeta())


@router.put("/voices/{voice_id}/default")
def set_default_voice(
    voice_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    voice = db.get(Voice, voice_id)
    if voice is None:
        raise HTTPException(status_code=404, detail="Voice not found")
    for current in db.scalars(select(Voice)).all():
        current.is_default = current.id == voice.id
    db.commit()
    return envelope({"default_voice_id": str(voice.id)}, EnvelopeMeta())


@router.post("/audio/{text_id}/{lang}/generate")
def generate_audio(
    text_id: UUID,
    lang: SupportedLanguage,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    voice_id: str | None = None,
) -> dict[str, object]:
    text = get_text_or_404(db, text_id)
    job = create_audio_job(db, requested_by=None, items=[(text.id, lang)])
    run_audio_job(db, job.id, elevenlabs_service, r2_service, preferred_voice_id=voice_id)
    audio_file = db.scalar(
        select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == lang)
    )
    return envelope(
        {
            "job_id": str(job.id),
            "audio": {
                "lang": audio_file.lang.value if audio_file else lang.value,
                "public_url": audio_file.public_url if audio_file else None,
                "manually_uploaded": audio_file.manually_uploaded if audio_file else False,
            },
        },
        EnvelopeMeta(),
    )


@router.put("/audio/{text_id}/{lang}/upload")
def upload_audio(
    text_id: UUID,
    lang: SupportedLanguage,
    payload: AudioUploadRequest,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    text = get_text_or_404(db, text_id)
    audio_file = db.scalar(
        select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == lang)
    )
    if audio_file is None:
        audio_file = AudioFile(text_id=text.id, lang=lang)
        db.add(audio_file)
    audio_file.r2_key = None
    audio_file.public_url = payload.public_url
    audio_file.duration_s = payload.duration_s
    audio_file.voice_id = payload.voice_id
    audio_file.manually_uploaded = True
    audio_file.generated_at = None
    db.commit()
    db.refresh(audio_file)
    return envelope(
        {
            "id": str(audio_file.id),
            "public_url": audio_file.public_url,
            "manually_uploaded": audio_file.manually_uploaded,
        },
        EnvelopeMeta(),
    )


@router.delete("/audio/{text_id}/{lang}")
def delete_audio(
    text_id: UUID,
    lang: SupportedLanguage,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    text = get_text_or_404(db, text_id)
    audio_file = db.scalar(
        select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == lang)
    )
    if audio_file is None:
        raise HTTPException(status_code=404, detail="Audio not found")
    if audio_file.r2_key:
        r2_service.delete_audio(audio_file.r2_key)
    db.delete(audio_file)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.get("/audio")
def list_audio_status(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    audio_files = db.scalars(select(AudioFile).order_by(AudioFile.created_at.desc())).all()
    return envelope(
        [
            {
                "id": str(audio.id),
                "text_id": str(audio.text_id),
                "lang": audio.lang.value,
                "public_url": audio.public_url,
                "manually_uploaded": audio.manually_uploaded,
            }
            for audio in audio_files
        ],
        EnvelopeMeta(total=len(audio_files)),
    )


@router.post("/audio/jobs")
def create_and_run_audio_job(
    payload: AudioJobRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    items = [(UUID(item["text_id"]), SupportedLanguage(item["lang"])) for item in payload.items]
    first_voice_id: str | None = payload.items[0].get("voice_id") if payload.items else None
    job = create_audio_job(db, current_admin.email, items)
    run_audio_job(db, job.id, elevenlabs_service, r2_service, preferred_voice_id=first_voice_id)
    return envelope(
        {
            "job_id": str(job.id),
            "status": job.status.value,
            "processed": job.processed,
            "total": job.total,
        },
        EnvelopeMeta(),
    )


@router.get("/audio/jobs/{job_id}/events")
def stream_audio_job_events(
    job_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    return StreamingResponse(stream_job_events(db, job_id), media_type="text/event-stream")
