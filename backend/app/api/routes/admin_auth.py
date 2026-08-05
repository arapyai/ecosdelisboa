from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.core.db import get_db
from app.core.security import create_access_token, verify_password
from app.models.entities import AdminUser
from app.schemas.common import EnvelopeMeta, envelope

router = APIRouter(prefix="/api/v1/admin/auth", tags=["admin-auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
def login(
    payload: LoginRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, object]:
    admin = db.scalar(
        select(AdminUser).where(
            func.lower(AdminUser.email) == str(payload.email).strip().lower(),
            AdminUser.is_active.is_(True),
        )
    )
    if admin is None or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(admin.id, auth_version=admin.auth_version)
    return envelope({"access_token": token, "token_type": "bearer"}, EnvelopeMeta())


@router.get("/me")
def me(current_admin: Annotated[AdminUser, Depends(get_current_admin)]) -> dict[str, object]:
    return envelope(
        {
            "id": str(current_admin.id),
            "email": current_admin.email,
            "is_active": current_admin.is_active,
        },
        EnvelopeMeta(),
    )
