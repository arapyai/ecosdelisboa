from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.models.entities import (
    AdminUser,
    Author,
    AuthorTranslation,
    Route,
    RouteTranslation,
)
from app.models.enums import TranslationStatus
from app.schemas.common import EnvelopeMeta, envelope
from app.services.editorial_translations import (
    mark_manual_translation,
    resolve_target_language,
    serialize_editorial_metadata,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin-entity-translations"])


class AuthorTranslationWrite(BaseModel):
    bio: str = Field(min_length=1)
    status: TranslationStatus = TranslationStatus.PENDING


class RouteTranslationWrite(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    status: TranslationStatus = TranslationStatus.PENDING


def target_language_or_400(db: Session, lang: str) -> str:
    try:
        return resolve_target_language(db, lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def get_author_or_404(db: Session, author_id: UUID) -> Author:
    author = db.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author


def get_route_or_404(db: Session, route_id: UUID) -> Route:
    route = db.get(Route, route_id)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    return route


def serialize_author_translation(translation: AuthorTranslation) -> dict[str, object]:
    return {
        "id": str(translation.id),
        "author_id": str(translation.author_id),
        "bio": translation.bio,
        **serialize_editorial_metadata(translation),
    }


def serialize_route_translation(translation: RouteTranslation) -> dict[str, object]:
    return {
        "id": str(translation.id),
        "route_id": str(translation.route_id),
        "title": translation.title,
        "description": translation.description,
        **serialize_editorial_metadata(translation),
    }


@router.get("/authors/{author_id}/translations")
def list_author_translations(
    author_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    get_author_or_404(db, author_id)
    translations = db.scalars(
        select(AuthorTranslation)
        .where(AuthorTranslation.author_id == author_id)
        .order_by(AuthorTranslation.lang)
    ).all()
    return envelope(
        [serialize_author_translation(item) for item in translations],
        EnvelopeMeta(total=len(translations)),
    )


@router.put("/authors/{author_id}/translations/{lang}")
def upsert_author_translation(
    author_id: UUID,
    lang: str,
    payload: AuthorTranslationWrite,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    author = get_author_or_404(db, author_id)
    language = target_language_or_400(db, lang)
    translation = db.scalar(
        select(AuthorTranslation).where(
            AuthorTranslation.author_id == author.id,
            AuthorTranslation.lang == language,
        )
    )
    if translation is None:
        translation = AuthorTranslation(author_id=author.id, lang=language, bio=payload.bio)
        db.add(translation)
    else:
        translation.bio = payload.bio
    mark_manual_translation(
        translation,
        status=payload.status,
        reviewer=current_admin.email,
    )
    db.commit()
    db.refresh(translation)
    return envelope(serialize_author_translation(translation), EnvelopeMeta())


@router.delete("/authors/{author_id}/translations/{lang}")
def delete_author_translation(
    author_id: UUID,
    lang: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    author = get_author_or_404(db, author_id)
    language = target_language_or_400(db, lang)
    translation = db.scalar(
        select(AuthorTranslation).where(
            AuthorTranslation.author_id == author.id,
            AuthorTranslation.lang == language,
        )
    )
    if translation is None:
        raise HTTPException(status_code=404, detail="Author translation not found")
    db.delete(translation)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())


@router.get("/routes/{route_id}/translations")
def list_route_translations(
    route_id: UUID,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    get_route_or_404(db, route_id)
    translations = db.scalars(
        select(RouteTranslation)
        .where(RouteTranslation.route_id == route_id)
        .order_by(RouteTranslation.lang)
    ).all()
    return envelope(
        [serialize_route_translation(item) for item in translations],
        EnvelopeMeta(total=len(translations)),
    )


@router.put("/routes/{route_id}/translations/{lang}")
def upsert_route_translation(
    route_id: UUID,
    lang: str,
    payload: RouteTranslationWrite,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    route = get_route_or_404(db, route_id)
    language = target_language_or_400(db, lang)
    translation = db.scalar(
        select(RouteTranslation).where(
            RouteTranslation.route_id == route.id,
            RouteTranslation.lang == language,
        )
    )
    if translation is None:
        translation = RouteTranslation(
            route_id=route.id,
            lang=language,
            title=payload.title,
            description=payload.description,
        )
        db.add(translation)
    else:
        translation.title = payload.title
        translation.description = payload.description
    mark_manual_translation(
        translation,
        status=payload.status,
        reviewer=current_admin.email,
    )
    db.commit()
    db.refresh(translation)
    return envelope(serialize_route_translation(translation), EnvelopeMeta())


@router.delete("/routes/{route_id}/translations/{lang}")
def delete_route_translation(
    route_id: UUID,
    lang: str,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    route = get_route_or_404(db, route_id)
    language = target_language_or_400(db, lang)
    translation = db.scalar(
        select(RouteTranslation).where(
            RouteTranslation.route_id == route.id,
            RouteTranslation.lang == language,
        )
    )
    if translation is None:
        raise HTTPException(status_code=404, detail="Route translation not found")
    db.delete(translation)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())
