from typing import Annotated

from fastapi import APIRouter, Depends, File, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.models.entities import AdminUser, Language
from app.schemas.common import EnvelopeMeta, envelope
from app.services.csv_import import apply_import, build_template_csv, preview_import

router = APIRouter(prefix="/api/v1/admin/points/import", tags=["admin-import"])
csv_file = File(...)


async def read_csv_upload(upload: UploadFile) -> str:
    content = await upload.read()
    return content.decode("utf-8-sig")


@router.get("/template")
def download_content_import_template(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    language_codes = list(
        db.scalars(
            select(Language.code)
            .where(Language.is_active.is_(True), Language.code != "pt")
            .order_by(Language.code)
        ).all()
    )
    return Response(
        content=build_template_csv(language_codes),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="content_import_template.csv"'},
    )


@router.post("/preview")
async def preview_points_import(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = csv_file,
) -> dict[str, object]:
    preview = preview_import(await read_csv_upload(file), db)
    return envelope([row.__dict__ for row in preview], EnvelopeMeta(total=len(preview)))


@router.post("/confirm")
async def confirm_points_import(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = csv_file,
) -> dict[str, object]:
    result = apply_import(await read_csv_upload(file), db)
    return envelope(result, EnvelopeMeta())
