from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.services.audio_jobs import AudioJobWorker
from app.services.audio_storage import AudioStorage
from app.services.elevenlabs import ElevenLabsService


def create_app(start_audio_worker: bool | None = None) -> FastAPI:
    settings = get_settings()
    worker_enabled = (
        settings.audio_worker_enabled if start_audio_worker is None else start_audio_worker
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        worker: AudioJobWorker | None = None
        if worker_enabled:
            worker = AudioJobWorker(
                session_factory=SessionLocal,
                elevenlabs=ElevenLabsService(),
                storage=AudioStorage(
                    storage_dir=settings.audio_storage_dir,
                    public_base_url=settings.audio_public_base_url,
                ),
                poll_interval_s=settings.audio_worker_poll_interval_s,
            )
            worker.start()
            app.state.audio_job_worker = worker
        try:
            yield
        finally:
            if worker is not None:
                worker.stop()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    Path(settings.audio_storage_dir).mkdir(parents=True, exist_ok=True)
    app.mount(
        settings.audio_public_base_url,
        StaticFiles(directory=settings.audio_storage_dir),
        name="media",
    )
    return app


app = create_app()
