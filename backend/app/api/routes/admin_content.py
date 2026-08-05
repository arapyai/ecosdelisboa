from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.api.routes.admin_routes import serialize_leg
from app.core.config import get_settings
from app.core.db import get_db
from app.models.entities import AdminUser, Author, Point, Route, RouteItem, Text
from app.models.enums import ContentType, RouteRoutingStatus, RouteSegmentKind, TextOrigin
from app.schemas.common import EnvelopeMeta, envelope
from app.services.languages import get_source_language
from app.services.route_readiness import serialize_route_readiness

router = APIRouter(prefix="/api/v1/admin", tags=["admin-content"])


class AuthorWrite(BaseModel):
    name: str
    bio_pt: str | None = None
    birth_year: int | None = None
    death_year: int | None = None
    photo_url: str | None = None
    elevenlabs_voice_id: str | None = None


class PointWrite(BaseModel):
    title_pt: str
    address: str | None = None
    neighborhood: str | None = None
    lat: float
    lng: float


class TextWrite(BaseModel):
    point_id: UUID
    author_id: UUID
    content_pt: str
    phonetic_content: str | None = None
    source_work: str | None = None
    source_year: int | None = None
    content_type: ContentType


class RouteSegmentWrite(BaseModel):
    position: int
    kind: RouteSegmentKind
    text_id: UUID | None = None
    bridge_content_pt: str | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "RouteSegmentWrite":
        if self.kind == RouteSegmentKind.TEXT and self.text_id is None:
            raise ValueError("text segments require text_id")
        if self.kind == RouteSegmentKind.TEXT and self.bridge_content_pt is not None:
            raise ValueError("text segments cannot contain bridge content")
        if self.kind == RouteSegmentKind.BRIDGE and not self.bridge_content_pt:
            raise ValueError("bridge segments require bridge_content_pt")
        if self.kind == RouteSegmentKind.BRIDGE and self.text_id is not None:
            raise ValueError("bridge segments cannot reference text_id")
        if self.kind == RouteSegmentKind.LEGACY:
            raise ValueError("legacy segments are read-only")
        return self


class RouteWrite(BaseModel):
    title_pt: str
    slug: str | None = None
    description_pt: str | None = None
    cover_image_url: str | None = None
    difficulty: str | None = None
    is_published: bool = False
    estimated_distance_m: float | None = None
    estimated_duration_s: int | None = None
    segments: list[RouteSegmentWrite] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_positions(self) -> "RouteWrite":
        positions = [segment.position for segment in self.segments]
        if len(positions) != len(set(positions)):
            raise ValueError("segment positions must be unique")
        return self


def serialize_author(author: Author) -> dict[str, object]:
    return {
        "id": str(author.id),
        "name": author.name,
        "bio_pt": author.bio_pt,
        "birth_year": author.birth_year,
        "death_year": author.death_year,
        "photo_url": author.photo_url,
        "elevenlabs_voice_id": author.elevenlabs_voice_id,
    }


def serialize_point(point: Point) -> dict[str, object]:
    return {
        "id": str(point.id),
        "title_pt": point.title_pt,
        "address": point.address,
        "neighborhood": point.neighborhood,
        "lat": point.lat,
        "lng": point.lng,
    }


def serialize_text(text: Text) -> dict[str, object]:
    return {
        "id": str(text.id),
        "point_id": str(text.point_id),
        "author_id": str(text.author_id),
        "content_pt": text.content_pt,
        "phonetic_content": text.phonetic_content,
        "source_work": text.source_work,
        "source_year": text.source_year,
        "content_type": text.content_type.value,
        "origin": text.origin,
        "author": serialize_author(text.author),
        "point": serialize_point(text.point),
        "translations": [
            {
                "lang": translation.lang,
                "content": translation.content,
                "status": translation.status.value,
            }
            for translation in text.translations
        ],
        "audio_files": [
            {
                "lang": audio.lang,
                "public_url": audio.public_url,
                "duration_s": audio.duration_s,
                "manually_uploaded": audio.manually_uploaded,
            }
            for audio in text.audio_files
        ],
    }


