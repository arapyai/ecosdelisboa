from pathlib import Path

from app.core.config import get_settings
from app.models.entities import AudioFile, Language, Text, Translation, Voice
from app.models.enums import TranslationStatus
from app.services.languages import parse_language_catalog
from tests.test_admin_content import auth_header
from tests.test_api_public import seed_public_data

HEADER = (
    "language_code,locale,country_code,language_name,is_source,gender,"
    "voice_label,voice_name,elevenlabs_voice_id,is_default\n"
)


def test_documented_seed_catalog_is_valid() -> None:
    catalog_path = Path(__file__).resolve().parents[2] / "docs" / "voice_language_seed.csv"

    catalog = parse_language_catalog(catalog_path.read_text(encoding="utf-8"))

    assert set(catalog.languages) == {"de", "en", "fr", "pt", "zh"}
    assert len(catalog.voices) == 40
    assert sum(voice.is_default for voice in catalog.voices.values()) == 10


def upload_catalog(client, headers, rows: str, *, replace: bool = False):
    return client.post(
        f"/api/v1/admin/languages/import?replace={str(replace).lower()}",
        headers=headers,
        files={"file": ("languages.csv", (HEADER + rows).encode(), "text/csv")},
    )


def test_language_catalog_import_supports_shared_voice_and_is_idempotent(
    client, db_session
) -> None:
    headers = auth_header(client, db_session)
    rows = (
        "it,it-IT,IT,Italian,false,female,,Giulia,shared-voice,false\n"
        "fr,fr-FR,FR,French,false,female,,Giulia,shared-voice,false\n"
    )

    first = upload_catalog(client, headers, rows)
    second = upload_catalog(client, headers, rows)

    assert first.status_code == 200
    assert first.json()["data"]["languages_created"] == 1
    assert first.json()["data"]["voices_created"] == 1
    assert second.status_code == 200
    assert second.json()["data"]["languages_created"] == 0
    voice = db_session.query(Voice).filter_by(elevenlabs_id="shared-voice").one()
    assert {language.code for language in voice.languages} == {"fr", "it"}


def test_invalid_catalog_is_rejected_without_partial_changes(client, db_session) -> None:
    headers = auth_header(client, db_session)
    rows = (
        "it,it-IT,IT,Italian,false,female,,Giulia,shared-voice,false\n"
        "it,it-CH,CH,Italian Swiss,false,female,,Giulia,shared-voice,false\n"
    )

    response = upload_catalog(client, headers, rows)

    assert response.status_code == 400
    assert db_session.get(Language, "it") is None
    assert db_session.query(Voice).filter_by(elevenlabs_id="shared-voice").count() == 0


def test_replace_catalog_requires_source_language(client, db_session) -> None:
    headers = auth_header(client, db_session)
    rows = "it,it-IT,IT,Italian,false,female,,Giulia,shared-voice,false\n"

    response = upload_catalog(client, headers, rows, replace=True)

    assert response.status_code == 400
    assert db_session.get(Language, "it") is None


def test_replace_catalog_deactivates_missing_languages_and_replaces_voice_pools(
    client, db_session
) -> None:
    headers = auth_header(client, db_session)
    old_voice = Voice(elevenlabs_id="old", name="Old", is_default=True)
    old_voice.languages.append(db_session.get(Language, "de"))
    db_session.add(old_voice)
    db_session.commit()
    rows = (
        "pt,pt-PT,PT,Portuguese,true,male,,Shared,shared,true\n"
        "it,it-IT,IT,Italian,false,male,,Shared,shared,true\n"
    )

    response = upload_catalog(client, headers, rows, replace=True)

    assert response.status_code == 200
    assert db_session.get(Language, "de").is_active is False
    assert db_session.get(Language, "it").is_active is True
    assert db_session.get(Language, "pt").is_source is True
    db_session.refresh(old_voice)
    assert old_voice.is_default is False
    assert old_voice.languages == []
    shared = db_session.query(Voice).filter_by(elevenlabs_id="shared").one()
    assert shared.is_default is True
    assert {language.code for language in shared.languages} == {"it", "pt"}


