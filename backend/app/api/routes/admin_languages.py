from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.models.entities import AdminUser, Language, Voice
from app.schemas.common import EnvelopeMeta, envelope
from app.services.languages import (
    apply_language_catalog,
    get_active_language,
    normalize_language_code,
    set_source_language,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin-languages"])
csv_file = File(...)


class LanguageCreate(BaseModel):
    code: str
    locale: str
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    name: str
    is_active: bool = True


class LanguageUpdate(BaseModel):
    locale: str
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    name: str


def serialize_language(language: Language) -> dict[str, object]:
    return {
        "code": language.code,
        "locale": language.locale,
        "country_code": language.country_code,
        "name": language.name,
        "is_active": language.is_active,
        "is_source": language.is_source,
    }


def get_language_or_404(db: Session, language_code: str) -> Language:
    try:
        code = normalize_language_code(language_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    language = db.get(Language, code)
    if language is None:
        raise HTTPException(status_code=404, detail="Language not found")
    return language


def get_voice_or_404(db: Session, voice_id: UUID) -> Voice:
    voice = db.scalar(
        select(Voice).options(selectinload(Voice.languages)).where(Voice.id == voice_id)
    )
    if voice is None:
        raise HTTPException(status_code=404, detail="Voice not found")
    return voice


@router.get("/languages")
def list_languages(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    active: bool | None = None,
) -> dict[str, object]:
    query = select(Language).order_by(Language.name)
    if active is not None:
        query = query.where(Language.is_active.is_(active))
    languages = db.scalars(query).all()
    return envelope(
        [serialize_language(language) for language in languages],
        EnvelopeMeta(total=len(languages)),
    )


@router.post("/languages", status_code=status.HTTP_201_CREATED)
def create_language(
    payload: LanguageCreate,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    try:
        code = normalize_language_code(payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if db.get(Language, code) is not None:
        raise HTTPException(status_code=409, detail="Language already exists")
    language = Language(
        code=code,
        locale=payload.locale,
        country_code=payload.country_code.upper() if payload.country_code else None,
        name=payload.name,
        is_active=payload.is_active,
    )
    db.add(language)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Language locale already exists") from exc
    db.refresh(language)
    return envelope(serialize_language(language), EnvelopeMeta())


@router.put("/languages/{language_code}")
def update_language(
    language_code: str,
    payload: LanguageUpdate,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    language = get_language_or_404(db, language_code)
    language.locale = payload.locale
    language.country_code = payload.country_code.upper() if payload.country_code else None
    language.name = payload.name
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Language locale already exists") from exc
    db.refresh(language)
    return envelope(serialize_language(language), EnvelopeMeta())


@router.delete("/languages/{language_code}")
def deactivate_language(
    language_code: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    language = get_language_or_404(db, language_code)
    if language.is_source:
        raise HTTPException(
            status_code=409,
            detail="Select another source language before deactivating this language",
        )
    language.is_active = False
    db.commit()
    return envelope(serialize_language(language), EnvelopeMeta())


@router.put("/languages/{language_code}/activate")
def activate_language(
    language_code: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    language = get_language_or_404(db, language_code)
    language.is_active = True
    db.commit()
    return envelope(serialize_language(language), EnvelopeMeta())


@router.put("/languages/{language_code}/source")
def select_source_language(
    language_code: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    try:
        language = get_active_language(db, language_code)
        set_source_language(db, language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    return envelope(serialize_language(language), EnvelopeMeta())


@router.post("/languages/import")
async def import_languages(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    replace: bool = False,
    file: UploadFile = csv_file,
) -> dict[str, object]:
    try:
        csv_content = (await file.read()).decode("utf-8-sig")
        result = apply_language_catalog(csv_content, db, replace=replace)
    except (UnicodeDecodeError, ValueError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Catalog conflicts with existing data") from exc
    return envelope(result, EnvelopeMeta())


@router.put("/voices/{voice_id}/languages/{language_code}")
def add_voice_language(
    voice_id: UUID,
    language_code: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    voice = get_voice_or_404(db, voice_id)
    try:
        language = get_active_language(db, language_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if language not in voice.languages:
        voice.languages.append(language)
    db.commit()
    return envelope(
        {"id": str(voice.id), "languages": sorted(item.code for item in voice.languages)},
        EnvelopeMeta(),
    )


@router.delete("/voices/{voice_id}/languages/{language_code}")
def remove_voice_language(
    voice_id: UUID,
    language_code: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    voice = get_voice_or_404(db, voice_id)
    try:
        code = normalize_language_code(language_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    voice.languages = [language for language in voice.languages if language.code != code]
    db.commit()
    return envelope(
        {"id": str(voice.id), "languages": sorted(item.code for item in voice.languages)},
        EnvelopeMeta(),
    )
