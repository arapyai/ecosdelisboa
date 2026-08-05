from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.core.config import get_settings
from app.core.db import get_db
from app.models.entities import (
    AdminUser,
    Route,
    RouteItem,
    RouteLeg,
    RouteSegmentAudioFile,
    RouteSegmentTranslation,
    Text,
)
from app.models.enums import RouteRoutingStatus, RouteSegmentKind, TranslationStatus
from app.schemas.common import EnvelopeMeta, envelope
from app.services.audio_jobs import create_bridge_audio_job, process_audio_job
from app.services.audio_storage import AudioStorage, manual_route_bridge_audio_key
from app.services.audio_uploads import validate_mp3_upload
from app.services.elevenlabs import ElevenLabsService
from app.services.languages import get_active_language, get_source_language
from app.services.route_readiness import serialize_route_readiness
from app.services.routing import (
    DirectionsProvider,
    RoutingError,
    create_directions_provider,
    route_input_hash,
)

router = APIRouter(prefix="/api/v1/admin/routes", tags=["admin-routes"])
directions_provider_factory = create_directions_provider
settings = get_settings()
elevenlabs_service = ElevenLabsService()
audio_storage = AudioStorage(
    storage_dir=settings.audio_storage_dir,
    public_base_url=settings.audio_public_base_url,
)


class WaypointWrite(BaseModel):
    lat: float
    lng: float


class RouteLegWaypointsWrite(BaseModel):
    position: int = Field(ge=0)
    waypoints: list[WaypointWrite] = Field(default_factory=list)


class RecalculateRouteWrite(BaseModel):
    legs: list[RouteLegWaypointsWrite] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_leg_positions(self) -> RecalculateRouteWrite:
        positions = [leg.position for leg in self.legs]
        if len(positions) != len(set(positions)):
            raise ValueError("leg positions must be unique")
        return self


class BridgeTranslationWrite(BaseModel):
    content: str = Field(min_length=1)
    status: TranslationStatus = TranslationStatus.PENDING


def _get_bridge(db: Session, route_id: UUID, segment_id: UUID) -> RouteItem:
    segment = db.scalar(
        select(RouteItem)
        .options(selectinload(RouteItem.translations), selectinload(RouteItem.audio_files))
        .where(RouteItem.id == segment_id, RouteItem.route_id == route_id)
    )
    if segment is None or segment.kind != RouteSegmentKind.BRIDGE.value:
        raise HTTPException(status_code=404, detail="Route bridge not found")
    return segment


def serialize_bridge_translation(translation: RouteSegmentTranslation) -> dict[str, object]:
    return {
        "id": str(translation.id),
        "segment_id": str(translation.segment_id),
        "lang": translation.lang,
        "content": translation.content,
        "status": translation.status.value,
        "reviewed_by": translation.reviewed_by,
        "reviewed_at": translation.reviewed_at.isoformat() if translation.reviewed_at else None,
    }


def serialize_bridge_audio(audio: RouteSegmentAudioFile) -> dict[str, object]:
    return {
        "id": str(audio.id),
        "segment_id": str(audio.segment_id),
        "lang": audio.lang,
        "public_url": audio.public_url,
        "duration_s": audio.duration_s,
        "voice_id": audio.voice_id,
        "generated_at": audio.generated_at.isoformat() if audio.generated_at else None,
        "manually_uploaded": audio.manually_uploaded,
    }


def serialize_leg(leg: RouteLeg) -> dict[str, object]:
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


def _load_route(db: Session, route_id: UUID) -> Route | None:
    return db.scalar(
        select(Route)
        .options(
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.point),
            selectinload(Route.items)
            .selectinload(RouteItem.text)
            .selectinload(Text.translations),
            selectinload(Route.items).selectinload(RouteItem.text).selectinload(Text.audio_files),
            selectinload(Route.items).selectinload(RouteItem.translations),
            selectinload(Route.items).selectinload(RouteItem.audio_files),
            selectinload(Route.legs),
            selectinload(Route.translations),
        )
        .where(Route.id == route_id)
    )