def serialize_route_segment(item: RouteItem) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": str(item.id),
        "position": item.position,
        "kind": item.kind,
        "text_id": str(item.text_id) if item.text_id else None,
        "bridge_content_pt": item.bridge_content_pt,
    }
    if item.text is not None:
        payload["text"] = serialize_text(item.text)
    if item.kind == RouteSegmentKind.BRIDGE.value:
        payload["translations"] = [
            {
                "id": str(translation.id),
                "lang": translation.lang,
                "content": translation.content,
                "status": translation.status.value,
            }
            for translation in item.translations
        ]
        payload["audio_files"] = [
            {
                "id": str(audio.id),
                "lang": audio.lang,
                "public_url": audio.public_url,
                "duration_s": audio.duration_s,
                "voice_id": audio.voice_id,
                "manually_uploaded": audio.manually_uploaded,
            }
            for audio in item.audio_files
        ]
    if item.kind == RouteSegmentKind.LEGACY.value:
        payload.update(
            {
                "point_id": str(item.point_id) if item.point_id else None,
                "waypoint_lat": item.waypoint_lat,
                "waypoint_lng": item.waypoint_lng,
                "transition_text_pt": item.transition_text_pt,
            }
        )
    return payload


def serialize_route(route: Route) -> dict[str, object]:
    segments = [serialize_route_segment(item) for item in route.items]
    return {
        "id": str(route.id),
        "title_pt": route.title_pt,
        "slug": route.slug,
        "description_pt": route.description_pt,
        "cover_image_url": route.cover_image_url,
        "difficulty": route.difficulty,
        "is_published": route.is_published,
        "estimated_distance_m": route.estimated_distance_m,
        "estimated_duration_s": route.estimated_duration_s,
        "routing_status": route.routing_status,
        "migration_status": route.migration_status,
        "segments": segments,
        "items": segments,
        "items_deprecated": True,
        "legs": [serialize_leg(leg) for leg in route.legs],
    }


def replace_route_segments(route: Route, segments: list[RouteSegmentWrite], db: Session) -> None:
    for existing_item in list(route.items):
        route.items.remove(existing_item)
    text_ids = {segment.text_id for segment in segments if segment.text_id is not None}
    existing_text_ids = set(db.scalars(select(Text.id).where(Text.id.in_(text_ids))).all())
    missing_text_ids = text_ids - existing_text_ids
    if missing_text_ids:
        raise HTTPException(
            status_code=422,
            detail={"code": "unknown_route_texts", "text_ids": sorted(map(str, missing_text_ids))},
        )
    for item in sorted(segments, key=lambda current: current.position):
        route.items.append(
            RouteItem(
                position=item.position,
                kind=item.kind.value,
                text_id=item.text_id,
                bridge_content_pt=item.bridge_content_pt,
            )
        )
    route.routing_status = RouteRoutingStatus.STALE.value
    route.routing_hash = None
    route.routing_error = None


def route_segments_changed(route: Route, segments: list[RouteSegmentWrite]) -> bool:
    current = [
        (item.position, item.kind, item.text_id, item.bridge_content_pt)
        for item in sorted(route.items, key=lambda candidate: candidate.position)
    ]
    requested = [
        (item.position, item.kind.value, item.text_id, item.bridge_content_pt)
        for item in sorted(segments, key=lambda candidate: candidate.position)
    ]
    return current != requested


def publication_readiness(db: Session, route: Route) -> list[dict[str, object]]:
    source_language = get_source_language(db).code
    return [
        serialize_route_readiness(route, lang, source_language)
        for lang in get_settings().route_required_languages
    ]


def ensure_route_can_publish(db: Session, route: Route) -> None:
    readiness = publication_readiness(db, route)
    if any(not item["ready"] for item in readiness):
        raise HTTPException(
            status_code=409,
            detail={"code": "route_not_ready", "readiness": readiness},
        )


