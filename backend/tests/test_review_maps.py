import io
import math
import zipfile
from datetime import UTC, datetime

import httpx
from PIL import Image
from pypdf import PdfReader

from app.api.routes import admin_review_maps
from app.core.config import get_settings
from app.models.entities import Point
from app.services.review_maps import (
    PAPER_SIZES,
    GeoBounds,
    MapTilerRenderer,
    ReviewMapRenderError,
    build_atlas_pdf,
    build_grid_layout,
    build_overview_pdf,
    build_review_workbook,
    build_snapshot,
    effective_raster_dpi,
    split_grid,
    split_sectors,
)
from tests.test_admin_content import auth_header


class BlankRenderer:
    def __init__(self, *args, **kwargs):
        pass

    def render(self, bounds: GeoBounds, width_px: int, height_px: int) -> Image.Image:
        return Image.new("RGB", (width_px, height_px), "#eee9df")


def add_review_points(db_session) -> list[Point]:
    points = [
        Point(
            title_pt="Chiado",
            address="Largo do Chiado",
            neighborhood="Chiado",
            lat=38.7107,
            lng=-9.1439,
            review_code="P0001",
        ),
        Point(
            title_pt="Dois pontos na mesma posição com um título editorial bastante longo",
            address="Largo do Chiado",
            neighborhood="Chiado",
            lat=38.7107,
            lng=-9.1439,
            review_code="P0002",
        ),
    ]
    db_session.add_all(points)
    db_session.commit()
    return points


def test_preview_requires_authentication(client) -> None:
    assert client.get("/api/v1/admin/review-map/preview").status_code == 401


