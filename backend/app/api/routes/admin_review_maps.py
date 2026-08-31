from __future__ import annotations

import os
import tempfile
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.config import get_settings
from app.core.db import get_db
from app.models.entities import AdminUser, Point
from app.schemas.common import EnvelopeMeta, envelope
from app.services.review_maps import (
    MapTilerRenderer,
    ReviewMapConfigurationError,
    ReviewMapError,
    ReviewMapRenderError,
    build_custom_review_zip,
    build_grid_layout,
    build_snapshot,
)

router = APIRouter(prefix="/api/v1/admin/review-map", tags=["admin-review-map"])


class ReviewMapExportRequest(BaseModel):
    paper_size: str = Field(default="A2", pattern=r"^A[0-4]$")
    grid_columns: int = Field(default=2, ge=1, le=4)
    grid_rows: int = Field(default=2, ge=1, le=4)
    excluded_review_codes: list[str] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def validate_sheet_count(self):
        if self.grid_columns * self.grid_rows > 16:
            raise ValueError("A grade pode ter no máximo 16 folhas.")
        return self


def _snapshot(db: Session, excluded_review_codes: list[str] | None = None):
    settings = get_settings()
    points = db.scalars(select(Point).order_by(Point.review_code, Point.created_at)).all()
    excluded_codes = set(excluded_review_codes or ())
    selected_points = [point for point in points if point.review_code not in excluded_codes]
    try:
        return build_snapshot(
            selected_points,
            center_lat=settings.review_map_center_lat,
            center_lng=settings.review_map_center_lng,
            outlier_radius_km=settings.review_map_outlier_radius_km,
        )
    except ReviewMapError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _serialize_bounds(bounds) -> dict[str, float]:
    return {
        "west": bounds.west,
        "south": bounds.south,
        "east": bounds.east,
        "north": bounds.north,
    }


@router.get("/preview")
def preview_review_map(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    paper_size: Annotated[str, Query(pattern=r"^A[0-4]$")] = "A2",
    grid_columns: Annotated[int, Query(ge=1, le=4)] = 2,
    grid_rows: Annotated[int, Query(ge=1, le=4)] = 2,
) -> dict[str, object]:
    snapshot = _snapshot(db)
    layout = build_grid_layout(
        snapshot,
        paper_size=paper_size,
        columns=grid_columns,
        rows=grid_rows,
    )
    payload = {
        "generated_at": snapshot.generated_at.isoformat(),
        "total_points": len(snapshot.points),
        "main_points": len(snapshot.main_points),
        "outside_points": len(snapshot.outside_points),
        "invalid_points": len(snapshot.invalid_points),
        "bounds": _serialize_bounds(layout.bounds),
        "sectors": [
            {"code": page.code, "bounds": _serialize_bounds(page.bounds)}
            for page in layout.pages
        ],
        "warnings": list(snapshot.warnings),
        "points": [
            {
                "id": point.id,
                "review_code": point.code,
                "title_pt": point.title,
                "address": point.address or None,
                "neighborhood": point.neighborhood or None,
                "lat": point.lat,
                "lng": point.lng,
                "sectors": [
                    page.code
                    for page in layout.pages
                    if (
                        page.bounds.west <= point.lng <= page.bounds.east
                        and page.bounds.south <= point.lat <= page.bounds.north
                    )
                ]
                if point.location_status == "main"
                else [],
                "location_status": point.location_status,
            }
            for point in snapshot.points
        ],
    }
    return envelope(payload, EnvelopeMeta(total=len(snapshot.points)))


@router.post("/export")
def export_review_map(
    payload: ReviewMapExportRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    settings = get_settings()
    snapshot = _snapshot(db, payload.excluded_review_codes)
    layout = build_grid_layout(
        snapshot,
        paper_size=payload.paper_size,
        columns=payload.grid_columns,
        rows=payload.grid_rows,
    )
    try:
        renderer = MapTilerRenderer(
            api_key=settings.maptiler_api_key or "",
            style_id=settings.review_map_style_id,
            timeout_s=settings.review_map_request_timeout_s,
        )
        package = build_custom_review_zip(
            snapshot,
            layout,
            renderer,
            settings.review_map_dpi,
        )
    except ReviewMapConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ReviewMapRenderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    descriptor, path = tempfile.mkstemp(prefix="lisboa-review-map-", suffix=".zip")
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(package)
    background_tasks.add_task(os.unlink, path)
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"lisboa-mapa-revisao-{snapshot.generated_at:%Y-%m-%d}.zip",
        background=background_tasks,
    )