@router.get("/authors")
def list_admin_authors(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    authors = db.scalars(select(Author).order_by(Author.name)).all()
    return envelope(
        [serialize_author(author) for author in authors],
        EnvelopeMeta(total=len(authors)),
    )


@router.post("/authors")
def create_author(
    payload: AuthorWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    author = Author(**payload.model_dump())
    db.add(author)
    db.commit()
    db.refresh(author)
    return envelope(serialize_author(author), EnvelopeMeta())


@router.put("/authors/{author_id}")
def update_author(
    author_id: UUID,
    payload: AuthorWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    author = db.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    for field, value in payload.model_dump().items():
        setattr(author, field, value)
    db.commit()
    db.refresh(author)
    return envelope(serialize_author(author), EnvelopeMeta())


@router.delete("/authors/{author_id}")
def delete_author(
    author_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    author = db.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    db.delete(author)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.get("/points")
def list_admin_points(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    points = db.scalars(select(Point).order_by(Point.title_pt)).all()
    return envelope([serialize_point(point) for point in points], EnvelopeMeta(total=len(points)))


@router.post("/points")
def create_point(
    payload: PointWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    point = Point(**payload.model_dump())
    db.add(point)
    db.commit()
    db.refresh(point)
    return envelope(serialize_point(point), EnvelopeMeta())


@router.put("/points/{point_id}")
def update_point(
    point_id: UUID,
    payload: PointWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    point = db.get(Point, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="Point not found")
    for field, value in payload.model_dump().items():
        setattr(point, field, value)
    db.commit()
    db.refresh(point)
    return envelope(serialize_point(point), EnvelopeMeta())


@router.delete("/points/{point_id}")
def delete_point(
    point_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    point = db.get(Point, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="Point not found")
    route_id = db.scalar(
        select(RouteItem.route_id)
        .join(Text, RouteItem.text_id == Text.id)
        .where(Text.point_id == point_id)
        .limit(1)
    )
    if route_id is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "point_used_by_route", "route_id": str(route_id)},
        )
    db.delete(point)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.get("/texts")
def list_admin_texts(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    point_id: UUID | None = None,
) -> dict[str, object]:
    query = (
        select(Text)
        .options(
            selectinload(Text.author),
            selectinload(Text.point),
            selectinload(Text.translations),
            selectinload(Text.audio_files),
        )
        .order_by(Text.created_at)
    )
    if point_id is not None:
        query = query.where(Text.point_id == point_id)
    texts = db.scalars(query).all()
    return envelope([serialize_text(text) for text in texts], EnvelopeMeta(total=len(texts)))


@router.post("/texts")
def create_text(
    payload: TextWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    text = Text(**payload.model_dump())
    text.origin = TextOrigin.MANUAL.value
    db.add(text)
    db.commit()
    db.refresh(text)
    return envelope(serialize_text(text), EnvelopeMeta())


@router.put("/texts/{text_id}")
def update_text(
    text_id: UUID,
    payload: TextWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    text = db.get(Text, text_id)
    if text is None:
        raise HTTPException(status_code=404, detail="Text not found")
    for field, value in payload.model_dump().items():
        setattr(text, field, value)
    text.origin = TextOrigin.MANUAL.value
    db.commit()
    db.refresh(text)
    return envelope(serialize_text(text), EnvelopeMeta())


@router.delete("/texts/{text_id}")
def delete_text(
    text_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    text = db.get(Text, text_id)
    if text is None:
        raise HTTPException(status_code=404, detail="Text not found")
    route_id = db.scalar(select(RouteItem.route_id).where(RouteItem.text_id == text_id).limit(1))
    if route_id is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "text_used_by_route", "route_id": str(route_id)},
        )
    db.delete(text)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.get("/routes")
def list_admin_routes(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    routes = db.scalars(
        select(Route)
        .options(
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.author),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.point),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.translations),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.audio_files),
            selectinload(Route.items).selectinload(RouteItem.translations),
            selectinload(Route.items).selectinload(RouteItem.audio_files),
            selectinload(Route.legs),
            selectinload(Route.translations),
        )
        .order_by(Route.title_pt)
    ).all()
    return envelope(
        [serialize_route(route) for route in routes],
        EnvelopeMeta(total=len(routes)),
    )


@router.post("/routes")
def create_route(
    payload: RouteWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    route = Route(**payload.model_dump(exclude={"segments"}))
    replace_route_segments(route, payload.segments, db)
    db.add(route)
    if route.is_published:
        db.flush()
        try:
            ensure_route_can_publish(db, route)
        except HTTPException:
            db.rollback()
            raise
    db.commit()
    db.refresh(route)
    return envelope(serialize_route(route), EnvelopeMeta())


@router.put("/routes/{route_id}")
def update_route(
    route_id: UUID,
    payload: RouteWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    route = db.scalar(
        select(Route)
        .options(
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.point),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.translations),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.audio_files),
            selectinload(Route.items).selectinload(RouteItem.translations),
            selectinload(Route.items).selectinload(RouteItem.audio_files),
            selectinload(Route.legs),
            selectinload(Route.translations),
        )
        .where(Route.id == route_id)
    )
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    for field, value in payload.model_dump(exclude={"segments"}).items():
        setattr(route, field, value)
    if route_segments_changed(route, payload.segments):
        for leg in list(route.legs):
            db.delete(leg)
        route.legs.clear()
        for item in list(route.items):
            db.delete(item)
        route.items.clear()
        db.flush()
        replace_route_segments(route, payload.segments, db)
    if route.is_published:
        db.flush()
        try:
            ensure_route_can_publish(db, route)
        except HTTPException:
            db.rollback()
            raise
    db.commit()
    db.refresh(route)
    return envelope(serialize_route(route), EnvelopeMeta())


@router.delete("/routes/{route_id}")
def delete_route(
    route_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    db.delete(route)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())
