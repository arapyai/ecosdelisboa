import json

import pytest

from app.models.entities import Text
from app.services import elevenlabs as elevenlabs_module
from app.services.elevenlabs import ElevenLabsService
from app.services.geocoding import parse_nominatim_payload
from app.services.llm import build_translation_prompt, extract_claude_text


def test_geocoding_payload_parser_returns_coordinates() -> None:
    result = parse_nominatim_payload([{"lat": "38.7076", "lon": "-9.1365"}], "Lisboa")

    assert result.lat == 38.7076
    assert result.lng == -9.1365


def test_geocoding_payload_parser_rejects_empty_results() -> None:
    with pytest.raises(ValueError, match="Address not found"):
        parse_nominatim_payload([], "Lugar inexistente")


def test_claude_response_extractor_returns_text() -> None:
    translated = extract_claude_text({"content": [{"type": "text", "text": "I am nothing."}]})

    assert translated == "I am nothing."


def test_translation_prompt_includes_literary_context() -> None:
    text = Text(content_pt="Nao sou nada.", source_work="Tabacaria")

    prompt = build_translation_prompt(text, "en", "pt")

    assert "Target language: en" in prompt
    assert "Source language: pt" in prompt
    assert "Source work: Tabacaria" in prompt
    assert "Nao sou nada." in prompt


def test_elevenlabs_service_uses_local_fallback_without_api_key() -> None:
    service = ElevenLabsService(api_key="")

    voices = service.list_voices()
    audio = service.generate_audio("O rio abre a cidade.", "voice-default")

    assert voices[0]["elevenlabs_id"] == "voice-default"
    assert audio.content == b"O rio abre a cidade."
    assert audio.duration_s == 12.5


def test_elevenlabs_service_manages_dictionaries_and_sends_locator(monkeypatch) -> None:
    requests = []
    responses = [
        b'{"id":"dictionary-pt","version_id":"version-1","name":"Portuguese"}',
        b'{"id":"dictionary-pt","latest_version_id":"version-1","rules":[]}',
        b'{"id":"dictionary-pt","version_id":"version-2","version_rules_num":1}',
        b"ID3-audio",
    ]

    class FakeResponse:
        def __init__(self, content: bytes) -> None:
            self.content = content

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def read(self) -> bytes:
            return self.content

    def fake_open_url(request, *, timeout):
        assert timeout == 60
        requests.append(request)
        return FakeResponse(responses.pop(0))

    monkeypatch.setattr(elevenlabs_module, "open_url", fake_open_url)
    service = ElevenLabsService(
        api_key="test-key",
        base_url="https://api.example/v1",
        model_id="eleven_v3",
    )

    created = service.create_pronunciation_dictionary("Portuguese")
    fetched = service.get_pronunciation_dictionary("dictionary-pt")
    published = service.set_pronunciation_dictionary_rules(
        "dictionary-pt",
        [{"type": "alias", "string_to_replace": "LX", "alias": "Lisboa"}],
    )
    audio = service.generate_audio(
        "LX",
        "voice-pt",
        pronunciation_dictionary_locators=[
            {
                "pronunciation_dictionary_id": "dictionary-pt",
                "version_id": "version-2",
            }
        ],
    )

    assert created["version_id"] == "version-1"
    assert fetched["rules"] == []
    assert published["version_id"] == "version-2"
    assert audio.content == b"ID3-audio"
    assert requests[0].get_method() == "POST"
    assert requests[0].full_url.endswith("/pronunciation-dictionaries/add-from-rules")
    assert json.loads(requests[0].data)["rules"] == []
    assert requests[1].get_method() == "GET"
    assert requests[2].full_url.endswith("/pronunciation-dictionaries/dictionary-pt/set-rules")
    assert json.loads(requests[2].data)["rules"][0]["alias"] == "Lisboa"
    audio_payload = json.loads(requests[3].data)
    assert audio_payload["model_id"] == "eleven_v3"
    assert audio_payload["pronunciation_dictionary_locators"] == [
        {
            "pronunciation_dictionary_id": "dictionary-pt",
            "version_id": "version-2",
        }
    ]
