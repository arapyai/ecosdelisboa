from app.core.security import hash_password
from app.models.entities import AdminUser, Author


def auth_header(client, db_session) -> dict[str, str]:
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
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_crud_author_point_text_and_route(client, db_session) -> None:
    headers = auth_header(client, db_session)

    author_response = client.post(
        "/api/v1/admin/authors",
        json={"name": "Eca de Queiros", "bio_pt": "Romancista"},
        headers=headers,
    )
    author_id = author_response.json()["data"]["id"]

    point_response = client.post(
        "/api/v1/admin/points",
        json={
            "title_pt": "O Ramalhete",
            "address": "Rua das Janelas Verdes",
            "neighborhood": "Santos",
            "lat": 38.7037,
            "lng": -9.1597,
        },
        headers=headers,
    )
    point_id = point_response.json()["data"]["id"]

    text_response = client.post(
        "/api/v1/admin/texts",
        json={
            "point_id": point_id,
            "author_id": author_id,
            "content_pt": "Ali vivia.",
            "source_work": "Os Maias",
            "source_year": 1888,
            "content_type": "prose",
        },
        headers=headers,
    )
    text_id = text_response.json()["data"]["id"]

    route_response = client.post(
        "/api/v1/admin/routes",
        json={
            "title_pt": "Santos Literario",
            "is_published": False,
            "segments": [{"position": 1, "kind": "text", "text_id": text_id}],
        },
        headers=headers,
    )
    route_id = route_response.json()["data"]["id"]

    assert client.get("/api/v1/admin/authors", headers=headers).json()["meta"]["total"] == 1
    assert client.get("/api/v1/admin/points", headers=headers).json()["meta"]["total"] == 1
    assert client.get("/api/v1/admin/texts", headers=headers).json()["meta"]["total"] == 1
    assert client.get("/api/v1/admin/routes", headers=headers).json()["meta"]["total"] == 1

    update_route = client.put(
        f"/api/v1/admin/routes/{route_id}",
        json={
            "title_pt": "Santos Literario",
            "is_published": False,
            "segments": [{"position": 1, "kind": "text", "text_id": text_id}],
        },
        headers=headers,
    )
    assert update_route.status_code == 200
    assert update_route.json()["data"]["is_published"] is False

    delete_text = client.delete(f"/api/v1/admin/texts/{text_id}", headers=headers)
    assert delete_text.status_code == 409
    assert delete_text.json()["detail"]["code"] == "text_used_by_route"

    delete_point = client.delete(f"/api/v1/admin/points/{point_id}", headers=headers)
    assert delete_point.status_code == 409
    assert delete_point.json()["detail"]["code"] == "point_used_by_route"

    route_payload = route_response.json()["data"]
    assert route_payload["segments"][0]["text"]["author"]["name"] == "Eca de Queiros"
    assert route_payload["segments"][0]["text"]["point"]["title_pt"] == "O Ramalhete"
    assert route_payload["items_deprecated"] is True


def test_route_rejects_unknown_text(client, db_session) -> None:
    headers = auth_header(client, db_session)
    response = client.post(
        "/api/v1/admin/routes",
        json={
            "title_pt": "Percurso inválido",
            "segments": [
                {
                    "position": 1,
                    "kind": "text",
                    "text_id": "00000000-0000-0000-0000-000000000099",
                }
            ],
        },
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unknown_route_texts"


def test_admin_endpoints_require_authentication(client) -> None:
    response = client.get("/api/v1/admin/authors")

    assert response.status_code == 401


def test_deleting_author_removes_it(client, db_session) -> None:
    headers = auth_header(client, db_session)
    author = Author(name="Cesario Verde")
    db_session.add(author)
    db_session.commit()

    response = client.delete(f"/api/v1/admin/authors/{author.id}", headers=headers)

    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True
