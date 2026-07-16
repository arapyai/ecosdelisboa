from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.db import get_db
from app.main import create_app
from app.models import Base, Language
from app.services.audio_storage import AudioStorage
from app.services.elevenlabs import ElevenLabsService
from app.services.llm import LLMTranslationService


@pytest.fixture(autouse=True)
def clear_settings_cache(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("ELEVENLABS_DEFAULT_VOICE_ID", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def db_session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(engine)

    with TestingSessionLocal() as session:
        session.add_all(
            [
                Language(
                    code="pt",
                    locale="pt-PT",
                    country_code="PT",
                    name="Portuguese",
                    is_active=True,
                    is_source=True,
                ),
                Language(code="en", locale="en-US", country_code="US", name="English"),
                Language(code="es", locale="es-ES", country_code="ES", name="Spanish"),
                Language(code="fr", locale="fr-FR", country_code="FR", name="French"),
                Language(code="de", locale="de-DE", country_code="DE", name="German"),
                Language(code="zh", locale="zh-CN", country_code="CN", name="Chinese"),
            ]
        )
        session.commit()
        yield session

    Base.metadata.drop_all(engine)


@pytest.fixture
def client(
    db_session: Session,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[TestClient]:
    audio_storage_dir = tmp_path / "media"
    monkeypatch.setenv("AUDIO_STORAGE_DIR", str(audio_storage_dir))
    get_settings.cache_clear()
    app = create_app(start_audio_worker=False)

    def override_get_db() -> Iterator[Session]:
        yield db_session

    from app.api.routes import admin_automation

    admin_automation.translation_service = LLMTranslationService(api_key="")
    admin_automation.elevenlabs_service = ElevenLabsService(api_key="")
    admin_automation.settings = get_settings()
    admin_automation.audio_storage = AudioStorage(
        storage_dir=str(audio_storage_dir),
        public_base_url=admin_automation.settings.audio_public_base_url,
    )
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
