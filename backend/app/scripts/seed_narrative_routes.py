from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.entities import (
    AudioGenerationJobItem,
    Author,
    Point,
    Route,
    RouteItem,
    RouteSegmentTranslation,
    RouteTranslation,
    Text,
    Translation,
)
from app.models.enums import (
    AudioJobItemStatus,
    ContentType,
    RouteRoutingStatus,
    RouteSegmentKind,
    TranslationStatus,
)
from app.services.audio_jobs import create_audio_job, create_bridge_audio_job

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "do_tejo_ao_chiado.json"
ALLOWED_ENVIRONMENTS = {"development", "staging"}
SEED_ACTOR = "narrative-route-seed"


def load_fixture(path: Path = FIXTURE_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def seed_do_tejo_ao_chiado(
    db: Session,
    *,
    environment: str,
) -> Route | None:
    """Seed the versioned route without contacting routing or audio providers."""
    if environment not in ALLOWED_ENVIRONMENTS:
        return None
    fixture = load_fixture()
    texts = [_upsert_text(db, item) for item in fixture["texts"]]
    route = db.scalar(select(Route).where(Route.slug == fixture["slug"]))
    is_new_route = route is None
    if route is None:
        route = Route(
            slug=fixture["slug"],
            is_published=False,
            routing_status=RouteRoutingStatus.PENDING.value,
        )
        db.add(route)
    route.title_pt = fixture["title_pt"]
    route.description_pt = fixture["description_pt"]
    route.difficulty = fixture["difficulty"]
    if is_new_route:
        route.routing_hash = None
    route.migration_status = "ready"
    db.flush()
    _upsert_route_translation(db, route, fixture)
    _upsert_segments(db, route, texts, fixture["bridges"])
    db.flush()
    return route


def queue_missing_route_audio(db: Session, route: Route) -> None:
    """Queue provider work only when explicitly called after the route transaction is committed."""
    settings = get_settings()
    text_items: dict[str, list[tuple[Any, str]]] = {"pt": [], "en": []}
    bridge_items: dict[str, list[tuple[Any, str]]] = {"pt": [], "en": []}
    for segment in route.items:
        if segment.kind == RouteSegmentKind.TEXT.value and segment.text is not None:
            for lang in text_items:
                has_audio = any(
                    audio.lang == lang and audio.public_url for audio in segment.text.audio_files
                )
                if not has_audio and not _is_queued(db, text_id=segment.text.id, lang=lang):
                    text_items[lang].append((segment.text.id, lang))
        elif segment.kind == RouteSegmentKind.BRIDGE.value:
            for lang in bridge_items:
                has_audio = any(
                    audio.lang == lang and audio.public_url for audio in segment.audio_files
                )
                if not has_audio and not _is_queued(db, segment_id=segment.id, lang=lang):
                    bridge_items[lang].append((segment.id, lang))
    for _lang, items in text_items.items():
        if items:
            create_audio_job(db, SEED_ACTOR, items, policy="missing_only")
    for lang, items in bridge_items.items():
        if items:
            create_bridge_audio_job(
                db,
                SEED_ACTOR,
                items,
                preferred_voice_id=settings.route_curatorial_voice_ids.get(lang),
            )


def _upsert_text(db: Session, item: dict[str, Any]) -> Text:
    author_data = item["author"]
    author = db.scalar(select(Author).where(Author.name == author_data["name"]))
    if author is None:
        author = Author(**author_data)
        db.add(author)
    point_data = item["point"]
    point = db.scalar(select(Point).where(Point.title_pt == point_data["title_pt"]))
    if point is None:
        point = Point(**point_data)
        db.add(point)
    db.flush()
    text = db.scalar(
        select(Text).where(
            Text.author_id == author.id,
            Text.point_id == point.id,
            Text.source_work == item["source_work"],
        )
    )
    if text is None:
        text = Text(
            author=author,
            point=point,
            content_pt=item["content_pt"],
            source_work=item["source_work"],
            source_year=item["source_year"],
            content_type=ContentType.PROSE,
        )
        db.add(text)
        db.flush()
    translation = db.scalar(
        select(Translation).where(Translation.text_id == text.id, Translation.lang == "en")
    )
    if translation is None:
        db.add(
            Translation(
                text=text,
                lang="en",
                content=item["content_en"],
                status=TranslationStatus.APPROVED,
                auto_translated=False,
                origin="manual",
                reviewed_by=SEED_ACTOR,
            )
        )
    return text


def _upsert_route_translation(db: Session, route: Route, fixture: dict[str, Any]) -> None:
    translation = db.scalar(
        select(RouteTranslation).where(
            RouteTranslation.route_id == route.id,
            RouteTranslation.lang == "en",
        )
    )
    if translation is None:
        db.add(
            RouteTranslation(
                route=route,
                lang="en",
                title=fixture["title_en"],
                description=fixture["description_en"],
                status=TranslationStatus.APPROVED,
                auto_translated=False,
                origin="manual",
                reviewed_by=SEED_ACTOR,
            )
        )


def _upsert_segments(
    db: Session,
    route: Route,
    texts: list[Text],
    bridges: dict[str, Any],
) -> None:
    payloads: list[tuple[str, Text | None, dict[str, str] | None]] = [
        (RouteSegmentKind.BRIDGE.value, None, bridges["intro"]),
    ]
    for index, text in enumerate(texts):
        payloads.append((RouteSegmentKind.TEXT.value, text, None))
        if index < len(bridges["transitions"]):
            payloads.append((RouteSegmentKind.BRIDGE.value, None, bridges["transitions"][index]))
    payloads.append((RouteSegmentKind.BRIDGE.value, None, bridges["ending"]))
    existing = {segment.position: segment for segment in route.items}
    for position, (kind, text, bridge) in enumerate(payloads):
        segment = existing.get(position)
        if segment is None:
            segment = RouteItem(route=route, position=position, kind=kind)
            db.add(segment)
        segment.kind = kind
        segment.text = text
        segment.text_id = text.id if text else None
        segment.point_id = None
        segment.bridge_content_pt = bridge["content_pt"] if bridge else None
        db.flush()
        if bridge:
            translation = db.scalar(
                select(RouteSegmentTranslation).where(
                    RouteSegmentTranslation.segment_id == segment.id,
                    RouteSegmentTranslation.lang == "en",
                )
            )
            if translation is None:
                db.add(
                    RouteSegmentTranslation(
                        segment=segment,
                        lang="en",
                        content=bridge["content_en"],
                        status=TranslationStatus.APPROVED,
                        reviewed_by=SEED_ACTOR,
                    )
                )


def _is_queued(
    db: Session,
    *,
    lang: str,
    text_id: Any | None = None,
    segment_id: Any | None = None,
) -> bool:
    statement = select(AudioGenerationJobItem.id).where(
        AudioGenerationJobItem.lang == lang,
        AudioGenerationJobItem.status.in_([AudioJobItemStatus.PENDING, AudioJobItemStatus.RUNNING]),
    )
    statement = statement.where(
        AudioGenerationJobItem.text_id == text_id
        if text_id is not None
        else AudioGenerationJobItem.route_segment_id == segment_id
    )
    return db.scalar(statement) is not None


def seed() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        route = seed_do_tejo_ao_chiado(db, environment=settings.environment)
        if route is None:
            raise RuntimeError("narrative route seed is restricted to development and staging")
        db.commit()
        queue_missing_route_audio(db, route)
        print(f"Seed concluído: {route.slug}")


if __name__ == "__main__":
    seed()
