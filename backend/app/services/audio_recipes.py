from __future__ import annotations

import hashlib
import json
import unicodedata

from app.models.entities import PronunciationDictionary

RECIPE_SCHEMA_VERSION = 1
PROVIDER = "elevenlabs"


def normalize_tts_text(value: str) -> str:
    return unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def source_text_hash(value: str) -> str:
    return sha256_bytes(normalize_tts_text(value).encode("utf-8"))


def canonical_json(value: dict[str, object]) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def build_generation_spec(
    *,
    source_text: str,
    language: str,
    voice_id: str,
    model_id: str,
    output_format: str,
    pronunciation_dictionary: PronunciationDictionary | None,
) -> dict[str, object]:
    dictionary: dict[str, str] | None = None
    if pronunciation_dictionary is not None:
        dictionary = {
            "id": pronunciation_dictionary.elevenlabs_id,
            "version_id": pronunciation_dictionary.version_id,
        }
    return {
        "schema_version": RECIPE_SCHEMA_VERSION,
        "provider": PROVIDER,
        "model_id": model_id,
        "output_format": output_format,
        "voice_id": voice_id,
        "language": language,
        "source_text_hash": source_text_hash(source_text),
        "pronunciation_dictionary": dictionary,
        "voice_settings": {},
    }


def recipe_hash(spec: dict[str, object]) -> str:
    return sha256_bytes(canonical_json(spec))
