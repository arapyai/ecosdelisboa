from random import choice
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models.entities import Voice
from app.schemas.common import EnvelopeMeta, envelope
from app.services.languages import get_active_language

router = APIRouter(prefix="/api/v1/voices", tags=["voices"])


@router.get("/default")
def get_default_voice(db: Annotated[Session, Depends(get_db)]) -> dict[str, object]:
    voices = db.scalars(
        select(Voice).options(selectinload(Voice.languages)).where(Voice.is_default.is_(True))
    ).all()
    if not voices:
        raise HTTPException(status_code=404, detail="Default voice not found")
    voice = choice(voices)

    return envelope(
        {
            "id": str(voice.id),
            "elevenlabs_id": voice.elevenlabs_id,
            "name": voice.name,
            "preview_url": voice.preview_url,
            "gender": voice.gender,
            "languages": sorted(language.code for language in voice.languages),
        },
        EnvelopeMeta(),
    )


@router.get("")
def list_voices(
    db: Annotated[Session, Depends(get_db)],
    lang: str | None = None,
) -> dict[str, object]:
    query = select(Voice).options(selectinload(Voice.languages)).order_by(Voice.name)
    if lang is not None:
        try:
            language_code = get_active_language(db, lang).code
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        query = query.where(Voice.languages.any(code=language_code))
    voices = db.scalars(query).unique().all()
    return envelope(
        [
            {
                "id": str(v.id),
                "elevenlabs_id": v.elevenlabs_id,
                "name": v.name,
                "preview_url": v.preview_url,
                "gender": v.gender,
                "languages": sorted(language.code for language in v.languages),
                "lang": (v.languages[0].code if len(v.languages) == 1 else None),
                "is_default": v.is_default,
            }
            for v in voices
        ],
        EnvelopeMeta(total=len(voices)),
    )
