from pathlib import Path
from time import monotonic

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base
from app.models.entities import (
    AudioFile,
    AudioGenerationJob,
    AudioGenerationJobItem,
    Author,
    Language,
    Point,
    PronunciationDictionary,
    Text,
    Voice,
)
from app.models.enums import AudioJobItemStatus, AudioJobStatus, ContentType
from app.services.audio_jobs import (
    AudioJobWorker,
    claim_next_audio_job,
    create_audio_job,
    process_audio_job,
    recover_interrupted_audio_jobs,
    stream_job_events,
)
from app.services.audio_storage import AudioStorage
from app.services.elevenlabs import ElevenLabsService, GeneratedAudio
from tests.test_api_public import seed_public_data


def test_claim_prevents_the_same_job_from_being_taken_twice(db_session) -> None:
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    job = create_audio_job(db_session, "admin@example.com", [(text.id, "pt")])

    assert claim_next_audio_job(db_session) == job.id
    assert claim_next_audio_job(db_session) is None


def test_recovery_resumes_only_unfinished_items(db_session) -> None:
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    second_text = Text(
        point_id=ids["point"].id,
        author_id=ids["author"].id,
        content_pt="Outro texto.",
        content_type=ContentType.PROSE,
    )
    db_session.add(second_text)
    db_session.commit()
    job = create_audio_job(
        db_session,
        "admin@example.com",
        [(text.id, "pt"), (second_text.id, "pt")],
    )
    items = list(
        db_session.query(AudioGenerationJobItem)
        .filter(AudioGenerationJobItem.job_id == job.id)
        .order_by(AudioGenerationJobItem.created_at)
    )
    job.status = AudioJobStatus.RUNNING
    items[0].status = AudioJobItemStatus.COMPLETED
    items[1].status = AudioJobItemStatus.RUNNING
    db_session.commit()

    assert recover_interrupted_audio_jobs(db_session) == 1

    db_session.refresh(job)
    db_session.refresh(items[0])
    db_session.refresh(items[1])
    assert job.status == AudioJobStatus.PENDING
    assert job.processed == 1
    assert job.succeeded == 1
    assert job.failed == 0
    assert items[0].status == AudioJobItemStatus.COMPLETED
    assert items[1].status == AudioJobItemStatus.PENDING


def test_partial_failure_keeps_successful_audio(db_session, tmp_path) -> None:
    ids = seed_public_data(db_session)
    translated_text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    untranslated_text = Text(
        point_id=ids["point"].id,
        author_id=ids["author"].id,
        content_pt="Sem tradução.",
        content_type=ContentType.PROSE,
    )
    db_session.add(untranslated_text)
    db_session.commit()
    job = create_audio_job(
        db_session,
        "admin@example.com",
        [(translated_text.id, "en"), (untranslated_text.id, "en")],
    )

    assert claim_next_audio_job(db_session) == job.id
    storage = AudioStorage(storage_dir=str(tmp_path / "media"))
    result = process_audio_job(
        db_session,
        job.id,
        ElevenLabsService(api_key=""),
        storage,
    )

    assert result.status == AudioJobStatus.FAILED
    assert result.processed == 2
    assert result.succeeded == 1
    assert result.failed == 1
    successful_audio = (
        db_session.query(AudioFile)
        .filter_by(
            text_id=translated_text.id,
            lang="en",
        )
        .one()
    )
    assert successful_audio.manually_uploaded is False
    assert Path(storage.storage_dir, successful_audio.r2_key).exists()
    failed_item = (
        db_session.query(AudioGenerationJobItem)
        .filter_by(
            job_id=job.id,
            text_id=untranslated_text.id,
        )
        .one()
    )
    assert failed_item.status == AudioJobItemStatus.FAILED
    assert failed_item.error_message == "Approved translation required before audio generation"


def test_audio_generation_applies_dictionary_for_item_language(db_session, tmp_path) -> None:
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    db_session.add(
        PronunciationDictionary(
            language_code="pt",
            elevenlabs_id="dictionary-pt",
            version_id="version-7",
            name="Lisboa por Outros — Portuguese",
        )
    )
    db_session.commit()
    job = create_audio_job(db_session, "admin@example.com", [(text.id, "pt")])
    assert claim_next_audio_job(db_session) == job.id

    class RecordingService:
        locator = None

        def generate_audio(
            self,
            source_text,
            voice_id,
            pronunciation_dictionary_locators=None,
        ):
            self.locator = pronunciation_dictionary_locators
            return GeneratedAudio(
                content=b"generated",
                duration_s=None,
                voice_id=voice_id,
            )

    service = RecordingService()
    process_audio_job(
        db_session,
        job.id,
        service,
        AudioStorage(storage_dir=str(tmp_path / "media")),
    )

    assert service.locator == [
        {
            "pronunciation_dictionary_id": "dictionary-pt",
            "version_id": "version-7",
        }
    ]