def test_preview_reports_points_sectors_and_counts(client, db_session) -> None:
    headers = auth_header(client, db_session)
    add_review_points(db_session)

    response = client.get(
        "/api/v1/admin/review-map/preview?paper_size=A4&grid_columns=2&grid_rows=1",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["total_points"] == 2
    assert payload["main_points"] == 2
    assert payload["outside_points"] == 0
    assert {sector["code"] for sector in payload["sectors"]} == {"F01", "F02"}
    assert [point["review_code"] for point in payload["points"]] == ["P0001", "P0002"]


def test_preview_rejects_empty_database(client, db_session) -> None:
    headers = auth_header(client, db_session)

    response = client.get("/api/v1/admin/review-map/preview", headers=headers)

    assert response.status_code == 409
    assert "Nenhum ponto" in response.json()["detail"]


def test_export_builds_custom_grid_and_workbook_from_same_snapshot(
    client,
    db_session,
    monkeypatch,
) -> None:
    headers = auth_header(client, db_session)
    add_review_points(db_session)
    monkeypatch.setenv("MAPTILER_API_KEY", "test-key")
    monkeypatch.setenv("REVIEW_MAP_DPI", "72")
    get_settings.cache_clear()
    monkeypatch.setattr(admin_review_maps, "MapTilerRenderer", BlankRenderer)

    response = client.post(
        "/api/v1/admin/review-map/export",
        json={"paper_size": "A2", "grid_columns": 2, "grid_rows": 1},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert set(archive.namelist()) == {
            "mapa-revisao-A2-2x1.pdf",
            "pontos-revisao.xlsx",
        }
        map_pdf = PdfReader(io.BytesIO(archive.read("mapa-revisao-A2-2x1.pdf")))
        assert len(map_pdf.pages) == 2
        assert math.isclose(float(map_pdf.pages[0].mediabox.width), 1683.78, abs_tol=0.1)
        assert math.isclose(float(map_pdf.pages[0].mediabox.height), 1190.55, abs_tol=0.1)
        pdf_text = "\n".join(page.extract_text() or "" for page in map_pdf.pages)
        workbook_bytes = archive.read("pontos-revisao.xlsx")

    with zipfile.ZipFile(io.BytesIO(workbook_bytes)) as workbook:
        workbook_xml = "\n".join(
            workbook.read(name).decode("utf-8")
            for name in workbook.namelist()
            if name.endswith(".xml")
        )

    for code in ("P0001", "P0002"):
        assert code in pdf_text
        assert workbook_xml.count(code) == 1
    assert "Correto,Ajustar,Remover,Revisar" in workbook_xml


def test_export_requires_maptiler_key(client, db_session, monkeypatch) -> None:
    headers = auth_header(client, db_session)
    add_review_points(db_session)
    monkeypatch.setenv("MAPTILER_API_KEY", "")
    get_settings.cache_clear()

    response = client.post("/api/v1/admin/review-map/export", json={}, headers=headers)

    assert response.status_code == 503
    assert "MAPTILER_API_KEY" in response.json()["detail"]


def test_export_rejects_invalid_paper_or_grid(client, db_session) -> None:
    headers = auth_header(client, db_session)
    add_review_points(db_session)

    response = client.post(
        "/api/v1/admin/review-map/export",
        json={"paper_size": "A5", "grid_columns": 0, "grid_rows": 1},
        headers=headers,
    )

    assert response.status_code == 422


def test_custom_grid_supports_eight_a4_sheets_and_overlap(db_session) -> None:
    points = add_review_points(db_session)
    snapshot = build_snapshot(
        points,
        center_lat=38.7223,
        center_lng=-9.1393,
        outlier_radius_km=30,
    )

    layout = build_grid_layout(snapshot, paper_size="A4", columns=4, rows=2)

    assert layout.sheet_count == 8
    assert layout.page_size == PAPER_SIZES["A4"]
    assert layout.pages[0].bounds.east > layout.pages[1].bounds.west
    assert layout.pages[0].bounds.south < layout.pages[4].bounds.north
    assert effective_raster_dpi(PAPER_SIZES["A0"], 300) < 300
    assert effective_raster_dpi(PAPER_SIZES["A4"], 300) == 300


def test_split_grid_numbers_pages_in_reading_order() -> None:
    pages = split_grid(
        GeoBounds(west=-9.2, south=38.68, east=-9.08, north=38.78),
        columns=2,
        rows=2,
    )

    assert [(page.code, page.row, page.column) for page in pages] == [
        ("F01", 1, 1),
        ("F02", 1, 2),
        ("F03", 2, 1),
        ("F04", 2, 2),
    ]


def test_export_reports_basemap_failure(client, db_session, monkeypatch) -> None:
    class BrokenRenderer(BlankRenderer):
        def render(self, bounds, width_px, height_px):
            raise ReviewMapRenderError("tiles indisponíveis")

    headers = auth_header(client, db_session)
    add_review_points(db_session)
    monkeypatch.setenv("MAPTILER_API_KEY", "test-key")
    monkeypatch.setenv("REVIEW_MAP_DPI", "72")
    get_settings.cache_clear()
    monkeypatch.setattr(admin_review_maps, "MapTilerRenderer", BrokenRenderer)

    response = client.post("/api/v1/admin/review-map/export", json={}, headers=headers)

    assert response.status_code == 502
    assert "tiles indisponíveis" in response.json()["detail"]


def test_snapshot_preserves_outliers_and_invalid_points_in_appendices(db_session) -> None:
    points = [
        Point(title_pt="Lisboa", lat=38.71, lng=-9.14, review_code="P0001"),
        Point(title_pt="Porto", lat=41.15, lng=-8.61, review_code="P0002"),
        Point(title_pt="Inválido", lat=999, lng=-9.1, review_code="P0003"),
    ]
    snapshot = build_snapshot(
        points,
        center_lat=38.7223,
        center_lng=-9.1393,
        outlier_radius_km=30,
        generated_at=datetime(2026, 8, 31, 12, tzinfo=UTC),
    )

    assert [point.code for point in snapshot.main_points] == ["P0001"]
    assert [point.code for point in snapshot.outside_points] == ["P0002"]
    assert [point.code for point in snapshot.invalid_points] == ["P0003"]
    assert len(snapshot.warnings) == 2
    workbook = build_review_workbook(snapshot)
    assert workbook.startswith(b"PK")


def test_snapshot_with_only_invalid_points_still_exports_review_material() -> None:
    snapshot = build_snapshot(
        [Point(title_pt="Inválido", lat=999, lng=-9.1, review_code="P0001")],
        center_lat=38.7223,
        center_lng=-9.1393,
        outlier_radius_km=30,
    )

    assert snapshot.main_points == ()
    assert [point.code for point in snapshot.invalid_points] == ["P0001"]
    overview = PdfReader(io.BytesIO(build_overview_pdf(snapshot, BlankRenderer(), 72)))
    assert "P0001" in " ".join(page.extract_text() or "" for page in overview.pages)


def test_sector_grid_has_expected_overlap() -> None:
    sectors = split_sectors(GeoBounds(west=-9.2, south=38.68, east=-9.08, north=38.78))

    assert sectors[0].code == "A1"
    assert sectors[0].bounds.east > sectors[1].bounds.west
    assert sectors[0].bounds.south < sectors[2].bounds.north


def test_appendix_pages_keep_outlier_and_invalid_codes() -> None:
    snapshot = build_snapshot(
        [
            Point(title_pt="Lisboa", lat=38.71, lng=-9.14, review_code="P0001"),
            Point(title_pt="Porto", lat=41.15, lng=-8.61, review_code="P0002"),
            Point(title_pt="Inválido", lat=999, lng=-9.1, review_code="P0003"),
        ],
        center_lat=38.7223,
        center_lng=-9.1393,
        outlier_radius_km=30,
    )

    overview = PdfReader(io.BytesIO(build_overview_pdf(snapshot, BlankRenderer(), 72)))
    atlas = PdfReader(io.BytesIO(build_atlas_pdf(snapshot, BlankRenderer(), 72)))
    overview_text = " ".join(page.extract_text() or "" for page in overview.pages)
    atlas_text = " ".join(page.extract_text() or "" for page in atlas.pages)

    assert len(overview.pages) == 3
    assert len(atlas.pages) == 7
    for code in ("P0001", "P0002", "P0003"):
        assert code in overview_text
        assert code in atlas_text


def test_maptiler_renderer_composes_and_caches_raster_tiles(monkeypatch) -> None:
    calls = []
    image_buffer = io.BytesIO()
    Image.new("RGB", (512, 512), "#dbe4dc").save(image_buffer, format="PNG")

    class Response:
        content = image_buffer.getvalue()

        def raise_for_status(self):
            return None

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def get(self, url, params):
            calls.append((url, params))
            return Response()

    monkeypatch.setattr("app.services.review_maps.httpx.Client", Client)
    renderer = MapTilerRenderer("key", "streets-v2")

    image = renderer.render(GeoBounds(-9.2, 38.68, -9.08, 38.78), 150, 120)
    first_call_count = len(calls)
    cached_image = renderer.render(GeoBounds(-9.2, 38.68, -9.08, 38.78), 150, 120)

    assert image.size == (150, 120)
    assert cached_image.size == (150, 120)
    assert first_call_count > 0
    assert len(calls) == first_call_count
    assert all("/256/" in call[0] and "@2x.png" in call[0] for call in calls)
    assert all(call[1] == {"key": "key"} for call in calls)


def test_maptiler_renderer_wraps_http_errors(monkeypatch) -> None:
    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def get(self, url, params):
            raise httpx.ConnectError("offline")

    monkeypatch.setattr("app.services.review_maps.httpx.Client", Client)

    try:
        MapTilerRenderer("key", "streets-v2").render(GeoBounds(-9.2, 38.68, -9.08, 38.78), 100, 100)
    except ReviewMapRenderError as exc:
        assert "ConnectError" in str(exc)
    else:
        raise AssertionError("expected ReviewMapRenderError")
