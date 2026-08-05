from uuid import UUID

from app.models.entities import (
    AudioGenerationJob,
    Language,
    Text,
    Translation,
    TranslationGenerationJob,
    Voice,
)
from app.models.enums import TextOrigin, TranslationStatus
from app.services.llm import LLMTranslationService
from app.services.translation_jobs import claim_next_translation_job, process_translation_job
from tests.test_admin_content import auth_header
from tests.test_api_public import seed_public_data


class FailingTranslationService:
    def translate(self, text, target_lang, source_lang) -> str:
        raise ValueError("provider temporarily unavailable")


def test_batch_moves_from_translation_to_review_and_translated_audio(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    spanish_voice = Voice(elevenlabs_id="voice-es", name="Spanish Voice")
    spanish_voice.languages.append(db_session.get(Language, "es"))
    db_session.add(spanish_voice)
    db_session.commit()

    created = client.post(
        "/api/v1/admin/automation/batches",
        headers=headers,
        json={
            "text_ids": [str(text.id)],
            "target_languages": ["es"],
            "generate_source_audio": False,
            "auto_approve_translations": False,
            "voice_overrides": {"es": "voice-es"},
            "policy": "missing_only",
        },
    )

    assert created.status_code == 200
    batch_id = created.json()["data"]["id"]
    job_id = claim_next_translation_job(db_session)
    assert job_id is not None
    process_translation_job(db_session, job_id, LLMTranslationService(api_key=""))

    awaiting_review = client.get(f"/api/v1/admin/automation/batches/{batch_id}", headers=headers)
    assert awaiting_review.status_code == 200
    assert awaiting_review.json()["data"]["current_stage"] == "awaiting_review"
    assert len(awaiting_review.json()["data"]["pending_reviews"]) == 1

    translation = db_session.query(Translation).filter_by(text_id=text.id, lang="es").one()
    reviewed = client.put(
        f"/api/v1/admin/translations/{translation.id}/review",
        headers=headers,
        json={"content": translation.content, "status": "approved"},
    )
    assert reviewed.status_code == 200

    ready = client.get(f"/api/v1/admin/automation/batches/{batch_id}", headers=headers)
    assert ready.json()["data"]["current_stage"] == "ready_for_translated_audio"

    audio = client.post(
        f"/api/v1/admin/automation/batches/{batch_id}/translated-audio",
        headers=headers,
    )
    assert audio.status_code == 200
    assert audio.json()["data"]["current_stage"] == "generating_audio"
    audio_job = db_session.query(AudioGenerationJob).filter_by(batch_stage="translated_audio").one()
    assert [(item.text_id, item.lang) for item in audio_job.items] == [(text.id, "es")]
    assert audio_job.preferred_voice_id == "voice-es"


def test_batch_auto_approves_translations_and_queues_their_audio_by_default(
    client, db_session
) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    spanish_voice = Voice(elevenlabs_id="auto-voice-es", name="Automatic Spanish Voice")
    spanish_voice.languages.append(db_session.get(Language, "es"))
    db_session.add(spanish_voice)
    db_session.commit()

    created = client.post(
        "/api/v1/admin/automation/batches",
        headers=headers,
        json={
            "text_ids": [str(text.id)],
            "target_languages": ["es"],
            "audio_languages": ["es"],
            "generate_source_audio": False,
            "generate_translated_audio": True,
            "voice_overrides": {"es": "auto-voice-es"},
        },
    )

    assert created.status_code == 200
    assert created.json()["data"]["auto_approve_translations"] is True
    batch_id = created.json()["data"]["id"]
    job_id = claim_next_translation_job(db_session)
    assert job_id is not None
    process_translation_job(db_session, job_id, LLMTranslationService(api_key=""))

    translation = db_session.query(Translation).filter_by(text_id=text.id, lang="es").one()
    assert translation.status == TranslationStatus.APPROVED
    assert translation.reviewed_by == "admin@example.com"
    audio_job = db_session.query(AudioGenerationJob).filter_by(batch_stage="translated_audio").one()
    assert audio_job.batch_id == UUID(batch_id)
    assert audio_job.preferred_voice_id == "auto-voice-es"
    assert [(item.text_id, item.lang) for item in audio_job.items] == [(text.id, "es")]

    batch = client.get(f"/api/v1/admin/automation/batches/{batch_id}", headers=headers)
    assert batch.json()["data"]["current_stage"] == "generating_audio"


def test_missing_only_preserves_manual_translation_but_queues_its_missing_audio(
    client, db_session
) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    translation = Translation(
        text_id=text.id,
        lang="fr",
        content="Texte revu manuellement",
        status=TranslationStatus.APPROVED,
        auto_translated=False,
        origin=TextOrigin.MANUAL.value,
        reviewed_by="editor@example.com",
    )
    db_session.add(translation)
    db_session.commit()

    created = client.post(
        "/api/v1/admin/automation/batches",
        headers=headers,
        json={
            "text_ids": [str(text.id)],
            "target_languages": ["fr"],
            "generate_source_audio": False,
            "auto_approve_translations": False,
            "policy": "missing_only",
        },
    )
    batch_id = created.json()["data"]["id"]
    job_id = claim_next_translation_job(db_session)
    assert job_id is not None
    job = process_translation_job(db_session, job_id, LLMTranslationService(api_key=""))

    assert job.skipped == 1
    db_session.refresh(translation)
    assert translation.content == "Texte revu manuellement"
    ready = client.get(f"/api/v1/admin/automation/batches/{batch_id}", headers=headers)
    assert ready.json()["data"]["current_stage"] == "ready_for_translated_audio"

    audio = client.post(
        f"/api/v1/admin/automation/batches/{batch_id}/translated-audio",
        headers=headers,
    )
    assert audio.status_code == 200
    audio_job = db_session.query(AudioGenerationJob).filter_by(batch_stage="translated_audio").one()
    assert audio_job.items[0].lang == "fr"


def test_replace_automatic_never_replaces_reviewed_translation(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    translation = Translation(
        text_id=text.id,
        lang="de",
        content="Geprüfter Text",
        status=TranslationStatus.APPROVED,
        auto_translated=True,
        origin=TextOrigin.AUTOMATIC.value,
        reviewed_by="editor@example.com",
    )
    db_session.add(translation)
    db_session.commit()

    response = client.post(
        "/api/v1/admin/automation/batches",
        headers=headers,
        json={
            "text_ids": [str(text.id)],
            "target_languages": ["de"],
            "generate_source_audio": False,
            "policy": "replace_automatic",
        },
    )
    assert response.status_code == 200
    job_id = claim_next_translation_job(db_session)
    assert job_id is not None
    process_translation_job(db_session, job_id, LLMTranslationService(api_key=""))

    job = db_session.get(TranslationGenerationJob, job_id)
    db_session.refresh(translation)
    assert job is not None and job.skipped == 1
    assert translation.content == "Geprüfter Text"


def test_retry_replaces_the_failed_attempt_in_batch_progress(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    created = client.post(
        "/api/v1/admin/automation/batches",
        headers=headers,
        json={
            "text_ids": [str(text.id)],
            "target_languages": ["es"],
            "generate_source_audio": False,
            "auto_approve_translations": False,
        },
    )
    batch_id = created.json()["data"]["id"]
    first_job_id = claim_next_translation_job(db_session)
    assert first_job_id is not None
    process_translation_job(db_session, first_job_id, FailingTranslationService())

    failed = client.get(f"/api/v1/admin/automation/batches/{batch_id}", headers=headers)
    assert failed.json()["data"]["status"] == "partial_failure"
    assert failed.json()["data"]["progress"]["failed"] == 1

    retry = client.post(
        f"/api/v1/admin/automation/batches/{batch_id}/retry-failed", headers=headers
    )
    assert retry.status_code == 200
    retry_job_id = claim_next_translation_job(db_session)
    assert retry_job_id is not None
    process_translation_job(db_session, retry_job_id, LLMTranslationService(api_key=""))

    recovered = client.get(f"/api/v1/admin/automation/batches/{batch_id}", headers=headers)
    assert recovered.json()["data"]["current_stage"] == "awaiting_review"
    assert recovered.json()["data"]["progress"]["failed"] == 0
    assert recovered.json()["data"]["errors"] == []


def test_batch_can_generate_audio_for_existing_approved_translations(client, db_session) -> None:
    headers = auth_header(client, db_session)
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    db_session.add(
        Translation(
            text_id=text.id,
            lang="fr",
            content="Je ne suis rien.",
            status=TranslationStatus.APPROVED,
        )
    )
    db_session.commit()

    response = client.post(
        "/api/v1/admin/automation/batches",
        headers=headers,
        json={
            "text_ids": [str(text.id)],
            "target_languages": [],
            "audio_languages": ["en"],
            "generate_source_audio": False,
            "generate_translated_audio": True,
            "voice_overrides": {"en": "voice-default"},
            "policy": "missing_only",
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["current_stage"] == "generating_audio"
    job = (
        db_session.query(AudioGenerationJob)
        .filter_by(batch_stage="existing_translated_audio")
        .one()
    )
    assert [(item.text_id, item.lang) for item in job.items] == [(text.id, "en")]
    assert job.preferred_voice_id == "voice-default"
    assert response.json()["data"]["voice_overrides"] == {"en": "voice-default"}
