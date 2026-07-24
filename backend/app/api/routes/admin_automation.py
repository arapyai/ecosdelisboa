from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from starlette.responses import StreamingResponse

from app.api.deps import get_current_admin
from app.core.config import get_settings
from app.core.db import get_db
from app.models.entities import AdminUser, AudioFile, Text, Translation, Voice
from app.models.enums import TextOrigin, TranslationStatus
from app.schemas.common import EnvelopeMeta, envelope
from app.services.audio_jobs import create_audio_job, process_audio_job, stream_job_events
from app.services.audio_storage import AudioStorage, manual_audio_key
from app.services.audio_uploads import validate_mp3_upload
from app.services.editorial_translations import mark_manual_translation
from app.services.elevenlabs import ElevenLabsService
from app.services.languages import (
    get_active_language,
    get_source_language,
    normalize_language_code,
)
from app.services.llm import LLMTranslationService, request_translation

router = APIRouter(prefix="/api/v1/admin", tags=["admin-automation"])

translation_service = LLMTranslationService()
elevenlabs_service = ElevenLabsService()
settings = get_settings()
audio_storage = AudioStorage(
    storage_dir=settings.audio_storage_dir,
    public_base_url=settings.audio_public_base_url,
)


class TranslationReviewRequest(BaseModel):
    content: str
    phonetic_content: str | None = None
    status: TranslationStatus


class TranslationUpsertRequest(BaseModel):
    content: str
    phonetic_content: str | None = None
    status: TranslationStatus = TranslationStatus.PENDING


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


def resolve_active_language(db: Session, lang: str) -> str:
    try:
        return get_active_language(db, lang).code
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def serialize_voice(voice: Voice) -> dict[str, object]:
    languages = sorted(language.code for language in voice.languages)
    return {
        "id": str(voice.id),
        "elevenlabs_id": voice.elevenlabs_id,
        "name": voice.name,
        "preview_url": voice.preview_url,
        "gender": voice.gender,
        "languages": languages,
        "lang": languages[0] if len(languages) == 1 else None,
        "is_default": voice.is_default,
    }


def serialize_audio_file(audio_file: AudioFile) -> dict[str, object]:
    return {
        "id": str(audio_file.id),
        "text_id": str(audio_file.text_id),
        "lang": audio_file.lang,
        "public_url": audio_file.public_url,
        "duration_s": audio_file.duration_s,
        "voice_id": audio_file.voice_id,
        "generated_at": (audio_file.generated_at.isoformat() if audio_file.generated_at else None),
        "manually_uploaded": audio_file.manually_uploaded,
    }


def serialize_translation(translation: Translation) -> dict[str, object]:
    return {
        "id": str(translation.id),
        "text_id": str(translation.text_id),
        "lang": translation.lang,
        "content": translation.content,
        "phonetic_content": translation.phonetic_content,
        "status": translation.status.value,
        "auto_translated": translation.auto_translated,
        "origin": translation.origin,
        "reviewed_by": translation.reviewed_by,
        "reviewed_at": translation.reviewed_at.isoformat() if translation.reviewed_at else None,
    }


