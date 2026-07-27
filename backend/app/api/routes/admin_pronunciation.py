import base64
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.models.entities import AdminUser, PronunciationDictionary
from app.schemas.common import EnvelopeMeta, envelope
from app.services.elevenlabs import ElevenLabsService
from app.services.languages import get_active_language

router = APIRouter(prefix="/api/v1/admin/pronunciation-dictionaries", tags=["admin-pronunciation"])
elevenlabs_service = ElevenLabsService()


class PronunciationRule(BaseModel):
    type: Literal["alias", "phoneme"]
    string_to_replace: str = Field(min_length=1, max_length=200)
    alias: str | None = Field(default=None, max_length=500)
    alphabet: Literal["ipa"] | None = None
    phoneme: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_rule(self) -> "PronunciationRule":
        self.string_to_replace = self.string_to_replace.strip()
        if not self.string_to_replace:
            raise ValueError("string_to_replace cannot be blank")
        if self.type == "alias":
            self.alias = (self.alias or "").strip()
            if not self.alias:
                raise ValueError("alias is required for alias rules")
            self.alphabet = None
            self.phoneme = None
        else:
            self.phoneme = (self.phoneme or "").strip()
            if not self.phoneme:
                raise ValueError("phoneme is required for phoneme rules")
            self.alphabet = "ipa"
            self.alias = None
        return self

    def provider_payload(self) -> dict[str, str]:
        if self.type == "alias":
            return {
                "type": "alias",
                "string_to_replace": self.string_to_replace,
                "alias": self.alias or "",
            }
        return {
            "type": "phoneme",
            "string_to_replace": self.string_to_replace,
            "alphabet": "ipa",
            "phoneme": self.phoneme or "",
        }


class RuleSetRequest(BaseModel):
    rules: list[PronunciationRule]

    @model_validator(mode="after")
    def reject_duplicates(self) -> "RuleSetRequest":
        strings = [rule.string_to_replace for rule in self.rules]
        if len(strings) != len(set(strings)):
            raise ValueError("Duplicate string_to_replace values are not allowed")
        return self


class PreviewRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    voice_id: str = Field(min_length=1, max_length=255)

    @model_validator(mode="after")
    def strip_values(self) -> "PreviewRequest":
        self.text = self.text.strip()
        self.voice_id = self.voice_id.strip()
        if not self.text:
            raise ValueError("text cannot be blank")
        if not self.voice_id:
            raise ValueError("voice_id cannot be blank")
        return self


