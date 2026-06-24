from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import get_db
from app.main import create_app
from app.models import Base
from app.services.elevenlabs import ElevenLabsService
from app.services.llm import LLMTranslationService


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
        yield session

    Base.metadata.drop_all(engine)


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    app = create_app()

    def override_get_db() -> Iterator[Session]:
        yield db_session

    from app.api.routes import admin_automation

    admin_automation.translation_service = LLMTranslationService(api_key="")
    admin_automation.elevenlabs_service = ElevenLabsService(api_key="")
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
