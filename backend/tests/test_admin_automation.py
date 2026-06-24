from pathlib import Path

from app.models.entities import AudioFile, Text, Translation, Voice
from app.models.enums import ContentType, SupportedLanguage, TranslationStatus
from app.services.elevenlabs import resolve_voice_id
from tests.test_admin_content import auth_header
from tests.test_api_public import seed_public_data


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
        lang=SupportedLanguage.ES,
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

    pt_voice = Voice(elevenlabs_id="voice-pt", name="PT Voice", lang=SupportedLanguage.PT)
    en_voice = Voice(elevenlabs_id="voice-en", name="EN Voice", lang=SupportedLanguage.EN)
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

    en_id = resolve_voice_id(db_session, text, SupportedLanguage.EN)
    assert en_id == "voice-en"

    fr_id = resolve_voice_id(db_session, text, SupportedLanguage.FR)
    assert fr_id == "voice-pt"

    preferred = resolve_voice_id(
        db_session,
        text,
        SupportedLanguage.PT,
        preferred_voice_id="custom",
    )
    assert preferred == "custom"


def test_random_voice_selection(client, db_session) -> None:
    from app.models.entities import Author, Point, Text

    db_session.add_all([
        Voice(elevenlabs_id="v1", name="V1", lang=SupportedLanguage.PT),
        Voice(elevenlabs_id="v2", name="V2", lang=SupportedLanguage.PT),
        Voice(elevenlabs_id="v3", name="V3", lang=SupportedLanguage.PT),
    ])
    db_session.commit()

    author = Author(name="Test")
    point = Point(title_pt="T", lat=38.7, lng=-9.14)
    text = Text(point=point, author=author, content_pt="T", content_type=ContentType.POETRY)
    text.translations = []
    text.audio_files = []
    db_session.add_all([author, point, text])
    db_session.commit()
    db_session.refresh(text)

    ids = {resolve_voice_id(db_session, text, SupportedLanguage.PT) for _ in range(20)}
    assert len(ids) > 1


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
        .filter(AudioFile.text_id == text.id, AudioFile.lang == SupportedLanguage.EN)
        .one()
    )
    assert audio.voice_id == "custom-voice"
    assert audio.public_url == f"/media/audio/{text.id}/en.mp3"
    assert Path(f"media/audio/{text.id}/en.mp3").read_bytes() == b"I am nothing."

    media_response = client.get(audio.public_url)
    assert media_response.status_code == 200
    assert media_response.content == b"I am nothing."


def test_manual_audio_upload_is_preserved_over_auto_regeneration(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    upload = client.put(
        f"/api/v1/admin/audio/{text.id}/en/upload",
        headers=headers,
        json={"public_url": "https://audio.example/manual.mp3", "voice_id": "manual"},
    )
    assert upload.status_code == 200

    generate = client.post(f"/api/v1/admin/audio/{text.id}/en/generate", headers=headers)
    assert generate.status_code == 200

    audio_file = (
        db_session.query(AudioFile)
        .filter(AudioFile.text_id == text.id, AudioFile.lang == SupportedLanguage.EN)
        .one()
    )
    assert audio_file.public_url == "https://audio.example/manual.mp3"
    assert audio_file.manually_uploaded is True


def test_manual_audio_upload_can_overwrite_and_delete_audio_independently(
    client, db_session
) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    first = client.put(
        f"/api/v1/admin/audio/{text.id}/pt/upload",
        headers=headers,
        json={"public_url": "https://audio.example/first.mp3", "voice_id": "manual-1"},
    )
    second = client.put(
        f"/api/v1/admin/audio/{text.id}/pt/upload",
        headers=headers,
        json={"public_url": "https://audio.example/second.mp3", "voice_id": "manual-2"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    audio_file = (
        db_session.query(AudioFile)
        .filter(AudioFile.text_id == text.id, AudioFile.lang == SupportedLanguage.PT)
        .one()
    )
    assert audio_file.public_url == "https://audio.example/second.mp3"
    assert audio_file.voice_id == "manual-2"
    assert audio_file.r2_key is None

    delete = client.delete(f"/api/v1/admin/audio/{text.id}/pt", headers=headers)

    assert delete.status_code == 200
    assert delete.json()["data"]["deleted"] is True
    remaining_pt_audio = (
        db_session.query(AudioFile)
        .filter(AudioFile.text_id == text.id, AudioFile.lang == SupportedLanguage.PT)
        .count()
    )
    assert remaining_pt_audio == 0


def test_audio_job_runs_and_sse_reports_completion(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()

    response = client.post(
        "/api/v1/admin/audio/jobs",
        headers=headers,
        json={"items": [{"text_id": str(text.id), "lang": "en"}]},
    )

    assert response.status_code == 200
    job_id = response.json()["data"]["job_id"]

    events = client.get(f"/api/v1/admin/audio/jobs/{job_id}/events", headers=headers)
    assert events.status_code == 200
    assert "completed" in events.text
