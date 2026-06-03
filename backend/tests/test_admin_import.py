from app.models.entities import Author, Point, Text
from app.services.csv_import import apply_import, preview_import
from app.services.geocoding import GeocodingResult
from tests.test_admin_content import auth_header

CSV_CONTENT = (
    b"point_name,address,neighborhood,city,country,lat_override,lng_override,"
    b"author_name,content_pt,content_type,source_work,source_year\n"
    b"Tabacaria do Rossio,Rossio 59,Baixa,Lisboa,Portugal,38.7134,-9.1392,"
    b"Fernando Pessoa,Nao sou nada.,poetry,Tabacaria,1928\n"
)

CSV_CONTENT_WITHOUT_COORDS = (
    "point_name,address,neighborhood,city,country,lat_override,lng_override,"
    "author_name,content_pt,content_type,source_work,source_year\n"
    "Chiado,Largo do Chiado,Chiado,Lisboa,Portugal,,,"
    "Fernando Pessoa,Aqui a cidade tem passos.,prose,Fragmento,2026\n"
)


def fake_geocoder(**_: object) -> GeocodingResult:
    return GeocodingResult(lat=38.7107, lng=-9.1439)


def test_csv_preview_reports_create_action(client, db_session) -> None:
    headers = auth_header(client, db_session)

    response = client.post(
        "/api/v1/admin/points/import/preview",
        headers=headers,
        files={"file": ("points.csv", CSV_CONTENT, "text/csv")},
    )

    assert response.status_code == 200
    assert response.json()["data"][0]["action"] == "create"
    assert response.json()["data"][0]["point_name"] == "Tabacaria do Rossio"


def test_csv_confirm_is_idempotent_by_point_author_source_and_content(client, db_session) -> None:
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
    assert len(db_session.query(Point).all()) == 1
    assert len(db_session.query(Text).all()) == 1


def test_csv_import_geocodes_when_coordinates_are_not_overridden(db_session) -> None:
    result = apply_import(CSV_CONTENT_WITHOUT_COORDS, db_session, geocoder=fake_geocoder)

    point = db_session.query(Point).one()
    assert result["created"] == 1
    assert point.lat == 38.7107
    assert point.lng == -9.1439


def test_csv_import_allows_multiple_authors_for_same_point(db_session) -> None:
    csv_content = (
        "point_name,address,neighborhood,city,country,lat_override,lng_override,"
        "author_name,content_pt,content_type,source_work,source_year\n"
        "Chiado,Largo do Chiado,Chiado,Lisboa,Portugal,38.7107,-9.1439,"
        "Fernando Pessoa,Texto de Pessoa.,prose,Fragmento,2026\n"
        "Chiado,Largo do Chiado,Chiado,Lisboa,Portugal,38.7107,-9.1439,"
        "Jose Saramago,Texto de Saramago.,prose,Fragmento,2026\n"
    )

    result = apply_import(csv_content, db_session)

    assert result["created"] == 2
    assert len(db_session.query(Point).all()) == 1
    assert len(db_session.query(Author).all()) == 2
    assert len(db_session.query(Text).all()) == 2


def test_csv_preview_reports_geocoding_errors(db_session) -> None:
    def failing_geocoder(**_: object) -> GeocodingResult:
        raise ValueError("not found")

    preview = preview_import(CSV_CONTENT_WITHOUT_COORDS, db_session, geocoder=failing_geocoder)

    assert preview[0].action == "error"
    assert preview[0].errors == ["geocoding failed: not found"]
