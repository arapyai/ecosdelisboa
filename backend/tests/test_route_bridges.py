from uuid import UUID

from app.core.security import hash_password
from app.models.entities import AdminUser, Language, Route, RouteSegmentAudioFile, Voice


def auth_header(client, db_session) -> dict[str, str]:
    db_session.add(
        AdminUser(
            email="bridges@example.com",
            password_hash=hash_password("secret"),
            is_active=True,
        )
    )
    db_session.commit()
    response = client.post(
        "/api/v1/admin/auth/login",
        json={"email": "bridges@example.com", "password": "secret"},
    )
    return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}


def create_bridge(client, headers) -> tuple[str, str]:
    response = client.post(
        "/api/v1/admin/routes",
        json={
            "title_pt": "Percurso curatorial",
            "segments": [
                {
                    "position": 0,
                    "kind": "bridge",
                    "bridge_content_pt": "Começamos junto ao Tejo.",
                }
            ],
        },
        headers=headers,
    )
    assert response.status_code == 200
    route = response.json()["data"]
    return route["id"], route["segments"][0]["id"]


def test_bridge_translation_is_reviewed_and_served_by_language(client, db_session) -> None:
    headers = auth_header(client, db_session)
    route_id, segment_id = create_bridge(client, headers)

    translation = client.put(
        f"/api/v1/admin/routes/{route_id}/segments/{segment_id}/translations/en",
        json={"content": "We begin beside the Tagus.", "status": "approved"},
        headers=headers,
    )

    assert translation.status_code == 200
    assert translation.json()["data"]["reviewed_by"] == "bridges@example.com"
    route = db_session.get(Route, UUID(route_id))
    route.is_published = True
    db_session.commit()
    detail = client.get(f"/api/v1/routes/{route_id}", params={"lang": "en"})
    segment = detail.json()["data"]["segments"][0]
    assert segment["content"] == "We begin beside the Tagus."
    assert segment["content_pt"] == "Começamos junto ao Tejo."


def test_bridge_audio_generation_uses_job_and_preserves_manual_upload(client, db_session) -> None:
    headers = auth_header(client, db_session)
    voice = Voice(elevenlabs_id="curator-pt", name="Curadora", is_default=True)
    voice.languages.append(db_session.get(Language, "pt"))
    db_session.add(voice)
    db_session.commit()
    route_id, segment_id = create_bridge(client, headers)

    generated = client.post(
        f"/api/v1/admin/routes/{route_id}/segments/{segment_id}/audio/pt/generate",
        headers=headers,
    )

    assert generated.status_code == 200
    assert generated.json()["data"]["status"] == "completed"
    assert generated.json()["data"]["audio"]["voice_id"] == "curator-pt"
    assert generated.json()["data"]["audio"]["manually_uploaded"] is False

    uploaded = client.put(
        f"/api/v1/admin/routes/{route_id}/segments/{segment_id}/audio/pt/upload",
        files={"file": ("bridge.mp3", b"ID3manual-bridge", "audio/mpeg")},
        headers=headers,
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["data"]["manually_uploaded"] is True
    manual_url = uploaded.json()["data"]["public_url"]

    regenerated = client.post(
        f"/api/v1/admin/routes/{route_id}/segments/{segment_id}/audio/pt/generate",
        headers=headers,
    )
    assert regenerated.status_code == 200
    assert regenerated.json()["data"]["audio"]["manually_uploaded"] is True
    assert regenerated.json()["data"]["audio"]["public_url"] == manual_url
    audio = db_session.query(RouteSegmentAudioFile).filter_by(segment_id=UUID(segment_id)).one()
    assert audio.manually_uploaded is True
