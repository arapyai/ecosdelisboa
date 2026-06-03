from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.models.entities import AdminUser, Author, Point, Route, RouteItem, Text
from app.models.enums import ContentType
from app.schemas.common import EnvelopeMeta, envelope

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
    source_work: str | None = None
    source_year: int | None = None
    content_type: ContentType


class RouteItemWrite(BaseModel):
    position: int
    point_id: UUID | None = None
    waypoint_lat: float | None = None
    waypoint_lng: float | None = None
    transition_text_pt: str | None = None


class RouteWrite(BaseModel):
    title_pt: str
    description_pt: str | None = None
    cover_image_url: str | None = None
    difficulty: str | None = None
    is_published: bool = False
    estimated_distance_m: float | None = None
    estimated_duration_s: int | None = None
    items: list[RouteItemWrite] = []


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
        "source_work": text.source_work,
        "source_year": text.source_year,
        "content_type": text.content_type.value,
    }


def serialize_route(route: Route) -> dict[str, object]:
    return {
        "id": str(route.id),
        "title_pt": route.title_pt,
        "description_pt": route.description_pt,
        "cover_image_url": route.cover_image_url,
        "difficulty": route.difficulty,
        "is_published": route.is_published,
        "estimated_distance_m": route.estimated_distance_m,
        "estimated_duration_s": route.estimated_duration_s,
        "items": [
            {
                "id": str(item.id),
                "position": item.position,
                "point_id": str(item.point_id) if item.point_id else None,
                "waypoint_lat": item.waypoint_lat,
                "waypoint_lng": item.waypoint_lng,
                "transition_text_pt": item.transition_text_pt,
            }
            for item in route.items
        ],
    }


def replace_route_items(route: Route, items: list[RouteItemWrite]) -> None:
    for existing_item in list(route.items):
        route.items.remove(existing_item)
    for item in sorted(items, key=lambda current: current.position):
        route.items.append(
            RouteItem(
                position=item.position,
                point_id=item.point_id,
                waypoint_lat=item.waypoint_lat,
                waypoint_lng=item.waypoint_lng,
                transition_text_pt=item.transition_text_pt,
            )
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
    db.delete(point)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.get("/texts")
def list_admin_texts(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    point_id: UUID | None = None,
) -> dict[str, object]:
    query = select(Text).order_by(Text.created_at)
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
    db.delete(text)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.get("/routes")
def list_admin_routes(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    routes = db.scalars(
        select(Route).options(selectinload(Route.items)).order_by(Route.title_pt)
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
    route = Route(**payload.model_dump(exclude={"items"}))
    replace_route_items(route, payload.items)
    db.add(route)
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
    route = db.scalar(select(Route).options(selectinload(Route.items)).where(Route.id == route_id))
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    for field, value in payload.model_dump(exclude={"items"}).items():
        setattr(route, field, value)
    db.execute(delete(RouteItem).where(RouteItem.route_id == route.id))
    db.flush()
    route.items = []
    replace_route_items(route, payload.items)
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
