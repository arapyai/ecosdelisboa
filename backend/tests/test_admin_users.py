from __future__ import annotations

from uuid import UUID

from app.core.security import hash_password
from app.models.entities import AdminUser


def create_admin(db_session, *, email: str, password: str = "current-secret") -> AdminUser:
    admin = AdminUser(
        email=email,
        password_hash=hash_password(password),
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


def login(client, email: str, password: str) -> str:
    response = client.post(
        "/api/v1/admin/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    return response.json()["data"]["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_user_crud_normalizes_email(client, db_session) -> None:
    current = create_admin(db_session, email="owner@example.com")
    token = login(client, current.email, "current-secret")

    created = client.post(
        "/api/v1/admin/users",
        headers=auth(token),
        json={
            "email": "  Editor@Example.COM ",
            "password": "editor-secret-2026",
            "is_active": True,
        },
    )
    assert created.status_code == 201
    user = created.json()["data"]
    assert user["email"] == "editor@example.com"
    assert user["is_active"] is True
    assert user["created_at"]

    listed = client.get("/api/v1/admin/users", headers=auth(token))
    assert listed.status_code == 200
    assert listed.json()["meta"]["total"] == 2

    updated = client.put(
        f"/api/v1/admin/users/{user['id']}",
        headers=auth(token),
        json={"email": "archive@example.com", "is_active": False},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["email"] == "archive@example.com"
    assert updated.json()["data"]["is_active"] is False

    deleted = client.delete(f"/api/v1/admin/users/{user['id']}", headers=auth(token))
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True}
    assert db_session.get(AdminUser, UUID(user["id"])) is None


def test_admin_user_management_requires_authentication(client) -> None:
    assert client.get("/api/v1/admin/users").status_code == 401


def test_admin_user_rejects_duplicate_email_and_short_password(client, db_session) -> None:
    current = create_admin(db_session, email="owner@example.com")
    token = login(client, current.email, "current-secret")

    duplicate = client.post(
        "/api/v1/admin/users",
        headers=auth(token),
        json={
            "email": "OWNER@example.com",
            "password": "another-secret-2026",
            "is_active": True,
        },
    )
    assert duplicate.status_code == 409

    short = client.post(
        "/api/v1/admin/users",
        headers=auth(token),
        json={"email": "editor@example.com", "password": "short", "is_active": True},
    )
    assert short.status_code == 422


def test_admin_cannot_deactivate_or_delete_self(client, db_session) -> None:
    current = create_admin(db_session, email="owner@example.com")
    token = login(client, current.email, "current-secret")

    deactivate = client.put(
        f"/api/v1/admin/users/{current.id}",
        headers=auth(token),
        json={"email": current.email, "is_active": False},
    )
    assert deactivate.status_code == 409

    delete = client.delete(f"/api/v1/admin/users/{current.id}", headers=auth(token))
    assert delete.status_code == 409


def test_password_reset_revokes_existing_tokens(client, db_session) -> None:
    current = create_admin(db_session, email="owner@example.com")
    token = login(client, current.email, "current-secret")

    reset = client.put(
        f"/api/v1/admin/users/{current.id}/password",
        headers=auth(token),
        json={"password": "replacement-secret-2026"},
    )
    assert reset.status_code == 200

    assert client.get("/api/v1/admin/auth/me", headers=auth(token)).status_code == 401
    assert (
        client.post(
            "/api/v1/admin/auth/login",
            json={"email": current.email, "password": "current-secret"},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/admin/auth/login",
            json={"email": current.email, "password": "replacement-secret-2026"},
        ).status_code
        == 200
    )


def test_deactivated_user_token_is_rejected(client, db_session) -> None:
    current = create_admin(db_session, email="owner@example.com")
    target = create_admin(db_session, email="editor@example.com")
    current_token = login(client, current.email, "current-secret")
    target_token = login(client, target.email, "current-secret")

    response = client.put(
        f"/api/v1/admin/users/{target.id}",
        headers=auth(current_token),
        json={"email": target.email, "is_active": False},
    )
    assert response.status_code == 200
    assert client.get("/api/v1/admin/auth/me", headers=auth(target_token)).status_code == 401
