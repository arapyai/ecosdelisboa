import json
import random
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import AudioFile, Text, Voice
from app.models.enums import TranslationStatus
from app.services.http_client import open_url
from app.services.languages import get_source_language


@dataclass
class GeneratedAudio:
    content: bytes
    duration_s: float | None
    voice_id: str


@dataclass
class ElevenLabsService:
    api_key: str | None = None
    base_url: str | None = None
    model_id: str | None = None

    def _api_key(self) -> str | None:
        if self.api_key is not None:
            return self.api_key
        return get_settings().elevenlabs_api_key

    def _base_url(self) -> str:
        return (self.base_url or get_settings().elevenlabs_base_url).rstrip("/")

    def _model_id(self) -> str:
        return self.model_id or get_settings().elevenlabs_model_id

    @property
    def generation_model_id(self) -> str:
        return self._model_id()

    @property
    def output_format(self) -> str:
        return get_settings().elevenlabs_output_format

    def _request_json(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict[str, object] | None = None,
    ) -> dict[str, object]:
        api_key = self._api_key()
        if not api_key:
            raise ValueError("ELEVENLABS_API_KEY is not configured")
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            f"{self._base_url()}{path}",
            data=data,
            method=method,
            headers={
                "xi-api-key": api_key,
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
        )
        try:
            with open_url(request, timeout=get_settings().elevenlabs_timeout_s) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            message = exc.read().decode("utf-8", "ignore")
            raise ValueError(f"ElevenLabs request failed: {exc.code} {message}") from exc
        except URLError as exc:
            raise ValueError(f"ElevenLabs request failed: {exc.reason}") from exc

    def list_voices(self) -> list[dict[str, str | None]]:
        if not self._api_key():
            return [
                {
                    "elevenlabs_id": "voice-default",
                    "name": "Default Voice",
                    "preview_url": "https://example.test/voice-default.mp3",
                }
            ]

        payload = self._request_json("/voices")
        voices = payload.get("voices", [])
        if not isinstance(voices, list):
            raise ValueError("ElevenLabs voices response is invalid")
        return [
            {
                "elevenlabs_id": str(voice.get("voice_id")),
                "name": str(voice.get("name")),
                "preview_url": voice.get("preview_url"),
            }
            for voice in voices
            if isinstance(voice, dict) and voice.get("voice_id") and voice.get("name")
        ]

    def create_pronunciation_dictionary(self, name: str) -> dict[str, object]:
        return self._request_json(
            "/pronunciation-dictionaries/add-from-rules",
            method="POST",
            payload={
                "name": name,
                "description": "Managed by Lisboa por Outros",
                "rules": [],
            },
        )

    def get_pronunciation_dictionary(self, dictionary_id: str) -> dict[str, object]:
        return self._request_json(f"/pronunciation-dictionaries/{dictionary_id}")

    def set_pronunciation_dictionary_rules(
        self,
        dictionary_id: str,
        rules: list[dict[str, str]],
    ) -> dict[str, object]:
        return self._request_json(
            f"/pronunciation-dictionaries/{dictionary_id}/set-rules",
            method="POST",
            payload={"rules": rules},
        )

    def generate_audio(
        self,
        text: str,
        voice_id: str,
        pronunciation_dictionary_locators: list[dict[str, str]] | None = None,
    ) -> GeneratedAudio:
        api_key = self._api_key()
        if not api_key:
            return GeneratedAudio(content=text.encode("utf-8"), duration_s=12.5, voice_id=voice_id)

        payload: dict[str, object] = {"text": text, "model_id": self._model_id()}
        if pronunciation_dictionary_locators:
            payload["pronunciation_dictionary_locators"] = pronunciation_dictionary_locators
        body = json.dumps(payload).encode("utf-8")
        query = urlencode({"output_format": self.output_format})
        request = Request(
            f"{self._base_url()}/text-to-speech/{voice_id}?{query}",
            data=body,
            method="POST",
            headers={
                "xi-api-key": api_key,
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
            },
        )
        try:
            with open_url(request, timeout=get_settings().elevenlabs_timeout_s) as response:
                return GeneratedAudio(
                    content=response.read(),
                    duration_s=None,
                    voice_id=voice_id,
                )
        except HTTPError as exc:
            message = exc.read().decode("utf-8", "ignore")
            raise ValueError(f"ElevenLabs audio generation failed: {exc.code} {message}") from exc
        except URLError as exc:
            raise ValueError(f"ElevenLabs audio generation failed: {exc.reason}") from exc


def resolve_voice_id(
    db: Session,
    text: Text,
    lang: str,
    preferred_voice_id: str | None = None,
) -> str:
    if preferred_voice_id is not None:
        return preferred_voice_id

    author = text.author
    if author is not None and author.elevenlabs_voice_id:
        return author.elevenlabs_voice_id

    language_voices = list(db.scalars(select(Voice).where(Voice.languages.any(code=lang))))
    if language_voices:
        return random.choice(language_voices).elevenlabs_id

    default_voices = list(db.scalars(select(Voice).where(Voice.is_default.is_(True))))
    if default_voices:
        return random.choice(default_voices).elevenlabs_id

    default_voice_id = get_settings().elevenlabs_default_voice_id
    if default_voice_id:
        return default_voice_id

    raise ValueError(f"No voice configured for language '{lang}'")


def get_audio_source_text(db: Session, text: Text, lang: str) -> str:
    if lang == get_source_language(db).code:
        return text.phonetic_content or text.content_pt

    translation = next(
        (
            item
            for item in text.translations
            if item.lang == lang and item.status == TranslationStatus.APPROVED
        ),
        None,
    )
    if translation is None:
        raise ValueError("Approved translation required before audio generation")
    return translation.phonetic_content or translation.content


def upsert_audio_file(
    db: Session,
    text: Text,
    lang: str,
    generated_audio: GeneratedAudio,
    storage_key: str,
    public_url: str,
    manually_uploaded: bool,
    recipe_hash: str | None = None,
    content_hash: str | None = None,
    generation_spec: dict[str, object] | None = None,
) -> AudioFile:
    audio_file = db.scalar(
        select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == lang)
    )
    if audio_file is not None and audio_file.manually_uploaded and not manually_uploaded:
        return audio_file

    if audio_file is None:
        audio_file = AudioFile(text_id=text.id, lang=lang)
        db.add(audio_file)

    audio_file.r2_key = storage_key
    audio_file.public_url = public_url
    audio_file.duration_s = generated_audio.duration_s
    audio_file.voice_id = generated_audio.voice_id
    audio_file.generated_at = datetime.now(UTC)
    audio_file.manually_uploaded = manually_uploaded
    audio_file.recipe_hash = recipe_hash
    audio_file.content_hash = content_hash
    audio_file.generation_spec = generation_spec
    return audio_file
