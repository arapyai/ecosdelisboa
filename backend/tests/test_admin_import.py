from app.models.entities import Point
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
