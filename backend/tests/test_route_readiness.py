from app.api.routes import admin_routes
from app.core.security import hash_password
from app.models.entities import (
    AdminUser,
    AudioFile,
    Author,
    Point,
    Route,
    RouteItem,
    RouteSegmentAudioFile,
    RouteSegmentTranslation,
    RouteTranslation,
    Text,
    Translation,
)
from app.models.enums import ContentType, TranslationStatus
from app.services.routing import DirectionsResult


def auth_header(client, db_session) -> dict[str, str]:
    db_session.add(
        AdminUser(
            email="readiness@example.com",
            password_hash=hash_password("secret"),
            is_active=True,
        )
    )
    db_session.commit()
    response = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "readiness@example.com", "password": "secret"},
    )
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


class StubProvider:
    name = "stub"

    def directions(self, coordinates):
        return DirectionsResult(
            geometry={"type": "LineString", "coordinates": coordinates},
            distance_m=900,
            duration_s=600,
            provider=self.name,
        )


def seed_ready_route(db_session) -> Route:
    author = Author(name="Autora")
    first = Text(
        author=author,
        point=Point(title_pt="Tejo", lat=38.71, lng=-9.14),
        content_pt="Texto junto ao Tejo.",
        source_work="Primeira obra",
        content_type=ContentType.PROSE,
    )
    second = Text(
        author=author,
        point=Point(title_pt="Chiado", lat=38.72, lng=-9.13),
        content_pt="Texto no Chiado.",
        source_work="Segunda obra",
        content_type=ContentType.PROSE,
    )
    for text, english in [(first, "Text by the Tagus."), (second, "Text in Chiado.")]:
        text.translations.append(
            Translation(lang="en", content=english, status=TranslationStatus.APPROVED)
        )
        text.audio_files.extend(
            [
                AudioFile(lang="pt", public_url=f"https://audio.test/{id(text)}/pt.mp3"),
                AudioFile(lang="en", public_url=f"https://audio.test/{id(text)}/en.mp3"),
            ]
        )
    bridge = RouteItem(
        position=2,
        kind="bridge",
        bridge_content_pt="Enquanto subimos, a cidade muda de voz.",
    )
    bridge.translations.append(
        RouteSegmentTranslation(
            lang="en",
            content="As we climb, the city changes voice.",
            status=TranslationStatus.APPROVED,
        )
    )
    bridge.audio_files.extend(
        [
            RouteSegmentAudioFile(lang="pt", public_url="https://audio.test/bridge/pt.mp3"),
            RouteSegmentAudioFile(lang="en", public_url="https://audio.test/bridge/en.mp3"),
        ]
    )
    route = Route(
        title_pt="Do Tejo ao Chiado",
        description_pt="Uma subida literária por Lisboa.",
        difficulty="moderate",
        is_published=False,
    )
    route.translations.append(
        RouteTranslation(
            lang="en",
            title="From the Tagus to Chiado",
            description="A literary climb through Lisbon.",
            status=TranslationStatus.APPROVED,
        )
    )
    route.items.extend(
        [
            RouteItem(position=1, kind="text", text=first),
            bridge,
            RouteItem(position=3, kind="text", text=second),
        ]
    )
    db_session.add(route)
    db_session.commit()
    return route


def test_publication_is_blocked_with_structured_readiness(client, db_session) -> None:
    headers = auth_header(client, db_session)

    response = client.post(
        "/api/v1/admin/routes",
        json={"title_pt": "Incompleto", "is_published": True, "segments": []},
        headers=headers,
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "route_not_ready"
    assert [item["lang"] for item in detail["readiness"]] == ["pt", "en"]
    assert any(
        issue["code"] == "too_few_texts"
        for readiness in detail["readiness"]
        for issue in readiness["issues"]
    )


def test_ready_route_can_publish_and_exports_real_geometry_and_audio(
    client, db_session, monkeypatch
) -> None:
    headers = auth_header(client, db_session)
    route = seed_ready_route(db_session)
    monkeypatch.setattr(admin_routes, "directions_provider_factory", lambda: StubProvider())
    recalculation = client.post(
        f"/api/v1/admin/routes/{route.id}/recalculate",
        json={"legs": [{"position": 0, "waypoints": [{"lat": 38.715, "lng": -9.135}]}]},
        headers=headers,
    )
    assert recalculation.status_code == 200

    payload = {
        "title_pt": route.title_pt,
        "description_pt": route.description_pt,
        "difficulty": route.difficulty,
        "is_published": True,
        "segments": [
            {"position": 1, "kind": "text", "text_id": str(route.items[0].text_id)},
            {
                "position": 2,
                "kind": "bridge",
                "bridge_content_pt": route.items[1].bridge_content_pt,
            },
            {"position": 3, "kind": "text", "text_id": str(route.items[2].text_id)},
        ],
    }
    publication = client.put(f"/api/v1/admin/routes/{route.id}", json=payload, headers=headers)

    assert publication.status_code == 200
    assert publication.json()["data"]["is_published"] is True
    readiness = client.get(f"/api/v1/admin/routes/{route.id}/readiness?lang=en", headers=headers)
    assert readiness.json()["data"] == {"lang": "en", "ready": True, "issues": []}

    gpx = client.get(f"/api/v1/routes/{route.id}/gpx")
    assert '<trkpt lat="38.715" lon="-9.135"/>' in gpx.text
    rss = client.get(f"/api/v1/routes/{route.id}/podcast.rss?lang=en")
    assert rss.text.count("<enclosure ") == 3
    assert "Text by the Tagus." in rss.text

    route.items[0].text.point.lat = 38.711
    db_session.commit()
    stale = client.get(f"/api/v1/admin/routes/{route.id}/readiness?lang=pt", headers=headers)
    assert any(issue["code"] == "routing_stale" for issue in stale.json()["data"]["issues"])
