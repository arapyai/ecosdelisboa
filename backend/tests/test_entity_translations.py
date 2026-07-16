from app.models.entities import Author, AuthorTranslation, Language, Route, RouteTranslation
from app.models.enums import TextOrigin, TranslationStatus
from tests.test_admin_content import auth_header


def test_admin_can_crud_author_translation(client, db_session) -> None:
    headers = auth_header(client, db_session)
    author = Author(name="Fernando Pessoa", bio_pt="Poeta")
    db_session.add(author)
    db_session.commit()

    created = client.put(
        f"/api/v1/admin/authors/{author.id}/translations/en",
        headers=headers,
        json={"bio": "Portuguese poet", "status": "approved"},
    )
    updated = client.put(
        f"/api/v1/admin/authors/{author.id}/translations/en",
        headers=headers,
        json={"bio": "Portuguese poet and writer", "status": "pending"},
    )
    listed = client.get(
        f"/api/v1/admin/authors/{author.id}/translations",
        headers=headers,
    )

    assert created.status_code == 200
    assert created.json()["data"]["status"] == "approved"
    assert updated.status_code == 200
    assert updated.json()["data"]["bio"] == "Portuguese poet and writer"
    assert updated.json()["data"]["origin"] == "manual"
    assert updated.json()["data"]["auto_translated"] is False
    assert updated.json()["data"]["reviewed_by"] == "admin@example.com"
    assert listed.json()["meta"]["total"] == 1
    assert db_session.query(AuthorTranslation).count() == 1

    deleted = client.delete(
        f"/api/v1/admin/authors/{author.id}/translations/en",
        headers=headers,
    )
    assert deleted.status_code == 200
    assert db_session.query(AuthorTranslation).count() == 0


def test_admin_can_crud_route_translation(client, db_session) -> None:
    headers = auth_header(client, db_session)
    route = Route(title_pt="Baixa Literaria", description_pt="Percurso pelo centro")
    db_session.add(route)
    db_session.commit()

    created = client.put(
        f"/api/v1/admin/routes/{route.id}/translations/en",
        headers=headers,
        json={
            "title": "Literary Baixa",
            "description": "A route through the city centre",
            "status": "approved",
        },
    )
    listed = client.get(
        f"/api/v1/admin/routes/{route.id}/translations",
        headers=headers,
    )

    assert created.status_code == 200
    assert created.json()["data"]["title"] == "Literary Baixa"
    assert created.json()["data"]["origin"] == "manual"
    assert listed.json()["data"][0]["description"] == "A route through the city centre"
    assert db_session.query(RouteTranslation).count() == 1

    deleted = client.delete(
        f"/api/v1/admin/routes/{route.id}/translations/en",
        headers=headers,
    )
    assert deleted.status_code == 200
    assert db_session.query(RouteTranslation).count() == 0


def test_admin_translation_rejects_source_and_inactive_languages(client, db_session) -> None:
    headers = auth_header(client, db_session)
    author = Author(name="Fernando Pessoa")
    db_session.get(Language, "en").is_active = False
    db_session.add(author)
    db_session.commit()

    source_response = client.put(
        f"/api/v1/admin/authors/{author.id}/translations/pt",
        headers=headers,
        json={"bio": "Poeta"},
    )
    inactive_response = client.put(
        f"/api/v1/admin/authors/{author.id}/translations/en",
        headers=headers,
        json={"bio": "Portuguese poet"},
    )

    assert source_response.status_code == 400
    assert inactive_response.status_code == 400


def test_public_entity_content_uses_approved_translation_and_falls_back(client, db_session) -> None:
    author = Author(name="Fernando Pessoa", bio_pt="Poeta")
    author.translations.extend(
        [
            AuthorTranslation(
                lang="en",
                bio="Portuguese poet",
                status=TranslationStatus.APPROVED,
                origin=TextOrigin.MANUAL.value,
            ),
            AuthorTranslation(
                lang="es",
                bio="Poeta portugues",
                status=TranslationStatus.PENDING,
                origin=TextOrigin.MANUAL.value,
            ),
        ]
    )
    route = Route(
        title_pt="Baixa Literaria",
        description_pt="Percurso pelo centro",
        is_published=True,
    )
    route.translations.extend(
        [
            RouteTranslation(
                lang="en",
                title="Literary Baixa",
                description="A route through the city centre",
                status=TranslationStatus.APPROVED,
                origin=TextOrigin.MANUAL.value,
            ),
            RouteTranslation(
                lang="es",
                title="Baixa literaria",
                status=TranslationStatus.PENDING,
                origin=TextOrigin.MANUAL.value,
            ),
        ]
    )
    db_session.add_all([author, route])
    db_session.commit()

    author_en = client.get(f"/api/v1/authors/{author.id}", params={"lang": "en"})
    author_es = client.get(f"/api/v1/authors/{author.id}", params={"lang": "es"})
    route_en = client.get(f"/api/v1/routes/{route.id}", params={"lang": "en"})
    route_es = client.get(f"/api/v1/routes/{route.id}", params={"lang": "es"})

    assert author_en.json()["data"]["bio"] == "Portuguese poet"
    assert author_es.json()["data"]["bio"] == "Poeta"
    assert route_en.json()["data"]["title"] == "Literary Baixa"
    assert route_en.json()["data"]["description"] == "A route through the city centre"
    assert route_es.json()["data"]["title"] == "Baixa Literaria"
    assert route_es.json()["data"]["description"] == "Percurso pelo centro"


def test_route_exports_use_selected_translation(client, db_session) -> None:
    route = Route(
        title_pt="Baixa Literaria",
        description_pt="Percurso pelo centro",
        is_published=True,
    )
    route.translations.append(
        RouteTranslation(
            lang="en",
            title="Literary Baixa",
            description=None,
            status=TranslationStatus.APPROVED,
            origin=TextOrigin.MANUAL.value,
        )
    )
    db_session.add(route)
    db_session.commit()

    gpx = client.get(f"/api/v1/routes/{route.id}/gpx", params={"lang": "en"})
    rss = client.get(f"/api/v1/routes/{route.id}/podcast.rss", params={"lang": "en"})

    assert "Literary Baixa" in gpx.text
    assert "Literary Baixa" in rss.text
    assert "Percurso pelo centro" not in rss.text