def _route_stops(route: Route) -> list[RouteItem]:
    return [
        segment
        for segment in route.items
        if segment.kind == RouteSegmentKind.TEXT.value and segment.text is not None
    ]


def recalculate_route_legs(
    db: Session,
    route: Route,
    provider: DirectionsProvider,
    waypoint_overrides: dict[int, list[dict[str, float]]],
) -> None:
    stops = _route_stops(route)
    if len(stops) < 2:
        raise RoutingError("a route requires at least two text segments")
    existing_waypoints = {leg.position: leg.waypoints for leg in route.legs}
    inputs: list[dict[str, object]] = []
    results = []
    for position, (start, end) in enumerate(zip(stops, stops[1:], strict=False)):
        waypoints = waypoint_overrides.get(position, existing_waypoints.get(position, []))
        coordinates = [
            (start.text.point.lng, start.text.point.lat),
            *[(waypoint["lng"], waypoint["lat"]) for waypoint in waypoints],
            (end.text.point.lng, end.text.point.lat),
        ]
        inputs.append(
            {
                "position": position,
                "from_segment_id": str(start.id),
                "to_segment_id": str(end.id),
                "coordinates": coordinates,
                "waypoints": waypoints,
            }
        )
        results.append((start, end, waypoints, provider.directions(coordinates)))

    for leg in list(route.legs):
        db.delete(leg)
    route.legs.clear()
    db.flush()
    for position, (start, end, waypoints, result) in enumerate(results):
        route.legs.append(
            RouteLeg(
                position=position,
                from_segment_id=start.id,
                to_segment_id=end.id,
                geometry=result.geometry,
                waypoints=waypoints,
                distance_m=result.distance_m,
                duration_s=result.duration_s,
                provider=result.provider,
            )
        )
    route.estimated_distance_m = sum(result.distance_m for *_, result in results)
    route.estimated_duration_s = sum(result.duration_s for *_, result in results)
    route.routing_hash = route_input_hash(inputs)
    route.routing_status = RouteRoutingStatus.READY.value
    route.routing_error = None
    route.routed_at = datetime.now(UTC)


