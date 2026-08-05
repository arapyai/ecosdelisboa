from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.core.security import hash_password
from app.models.entities import AdminUser
from app.schemas.common import EnvelopeMeta, envelope
from app.services.admin_users import normalize_admin_email, validate_admin_password

router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    is_active: bool = True

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> str:
        return normalize_admin_email(str(value))

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_admin_password(value)


class AdminUserUpdate(BaseModel):
    email: EmailStr
    is_active: bool

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> str:
        return normalize_admin_email(str(value))


class AdminPasswordUpdate(BaseModel):
    password: str = Field(min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_admin_password(value)


def serialize_admin_user(admin: AdminUser) -> dict[str, object]:
    return {
        "id": str(admin.id),
        "email": admin.email,
        "is_active": admin.is_active,
        "created_at": admin.created_at.isoformat(),
    }


def get_admin_or_404(db: Session, admin_id: UUID) -> AdminUser:
    admin = db.get(AdminUser, admin_id)
    if admin is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    return admin


def ensure_can_deactivate(db: Session, target: AdminUser, current_admin: AdminUser) -> None:
    if target.id == current_admin.id:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own account")
    active_users = db.scalar(
        select(func.count()).select_from(AdminUser).where(AdminUser.is_active.is_(True))
    )
    if target.is_active and active_users is not None and active_users <= 1:
        raise HTTPException(status_code=409, detail="At least one active admin user is required")


@router.get("")
def list_admin_users(
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    users = db.scalars(select(AdminUser).order_by(AdminUser.email)).all()
    return envelope(
        [serialize_admin_user(admin) for admin in users],
        EnvelopeMeta(total=len(users)),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_admin_user(
    payload: AdminUserCreate,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    email = normalize_admin_email(str(payload.email))
    if db.scalar(select(AdminUser.id).where(AdminUser.email == email)) is not None:
        raise HTTPException(status_code=409, detail="Admin email already exists")
    admin = AdminUser(
        email=email,
        password_hash=hash_password(payload.password),
        is_active=payload.is_active,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Admin email already exists") from exc
    db.refresh(admin)
    return envelope(serialize_admin_user(admin), EnvelopeMeta())


@router.put("/{admin_id}")
def update_admin_user(
    admin_id: UUID,
    payload: AdminUserUpdate,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    admin = get_admin_or_404(db, admin_id)
    if admin.is_active and not payload.is_active:
        ensure_can_deactivate(db, admin, current_admin)
    admin.email = normalize_admin_email(str(payload.email))
    admin.is_active = payload.is_active
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Admin email already exists") from exc
    db.refresh(admin)
    return envelope(serialize_admin_user(admin), EnvelopeMeta())


@router.put("/{admin_id}/password")
def update_admin_password(
    admin_id: UUID,
    payload: AdminPasswordUpdate,
    _: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    admin = get_admin_or_404(db, admin_id)
    admin.password_hash = hash_password(payload.password)
    admin.auth_version += 1
    db.commit()
    db.refresh(admin)
    return envelope(serialize_admin_user(admin), EnvelopeMeta())


@router.delete("/{admin_id}")
def delete_admin_user(
    admin_id: UUID,
    current_admin: Annotated[AdminUser, Depends(get_current_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    admin = get_admin_or_404(db, admin_id)
    if admin.id == current_admin.id:
        raise HTTPException(status_code=409, detail="You cannot delete your own account")
    if admin.is_active:
        ensure_can_deactivate(db, admin, current_admin)
    db.delete(admin)
    db.commit()
    return envelope({"deleted": True}, EnvelopeMeta())
