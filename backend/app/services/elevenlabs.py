from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import AudioFile, Text, Voice
from app.models.enums import SupportedLanguage, TranslationStatus


@dataclass
class GeneratedAudio:
    content: bytes
    duration_s: float
    voice_id: str


@dataclass
class ElevenLabsService:
    def list_voices(self) -> list[dict[str, str | None]]:
        return [
            {
                "elevenlabs_id": "voice-default",
                "name": "Default Voice",
                "preview_url": "https://example.test/voice-default.mp3",
            }
        ]

    def generate_audio(self, text: str, voice_id: str) -> GeneratedAudio:
        return GeneratedAudio(content=text.encode("utf-8"), duration_s=12.5, voice_id=voice_id)


def resolve_voice_id(db: Session, text: Text) -> str:
    author = text.author
    if author is not None and author.elevenlabs_voice_id:
        return author.elevenlabs_voice_id

    default_voice = db.scalar(select(Voice).where(Voice.is_default.is_(True)))
    if default_voice is None:
        raise ValueError("Default voice not configured")
    return default_voice.elevenlabs_id


def get_audio_source_text(text: Text, lang: SupportedLanguage) -> str:
    if lang == SupportedLanguage.PT:
        return text.content_pt

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
    return translation.content


def upsert_audio_file(
    db: Session,
    text: Text,
    lang: SupportedLanguage,
    generated_audio: GeneratedAudio,
    public_url: str,
    manually_uploaded: bool,
) -> AudioFile:
    audio_file = db.scalar(
        select(AudioFile).where(AudioFile.text_id == text.id, AudioFile.lang == lang)
    )
    if audio_file is not None and audio_file.manually_uploaded and not manually_uploaded:
        return audio_file

    if audio_file is None:
        audio_file = AudioFile(text_id=text.id, lang=lang)
        db.add(audio_file)

    audio_file.r2_key = f"audio/{text.id}/{lang.value}.mp3"
    audio_file.public_url = public_url
    audio_file.duration_s = generated_audio.duration_s
    audio_file.voice_id = generated_audio.voice_id
    audio_file.manually_uploaded = manually_uploaded
    return audio_file
