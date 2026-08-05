from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.entities import Language
from app.schemas.common import EnvelopeMeta, envelope

router = APIRouter(prefix="/api/v1/languages", tags=["languages"])


@router.get("")
def list_languages(db: Annotated[Session, Depends(get_db)]) -> dict[str, object]:
    languages = db.scalars(
        select(Language).where(Language.is_active.is_(True)).order_by(Language.name)
    ).all()
    return envelope(
        [
            {
                "code": language.code,
                "locale": language.locale,
                "country_code": language.country_code,
                "name": language.name,
                "is_source": language.is_source,
            }
            for language in languages
        ],
        EnvelopeMeta(total=len(languages)),
    )
