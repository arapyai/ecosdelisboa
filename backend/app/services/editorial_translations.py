from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy.orm import Session

from app.models.enums import TextOrigin, TranslationStatus
from app.services.languages import get_active_language, get_source_language


class EditorialTranslation(Protocol):
    lang: str
    status: TranslationStatus
    auto_translated: bool
    origin: str
    reviewed_by: str | None
    reviewed_at: datetime | None


def resolve_language_selection(db: Session, lang: str | None) -> tuple[str, str]:
    source_language = get_source_language(db).code
    selected_language = get_active_language(db, lang).code if lang else source_language
    return source_language, selected_language


def resolve_target_language(db: Session, lang: str) -> str:
    source_language, selected_language = resolve_language_selection(db, lang)
    if selected_language == source_language:
        raise ValueError("Target language is the source language")
    return selected_language


def select_approved_translation[TranslationModel: EditorialTranslation](
    translations: Iterable[TranslationModel],
    lang: str,
) -> TranslationModel | None:
    return next(
        (
            translation
            for translation in translations
            if translation.lang == lang and translation.status == TranslationStatus.APPROVED
        ),
        None,
    )


def mark_manual_translation(
    translation: EditorialTranslation,
    *,
    status: TranslationStatus,
    reviewer: str,
) -> None:
    translation.status = status
    translation.auto_translated = False
    translation.origin = TextOrigin.MANUAL.value
    translation.reviewed_by = reviewer
    translation.reviewed_at = datetime.now(UTC)


def serialize_editorial_metadata(translation: EditorialTranslation) -> dict[str, object]:
    return {
        "lang": translation.lang,
        "status": translation.status.value,
        "auto_translated": translation.auto_translated,
        "origin": translation.origin,
        "reviewed_by": translation.reviewed_by,
        "reviewed_at": (translation.reviewed_at.isoformat() if translation.reviewed_at else None),
    }
