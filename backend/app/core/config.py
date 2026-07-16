from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Lisboa por Outros API"
    environment: str = "development"
    database_url: str = "sqlite+pysqlite:///./app.db"
    admin_secret_key: str = "change-me"
    admin_access_token_expire_minutes: int = 60
    admin_initial_email: str = "admin@example.com"
    admin_initial_password: str = "change-me"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    geocoding_provider: str = "nominatim"
    geocoding_base_url: str = "https://nominatim.openstreetmap.org/search"
    geocoding_user_agent: str = "lisboa-por-outros-api/0.1"
    geocoding_timeout_s: float = 10.0
    geocoding_api_key: str | None = None
    geocoding_api_key_header: str | None = None
    geocoding_api_key_query_param: str | None = None
    translation_llm_provider: str = "claude"
    translation_llm_model: str = "claude-3-5-sonnet-latest"
    translation_llm_api_key: str | None = None
    translation_llm_base_url: str | None = None
    translation_llm_timeout_s: float = 30.0
    anthropic_api_key: str | None = None
    anthropic_base_url: str = "https://api.anthropic.com/v1"
    anthropic_version: str = "2023-06-01"
    elevenlabs_api_key: str | None = None
    elevenlabs_base_url: str = "https://api.elevenlabs.io/v1"
    elevenlabs_model_id: str = "eleven_multilingual_v2"
    elevenlabs_timeout_s: float = 60.0
    elevenlabs_default_voice_id: str | None = None
    audio_storage_dir: str = "media"
    audio_public_base_url: str = "/media"
    audio_upload_max_bytes: int = Field(default=25 * 1024 * 1024, gt=0)
    audio_worker_enabled: bool = True
    audio_worker_poll_interval_s: float = Field(default=1.0, gt=0)


@lru_cache
def get_settings() -> Settings:
    return Settings()
