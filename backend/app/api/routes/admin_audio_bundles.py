import zipfile
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.api.deps import get_current_admin
from app.core.config import get_settings
from app.core.db import get_db
from app.models.entities import AdminUser
from app.schemas.common import EnvelopeMeta, envelope
from app.services.audio_bundles import (
    build_export_bundle,
    confirm_import,
    export_preview,
    import_preview,
)
from app.services.audio_storage import AudioStorage

router = APIRouter(prefix="/api/v1/admin/audio-bundles", tags=["admin-audio-bundles"])
settings = get_settings()
audio_storage = AudioStorage(settings.audio_storage_dir, settings.audio_public_base_url)


class ExportRequest(BaseModel):
    text_ids: list[UUID]


@router.post("/export/preview")
def preview_export(
    payload: ExportRequest,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    try:
        result = export_preview(db, audio_storage, payload.text_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return envelope(result, EnvelopeMeta())


@router.post("/export")
def export_bundle(
    payload: ExportRequest,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> StreamingResponse:
    try:
        content = build_export_bundle(db, audio_storage, payload.text_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return StreamingResponse(
        iter([content]),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="lisboa-audios.zip"'},
    )


async def _read_bundle(file: UploadFile) -> bytes:
    content = await file.read(settings.audio_bundle_max_bytes + 1)
    await file.close()
    if file.filename is None or not file.filename.casefold().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Audio bundle must use the .zip extension")
    if len(content) > settings.audio_bundle_max_bytes:
        raise HTTPException(
            status_code=413, detail="Audio bundle exceeds the configured size limit"
        )
    return content


def _bundle_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=413 if isinstance(exc, OverflowError) else 400, detail=str(exc)
    )


@router.post("/import/preview")
async def preview_import(
    file: Annotated[UploadFile, File(description="Lisboa audio bundle ZIP")],
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    content = await _read_bundle(file)
    try:
        result = import_preview(
            db,
            content,
            max_bytes=settings.audio_bundle_max_bytes,
            max_entries=settings.audio_bundle_max_entries,
            storage=audio_storage,
        )
    except (ValueError, TypeError, OverflowError, zipfile.BadZipFile) as exc:
        raise _bundle_error(exc) from exc
    return envelope(result, EnvelopeMeta())


@router.post("/import/confirm")
async def import_bundle(
    file: Annotated[UploadFile, File(description="Lisboa audio bundle ZIP")],
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    content = await _read_bundle(file)
    try:
        result = confirm_import(
            db,
            content,
            max_bytes=settings.audio_bundle_max_bytes,
            max_entries=settings.audio_bundle_max_entries,
            storage=audio_storage,
        )
    except (ValueError, TypeError, OverflowError, zipfile.BadZipFile) as exc:
        raise _bundle_error(exc) from exc
    return envelope(result, EnvelopeMeta())
