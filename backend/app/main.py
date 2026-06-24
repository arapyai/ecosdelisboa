from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)

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
