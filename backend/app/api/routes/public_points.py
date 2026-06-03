from math import asin, cos, radians, sin, sqrt
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models.entities import AudioFile, Point, Text
from app.models.enums import SupportedLanguage, TranslationStatus
from app.schemas.common import EnvelopeMeta, envelope

router = APIRouter(prefix="/api/v1/points", tags=["points"])


def haversine_distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_m = 6_371_000
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    a = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    )
    return 2 * radius_m * asin(sqrt(a))


def resolve_text_content(text: Text, lang: SupportedLanguage) -> str:
    if lang == SupportedLanguage.PT:
        return text.content_pt

    approved = next(
        (
            translation
            for translation in text.translations
            if translation.lang == lang and translation.status == TranslationStatus.APPROVED
        ),
        None,
    )
    return approved.content if approved else text.content_pt


def serialize_point_summary(point: Point) -> dict[str, object]:
    authors_by_id = {
        str(text.author.id): {
            "id": str(text.author.id),
            "name": text.author.name,
            "photo_url": text.author.photo_url,
        }
        for text in point.texts
        if text.author is not None
    }
    first_author_id = next(iter(authors_by_id), None)
    return {
        "id": str(point.id),
        "author_id": first_author_id,
        "authors": list(authors_by_id.values()),
        "title_pt": point.title_pt,
        "address": point.address,
        "neighborhood": point.neighborhood,
        "lat": point.lat,
        "lng": point.lng,
    }


@router.get("")
def list_points(
    db: Annotated[Session, Depends(get_db)],
    lat: float | None = None,
    lng: float | None = None,
    radius: float | None = Query(default=None, gt=0),
    author_id: UUID | None = None,
) -> dict[str, object]:
    query = select(Point).options(selectinload(Point.texts).selectinload(Text.author)).order_by(Point.title_pt)
    if author_id:
        query = query.where(Point.texts.any(Text.author_id == author_id))

    points = db.scalars(query).all()
    if lat is not None and lng is not None and radius is not None:
        points = [
            point
            for point in points
            if haversine_distance_m(lat, lng, point.lat, point.lng) <= radius
        ]

    return envelope(
        [serialize_point_summary(point) for point in points],
        EnvelopeMeta(total=len(points)),
    )


@router.get("/{point_id}")
def get_point(
    point_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    lang: SupportedLanguage = SupportedLanguage.PT,
) -> dict[str, object]:
    point = db.scalar(
        select(Point)
        .options(
            selectinload(Point.texts).selectinload(Text.author),
            selectinload(Point.texts).selectinload(Text.translations),
            selectinload(Point.texts).selectinload(Text.audio_files),
        )
        .where(Point.id == point_id)
    )
    if point is None:
        raise HTTPException(status_code=404, detail="Point not found")

    payload = serialize_point_summary(point)
    payload["author"] = payload["authors"][0] if payload["authors"] else None
    payload["texts"] = [
        {
            "id": str(text.id),
            "author_id": str(text.author_id),
            "author": {
                "id": str(text.author.id),
                "name": text.author.name,
                "photo_url": text.author.photo_url,
            },
            "content": resolve_text_content(text, lang),
            "content_pt": text.content_pt,
            "source_work": text.source_work,
            "source_year": text.source_year,
            "content_type": text.content_type.value,
            "audio_files": [serialize_audio_file(audio) for audio in text.audio_files],
        }
        for text in point.texts
    ]
    return envelope(payload, EnvelopeMeta(extra={"lang": lang.value}))


def serialize_audio_file(audio: AudioFile) -> dict[str, object]:
    return {
        "id": str(audio.id),
        "lang": audio.lang.value,
        "public_url": audio.public_url,
        "duration_s": audio.duration_s,
        "voice_id": audio.voice_id,
        "generated_at": audio.generated_at.isoformat() if audio.generated_at else None,
        "manually_uploaded": audio.manually_uploaded,
    }
