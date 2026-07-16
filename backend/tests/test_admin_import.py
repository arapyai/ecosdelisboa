import csv
import io

from app.models.entities import Author, Point, Text, Translation
from app.models.enums import TextOrigin, TranslationStatus
from app.services.csv_import import apply_import, preview_import
from app.services.geocoding import GeocodingResult
from tests.test_admin_content import auth_header

CSV_CONTENT = (
    b"point_name,address,neighborhood,city,country,lat_override,lng_override,"
    b"author_name,content_pt,content_type,source_work,source_year\n"
    b"Tabacaria do Rossio,Rossio 59,Baixa,Lisboa,Portugal,38.7134,-9.1392,"
    b"Fernando Pessoa,Nao sou nada.,poetry,Tabacaria,1928\n"
)


def test_csv_preview_reports_create_action(client, db_session) -> None:
    headers = auth_header(client, db_session)

    response = client.post(
        "/api/v1/admin/points/import/preview",
        headers=headers,
        files={"file": ("points.csv", CSV_CONTENT, "text/csv")},
    )

    assert response.status_code == 200
    assert response.json()["data"][0]["action"] == "create"
    assert response.json()["data"][0]["point_action"] == "create"
    assert response.json()["data"][0]["text_action"] == "create"


def test_csv_confirm_is_idempotent_by_author_and_title(client, db_session) -> None:
    headers = auth_header(client, db_session)

    first = client.post(
        "/api/v1/admin/points/import/confirm",
        headers=headers,
        files={"file": ("points.csv", CSV_CONTENT, "text/csv")},
    )
    second = client.post(
        "/api/v1/admin/points/import/confirm",
        headers=headers,
        files={"file": ("points.csv", CSV_CONTENT, "text/csv")},
    )

    assert first.status_code == 200
    assert first.json()["data"]["created"] == 1
    assert second.json()["data"]["updated"] == 1
    assert second.json()["data"]["texts"]["reused"] == 1
    assert len(db_session.query(Point).all()) == 1


def test_csv_confirm_preserves_coordinates_when_existing_point_has_no_overrides(
    client,
    db_session,
) -> None:
    headers = auth_header(client, db_session)
    point = Point(
        title_pt="Chiado",
        address="Largo do Chiado",
        neighborhood="Chiado",
        lat=38.7107,
        lng=-9.1439,
    )
    db_session.add(point)
    db_session.commit()

    response = client.post(
        "/api/v1/admin/points/import/confirm",
        headers=headers,
        files={
            "file": (
                "points.csv",
                b"point_name,address,neighborhood,city,country,lat_override,lng_override,"
                b"author_name,content_pt,content_type,source_work,source_year\n"
                b"Chiado,Largo do Chiado,Chiado,Lisboa,Portugal,,,"
                b"Fernando Pessoa,Aqui a cidade tem passos.,prose,Fragmento demonstrativo,2026\n",
                "text/csv",
            )
        },
    )

    db_session.refresh(point)
    assert response.status_code == 200
    assert response.json()["data"]["updated"] == 1
    assert point.lat == 38.7107
    assert point.lng == -9.1439


def test_csv_template_is_downloadable_and_matches_the_parser(client, db_session) -> None:
    headers = auth_header(client, db_session)

    response = client.get("/api/v1/admin/points/import/template", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-disposition"] == (
        'attachment; filename="content_import_template.csv"'
    )
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert rows[0]["content_pt"]
    assert rows[0]["content_en"]


def test_import_creates_translations_from_content_language_columns(client, db_session) -> None:
    headers = auth_header(client, db_session)
    csv_content = CSV_CONTENT.replace(
        b"author_name,content_pt,content_type",
        b"author_name,content_pt,content_en,content_type",
    ).replace(
        b"Fernando Pessoa,Nao sou nada.,poetry",
        b"Fernando Pessoa,Nao sou nada.,I am nothing.,poetry",
    )

    response = client.post(
        "/api/v1/admin/points/import/confirm",
        headers=headers,
        files={"file": ("points.csv", csv_content, "text/csv")},
    )
    repeated = client.post(
        "/api/v1/admin/points/import/confirm",
        headers=headers,
        files={"file": ("points.csv", csv_content, "text/csv")},
    )

    assert response.status_code == 200
    assert response.json()["data"]["translations"] == {
        "created": 1,
        "updated": 0,
        "reused": 0,
        "by_language": {"en": {"created": 1, "updated": 0, "reused": 0}},
    }
    translation = db_session.query(Translation).one()
    assert translation.content == "I am nothing."
    assert translation.status == TranslationStatus.PENDING
    assert translation.auto_translated is False
    assert translation.origin == TextOrigin.IMPORT
    assert repeated.json()["data"]["translations"]["reused"] == 1
    assert db_session.query(Translation).count() == 1


