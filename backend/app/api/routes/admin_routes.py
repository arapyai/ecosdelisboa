from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.models.entities import AdminUser, Route, RouteItem, RouteLeg, Text
from app.models.enums import RouteRoutingStatus, RouteSegmentKind
from app.schemas.common import EnvelopeMeta, envelope
from app.services.routing import (
    DirectionsProvider,
    RoutingError,
    create_directions_provider,
    route_input_hash,
)

router = APIRouter(prefix="/api/v1/admin/routes", tags=["admin-routes"])
directions_provider_factory = create_directions_provider


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
            selectinload(Route.legs),
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
