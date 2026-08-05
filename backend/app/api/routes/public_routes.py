from typing import Annotated
from uuid import UUID
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models.entities import AudioFile, Route, RouteItem, RouteLeg, Text
from app.models.enums import RouteSegmentKind, TranslationStatus
from app.schemas.common import EnvelopeMeta, envelope
from app.services.editorial_translations import (
    resolve_language_selection,
    select_approved_translation,
)

router = APIRouter(prefix="/api/v1/routes", tags=["routes"])


def resolve_text_content(text: Text, lang: str, source_language: str) -> str:
    if lang == source_language:
        return text.content_pt
    translation = next(
        (
            candidate
            for candidate in text.translations
            if candidate.lang == lang and candidate.status == TranslationStatus.APPROVED
        ),
        None,
    )
    return translation.content if translation is not None else text.content_pt


def serialize_audio(audio: AudioFile) -> dict[str, object]:
    return {
        "id": str(audio.id),
        "lang": audio.lang,
        "public_url": audio.public_url,
        "duration_s": audio.duration_s,
        "voice_id": audio.voice_id,
        "manually_uploaded": audio.manually_uploaded,
    }


def serialize_route_leg(leg: RouteLeg) -> dict[str, object]:
    return {
        "id": str(leg.id),
        "position": leg.position,
        "from_segment_id": str(leg.from_segment_id),
        "to_segment_id": str(leg.to_segment_id),
        "geometry": leg.geometry,
        "waypoints": leg.waypoints,
        "distance_m": leg.distance_m,
        "duration_s": leg.duration_s,
        "provider": leg.provider,
    }


def serialize_route_segment(
    item: RouteItem,
    lang: str,
    source_language: str,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": str(item.id),
        "position": item.position,
        "kind": item.kind,
    }
    if item.kind == RouteSegmentKind.TEXT.value and item.text is not None:
        text = item.text
        payload["text"] = {
            "id": str(text.id),
            "content": resolve_text_content(text, lang, source_language),
            "content_pt": text.content_pt,
            "source_work": text.source_work,
            "source_year": text.source_year,
            "content_type": text.content_type.value,
            "author": {
                "id": str(text.author.id),
                "name": text.author.name,
                "photo_url": text.author.photo_url,
            },
            "point": {
                "id": str(text.point.id),
                "title_pt": text.point.title_pt,
                "address": text.point.address,
                "neighborhood": text.point.neighborhood,
                "lat": text.point.lat,
                "lng": text.point.lng,
            },
            "audio_files": [serialize_audio(audio) for audio in text.audio_files],
        }
    elif item.kind == RouteSegmentKind.BRIDGE.value:
        translation = next(
            (
                candidate
                for candidate in item.translations
                if candidate.lang == lang and candidate.status == TranslationStatus.APPROVED
            ),
            None,
        )
        payload["content"] = (
            translation.content
            if lang != source_language and translation is not None
            else item.bridge_content_pt
        )
        payload["content_pt"] = item.bridge_content_pt
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
    elif item.point is not None:
        payload["kind"] = RouteSegmentKind.LEGACY.value
        payload["transition_text_pt"] = item.transition_text_pt
        payload["point"] = {
            "id": str(item.point.id),
            "title_pt": item.point.title_pt,
            "lat": item.point.lat,
            "lng": item.point.lng,
        }
    else:
        payload["kind"] = RouteSegmentKind.LEGACY.value
        payload["transition_text_pt"] = item.transition_text_pt
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
        "slug": route.slug,
        "title_pt": route.title_pt,
        "description_pt": route.description_pt,
        "title": title,
        "description": description,
        "cover_image_url": route.cover_image_url,
        "difficulty": route.difficulty,
        "is_published": route.is_published,
        "estimated_distance_m": route.estimated_distance_m,
        "estimated_duration_s": route.estimated_duration_s,
        "routing_status": route.routing_status,
        "text_count": sum(
            item.kind == RouteSegmentKind.TEXT.value and item.text is not None
            for item in route.items
        ),
        "authors": sorted(
            {
                item.text.author.name
                for item in route.items
                if item.kind == RouteSegmentKind.TEXT.value and item.text is not None
            }
        ),
    }