@router.post("/{route_id}/recalculate")
def recalculate_route(
    route_id: UUID,
    payload: RecalculateRouteWrite,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    route = _load_route(db, route_id)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    waypoint_overrides = {
        leg.position: [waypoint.model_dump() for waypoint in leg.waypoints] for leg in payload.legs
    }
    try:
        recalculate_route_legs(db, route, directions_provider_factory(), waypoint_overrides)
    except RoutingError as exc:
        db.rollback()
        route = _load_route(db, route_id)
        if route is not None:
            route.routing_status = RouteRoutingStatus.FAILED.value
            route.routing_error = str(exc)
            db.commit()
        raise HTTPException(
            status_code=502,
            detail={"code": "routing_failed", "message": str(exc)},
        ) from exc
    db.commit()
    route = _load_route(db, route_id)
    assert route is not None
    return envelope(
        {
            "route_id": str(route.id),
            "routing_status": route.routing_status,
            "routing_hash": route.routing_hash,
            "estimated_distance_m": route.estimated_distance_m,
            "estimated_duration_s": route.estimated_duration_s,
            "legs": [serialize_leg(leg) for leg in route.legs],
        },
        EnvelopeMeta(),
    )


@router.get("/{route_id}/readiness")
def get_route_readiness(
    route_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    lang: str = "pt",
) -> dict[str, object]:
    try:
        language = get_active_language(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    route = _load_route(db, route_id)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    readiness = serialize_route_readiness(route, language.code, get_source_language(db).code)
    return envelope(readiness, EnvelopeMeta())


@router.put("/{route_id}/segments/{segment_id}/translations/{lang}")
def upsert_bridge_translation(
    route_id: UUID,
    segment_id: UUID,
    lang: str,
    payload: BridgeTranslationWrite,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    try:
        language = get_active_language(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if language.code == get_source_language(db).code:
        raise HTTPException(status_code=400, detail="Bridge source content is edited in Portuguese")
    segment = _get_bridge(db, route_id, segment_id)
    translation = next(
        (candidate for candidate in segment.translations if candidate.lang == language.code),
        None,
    )
    if translation is None:
        translation = RouteSegmentTranslation(segment_id=segment.id, lang=language.code)
        db.add(translation)
    translation.content = payload.content
    translation.status = payload.status
    translation.reviewed_by = current_admin.email
    translation.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(translation)
    return envelope(serialize_bridge_translation(translation), EnvelopeMeta())


@router.delete("/{route_id}/segments/{segment_id}/translations/{lang}")
def delete_bridge_translation(
    route_id: UUID,
    segment_id: UUID,
    lang: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    segment = _get_bridge(db, route_id, segment_id)
    translation = next(
        (candidate for candidate in segment.translations if candidate.lang == lang),
        None,
    )
    if translation is None:
        raise HTTPException(status_code=404, detail="Bridge translation not found")
    db.delete(translation)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.post("/{route_id}/segments/{segment_id}/audio/{lang}/generate")
def generate_bridge_audio(
    route_id: UUID,
    segment_id: UUID,
    lang: str,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    voice_id: str | None = None,
) -> dict[str, object]:
    try:
        language = get_active_language(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    segment = _get_bridge(db, route_id, segment_id)
    job = create_bridge_audio_job(
        db,
        requested_by=current_admin.email,
        items=[(segment.id, language.code)],
        preferred_voice_id=voice_id,
        start_immediately=True,
    )
    process_audio_job(db, job.id, elevenlabs_service, audio_storage)
    audio = db.scalar(
        select(RouteSegmentAudioFile).where(
            RouteSegmentAudioFile.segment_id == segment.id,
            RouteSegmentAudioFile.lang == language.code,
        )
    )
    return envelope(
        {
            "job_id": str(job.id),
            "status": job.status.value,
            "error": job.last_error,
            "audio": serialize_bridge_audio(audio) if audio else None,
        },
        EnvelopeMeta(),
    )


@router.put("/{route_id}/segments/{segment_id}/audio/{lang}/upload")
async def upload_bridge_audio(
    route_id: UUID,
    segment_id: UUID,
    lang: str,
    file: Annotated[UploadFile, File(description="MP3 file for this route bridge")],
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    try:
        language = get_active_language(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    segment = _get_bridge(db, route_id, segment_id)
    content = await file.read(settings.audio_upload_max_bytes + 1)
    await file.close()
    try:
        validate_mp3_upload(
            filename=file.filename,
            content_type=file.content_type,
            content=content,
            max_bytes=settings.audio_upload_max_bytes,
        )
    except TypeError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except OverflowError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audio = db.scalar(
        select(RouteSegmentAudioFile).where(
            RouteSegmentAudioFile.segment_id == segment.id,
            RouteSegmentAudioFile.lang == language.code,
        )
    )
    previous_key = audio.r2_key if audio else None
    key = manual_route_bridge_audio_key(segment.id, language.code)
    public_url = audio_storage.upload_audio(key, content)
    if audio is None:
        audio = RouteSegmentAudioFile(segment_id=segment.id, lang=language.code)
        db.add(audio)
    audio.r2_key = key
    audio.public_url = public_url
    audio.duration_s = None
    audio.voice_id = None
    audio.generated_at = None
    audio.manually_uploaded = True
    try:
        db.commit()
    except Exception:
        db.rollback()
        if previous_key != key:
            audio_storage.delete_audio(key)
        raise
    if previous_key and previous_key != key:
        audio_storage.delete_audio(previous_key)
    db.refresh(audio)
    return envelope(serialize_bridge_audio(audio), EnvelopeMeta())
