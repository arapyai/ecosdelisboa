import base64

from app.api.routes import admin_pronunciation
from app.models.entities import Language, PronunciationDictionary
from app.services.elevenlabs import GeneratedAudio
from tests.test_admin_content import auth_header


class FakePronunciationService:
    def __init__(self) -> None:
        self.rules: list[dict[str, str]] = []
        self.audio_calls: list[tuple[str, str, list[dict[str, str]] | None]] = []

    def create_pronunciation_dictionary(self, name: str) -> dict[str, object]:
        return {"id": "dictionary-pt", "version_id": "version-1", "name": name}

    def get_pronunciation_dictionary(self, dictionary_id: str) -> dict[str, object]:
        assert dictionary_id == "dictionary-pt"
        return {"id": dictionary_id, "rules": self.rules}

    def set_pronunciation_dictionary_rules(
        self,
        dictionary_id: str,
        rules: list[dict[str, str]],
    ) -> dict[str, object]:
        assert dictionary_id == "dictionary-pt"
        self.rules = rules
        return {"id": dictionary_id, "version_id": "version-2"}

    def generate_audio(
        self,
        text: str,
        voice_id: str,
        pronunciation_dictionary_locators: list[dict[str, str]] | None = None,
    ) -> GeneratedAudio:
        self.audio_calls.append((text, voice_id, pronunciation_dictionary_locators))
        content = b"with-dictionary" if pronunciation_dictionary_locators else b"without-dictionary"
        return GeneratedAudio(content=content, duration_s=None, voice_id=voice_id)


def test_admin_can_create_publish_and_preview_dictionary(
    client,
    db_session,
    monkeypatch,
) -> None:
    service = FakePronunciationService()
    monkeypatch.setattr(admin_pronunciation, "elevenlabs_service", service)
    headers = auth_header(client, db_session)

    created = client.post(
        "/api/v1/admin/pronunciation-dictionaries/pt",
        headers=headers,
    )
    assert created.status_code == 201
    assert created.json()["data"]["version_id"] == "version-1"

    rules = [
        {
            "type": "phoneme",
            "string_to_replace": "Chiado",
            "alphabet": "ipa",
            "phoneme": "ʃiˈadu",
        },
        {
            "type": "alias",
            "string_to_replace": "LX",
            "alias": "Lisboa",
        },
    ]
    published = client.put(
        "/api/v1/admin/pronunciation-dictionaries/pt/rules",
        headers=headers,
        json={"rules": rules},
    )
    assert published.status_code == 200
    assert published.json()["data"]["version_id"] == "version-2"
    assert published.json()["data"]["last_published_by"] == "admin@example.com"
    assert service.rules == rules

    detail = client.get(
        "/api/v1/admin/pronunciation-dictionaries/pt",
        headers=headers,
    )
    assert detail.status_code == 200
    assert detail.json()["data"]["rules"] == rules

    preview = client.post(
        "/api/v1/admin/pronunciation-dictionaries/pt/preview",
        headers=headers,
        json={"text": "Chiado", "voice_id": "voice-pt"},
    )
    assert preview.status_code == 200
    preview_data = preview.json()["data"]
    assert base64.b64decode(preview_data["without_dictionary"]["audio_base64"]) == (
        b"without-dictionary"
    )
    assert base64.b64decode(preview_data["with_dictionary"]["audio_base64"]) == b"with-dictionary"
    assert service.audio_calls[0][2] is None
    assert service.audio_calls[1][2] == [
        {
            "pronunciation_dictionary_id": "dictionary-pt",
            "version_id": "version-2",
        }
    ]


def test_dictionary_validation_and_authentication(client, db_session, monkeypatch) -> None:
    service = FakePronunciationService()
    monkeypatch.setattr(admin_pronunciation, "elevenlabs_service", service)

    assert client.get("/api/v1/admin/pronunciation-dictionaries").status_code == 401

    headers = auth_header(client, db_session)
    assert (
        client.post(
            "/api/v1/admin/pronunciation-dictionaries/pt",
            headers=headers,
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/v1/admin/pronunciation-dictionaries/pt",
            headers=headers,
        ).status_code
        == 409
    )

    duplicate = client.put(
        "/api/v1/admin/pronunciation-dictionaries/pt/rules",
        headers=headers,
        json={
            "rules": [
                {"type": "alias", "string_to_replace": "LX", "alias": "Lisboa"},
                {"type": "alias", "string_to_replace": "LX", "alias": "Lisboa cidade"},
            ]
        },
    )
    assert duplicate.status_code == 422

    blank_phoneme = client.put(
        "/api/v1/admin/pronunciation-dictionaries/pt/rules",
        headers=headers,
        json={
            "rules": [
                {
                    "type": "phoneme",
                    "string_to_replace": "Chiado",
                    "alphabet": "ipa",
                    "phoneme": " ",
                }
            ]
        },
    )
    assert blank_phoneme.status_code == 422

    too_long_preview = client.post(
        "/api/v1/admin/pronunciation-dictionaries/pt/preview",
        headers=headers,
        json={"text": "a" * 301, "voice_id": "voice-pt"},
    )
    assert too_long_preview.status_code == 422

    language = db_session.get(Language, "fr")
    language.is_active = False
    db_session.commit()
    inactive = client.post(
        "/api/v1/admin/pronunciation-dictionaries/fr",
        headers=headers,
    )
    assert inactive.status_code == 400


def test_failed_publication_keeps_active_version(
    client,
    db_session,
    monkeypatch,
) -> None:
    service = FakePronunciationService()
    monkeypatch.setattr(admin_pronunciation, "elevenlabs_service", service)
    headers = auth_header(client, db_session)
    client.post("/api/v1/admin/pronunciation-dictionaries/pt", headers=headers)

    def fail_publish(*_args, **_kwargs):
        raise ValueError("provider unavailable")

    monkeypatch.setattr(service, "set_pronunciation_dictionary_rules", fail_publish)
    response = client.put(
        "/api/v1/admin/pronunciation-dictionaries/pt/rules",
        headers=headers,
        json={"rules": [{"type": "alias", "string_to_replace": "LX", "alias": "Lisboa"}]},
    )

    assert response.status_code == 502
    stored = db_session.query(PronunciationDictionary).one()
    assert stored.version_id == "version-1"
