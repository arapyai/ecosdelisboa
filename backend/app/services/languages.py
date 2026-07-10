import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.entities import Language, Voice, voice_languages

LANGUAGE_CODE_PATTERN = re.compile(r"^[a-z]{2,8}$")
LOCALE_PATTERN = re.compile(r"^[a-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$")
COUNTRY_CODE_PATTERN = re.compile(r"^[A-Z]{2}$")
REQUIRED_COLUMNS = {
    "language_code",
    "locale",
    "country_code",
    "language_name",
    "is_source",
    "gender",
    "voice_label",
    "voice_name",
    "elevenlabs_voice_id",
    "is_default",
}


@dataclass(frozen=True)
class CatalogLanguage:
    code: str
    locale: str
    country_code: str | None
    name: str
    is_source: bool


@dataclass(frozen=True)
class CatalogVoice:
    elevenlabs_id: str
    name: str
    gender: str | None
    is_default: bool


@dataclass(frozen=True)
class LanguageCatalog:
    languages: dict[str, CatalogLanguage]
    voices: dict[str, CatalogVoice]
    associations: set[tuple[str, str]]


def normalize_language_code(code: str) -> str:
    normalized = code.strip().lower()
    if not LANGUAGE_CODE_PATTERN.fullmatch(normalized):
        raise ValueError("Language code must contain 2 to 8 lowercase letters")
    return normalized


def get_active_language(db: Session, code: str) -> Language:
    normalized = normalize_language_code(code)
    language = db.get(Language, normalized)
    if language is None or not language.is_active:
        raise ValueError(f"Language '{normalized}' is not active")
    return language


def get_source_language(db: Session) -> Language:
    language = db.scalar(
        select(Language).where(Language.is_source.is_(True), Language.is_active.is_(True))
    )
    if language is None:
        raise ValueError("No active source language configured")
    return language


def set_source_language(db: Session, language: Language) -> None:
    if not language.is_active:
        raise ValueError("Source language must be active")
    for current in db.scalars(select(Language).where(Language.is_source.is_(True))).all():
        current.is_source = False
    db.flush()
    language.is_source = True


def _value(row: dict[str, str], field: str) -> str:
    return (row.get(field) or "").strip()


def _boolean(row: dict[str, str], field: str, row_number: int) -> bool:
    raw = _value(row, field).lower()
    if raw == "true":
        return True
    if raw == "false":
        return False
    raise ValueError(f"Row {row_number}: {field} must be true or false")


