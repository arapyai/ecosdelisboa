from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.entities import AdminUser
from app.services.admin_users import normalize_admin_email, validate_admin_password

PUBLISHED_ENVIRONMENTS = {"production", "staging"}
LOCAL_DEFAULT_EMAIL = "admin@example.com"
LOCAL_DEFAULT_PASSWORD = "change-me"


def ensure_initial_admin(session: Session, settings: Settings) -> bool:
    users_count = session.scalar(select(func.count()).select_from(AdminUser)) or 0
    if users_count > 0:
        return False

    environment = settings.environment.strip().lower()
    try:
        email = normalize_admin_email(settings.admin_initial_email)
    except ValueError as exc:
        raise RuntimeError(f"Invalid initial admin configuration: {exc}") from exc

    password = settings.admin_initial_password
    if environment in PUBLISHED_ENVIRONMENTS:
        try:
            validate_admin_password(password)
        except ValueError as exc:
            raise RuntimeError(f"Invalid initial admin configuration: {exc}") from exc
        if email == LOCAL_DEFAULT_EMAIL or password == LOCAL_DEFAULT_PASSWORD:
            raise RuntimeError(
                "ADMIN_INITIAL_EMAIL and ADMIN_INITIAL_PASSWORD must use non-default values "
                f"in {environment}"
            )
    elif not password:
        raise RuntimeError("Invalid initial admin configuration: password is empty")

    session.add(
        AdminUser(
            email=email,
            password_hash=hash_password(password),
            is_active=True,
        )
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        concurrent_users = session.scalar(select(func.count()).select_from(AdminUser)) or 0
        if concurrent_users > 0:
            return False
        raise
    return True


def seed() -> bool:
    settings = get_settings()
    with SessionLocal() as session:
        created = ensure_initial_admin(session, settings)
    if created:
        print(f"Initial admin created: {normalize_admin_email(settings.admin_initial_email)}")
    else:
        print("Initial admin seed skipped: admin_users is not empty")
    return created


if __name__ == "__main__":
    seed()