def test_import_rejects_translation_for_inactive_or_unknown_language(
    client,
    db_session,
) -> None:
    headers = auth_header(client, db_session)
    csv_content = CSV_CONTENT.replace(
        b"author_name,content_pt,content_type",
        b"author_name,content_pt,content_it,content_type",
    ).replace(
        b"Fernando Pessoa,Nao sou nada.,poetry",
        b"Fernando Pessoa,Nao sou nada.,Non sono niente.,poetry",
    )

    response = client.post(
        "/api/v1/admin/points/import/preview",
        headers=headers,
        files={"file": ("points.csv", csv_content, "text/csv")},
    )

    assert response.status_code == 200
    assert response.json()["data"][0]["action"] == "error"
    assert "content_it uses an unknown or inactive language" in response.json()["data"][0]["errors"]


def test_import_keeps_multiple_texts_by_same_author_at_same_point(db_session) -> None:
    csv_content = (
        "point_name,address,lat_override,lng_override,author_name,content_pt,content_type,"
        "source_work,source_year\n"
        "Chiado,Largo do Chiado,38.7107,-9.1439,Fernando Pessoa,Primeiro trecho,prose,"
        "Livro A,1928\n"
        "Chiado,Largo do Chiado,38.7107,-9.1439,Fernando Pessoa,Segundo trecho,prose,"
        "Livro B,1929\n"
    )

    first = apply_import(csv_content, db_session)
    second = apply_import(csv_content, db_session)

    assert first["texts"] == {"created": 2, "updated": 0, "reused": 0}
    assert second["texts"] == {"created": 0, "updated": 0, "reused": 2}
    assert db_session.query(Text).count() == 2
    assert db_session.query(Point).count() == 1
    assert db_session.query(Author).count() == 1


def test_preview_reuses_normalized_point_without_calling_geocoder(db_session) -> None:
    point = Point(
        title_pt="Terreiro do Paço",
        address="Praça do Comércio",
        neighborhood="Baixa",
        lat=38.7076,
        lng=-9.1365,
    )
    db_session.add(point)
    db_session.commit()

    def fail_geocoder(**_kwargs):
        raise AssertionError("geocoder should not be called for a normalized match")

    rows = preview_import(
        "point_name,address,author_name,content_pt\n"
        "Terreiro do Paco,Praca do Comercio,Fernando Pessoa,Um trecho\n",
        db_session,
        geocoder=fail_geocoder,
    )

    assert rows[0].point_action == "reuse"
    assert rows[0].geocoded is False


def test_preview_geocodes_once_and_reuses_nearby_point(db_session) -> None:
    point = Point(
        title_pt="Chiado",
        address="Largo do Chiado",
        neighborhood="Chiado",
        lat=38.7107,
        lng=-9.1439,
    )
    db_session.add(point)
    db_session.commit()
    calls = 0

    def geocoder(**_kwargs):
        nonlocal calls
        calls += 1
        return GeocodingResult(lat=38.71071, lng=-9.14391)

    rows = preview_import(
        "point_name,address,author_name,content_pt\n"
        "Largo do Chiado 1,Chiado Lisboa,Fernando Pessoa,Um trecho\n",
        db_session,
        geocoder=geocoder,
    )

    assert calls == 1
    assert rows[0].point_action == "reuse"
    assert rows[0].geocoded is True


def test_preview_reports_geocoding_failure_without_planning_a_point(db_session) -> None:
    def geocoder(**_kwargs):
        raise ValueError("address not found")

    rows = preview_import(
        "point_name,address,author_name,content_pt\n"
        "Lugar desconhecido,Endereco inexistente,Fernando Pessoa,Um trecho\n",
        db_session,
        geocoder=geocoder,
    )

    assert rows[0].action == "error"
    assert rows[0].point_action == "error"
    assert rows[0].lat is None
    assert rows[0].lng is None
    assert rows[0].errors == ["geocoding failed: address not found"]


def test_import_populates_author_metadata_and_marks_source_as_import(db_session) -> None:
    result = apply_import(
        "point_name,address,lat_override,lng_override,author_name,author_bio_pt,birth_date,"
        "death_date,content_pt\n"
        "Chiado,Largo do Chiado,38.7107,-9.1439,Fernando Pessoa,Poeta,1888-06-13,"
        "1935-11-30,Um trecho\n",
        db_session,
    )

    assert result["authors"]["created"] == 1
    author = db_session.query(Author).one()
    text = db_session.query(Text).one()
    assert (author.bio_pt, author.birth_year, author.death_year) == ("Poeta", 1888, 1935)
    assert text.origin == TextOrigin.IMPORT