def parse_language_catalog(csv_content: str) -> LanguageCatalog:
    reader = csv.DictReader(io.StringIO(csv_content))
    if reader.fieldnames is None:
        raise ValueError("CSV header is required")
    missing = REQUIRED_COLUMNS - set(reader.fieldnames)
    if missing:
        raise ValueError(f"Missing required CSV columns: {', '.join(sorted(missing))}")

    languages: dict[str, CatalogLanguage] = {}
    locales: dict[str, str] = {}
    voices: dict[str, CatalogVoice] = {}
    associations: set[tuple[str, str]] = set()

    for row_number, row in enumerate(reader, start=2):
        try:
            code = normalize_language_code(_value(row, "language_code"))
        except ValueError as exc:
            raise ValueError(f"Row {row_number}: {exc}") from exc
        locale = _value(row, "locale")
        if len(locale) > 35 or not LOCALE_PATTERN.fullmatch(locale):
            raise ValueError(f"Row {row_number}: invalid locale")
        country_code = _value(row, "country_code") or None
        if country_code is not None and not COUNTRY_CODE_PATTERN.fullmatch(country_code):
            raise ValueError(f"Row {row_number}: country_code must be an ISO alpha-2 code")
        language_name = _value(row, "language_name")
        if not language_name:
            raise ValueError(f"Row {row_number}: language_name is required")
        if len(language_name) > 100:
            raise ValueError(f"Row {row_number}: language_name is too long")
        if locale in locales and locales[locale] != code:
            raise ValueError(f"Row {row_number}: locale '{locale}' is already used")
        locales[locale] = code
        language = CatalogLanguage(
            code=code,
            locale=locale,
            country_code=country_code,
            name=language_name,
            is_source=_boolean(row, "is_source", row_number),
        )
        if code in languages and languages[code] != language:
            raise ValueError(f"Row {row_number}: inconsistent metadata for language '{code}'")
        languages[code] = language

        elevenlabs_id = _value(row, "elevenlabs_voice_id")
        if not elevenlabs_id:
            raise ValueError(f"Row {row_number}: elevenlabs_voice_id is required")
        if len(elevenlabs_id) > 255:
            raise ValueError(f"Row {row_number}: elevenlabs_voice_id is too long")
        voice_name = _value(row, "voice_name") or _value(row, "voice_label")
        if not voice_name:
            raise ValueError(f"Row {row_number}: voice_name or voice_label is required")
        if len(voice_name) > 255:
            raise ValueError(f"Row {row_number}: voice name is too long")
        gender = _value(row, "gender").lower() or None
        voice = CatalogVoice(
            elevenlabs_id=elevenlabs_id,
            name=voice_name,
            gender=gender,
            is_default=_boolean(row, "is_default", row_number),
        )
        if elevenlabs_id in voices and voices[elevenlabs_id] != voice:
            raise ValueError(f"Row {row_number}: inconsistent metadata for voice '{elevenlabs_id}'")
        voices[elevenlabs_id] = voice
        associations.add((elevenlabs_id, code))

    if not languages:
        raise ValueError("CSV must include at least one language")
    source_codes = [language.code for language in languages.values() if language.is_source]
    if len(source_codes) > 1:
        raise ValueError("CSV can configure only one source language")
    return LanguageCatalog(languages, voices, associations)


def apply_language_catalog(
    csv_content: str,
    db: Session,
    *,
    replace: bool = False,
) -> dict[str, int]:
    catalog = parse_language_catalog(csv_content)
    source_codes = [item.code for item in catalog.languages.values() if item.is_source]
    if replace and len(source_codes) != 1:
        raise ValueError("Replacement CSV must define exactly one source language")
    if not source_codes and get_optional_source_language(db) is None:
        raise ValueError("CSV must define a source language when none is configured")

    if replace:
        db.execute(delete(voice_languages))
        for language in db.scalars(select(Language)).all():
            language.is_active = False
        for voice in db.scalars(select(Voice)).all():
            voice.is_default = False

    languages_created = 0
    voices_created = 0
    language_models: dict[str, Language] = {}
    for item in catalog.languages.values():
        language = db.get(Language, item.code)
        if language is None:
            language = Language(code=item.code, locale=item.locale, name=item.name)
            db.add(language)
            languages_created += 1
        language.locale = item.locale
        language.country_code = item.country_code
        language.name = item.name
        language.is_active = True
        language_models[item.code] = language

    db.flush()
    if source_codes:
        set_source_language(db, language_models[source_codes[0]])

    voice_models: dict[str, Voice] = {}
    for item in catalog.voices.values():
        voice = db.scalar(select(Voice).where(Voice.elevenlabs_id == item.elevenlabs_id))
        if voice is None:
            voice = Voice(elevenlabs_id=item.elevenlabs_id, name=item.name)
            db.add(voice)
            voices_created += 1
        voice.name = item.name
        voice.gender = item.gender
        if item.is_default:
            voice.is_default = True
        voice_models[item.elevenlabs_id] = voice

    db.flush()
    for elevenlabs_id, language_code in catalog.associations:
        voice = voice_models[elevenlabs_id]
        language = language_models[language_code]
        if language not in voice.languages:
            voice.languages.append(language)

    db.commit()
    return {
        "languages": len(catalog.languages),
        "languages_created": languages_created,
        "voices": len(catalog.voices),
        "voices_created": voices_created,
        "associations": len(catalog.associations),
    }


def get_optional_source_language(db: Session) -> Language | None:
    return db.scalar(select(Language).where(Language.is_source.is_(True)))


def seed_language_catalog(db: Session, path: Path) -> dict[str, int]:
    return apply_language_catalog(path.read_text(encoding="utf-8"), db)
