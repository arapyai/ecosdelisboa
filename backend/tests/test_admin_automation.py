from pathlib import Path

import pytest

from app.core.config import get_settings
from app.models.entities import AudioFile, Language, Text, Translation, Voice
from app.models.enums import ContentType, TranslationStatus
from app.services.elevenlabs import resolve_voice_id
from tests.test_admin_content import auth_header
from tests.test_api_public import seed_public_data

MP3_ONE = b"ID3\x04\x00\x00\x00\x00\x00\x00first-audio"
MP3_TWO = b"ID3\x04\x00\x00\x00\x00\x00\x00second-audio"


def test_translation_workflow_stays_pending_until_review(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    response = client.post(f"/api/v1/admin/translations/{text.id}/es", headers=headers)

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "pending"


def test_translation_review_requires_explicit_status(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    translation = Translation(
        text_id=text.id,
        lang="es",
        content="No soy nada.",
        status=TranslationStatus.PENDING,
    )
    db_session.add(translation)
    db_session.commit()

    response = client.put(
        f"/api/v1/admin/translations/{translation.id}/review",
        headers=headers,
        json={"content": "No soy nada.", "status": "approved"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "approved"


def test_translation_can_be_upserted_and_deleted_independently(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    upsert = client.put(
        f"/api/v1/admin/translations/{text.id}/fr/manual",
        headers=headers,
        json={"content": "Je ne suis rien.", "status": "approved"},
    )

    assert upsert.status_code == 200
    assert upsert.json()["data"]["status"] == "approved"
    assert upsert.json()["data"]["auto_translated"] is False

    update = client.put(
        f"/api/v1/admin/translations/{text.id}/fr/manual",
        headers=headers,
        json={"content": "Je ne suis rien du tout.", "status": "pending"},
    )
    translation_id = update.json()["data"]["id"]

    assert update.status_code == 200
    assert update.json()["data"]["content"] == "Je ne suis rien du tout."
    assert db_session.query(Translation).filter(Translation.text_id == text.id).count() == 2

    delete = client.delete(f"/api/v1/admin/translations/{translation_id}", headers=headers)

    assert delete.status_code == 200
    assert delete.json()["data"]["deleted"] is True


def test_voice_sync_and_default_selection(client, db_session) -> None:
    headers = auth_header(client, db_session)

    sync = client.post("/api/v1/admin/voices/sync", headers=headers)
    assert sync.status_code == 200

    voice = db_session.query(Voice).filter(Voice.elevenlabs_id == "voice-default").one()
    response = client.put(f"/api/v1/admin/voices/{voice.id}/default", headers=headers)

    assert response.status_code == 200
    assert response.json()["data"]["default_voice_id"] == str(voice.id)


def test_admin_voice_list_and_lang_assignment(client, db_session) -> None:
    headers = auth_header(client, db_session)
    sync = client.post("/api/v1/admin/voices/sync", headers=headers)
    assert sync.status_code == 200

    voice = db_session.query(Voice).filter(Voice.elevenlabs_id == "voice-default").one()

    lang_resp = client.put(f"/api/v1/admin/voices/{voice.id}/lang?lang=pt", headers=headers)
    assert lang_resp.status_code == 200
    assert lang_resp.json()["data"]["lang"] == "pt"

    list_resp = client.get("/api/v1/admin/voices", headers=headers)
    assert list_resp.status_code == 200
    voices = list_resp.json()["data"]
    pt_voices = [v for v in voices if v["lang"] == "pt"]
    assert len(pt_voices) == 1

    lang_resp = client.put(f"/api/v1/admin/voices/{voice.id}/lang", headers=headers)
    assert lang_resp.json()["data"]["lang"] is None


def test_voice_selection_with_lang_fallback(client, db_session) -> None:
    from app.models.entities import Author, Point, Text

    pt_voice = Voice(elevenlabs_id="voice-pt", name="PT Voice", is_default=True)
    en_voice = Voice(elevenlabs_id="voice-en", name="EN Voice")
    pt_voice.languages.append(db_session.get(Language, "pt"))
    en_voice.languages.append(db_session.get(Language, "en"))
    db_session.add_all([pt_voice, en_voice])
    db_session.commit()

    author = Author(name="Test Author")
    author = Author(name="Test Author")
    point = Point(title_pt="Test Point", lat=38.7, lng=-9.14)
    text = Text(point=point, author=author, content_pt="Test", content_type=ContentType.POETRY)
    text.translations = []
    text.audio_files = []
    db_session.add_all([author, point, text])
    db_session.commit()
    db_session.refresh(text)

    en_id = resolve_voice_id(db_session, text, "en")
    assert en_id == "voice-en"

    fr_id = resolve_voice_id(db_session, text, "fr")
    assert fr_id == "voice-pt"

    preferred = resolve_voice_id(
        db_session,
        text,
        "pt",
        preferred_voice_id="custom",
    )
    assert preferred == "custom"


def test_random_voice_selection(client, db_session) -> None:
    from app.models.entities import Author, Point, Text

    voices = [
        Voice(elevenlabs_id="v1", name="V1"),
        Voice(elevenlabs_id="v2", name="V2"),
        Voice(elevenlabs_id="v3", name="V3"),
    ]
    for voice in voices:
        voice.languages.append(db_session.get(Language, "pt"))
    db_session.add_all(voices)
    db_session.commit()

    author = Author(name="Test")
    point = Point(title_pt="T", lat=38.7, lng=-9.14)
    text = Text(point=point, author=author, content_pt="T", content_type=ContentType.POETRY)
    text.translations = []
    text.audio_files = []
    db_session.add_all([author, point, text])
    db_session.commit()
    db_session.refresh(text)

    ids = {resolve_voice_id(db_session, text, "pt") for _ in range(20)}
    assert len(ids) > 1


def test_voice_resolution_follows_full_precedence(client, db_session, monkeypatch) -> None:
    from app.models.entities import Author, Point, Text

    language_voice = Voice(elevenlabs_id="language", name="Language")
    language_voice.languages.append(db_session.get(Language, "en"))
    default_voice = Voice(elevenlabs_id="default", name="Default", is_default=True)
    author = Author(name="Test", elevenlabs_voice_id="author")
    author_voice = Voice(elevenlabs_id="author", name="Author")
    point = Point(title_pt="T", lat=38.7, lng=-9.14)
    text = Text(point=point, author=author, content_pt="T", content_type=ContentType.POETRY)
    db_session.add_all([language_voice, default_voice, author_voice, author, point, text])
    db_session.commit()

    assert resolve_voice_id(db_session, text, "en", preferred_voice_id="explicit") == "explicit"
    assert resolve_voice_id(db_session, text, "en") == "author"

    author.elevenlabs_voice_id = None
    db_session.commit()
    assert resolve_voice_id(db_session, text, "en") == "language"

    language_voice.languages = []
    db_session.commit()
    assert resolve_voice_id(db_session, text, "en") == "default"

    default_voice.is_default = False
    db_session.commit()
    monkeypatch.setenv("ELEVENLABS_DEFAULT_VOICE_ID", "env-default")
    get_settings.cache_clear()
    assert resolve_voice_id(db_session, text, "en") == "env-default"


def test_generate_audio_with_preferred_voice(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    response = client.post(
        f"/api/v1/admin/audio/{text.id}/en/generate?voice_id=custom-voice",
        headers=headers,
    )

    assert response.status_code == 200
    audio = (
        db_session.query(AudioFile)
        .filter(AudioFile.text_id == text.id, AudioFile.lang == "en")
        .one()
    )
    assert audio.voice_id == "custom-voice"
    assert audio.public_url == f"/media/audio/{text.id}/en.mp3"
    audio_path = Path(get_settings().audio_storage_dir) / f"audio/{text.id}/en.mp3"
    assert audio_path.read_bytes() == b"I am nothing."

    media_response = client.get(audio.public_url)
    assert media_response.status_code == 200
    assert media_response.content == b"I am nothing."


def test_manual_audio_upload_is_preserved_over_auto_regeneration(
    client,
    db_session,
    monkeypatch,
) -> None:
    from app.api.routes import admin_automation

    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    upload = client.put(
        f"/api/v1/admin/audio/{text.id}/en/upload",
        headers=headers,
        files={"file": ("narration.mp3", MP3_ONE, "audio/mpeg")},
    )
    assert upload.status_code == 200
    upload_data = upload.json()["data"]
    assert upload_data["text_id"] == str(text.id)
    assert upload_data["lang"] == "en"
    assert upload_data["public_url"] == f"/media/audio/manual/{text.id}/en.mp3"
    assert upload_data["duration_s"] is None
    assert upload_data["voice_id"] is None
    assert upload_data["generated_at"] is None
    assert upload_data["manually_uploaded"] is True
    media_response = client.get(upload_data["public_url"])
    assert media_response.status_code == 200
    assert media_response.content == MP3_ONE

    class UnexpectedElevenLabsCall:
        def generate_audio(self, *_args, **_kwargs):
            raise AssertionError("manual audio must skip ElevenLabs generation")

    monkeypatch.setattr(admin_automation, "elevenlabs_service", UnexpectedElevenLabsCall())

    generate = client.post(f"/api/v1/admin/audio/{text.id}/en/generate", headers=headers)
    assert generate.status_code == 200

    audio_file = (
        db_session.query(AudioFile)
        .filter(AudioFile.text_id == text.id, AudioFile.lang == "en")
        .one()
    )
    assert audio_file.public_url == f"/media/audio/manual/{text.id}/en.mp3"
    assert audio_file.r2_key == f"audio/manual/{text.id}/en.mp3"
    assert audio_file.manually_uploaded is True
    assert audio_file.voice_id is None
    assert audio_file.generated_at is None
    assert (
        Path(get_settings().audio_storage_dir) / f"audio/manual/{text.id}/en.mp3"
    ).read_bytes() == MP3_ONE
    assert not (Path(get_settings().audio_storage_dir) / f"audio/{text.id}/en.mp3").exists()


def test_manual_audio_upload_can_overwrite_and_delete_audio_independently(
    client, db_session
) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    generated = client.post(f"/api/v1/admin/audio/{text.id}/pt/generate", headers=headers)
    generated_path = Path(get_settings().audio_storage_dir) / f"audio/{text.id}/pt.mp3"
    assert generated.status_code == 200
    assert generated_path.exists()

    first = client.put(
        f"/api/v1/admin/audio/{text.id}/pt/upload",
        headers=headers,
        files={"file": ("../../first.mp3", MP3_ONE, "audio/mpeg")},
    )
    second = client.put(
        f"/api/v1/admin/audio/{text.id}/pt/upload",
        headers=headers,
        files={"file": ("second.mp3", MP3_TWO, "audio/mp3")},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    audio_file = (
        db_session.query(AudioFile)
        .filter(AudioFile.text_id == text.id, AudioFile.lang == "pt")
        .one()
    )
    assert audio_file.public_url == f"/media/audio/manual/{text.id}/pt.mp3"
    assert audio_file.voice_id is None
    assert audio_file.r2_key == f"audio/manual/{text.id}/pt.mp3"
    manual_path = Path(get_settings().audio_storage_dir) / audio_file.r2_key
    assert manual_path.read_bytes() == MP3_TWO
    assert list(manual_path.parent.iterdir()) == [manual_path]
    assert not generated_path.exists()

    delete = client.delete(f"/api/v1/admin/audio/{text.id}/pt", headers=headers)

    assert delete.status_code == 200
    assert delete.json()["data"]["deleted"] is True
    remaining_pt_audio = (
        db_session.query(AudioFile)
        .filter(AudioFile.text_id == text.id, AudioFile.lang == "pt")
        .count()
    )
    assert remaining_pt_audio == 0
    assert not manual_path.exists()
    assert not manual_path.parent.exists()


@pytest.mark.parametrize(
    ("filename", "content_type", "content", "expected_status"),
    [
        ("audio.wav", "audio/mpeg", MP3_ONE, 400),
        ("audio.mp3", "audio/wav", MP3_ONE, 415),
        ("audio.mp3", "audio/mpeg", b"not-an-mp3", 400),
        ("audio.mp3", "audio/mpeg", b"", 400),
    ],
)
def test_manual_audio_upload_validates_file(
    client,
    db_session,
    filename,
    content_type,
    content,
    expected_status,
) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    response = client.put(
        f"/api/v1/admin/audio/{text.id}/pt/upload",
        headers=headers,
        files={"file": (filename, content, content_type)},
    )

    assert response.status_code == expected_status
    assert db_session.query(AudioFile).filter_by(text_id=text.id, lang="pt").count() == 0


def test_manual_audio_upload_enforces_configured_size_limit(
    client,
    db_session,
    monkeypatch,
) -> None:
    from app.api.routes import admin_automation

    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    monkeypatch.setattr(admin_automation.settings, "audio_upload_max_bytes", 8)

    response = client.put(
        f"/api/v1/admin/audio/{text.id}/pt/upload",
        headers=headers,
        files={"file": ("audio.mp3", MP3_ONE, "audio/mpeg")},
    )

    assert response.status_code == 413
    assert db_session.query(AudioFile).filter_by(text_id=text.id, lang="pt").count() == 0


def test_audio_job_creation_keeps_contract_and_returns_pending(client, db_session) -> None:
    from app.api.routes import admin_automation
    from app.services.audio_jobs import claim_next_audio_job, process_audio_job

    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    response = client.post(
        "/api/v1/admin/audio/jobs",
        headers=headers,
        json={"items": [{"text_id": str(text.id), "lang": "en", "voice_id": "chosen"}]},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["status"] == "pending"
    assert payload["processed"] == 0
    assert payload["total"] == 1

    job_id = payload["job_id"]
    claimed_job_id = claim_next_audio_job(db_session)
    assert str(claimed_job_id) == job_id
    completed = process_audio_job(
        db_session,
        claimed_job_id,
        admin_automation.elevenlabs_service,
        admin_automation.audio_storage,
    )
    assert completed.status.value == "completed"
    assert completed.preferred_voice_id == "chosen"

    events = client.get(f"/api/v1/admin/audio/jobs/{job_id}/events", headers=headers)
    assert events.status_code == 200
    assert "completed" in events.text
