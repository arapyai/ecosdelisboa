from app.core.security import create_access_token, hash_password
from app.models.entities import AdminUser


def test_admin_login_returns_bearer_token(client, db_session) -> None:
    admin = AdminUser(
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()

    response = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "admin@example.com", "password": "secret"},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]


def test_admin_me_requires_valid_bearer_token(client, db_session) -> None:
    admin = AdminUser(
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_active=True,
    )
    db_session.add(admin)
    db_session.commit()

    login = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "admin@example.com", "password": "secret"},
    )
    token = login.json()["data"]["access_token"]

    response = client.get(
        "/api/v1/admin/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["email"] == "admin@example.com"


def test_admin_me_rejects_token_from_previous_auth_version(client, db_session) -> None:
    admin = AdminUser(
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_active=True,
        auth_version=2,
    )
    db_session.add(admin)
    db_session.commit()

    stale_token = create_access_token(admin.id, auth_version=1)
    response = client.get(
        "/api/v1/admin/auth/me",
        headers={"Authorization": f"Bearer {stale_token}"},
    )

    assert response.status_code == 401