def get_active_language_or_400(db: Session, language_code: str):
    try:
        return get_active_language(db, language_code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def get_dictionary_or_404(db: Session, language_code: str) -> PronunciationDictionary:
    language = get_active_language_or_400(db, language_code)
    pronunciation_dictionary = db.scalar(
        select(PronunciationDictionary).where(
            PronunciationDictionary.language_code == language.code
        )
    )
    if pronunciation_dictionary is None:
        raise HTTPException(status_code=404, detail="Pronunciation dictionary not found")
    return pronunciation_dictionary


def serialize_dictionary(
    pronunciation_dictionary: PronunciationDictionary,
    rules: list[object] | None = None,
) -> dict[str, object]:
    data: dict[str, object] = {
        "id": str(pronunciation_dictionary.id),
        "language_code": pronunciation_dictionary.language_code,
        "elevenlabs_id": pronunciation_dictionary.elevenlabs_id,
        "version_id": pronunciation_dictionary.version_id,
        "name": pronunciation_dictionary.name,
        "last_published_at": (
            pronunciation_dictionary.last_published_at.isoformat()
            if pronunciation_dictionary.last_published_at
            else None
        ),
        "last_published_by": pronunciation_dictionary.last_published_by,
    }
    if rules is not None:
        data["rules"] = rules
    return data


def provider_error() -> HTTPException:
    return HTTPException(
        status_code=502,
        detail="ElevenLabs pronunciation service is unavailable",
    )


@router.get("")
def list_pronunciation_dictionaries(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    dictionaries = db.scalars(
        select(PronunciationDictionary).order_by(PronunciationDictionary.language_code)
    ).all()
    return envelope(
        [serialize_dictionary(item) for item in dictionaries],
        EnvelopeMeta(total=len(dictionaries)),
    )


@router.post("/{language_code}", status_code=status.HTTP_201_CREATED)
def create_pronunciation_dictionary(
    language_code: str,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    language = get_active_language_or_400(db, language_code)
    existing = db.scalar(
        select(PronunciationDictionary).where(
            PronunciationDictionary.language_code == language.code
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Pronunciation dictionary already exists")

    name = f"Lisboa por Outros — {language.name}"
    try:
        remote = elevenlabs_service.create_pronunciation_dictionary(name)
        remote_id = str(remote["id"])
        version_id = str(remote["version_id"])
    except (KeyError, TypeError, ValueError):
        raise provider_error() from None

    now = datetime.now(UTC)
    pronunciation_dictionary = PronunciationDictionary(
        language_code=language.code,
        elevenlabs_id=remote_id,
        version_id=version_id,
        name=str(remote.get("name") or name),
        last_published_at=now,
        last_published_by=current_admin.email,
    )
    db.add(pronunciation_dictionary)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Pronunciation dictionary already exists",
        ) from exc
    db.refresh(pronunciation_dictionary)
    return envelope(serialize_dictionary(pronunciation_dictionary, []), EnvelopeMeta())


@router.get("/{language_code}")
def get_pronunciation_dictionary(
    language_code: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    pronunciation_dictionary = get_dictionary_or_404(db, language_code)
    try:
        remote = elevenlabs_service.get_pronunciation_dictionary(
            pronunciation_dictionary.elevenlabs_id
        )
        rules = remote.get("rules", [])
        if not isinstance(rules, list):
            raise ValueError("Invalid rules response")
    except ValueError:
        raise provider_error() from None
    return envelope(serialize_dictionary(pronunciation_dictionary, rules), EnvelopeMeta())


@router.put("/{language_code}/rules")
def publish_pronunciation_rules(
    language_code: str,
    payload: RuleSetRequest,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    pronunciation_dictionary = get_dictionary_or_404(db, language_code)
    rules = [rule.provider_payload() for rule in payload.rules]
    try:
        remote = elevenlabs_service.set_pronunciation_dictionary_rules(
            pronunciation_dictionary.elevenlabs_id,
            rules,
        )
        version_id = str(remote["version_id"])
    except (KeyError, TypeError, ValueError):
        raise provider_error() from None

    pronunciation_dictionary.version_id = version_id
    pronunciation_dictionary.last_published_at = datetime.now(UTC)
    pronunciation_dictionary.last_published_by = current_admin.email
    db.commit()
    db.refresh(pronunciation_dictionary)
    return envelope(
        serialize_dictionary(pronunciation_dictionary, rules),
        EnvelopeMeta(),
    )


@router.post("/{language_code}/preview")
def preview_pronunciation_dictionary(
    language_code: str,
    payload: PreviewRequest,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    pronunciation_dictionary = get_dictionary_or_404(db, language_code)
    locator = [
        {
            "pronunciation_dictionary_id": pronunciation_dictionary.elevenlabs_id,
            "version_id": pronunciation_dictionary.version_id,
        }
    ]
    try:
        before = elevenlabs_service.generate_audio(payload.text, payload.voice_id)
        after = elevenlabs_service.generate_audio(
            payload.text,
            payload.voice_id,
            pronunciation_dictionary_locators=locator,
        )
    except ValueError:
        raise provider_error() from None

    return envelope(
        {
            "voice_id": payload.voice_id,
            "text": payload.text,
            "without_dictionary": {
                "content_type": "audio/mpeg",
                "audio_base64": base64.b64encode(before.content).decode("ascii"),
            },
            "with_dictionary": {
                "content_type": "audio/mpeg",
                "audio_base64": base64.b64encode(after.content).decode("ascii"),
            },
        },
        EnvelopeMeta(),
    )
