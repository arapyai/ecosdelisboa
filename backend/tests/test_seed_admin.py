from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.core.config import Settings
from app.core.security import hash_password, verify_password
from app.models.entities import AdminUser
from app.scripts.seed_admin import ensure_initial_admin


def settings_for(**overrides: object) -> Settings:
    values = {
        "environment": "production",
        "admin_initial_email": "owner@example.com",
        "admin_initial_password": "production-secret-2026",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_seed_creates_one_active_admin_in_empty_database(db_session) -> None:
    settings = settings_for(admin_initial_email=" Owner@Example.COM ")

    assert ensure_initial_admin(db_session, settings) is True

    users = db_session.scalars(select(AdminUser)).all()
    assert len(users) == 1
    assert users[0].email == "owner@example.com"
    assert users[0].is_active is True
    assert verify_password("production-secret-2026", users[0].password_hash)


def test_seed_is_idempotent(db_session) -> None:
    settings = settings_for()

    assert ensure_initial_admin(db_session, settings) is True
    first_user = db_session.scalar(select(AdminUser))
    assert first_user is not None
    first_hash = first_user.password_hash

    assert ensure_initial_admin(db_session, settings) is False
    assert db_session.scalar(select(func.count()).select_from(AdminUser)) == 1
    assert db_session.scalar(select(AdminUser)).password_hash == first_hash


def test_seed_does_not_replace_an_inactive_existing_user(db_session) -> None:
    existing = AdminUser(
        email="inactive@example.com",
        password_hash=hash_password("existing-secret"),
        is_active=False,
    )
    db_session.add(existing)
    db_session.commit()

    assert ensure_initial_admin(db_session, settings_for()) is False
    assert db_session.scalar(select(func.count()).select_from(AdminUser)) == 1


def test_seed_allows_documented_local_defaults_in_development(db_session) -> None:
    settings = settings_for(
        environment="development",
        admin_initial_email="admin@example.com",
        admin_initial_password="change-me",
    )

    assert ensure_initial_admin(db_session, settings) is True


@pytest.mark.parametrize(
    ("email", "password"),
    [
        ("admin@example.com", "production-secret-2026"),
        ("owner@example.com", "change-me"),
        ("owner@example.com", "too-short"),
    ],
)
def test_seed_rejects_unsafe_published_credentials(
    db_session,
    email: str,
    password: str,
) -> None:
    with pytest.raises(RuntimeError, match="initial admin|ADMIN_INITIAL"):
        ensure_initial_admin(
            db_session,
            settings_for(admin_initial_email=email, admin_initial_password=password),
        )

    assert db_session.scalar(select(func.count()).select_from(AdminUser)) == 0