def build_route_coordinates(route: Route) -> list[tuple[float, float]]:
    if route.legs:
        coordinates: list[tuple[float, float]] = []
        for leg in sorted(route.legs, key=lambda candidate: candidate.position):
            raw_coordinates = leg.geometry.get("coordinates", [])
            if not isinstance(raw_coordinates, list):
                continue
            leg_coordinates = [
                (float(coordinate[1]), float(coordinate[0]))
                for coordinate in raw_coordinates
                if isinstance(coordinate, list) and len(coordinate) >= 2
            ]
            if coordinates and leg_coordinates and coordinates[-1] == leg_coordinates[0]:
                leg_coordinates = leg_coordinates[1:]
            coordinates.extend(leg_coordinates)
        if coordinates:
            return coordinates
    coordinates: list[tuple[float, float]] = []
    for item in route.items:
        if item.kind == RouteSegmentKind.TEXT.value and item.text is not None:
            coordinates.append((item.text.point.lat, item.text.point.lng))
        elif item.point is not None:
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
    lang: str = "pt",
    source_language: str = "pt",
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
        item_title: str | None = None
        item_description: str | None = None
        audio_url: str | None = None
        if item.kind == RouteSegmentKind.TEXT.value and item.text is not None:
            item_title = item.text.source_work or item.text.point.title_pt
            item_description = resolve_text_content(item.text, lang, source_language)
            audio = next(
                (
                    candidate
                    for candidate in item.text.audio_files
                    if candidate.lang == lang and candidate.public_url
                ),
                None,
            )
            audio_url = audio.public_url if audio is not None else None
        elif item.kind == RouteSegmentKind.BRIDGE.value:
            item_title = f"Interlúdio {item.position + 1}"
            translation = next(
                (
                    candidate
                    for candidate in item.translations
                    if candidate.lang == lang and candidate.status == TranslationStatus.APPROVED
                ),
                None,
            )
            item_description = (
                translation.content
                if lang != source_language and translation is not None
                else item.bridge_content_pt
            )
            audio = next(
                (
                    candidate
                    for candidate in item.audio_files
                    if candidate.lang == lang and candidate.public_url
                ),
                None,
            )
            audio_url = audio.public_url if audio is not None else None
        elif item.point is not None:
            item_title = item.point.title_pt
            item_description = item.point.title_pt
        if item_title is None:
            continue
        enclosure = ""
        if audio_url:
            enclosure_url = escape(audio_url, {'"': "&quot;"})
            enclosure = (
                f'<enclosure url="{enclosure_url}" length="0" type="audio/mpeg"/>'
            )
        items.append(
            "<item>"
            f"<title>{escape(item_title)}</title>"
            f"<guid>{item.id}</guid>"
            f"<description>{escape(item_description or item_title)}</description>"
            f"{enclosure}"
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
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.author),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.point),
            selectinload(Route.items)
            .selectinload(RouteItem.text)
            .selectinload(Text.translations),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.audio_files),
            selectinload(Route.items).selectinload(RouteItem.translations),
            selectinload(Route.items).selectinload(RouteItem.audio_files),
            selectinload(Route.translations),
            selectinload(Route.legs),
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
        .options(
            selectinload(Route.translations),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.author),
        )
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
    segments = [
        serialize_route_segment(item, selected_language, source_language) for item in route.items
    ]
    payload["segments"] = segments
    payload["items"] = segments
    payload["items_deprecated"] = True
    payload["legs"] = [serialize_route_leg(leg) for leg in route.legs]
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
        content=build_podcast_rss(
            route,
            title,
            description,
            selected_language,
            source_language,
        ),
        media_type="application/rss+xml",
    )
