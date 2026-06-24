import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import Text, Translation
from app.models.enums import SupportedLanguage, TranslationStatus
from app.services.http_client import open_url


@dataclass
class LLMTranslationService:
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None

    def _provider(self) -> str:
        return (self.provider or get_settings().translation_llm_provider).lower()

    def _model(self) -> str:
        return self.model or get_settings().translation_llm_model

    def _api_key(self) -> str | None:
        settings = get_settings()
        if self.api_key is not None:
            return self.api_key
        return settings.translation_llm_api_key or settings.anthropic_api_key

    def _base_url(self) -> str:
        settings = get_settings()
        base_url = self.base_url or settings.translation_llm_base_url or settings.anthropic_base_url
        return base_url.rstrip("/")

    def translate(self, text: Text, target_lang: SupportedLanguage) -> str:
        provider = self._provider()
        if provider in {"claude", "anthropic"}:
            return self._translate_with_claude(text, target_lang)
        raise ValueError(f"Unsupported LLM provider: {provider}")

    def _translate_with_claude(self, text: Text, target_lang: SupportedLanguage) -> str:
        api_key = self._api_key()
        if not api_key:
            return f"[claude:{target_lang.value}] {text.content_pt}"

        settings = get_settings()
        prompt = build_translation_prompt(text, target_lang)
        body = json.dumps(
            {
                "model": self._model(),
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}],
            }
        ).encode("utf-8")
        request = Request(
            f"{self._base_url()}/messages",
            data=body,
            method="POST",
            headers={
                "x-api-key": api_key,
                "anthropic-version": settings.anthropic_version,
                "content-type": "application/json",
            },
        )
        try:
            with open_url(request, timeout=settings.translation_llm_timeout_s) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            message = exc.read().decode("utf-8", "ignore")
            raise ValueError(f"LLM translation failed: {exc.code} {message}") from exc
        except URLError as exc:
            raise ValueError(f"LLM translation failed: {exc.reason}") from exc

        return extract_claude_text(payload)


def build_translation_prompt(text: Text, target_lang: SupportedLanguage) -> str:
    author = text.author.name if text.author else "Unknown author"
    source = text.source_work or "Unknown source"
    return (
        "You are a literary translator. Preserve the author's voice, rhythm, "
        "punctuation style and register. Do not modernize or simplify. "
        "Return only the translated text.\n\n"
        f"Target language: {target_lang.value}\n"
        f"Author: {author}\n"
        f"Source work: {source}\n\n"
        f"Portuguese original:\n{text.content_pt}"
    )


def extract_claude_text(payload: dict[str, object]) -> str:
    content = payload.get("content")
    if not isinstance(content, list):
        raise ValueError("LLM translation response is invalid")
    parts: list[str] = []
    for item in content:
        if (
            isinstance(item, dict)
            and item.get("type") == "text"
            and isinstance(item.get("text"), str)
        ):
            parts.append(item["text"])
    translated = "".join(parts).strip()
    if not translated:
        raise ValueError("LLM translation response did not include text")
    return translated


def request_translation(
    db: Session,
    text: Text,
    target_lang: SupportedLanguage,
    service: LLMTranslationService,
) -> Translation:
    existing = db.scalar(
        select(Translation).where(Translation.text_id == text.id, Translation.lang == target_lang)
    )
    content = service.translate(text, target_lang)
    if existing is None:
        translation = Translation(
            text_id=text.id,
            lang=target_lang,
            content=content,
            status=TranslationStatus.PENDING,
            auto_translated=True,
        )
        db.add(translation)
        db.flush()
        return translation

    existing.content = content
    existing.status = TranslationStatus.PENDING
    existing.auto_translated = True
    existing.reviewed_by = None
    existing.reviewed_at = None
    db.flush()
    return existing
