from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models.entities import Author, Text
from app.schemas.common import EnvelopeMeta, envelope

router = APIRouter(prefix="/api/v1/authors", tags=["authors"])


def serialize_author(author: Author) -> dict[str, object]:
    point_ids = {text.point_id for text in author.texts}
    return {
        "id": str(author.id),
        "name": author.name,
        "bio_pt": author.bio_pt,
        "birth_year": author.birth_year,
        "death_year": author.death_year,
        "photo_url": author.photo_url,
        "elevenlabs_voice_id": author.elevenlabs_voice_id,
        "point_count": len(point_ids),
    }


@router.get("")
def list_authors(
    db: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict[str, object]:
    authors = db.scalars(
        select(Author)
        .options(selectinload(Author.texts).selectinload(Text.point))
        .order_by(Author.name)
        .offset((page - 1) * per_page)
        .limit(per_page)
    ).all()
    total = len(db.scalars(select(Author.id)).all())
    return envelope(
        [serialize_author(author) for author in authors],
        EnvelopeMeta(page=page, per_page=per_page, total=total),
    )


@router.get("/{author_id}")
def get_author(author_id: UUID, db: Annotated[Session, Depends(get_db)]) -> dict[str, object]:
    author = db.scalar(
        select(Author)
        .options(selectinload(Author.texts).selectinload(Text.point))
        .where(Author.id == author_id)
    )
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")

    payload = serialize_author(author)
    points_by_id = {text.point.id: text.point for text in author.texts}
    payload["points"] = [
        {
            "id": str(point.id),
            "title_pt": point.title_pt,
            "lat": point.lat,
            "lng": point.lng,
            "neighborhood": point.neighborhood,
        }
        for point in points_by_id.values()
    ]
    return envelope(payload, EnvelopeMeta())