@router.post("/translations/{text_id}/{lang}")
def trigger_translation(
    text_id: UUID,
    lang: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    lang = resolve_active_language(db, lang)
    if lang == get_source_language(db).code:
        raise HTTPException(status_code=400, detail="Target language is the source language")
    text = get_text_or_404(db, text_id)
    translation = request_translation(db, text, lang, translation_service)
    db.commit()
    db.refresh(translation)
    return envelope(
        serialize_translation(translation),
        EnvelopeMeta(),
    )


@router.put("/translations/{text_id}/{lang}/manual")
def upsert_translation(
    text_id: UUID,
    lang: str,
    payload: TranslationUpsertRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    lang = resolve_active_language(db, lang)
    if lang == get_source_language(db).code:
        raise HTTPException(status_code=400, detail="Target language is the source language")
    text = get_text_or_404(db, text_id)
    translation = db.scalar(
        select(Translation).where(Translation.text_id == text.id, Translation.lang == lang)
    )
    if translation is None:
        translation = Translation(text_id=text.id, lang=lang)
        db.add(translation)
    translation.content = payload.content
    translation.phonetic_content = payload.phonetic_content
    mark_manual_translation(
        translation,
        status=payload.status,
        reviewer=current_admin.email,
    )
    db.commit()
    db.refresh(translation)
    return envelope(
        serialize_translation(translation),
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
    mark_manual_translation(
        translation,
        status=payload.status,
        reviewer=current_admin.email,
    )
    db.commit()
    db.refresh(translation)
    return envelope(
        serialize_translation(translation),
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
    lang: str | None = None,
    origin: TextOrigin | None = None,
    text_id: UUID | None = None,
) -> dict[str, object]:
    query = select(Translation).order_by(Translation.created_at.desc())
    if status is not None:
        query = query.where(Translation.status == status)
    if lang is not None:
        lang = normalize_language_code(lang)
        query = query.where(Translation.lang == lang)
    if origin is not None:
        query = query.where(Translation.origin == origin.value)
    if text_id is not None:
        query = query.where(Translation.text_id == text_id)
    translations = db.scalars(query).all()
    return envelope(
        [serialize_translation(item) for item in translations],
        EnvelopeMeta(total=len(translations)),
    )


@router.get("/voices")
def list_voices(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    lang: str | None = None,
) -> dict[str, object]:
    query = select(Voice).options(selectinload(Voice.languages)).order_by(Voice.name)
    if lang is not None:
        language = resolve_active_language(db, lang)
        query = query.where(Voice.languages.any(code=language))
    voices = db.scalars(query).unique().all()
    return envelope(
        [serialize_voice(voice) for voice in voices],
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
    lang: str | None = None,
) -> dict[str, object]:
    voice = db.scalar(
        select(Voice).options(selectinload(Voice.languages)).where(Voice.id == voice_id)
    )
    if voice is None:
        raise HTTPException(status_code=404, detail="Voice not found")
    if lang is None:
        voice.languages = []
    else:
        voice.languages = [get_active_language(db, resolve_active_language(db, lang))]
    db.commit()
    db.refresh(voice)
    return envelope(
        {
            "id": str(voice.id),
            "lang": voice.languages[0].code if voice.languages else None,
            "languages": [language.code for language in voice.languages],
        },
        EnvelopeMeta(),
    )


@router.put("/voices/{voice_id}/default")
def set_default_voice(
    voice_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    voice = db.get(Voice, voice_id)
    if voice is None:
        raise HTTPException(status_code=404, detail="Voice not found")
    voice.is_default = True
    db.commit()
    return envelope({"default_voice_id": str(voice.id), "is_default": True}, EnvelopeMeta())


@router.delete("/voices/{voice_id}/default")
def remove_default_voice(
    voice_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    voice = db.get(Voice, voice_id)
    if voice is None:
        raise HTTPException(status_code=404, detail="Voice not found")
    voice.is_default = False
    db.commit()
    return envelope({"default_voice_id": str(voice.id), "is_default": False}, EnvelopeMeta())


@router.post("/audio/{text_id}/{lang}/generate")
def generate_audio(
    text_id: UUID,
    lang: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    voice_id: str | None = None,
) -> dict[str, object]:
    lang = resolve_active_language(db, lang)
    text = get_text_or_404(db, text_id)
    job = create_audio_job(
        db,
        requested_by=None,
        items=[(text.id, lang)],
        preferred_voice_id=voice_id,
        start_immediately=True,
    )
    process_audio_job(db, job.id, elevenlabs_service, audio_storage)
    audio_file = db.scalar(
        select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == lang)
    )
    return envelope(
        {
            "job_id": str(job.id),
            "status": job.status.value,
            "error": job.last_error,
            "audio": serialize_audio_file(audio_file) if audio_file else None,
        },
        EnvelopeMeta(),
    )


@router.put("/audio/{text_id}/{lang}/upload")
async def upload_audio(
    text_id: UUID,
    lang: str,
    file: Annotated[UploadFile, File(description="MP3 file for this text and language")],
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    lang = resolve_active_language(db, lang)
    text = get_text_or_404(db, text_id)
    content = await file.read(settings.audio_upload_max_bytes + 1)
    await file.close()
    try:
        validate_mp3_upload(
            filename=file.filename,
            content_type=file.content_type,
            content=content,
            max_bytes=settings.audio_upload_max_bytes,
        )
    except TypeError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except OverflowError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    audio_file = db.scalar(
        select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == lang)
    )
    previous_key = audio_file.r2_key if audio_file else None
    storage_key = manual_audio_key(text.id, lang)
    public_url = audio_storage.upload_audio(storage_key, content)
    if audio_file is None:
        audio_file = AudioFile(text_id=text.id, lang=lang)
        db.add(audio_file)
    audio_file.r2_key = storage_key
    audio_file.public_url = public_url
    audio_file.duration_s = None
    audio_file.voice_id = None
    audio_file.manually_uploaded = True
    audio_file.generated_at = None
    try:
        db.commit()
    except Exception:
        db.rollback()
        if previous_key != storage_key:
            audio_storage.delete_audio(storage_key)
        raise
    db.refresh(audio_file)
    if previous_key and previous_key != storage_key:
        audio_storage.delete_audio(previous_key)
    return envelope(
        serialize_audio_file(audio_file),
        EnvelopeMeta(),
    )


@router.delete("/audio/{text_id}/{lang}")
def delete_audio(
    text_id: UUID,
    lang: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    lang = normalize_language_code(lang)
    text = get_text_or_404(db, text_id)
    audio_file = db.scalar(
        select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == lang)
    )
    if audio_file is None:
        raise HTTPException(status_code=404, detail="Audio not found")
    if audio_file.r2_key:
        audio_storage.delete_audio(audio_file.r2_key)
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
        [serialize_audio_file(audio) for audio in audio_files],
        EnvelopeMeta(total=len(audio_files)),
    )


@router.post("/audio/jobs")
def create_audio_generation_job(
    payload: AudioJobRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    items = [
        (UUID(item["text_id"]), resolve_active_language(db, item["lang"])) for item in payload.items
    ]
    first_voice_id: str | None = payload.items[0].get("voice_id") if payload.items else None
    job = create_audio_job(
        db,
        current_admin.email,
        items,
        preferred_voice_id=first_voice_id,
    )
    return envelope(
        {
            "job_id": str(job.id),
            "status": job.status.value,
            "processed": job.processed,
            "total": job.total,
            "error": job.last_error,
        },
        EnvelopeMeta(),
    )


@router.get("/audio/jobs/{job_id}/events")
def stream_audio_job_events(
    job_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    return StreamingResponse(
        stream_job_events(db, job_id, settings.audio_worker_poll_interval_s),
        media_type="text/event-stream",
    )
