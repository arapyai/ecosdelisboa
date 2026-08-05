from typing import Annotated
from uuid import UUID
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models.entities import Route, RouteItem
from app.schemas.common import EnvelopeMeta, envelope
from app.services.editorial_translations import (
    resolve_language_selection,
    select_approved_translation,
)

router = APIRouter(prefix="/api/v1/routes", tags=["routes"])


def serialize_route_item(item: RouteItem) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": str(item.id),
        "position": item.position,
        "transition_text_pt": item.transition_text_pt,
    }
    if item.point is not None:
        payload["point"] = {
            "id": str(item.point.id),
            "title_pt": item.point.title_pt,
            "lat": item.point.lat,
            "lng": item.point.lng,
        }
    else:
        payload["waypoint"] = {"lat": item.waypoint_lat, "lng": item.waypoint_lng}
    return payload


def resolve_route_content(
    route: Route,
    lang: str,
    source_language: str,
) -> tuple[str, str | None]:
    translation = (
        None if lang == source_language else select_approved_translation(route.translations, lang)
    )
    if translation is None:
        return route.title_pt, route.description_pt
    return translation.title, translation.description


def serialize_route(route: Route, lang: str, source_language: str) -> dict[str, object]:
    title, description = resolve_route_content(route, lang, source_language)
    return {
        "id": str(route.id),
        "title_pt": route.title_pt,
        "description_pt": route.description_pt,
        "title": title,
        "description": description,
        "cover_image_url": route.cover_image_url,
        "difficulty": route.difficulty,
        "is_published": route.is_published,
        "estimated_distance_m": route.estimated_distance_m,
        "estimated_duration_s": route.estimated_duration_s,
    }


def build_route_coordinates(route: Route) -> list[tuple[float, float]]:
    coordinates: list[tuple[float, float]] = []
    for item in route.items:
        if item.point is not None:
            coordinates.append((item.point.lat, item.point.lng))
        elif item.waypoint_lat is not None and item.waypoint_lng is not None:
            coordinates.append((item.waypoint_lat, item.waypoint_lng))
    return coordinates


def build_gpx(route: Route, title: str | None = None) -> str:
    route_name = escape(title or route.title_pt)
    points_xml = []
    for lat, lng in build_route_coordinates(route):
        points_xml.append(f'<trkpt lat="{lat}" lon="{lng}"/>')

    joined_points = "".join(points_xml)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<gpx version="1.1" creator="Lisboa por Outros" xmlns="http://www.topografix.com/GPX/1/1">'
        f"<trk><name>{route_name}</name><trkseg>{joined_points}</trkseg></trk>"
        "</gpx>"
    )


def build_podcast_rss(
    route: Route,
    title: str | None = None,
    description: str | None = None,
) -> str:
    selected_title = title if title is not None else route.title_pt
    if title is None:
        selected_description = route.description_pt or selected_title
    else:
        selected_description = description or selected_title
    title_xml = escape(selected_title)
    description_xml = escape(selected_description)
    items = []
    for item in route.items:
        if item.point is None:
            continue
        point_title = escape(item.point.title_pt)
        point_id = str(item.point.id)
        items.append(
            "<item>"
            f"<title>{point_title}</title>"
            f"<guid>{point_id}</guid>"
            f"<description>{point_title}</description>"
            "</item>"
        )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0"><channel>'
        f"<title>{title_xml}</title>"
        f"<description>{description_xml}</description>"
        f"<link>https://api.lisboaporoutros.com/api/v1/routes/{route.id}</link>"
        f"{''.join(items)}"
        "</channel></rss>"
    )


def get_published_route(route_id: UUID, db: Session) -> Route:
    route = db.scalar(
        select(Route)
        .options(
            selectinload(Route.items).selectinload(RouteItem.point),
            selectinload(Route.translations),
        )
        .where(Route.id == route_id, Route.is_published.is_(True))
    )
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    return route


@router.get("")
def list_routes(
    db: Annotated[Session, Depends(get_db)],
    lang: str | None = None,
) -> dict[str, object]:
    try:
        source_language, selected_language = resolve_language_selection(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    routes = db.scalars(
        select(Route)
        .options(selectinload(Route.translations))
        .where(Route.is_published.is_(True))
        .order_by(Route.title_pt)
    ).all()
    return envelope(
        [serialize_route(route, selected_language, source_language) for route in routes],
        EnvelopeMeta(total=len(routes), extra={"lang": selected_language}),
    )


@router.get("/{route_id}")
def get_route(
    route_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    lang: str | None = None,
) -> dict[str, object]:
    try:
        source_language, selected_language = resolve_language_selection(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    route = get_published_route(route_id, db)

    payload = serialize_route(route, selected_language, source_language)
    payload["items"] = [serialize_route_item(item) for item in route.items]
    return envelope(payload, EnvelopeMeta(extra={"lang": selected_language}))


@router.get("/{route_id}/gpx")
def get_route_gpx(
    route_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    lang: str | None = None,
) -> Response:
    try:
        source_language, selected_language = resolve_language_selection(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    route = get_published_route(route_id, db)
    title, _ = resolve_route_content(route, selected_language, source_language)
    return Response(content=build_gpx(route, title), media_type="application/gpx+xml")


@router.get("/{route_id}/podcast.rss")
def get_route_podcast_rss(
    route_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    lang: str | None = None,
) -> Response:
    try:
        source_language, selected_language = resolve_language_selection(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    route = get_published_route(route_id, db)
    title, description = resolve_route_content(route, selected_language, source_language)
    return Response(
        content=build_podcast_rss(route, title, description),
        media_type="application/rss+xml",
    )
