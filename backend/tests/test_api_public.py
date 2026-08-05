from datetime import UTC, datetime

from app.models.entities import (
    AudioFile,
    Author,
    Language,
    Point,
    Route,
    RouteItem,
    Text,
    Translation,
    Voice,
)
from app.models.enums import ContentType, TranslationStatus


def seed_public_data(db_session):
    voice = Voice(elevenlabs_id="voice-default", name="Default Voice", is_default=True)
    voice.languages.append(db_session.get(Language, "en"))
    author = Author(name="Fernando Pessoa", bio_pt="Poeta", elevenlabs_voice_id="voice-default")
    point = Point(
        title_pt="Tabacaria do Rossio",
        address="Rossio 59",
        neighborhood="Baixa",
        lat=38.7134,
        lng=-9.1392,
    )
    text = Text(
        point=point,
        author=author,
        content_pt="Nao sou nada.",
        source_work="Tabacaria",
        source_year=1928,
        content_type=ContentType.POETRY,
    )
    translation = Translation(
        text=text,
        lang="en",
        content="I am nothing.",
        status=TranslationStatus.APPROVED,
    )
    audio = AudioFile(
        text=text,
        lang="en",
        public_url="https://audio.example/1/en.mp3",
        duration_s=31.0,
        voice_id="voice-default",
        generated_at=datetime.now(UTC),
    )
    route = Route(
        title_pt="Baixa Literaria",
        description_pt="Percurso pelo centro",
        difficulty="easy",
        is_published=True,
    )
    route.items.append(RouteItem(position=1, point=point, transition_text_pt="Segue em frente"))
    route.items.append(RouteItem(position=2, waypoint_lat=38.714, waypoint_lng=-9.14))
    draft_route = Route(title_pt="Rascunho", is_published=False)

    db_session.add_all([voice, author, point, text, translation, audio, route, draft_route])
    db_session.commit()
    return {"author": author, "point": point, "route": route}


def test_list_authors_returns_point_count(client, db_session) -> None:
    seed_public_data(db_session)

    response = client.get("/api/v1/authors")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"][0]["name"] == "Fernando Pessoa"
    assert payload["data"][0]["point_count"] == 1


def test_get_author_returns_points(client, db_session) -> None:
    ids = seed_public_data(db_session)

    response = client.get(f"/api/v1/authors/{ids['author'].id}")

    assert response.status_code == 200
    assert response.json()["data"]["points"][0]["title_pt"] == "Tabacaria do Rossio"


def test_list_points_filters_by_radius(client, db_session) -> None:
    seed_public_data(db_session)

    response = client.get("/api/v1/points", params={"lat": 38.7134, "lng": -9.1392, "radius": 20})

    assert response.status_code == 200
    assert len(response.json()["data"]) == 1


def test_get_point_returns_approved_translation_and_audio(client, db_session) -> None:
    ids = seed_public_data(db_session)

    response = client.get(f"/api/v1/points/{ids['point'].id}", params={"lang": "en"})

    assert response.status_code == 200
    text_payload = response.json()["data"]["texts"][0]
    assert text_payload["content"] == "I am nothing."
    assert text_payload["audio_files"][0]["lang"] == "en"


def test_list_routes_returns_only_published_routes(client, db_session) -> None:
    seed_public_data(db_session)

    response = client.get("/api/v1/routes")

    assert response.status_code == 200
    assert [route["title_pt"] for route in response.json()["data"]] == ["Baixa Literaria"]


def test_get_route_returns_point_and_waypoint_items(client, db_session) -> None:
    ids = seed_public_data(db_session)

    response = client.get(f"/api/v1/routes/{ids['route'].id}")

    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert items[0]["point"]["title_pt"] == "Tabacaria do Rossio"
    assert items[1]["waypoint"] == {"lat": 38.714, "lng": -9.14}


def test_get_route_returns_text_led_segments_in_selected_language(client, db_session) -> None:
    ids = seed_public_data(db_session)
    text = ids["point"].texts[0]
    route = Route(title_pt="Percurso narrativo", is_published=True)
    route.items.append(RouteItem(position=1, kind="text", text=text))
    db_session.add(route)
    db_session.commit()

    response = client.get(f"/api/v1/routes/{route.id}", params={"lang": "en"})

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["text_count"] == 1
    assert payload["authors"] == ["Fernando Pessoa"]
    assert payload["segments"][0]["kind"] == "text"
    assert payload["segments"][0]["text"]["content"] == "I am nothing."
    assert payload["segments"][0]["text"]["point"]["title_pt"] == "Tabacaria do Rossio"
    assert payload["segments"][0]["text"]["audio_files"][0]["lang"] == "en"
    assert payload["items"] == payload["segments"]
    assert payload["items_deprecated"] is True


def test_get_default_voice_returns_current_voice(client, db_session) -> None:
    seed_public_data(db_session)

    response = client.get("/api/v1/voices/default")

    assert response.status_code == 200
    assert response.json()["data"]["elevenlabs_id"] == "voice-default"


def test_list_voices_filters_by_lang(client, db_session) -> None:
    pt_voice = Voice(elevenlabs_id="v-pt", name="PT Voice")
    en_voice = Voice(elevenlabs_id="v-en", name="EN Voice")
    fr_voice = Voice(elevenlabs_id="v-fr", name="FR Voice")
    pt_voice.languages.append(db_session.get(Language, "pt"))
    en_voice.languages.append(db_session.get(Language, "en"))
    fr_voice.languages.append(db_session.get(Language, "fr"))
    db_session.add_all([pt_voice, en_voice, fr_voice])
    db_session.commit()

    all_resp = client.get("/api/v1/voices")
    assert all_resp.status_code == 200
    assert len(all_resp.json()["data"]) == 3

    pt_resp = client.get("/api/v1/voices?lang=pt")
    assert len(pt_resp.json()["data"]) == 1
    assert pt_resp.json()["data"][0]["elevenlabs_id"] == "v-pt"


def test_list_active_languages(client, db_session) -> None:
    db_session.get(Language, "de").is_active = False
    db_session.commit()

    response = client.get("/api/v1/languages")

    assert response.status_code == 200
    codes = {language["code"] for language in response.json()["data"]}
    assert "pt" in codes
    assert "de" not in codes


def test_get_route_gpx_returns_xml_payload(client, db_session) -> None:
    ids = seed_public_data(db_session)

    response = client.get(f"/api/v1/routes/{ids['route'].id}/gpx")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/gpx+xml")
    assert "<gpx" in response.text
    assert "trkpt" in response.text


def test_get_route_podcast_rss_returns_xml_payload(client, db_session) -> None:
    ids = seed_public_data(db_session)

    response = client.get(f"/api/v1/routes/{ids['route'].id}/podcast.rss")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/rss+xml")
    assert "<rss" in response.text
    assert "Tabacaria do Rossio" in response.text
    assert f"<link>http://testserver/api/v1/routes/{ids['route'].id}</link>" in response.text
