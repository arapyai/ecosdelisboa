import io
import json
from urllib.error import URLError

import pytest

from app.api.routes import admin_routes
from app.core.security import hash_password
from app.models.entities import AdminUser, Author, Point, Route, RouteItem, Text
from app.models.enums import ContentType
from app.services import routing
from app.services.routing import DirectionsResult, OpenRouteServiceProvider, RoutingError


def auth_header(client, db_session) -> dict[str, str]:
    db_session.add(
        AdminUser(
            email="routes@example.com",
            password_hash=hash_password("secret"),
            is_active=True,
        )
    )
    db_session.commit()
    response = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "routes@example.com", "password": "secret"},
    )
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


def seed_route(db_session) -> Route:
    author = Author(name="Fernando Pessoa")
    first_point = Point(title_pt="Primeiro", lat=38.71, lng=-9.14)
    second_point = Point(title_pt="Segundo", lat=38.72, lng=-9.13)
    first_text = Text(
        author=author,
        point=first_point,
        content_pt="Primeiro texto",
        content_type=ContentType.PROSE,
    )
    second_text = Text(
        author=author,
        point=second_point,
        content_pt="Segundo texto",
        content_type=ContentType.PROSE,
    )
    route = Route(title_pt="Rota")
    route.items.extend(
        [
            RouteItem(position=1, kind="text", text=first_text),
            RouteItem(position=2, kind="text", text=second_text),
        ]
    )
    db_session.add(route)
    db_session.commit()
    return route


class StubProvider:
    name = "stub"

    def __init__(self) -> None:
        self.calls: list[list[tuple[float, float]]] = []

    def directions(self, coordinates):
        self.calls.append(coordinates)
        return DirectionsResult(
            geometry={"type": "LineString", "coordinates": coordinates},
            distance_m=1250.5,
            duration_s=910,
            provider=self.name,
        )


class FailingProvider:
    name = "failing"

    def directions(self, coordinates):
        raise RoutingError("provider unavailable")


def test_recalculate_persists_route_leg_waypoints_and_hash(client, db_session, monkeypatch) -> None:
    headers = auth_header(client, db_session)
    route = seed_route(db_session)
    provider = StubProvider()
    monkeypatch.setattr(admin_routes, "directions_provider_factory", lambda: provider)

    response = client.post(
        f"/api/v1/admin/routes/{route.id}/recalculate",
        json={"legs": [{"position": 0, "waypoints": [{"lat": 38.715, "lng": -9.135}]}]},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["routing_status"] == "ready"
    assert len(payload["routing_hash"]) == 64
    assert payload["estimated_distance_m"] == 1250.5
    assert payload["estimated_duration_s"] == 910
    assert payload["legs"][0]["waypoints"] == [{"lat": 38.715, "lng": -9.135}]
    assert provider.calls == [[(-9.14, 38.71), (-9.135, 38.715), (-9.13, 38.72)]]

    public_route = db_session.get(Route, route.id)
    public_route.is_published = True
    db_session.commit()
    detail = client.get(f"/api/v1/routes/{route.id}")
    assert detail.json()["data"]["legs"][0]["geometry"]["type"] == "LineString"


def test_failed_recalculation_preserves_last_valid_geometry(
    client, db_session, monkeypatch
) -> None:
    headers = auth_header(client, db_session)
    route = seed_route(db_session)
    provider = StubProvider()
    monkeypatch.setattr(admin_routes, "directions_provider_factory", lambda: provider)
    success = client.post(
        f"/api/v1/admin/routes/{route.id}/recalculate",
        json={},
        headers=headers,
    )
    original_geometry = success.json()["data"]["legs"][0]["geometry"]

    monkeypatch.setattr(admin_routes, "directions_provider_factory", lambda: FailingProvider())
    failure = client.post(
        f"/api/v1/admin/routes/{route.id}/recalculate",
        json={},
        headers=headers,
    )

    assert failure.status_code == 502
    assert failure.json()["detail"]["code"] == "routing_failed"
    db_session.expire_all()
    persisted = db_session.get(Route, route.id)
    assert persisted.routing_status == "failed"
    assert persisted.routing_error == "provider unavailable"
    assert persisted.legs[0].geometry == original_geometry


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def test_openrouteservice_uses_foot_walking_geojson(monkeypatch) -> None:
    captured = {}
    response_payload = {
        "features": [
            {
                "geometry": {"type": "LineString", "coordinates": [[-9.14, 38.71]]},
                "properties": {"summary": {"distance": 123.4, "duration": 89.6}},
            }
        ]
    }

    def fake_open(request, *, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return FakeResponse(json.dumps(response_payload).encode())

    monkeypatch.setattr(routing, "open_url", fake_open)
    provider = OpenRouteServiceProvider(api_key="test-key", timeout_s=4, retry_count=0)
    result = provider.directions([(-9.14, 38.71), (-9.13, 38.72)])

    request = captured["request"]
    assert request.full_url.endswith("/v2/directions/foot-walking/geojson")
    assert request.headers["Authorization"] == "test-key"
    assert json.loads(request.data) == {"coordinates": [[-9.14, 38.71], [-9.13, 38.72]]}
    assert captured["timeout"] == 4
    assert result.distance_m == 123.4
    assert result.duration_s == 90


def test_openrouteservice_retries_timeouts(monkeypatch) -> None:
    attempts = 0

    def fail_open(_request, *, timeout):
        nonlocal attempts
        attempts += 1
        raise URLError("timeout")

    monkeypatch.setattr(routing, "open_url", fail_open)
    monkeypatch.setattr(routing.time, "sleep", lambda _delay: None)
    provider = OpenRouteServiceProvider(api_key="test", retry_count=2)

    with pytest.raises(RoutingError, match="request failed"):
        provider.directions([(-9.14, 38.71), (-9.13, 38.72)])

    assert attempts == 3