def test_audio_generation_reuses_signed_local_recipe_without_provider(db_session, tmp_path) -> None:
    ids = seed_public_data(db_session)
    first = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    second = Text(
        point_id=ids["point"].id,
        author_id=ids["author"].id,
        content_pt=first.content_pt,
        content_type=ContentType.PROSE,
    )
    db_session.add(second)
    db_session.commit()
    storage = AudioStorage(storage_dir=str(tmp_path / "media"))

    class CountingService:
        generation_model_id = "eleven_v3"
        output_format = "mp3_44100_128"
        calls = 0

        def generate_audio(self, _source_text, voice_id, **_kwargs):
            self.calls += 1
            return GeneratedAudio(b"ID3portable", 1.0, voice_id)

    service = CountingService()
    for text in (first, second):
        job = create_audio_job(db_session, "admin@example.com", [(text.id, "pt")])
        assert claim_next_audio_job(db_session) == job.id
        process_audio_job(db_session, job.id, service, storage)

    assert service.calls == 1
    first_audio = db_session.query(AudioFile).filter_by(text_id=first.id, lang="pt").one()
    second_audio = db_session.query(AudioFile).filter_by(text_id=second.id, lang="pt").one()
    assert first_audio.recipe_hash == second_audio.recipe_hash
    assert Path(storage.storage_dir, str(second_audio.r2_key)).read_bytes() == b"ID3portable"


def test_worker_stop_leaves_job_recoverable(db_session, tmp_path) -> None:
    ids = seed_public_data(db_session)
    text = db_session.query(Text).filter(Text.point_id == ids["point"].id).one()
    job = create_audio_job(db_session, "admin@example.com", [(text.id, "pt")])
    assert claim_next_audio_job(db_session) == job.id

    result = process_audio_job(
        db_session,
        job.id,
        ElevenLabsService(api_key=""),
        AudioStorage(storage_dir=str(tmp_path / "media")),
        should_stop=lambda: True,
    )

    assert result.status == AudioJobStatus.RUNNING
    assert recover_interrupted_audio_jobs(db_session) == 1
    recovered = db_session.get(AudioGenerationJob, job.id)
    assert recovered is not None
    assert recovered.status == AudioJobStatus.PENDING


def test_worker_thread_processes_persisted_job(tmp_path) -> None:
    engine = create_engine(
        f"sqlite+pysqlite:///{tmp_path / 'worker.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    worker_sessions = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    with worker_sessions() as db:
        language = Language(
            code="pt",
            locale="pt-PT",
            country_code="PT",
            name="Portuguese",
            is_active=True,
            is_source=True,
        )
        voice = Voice(elevenlabs_id="voice-default", name="Default", is_default=True)
        author = Author(name="Fernando Pessoa", elevenlabs_voice_id="voice-default")
        point = Point(title_pt="Chiado", lat=38.71, lng=-9.14)
        text = Text(
            point=point,
            author=author,
            content_pt="Não sou nada.",
            content_type=ContentType.POETRY,
        )
        db.add_all([language, voice, author, point, text])
        db.commit()
        job = create_audio_job(db, "admin@example.com", [(text.id, "pt")])
        job_id = job.id
        text_id = text.id

    storage = AudioStorage(storage_dir=str(tmp_path / "media"))
    worker = AudioJobWorker(
        session_factory=worker_sessions,
        elevenlabs=ElevenLabsService(api_key=""),
        storage=storage,
        poll_interval_s=0.01,
    )
    with worker_sessions() as events_db:
        events = stream_job_events(events_db, job_id, poll_interval_s=0.01)
        assert '"status": "pending"' in next(events)
        worker.start()
        try:
            deadline = monotonic() + 2
            last_event = ""
            while monotonic() < deadline:
                last_event = next(events)
                if '"status": "completed"' in last_event:
                    break
        finally:
            worker.stop()

    assert '"status": "completed"' in last_event
    with worker_sessions() as db:
        audio = db.query(AudioFile).filter_by(text_id=text_id, lang="pt").one()
        assert Path(storage.storage_dir, audio.r2_key).read_bytes() == "Não sou nada.".encode()