def test_language_source_switch_and_soft_deactivation_preserve_content(client, db_session) -> None:
    headers = auth_header(client, db_session)
    created = client.post(
        "/api/v1/admin/languages",
        headers=headers,
        json={
            "code": "it",
            "locale": "it-IT",
            "country_code": "IT",
            "name": "Italian",
        },
    )
    assert created.status_code == 201
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    db_session.add(
        Translation(
            text_id=text.id,
            lang="it",
            content="Non sono nulla.",
            status=TranslationStatus.APPROVED,
        )
    )
    db_session.add(AudioFile(text_id=text.id, lang="it", public_url="https://audio.example/it.mp3"))
    db_session.commit()

    source = client.put("/api/v1/admin/languages/it/source", headers=headers)
    blocked = client.delete("/api/v1/admin/languages/it", headers=headers)
    client.put("/api/v1/admin/languages/pt/source", headers=headers)
    removed = client.delete("/api/v1/admin/languages/it", headers=headers)

    assert source.status_code == 200
    assert blocked.status_code == 409
    assert removed.status_code == 200
    assert removed.json()["data"]["is_active"] is False
    assert db_session.query(Translation).filter_by(text_id=text.id, lang="it").count() == 1
    assert db_session.query(AudioFile).filter_by(text_id=text.id, lang="it").count() == 1


def test_voice_language_and_default_endpoints_allow_multiple_values(client, db_session) -> None:
    headers = auth_header(client, db_session)
    first = Voice(elevenlabs_id="first", name="First")
    second = Voice(elevenlabs_id="second", name="Second")
    db_session.add_all([first, second])
    db_session.commit()

    add_pt = client.put(f"/api/v1/admin/voices/{first.id}/languages/pt", headers=headers)
    add_fr = client.put(f"/api/v1/admin/voices/{first.id}/languages/fr", headers=headers)
    client.put(f"/api/v1/admin/voices/{first.id}/default", headers=headers)
    client.put(f"/api/v1/admin/voices/{second.id}/default", headers=headers)

    assert add_pt.status_code == 200
    assert add_fr.json()["data"]["languages"] == ["fr", "pt"]
    db_session.refresh(first)
    db_session.refresh(second)
    assert first.is_default is True
    assert second.is_default is True

    removed = client.delete(f"/api/v1/admin/voices/{first.id}/default", headers=headers)
    assert removed.json()["data"]["is_default"] is False


def test_inactive_language_is_rejected_by_translation_and_audio(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    client.delete("/api/v1/admin/languages/fr", headers=headers)

    translation = client.post(f"/api/v1/admin/translations/{text.id}/fr", headers=headers)
    audio = client.post(f"/api/v1/admin/audio/{text.id}/fr/generate", headers=headers)
    upload = client.put(
        f"/api/v1/admin/audio/{text.id}/fr/upload",
        headers=headers,
        files={
            "file": (
                "audio.mp3",
                b"ID3\x04\x00\x00\x00\x00\x00\x00manual-audio",
                "audio/mpeg",
            )
        },
    )

    assert translation.status_code == 400
    assert audio.status_code == 400
    assert upload.status_code == 400


def test_configured_source_language_controls_audio_source_text(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    client.put("/api/v1/admin/languages/en/source", headers=headers)

    response = client.post(f"/api/v1/admin/audio/{text.id}/en/generate", headers=headers)

    assert response.status_code == 200
    audio = db_session.query(AudioFile).filter_by(text_id=text.id, lang="en").one()
    audio_path = Path(get_settings().audio_storage_dir) / str(audio.r2_key)
    assert audio_path.read_bytes() == b"Nao sou nada."


def test_language_admin_requires_authentication(client) -> None:
    response = client.get("/api/v1/admin/languages")
    assert response.status_code == 401
