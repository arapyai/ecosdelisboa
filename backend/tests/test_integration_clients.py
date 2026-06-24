import pytest

from app.models.entities import Text
from app.models.enums import SupportedLanguage
from app.services.elevenlabs import ElevenLabsService
from app.services.geocoding import parse_geocoding_payload
from app.services.llm import build_translation_prompt, extract_claude_text


def test_geocoding_payload_parser_returns_coordinates() -> None:
    result = parse_geocoding_payload([{"lat": "38.7076", "lon": "-9.1365"}], "Lisboa")

    assert result.lat == 38.7076
    assert result.lng == -9.1365


def test_geocoding_payload_parser_rejects_empty_results() -> None:
    with pytest.raises(ValueError, match="Address not found"):
        parse_geocoding_payload([], "Lugar inexistente")


def test_claude_response_extractor_returns_text() -> None:
    translated = extract_claude_text({"content": [{"type": "text", "text": "I am nothing."}]})

    assert translated == "I am nothing."


def test_translation_prompt_includes_literary_context() -> None:
    text = Text(content_pt="Nao sou nada.", source_work="Tabacaria")

    prompt = build_translation_prompt(text, SupportedLanguage.EN)

    assert "Target language: en" in prompt
    assert "Source work: Tabacaria" in prompt
    assert "Nao sou nada." in prompt


def test_elevenlabs_service_uses_local_fallback_without_api_key() -> None:
    service = ElevenLabsService(api_key="")

    voices = service.list_voices()
    audio = service.generate_audio("O rio abre a cidade.", "voice-default")

    assert voices[0]["elevenlabs_id"] == "voice-default"
    assert audio.content == b"O rio abre a cidade."
    assert audio.duration_s == 12.5
