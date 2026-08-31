from __future__ import annotations

import io
import math
import zipfile
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

import httpx
import xlsxwriter
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import A0, A1, A2, A3, A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.models.entities import Point

ATTRIBUTION = "© MapTiler © OpenStreetMap contributors - https://www.openstreetmap.org/copyright"
PAPER_SIZES = {
    "A0": landscape(A0),
    "A1": landscape(A1),
    "A2": landscape(A2),
    "A3": landscape(A3),
    "A4": landscape(A4),
}


class ReviewMapError(RuntimeError):
    pass


class ReviewMapConfigurationError(ReviewMapError):
    pass


class ReviewMapRenderError(ReviewMapError):
    pass


@dataclass(frozen=True)
class GeoBounds:
    west: float
    south: float
    east: float
    north: float


@dataclass(frozen=True)
class ReviewPoint:
    id: str
    code: str
    title: str
    address: str
    neighborhood: str
    lat: float
    lng: float
    sectors: tuple[str, ...] = ()
    location_status: str = "main"


@dataclass(frozen=True)
class ReviewSector:
    code: str
    bounds: GeoBounds


@dataclass(frozen=True)
class ReviewMapSnapshot:
    generated_at: datetime
    points: tuple[ReviewPoint, ...]
    main_points: tuple[ReviewPoint, ...]
    outside_points: tuple[ReviewPoint, ...]
    invalid_points: tuple[ReviewPoint, ...]
    bounds: GeoBounds
    sectors: tuple[ReviewSector, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class ReviewGridPage:
    number: int
    row: int
    column: int
    bounds: GeoBounds

    @property
    def code(self) -> str:
        return f"F{self.number:02d}"


@dataclass(frozen=True)
class ReviewGridLayout:
    paper_size: str
    page_size: tuple[float, float]
    columns: int
    rows: int
    bounds: GeoBounds
    pages: tuple[ReviewGridPage, ...]

    @property
    def sheet_count(self) -> int:
        return self.columns * self.rows


class BasemapRenderer(Protocol):
    def render(self, bounds: GeoBounds, width_px: int, height_px: int) -> Image.Image: ...


def _world_xy(lng: float, lat: float) -> tuple[float, float]:
    limited_lat = max(-85.05112878, min(85.05112878, lat))
    x = (lng + 180.0) / 360.0
    sine = math.sin(math.radians(limited_lat))
    y = 0.5 - math.log((1 + sine) / (1 - sine)) / (4 * math.pi)
    return x, y


def _lng_lat(x: float, y: float) -> tuple[float, float]:
    lng = x * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y))))
    return lng, lat


def _world_bounds(bounds: GeoBounds) -> tuple[float, float, float, float]:
    west_x, north_y = _world_xy(bounds.west, bounds.north)
    east_x, south_y = _world_xy(bounds.east, bounds.south)
    return west_x, north_y, east_x, south_y


def _geo_bounds(west_x: float, north_y: float, east_x: float, south_y: float) -> GeoBounds:
    west, north = _lng_lat(west_x, north_y)
    east, south = _lng_lat(east_x, south_y)
    return GeoBounds(west=west, south=south, east=east, north=north)


def _valid_coordinate(lat: float, lng: float) -> bool:
    return math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180


def _distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_m = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)
    value = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return radius_m * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def fit_bounds(points: tuple[ReviewPoint, ...], aspect: float = 1.5) -> GeoBounds:
    if not points:
        raise ReviewMapError("Nenhum ponto com coordenadas válidas para enquadrar.")
    projected = [_world_xy(point.lng, point.lat) for point in points]
    min_x = min(item[0] for item in projected)
    max_x = max(item[0] for item in projected)
    min_y = min(item[1] for item in projected)
    max_y = max(item[1] for item in projected)
    min_span = 0.018 / 360
    span_x = max(max_x - min_x, min_span)
    span_y = max(max_y - min_y, min_span)
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    if span_x / span_y < aspect:
        span_x = span_y * aspect
    else:
        span_y = span_x / aspect
    span_x *= 1.18
    span_y *= 1.18
    return _geo_bounds(
        center_x - span_x / 2,
        center_y - span_y / 2,
        center_x + span_x / 2,
        center_y + span_y / 2,
    )


def split_sectors(bounds: GeoBounds, overlap_ratio: float = 0.035) -> tuple[ReviewSector, ...]:
    west_x, north_y, east_x, south_y = _world_bounds(bounds)
    mid_x = (west_x + east_x) / 2
    mid_y = (north_y + south_y) / 2
    overlap_x = (east_x - west_x) * overlap_ratio
    overlap_y = (south_y - north_y) * overlap_ratio
    return (
        ReviewSector("A1", _geo_bounds(west_x, north_y, mid_x + overlap_x, mid_y + overlap_y)),
        ReviewSector("A2", _geo_bounds(mid_x - overlap_x, north_y, east_x, mid_y + overlap_y)),
        ReviewSector("A3", _geo_bounds(west_x, mid_y - overlap_y, mid_x + overlap_x, south_y)),
        ReviewSector("A4", _geo_bounds(mid_x - overlap_x, mid_y - overlap_y, east_x, south_y)),
    )


def split_grid(
    bounds: GeoBounds,
    columns: int,
    rows: int,
    overlap_ratio: float = 0.035,
) -> tuple[ReviewGridPage, ...]:
    if columns < 1 or rows < 1:
        raise ReviewMapError("A grade precisa ter ao menos uma coluna e uma linha.")
    west_x, north_y, east_x, south_y = _world_bounds(bounds)
    cell_width = (east_x - west_x) / columns
    cell_height = (south_y - north_y) / rows
    overlap_x = cell_width * overlap_ratio
    overlap_y = cell_height * overlap_ratio
    pages: list[ReviewGridPage] = []
    number = 1
    for row in range(rows):
        for column in range(columns):
            page_west = west_x + column * cell_width
            page_east = page_west + cell_width
            page_north = north_y + row * cell_height
            page_south = page_north + cell_height
            if column > 0:
                page_west -= overlap_x
            if column < columns - 1:
                page_east += overlap_x
            if row > 0:
                page_north -= overlap_y
            if row < rows - 1:
                page_south += overlap_y
            pages.append(
                ReviewGridPage(
                    number=number,
                    row=row + 1,
                    column=column + 1,
                    bounds=_geo_bounds(page_west, page_north, page_east, page_south),
                )
            )
            number += 1
    return tuple(pages)


def build_grid_layout(
    snapshot: ReviewMapSnapshot,
    *,
    paper_size: str,
    columns: int,
    rows: int,
    overlap_ratio: float = 0.035,
) -> ReviewGridLayout:
    normalized_size = paper_size.upper()
    try:
        page_size = PAPER_SIZES[normalized_size]
    except KeyError as exc:
        raise ReviewMapError(f"Formato de papel inválido: {paper_size}.") from exc
    total_aspect = page_size[0] * columns / (page_size[1] * rows)
    bounds = (
        fit_bounds(snapshot.main_points, aspect=total_aspect)
        if snapshot.main_points
        else snapshot.bounds
    )
    return ReviewGridLayout(
        paper_size=normalized_size,
        page_size=page_size,
        columns=columns,
        rows=rows,
        bounds=bounds,
        pages=split_grid(bounds, columns, rows, overlap_ratio),
    )


def _contains(bounds: GeoBounds, point: ReviewPoint) -> bool:
    return bounds.west <= point.lng <= bounds.east and bounds.south <= point.lat <= bounds.north


def build_snapshot(
    points: list[Point],
    *,
    center_lat: float,
    center_lng: float,
    outlier_radius_km: float,
    generated_at: datetime | None = None,
) -> ReviewMapSnapshot:
    if not points:
        raise ReviewMapError("Nenhum ponto cadastrado para exportação.")
    if any(not point.review_code for point in points):
        raise ReviewMapError("Existem pontos sem código de revisão. Execute a migration pendente.")

    base = tuple(
        ReviewPoint(
            id=str(point.id),
            code=point.review_code or "",
            title=point.title_pt,
            address=point.address or "",
            neighborhood=point.neighborhood or "",
            lat=point.lat,
            lng=point.lng,
        )
        for point in sorted(points, key=lambda item: item.review_code or "")
    )
    valid = tuple(point for point in base if _valid_coordinate(point.lat, point.lng))
    invalid = tuple(point for point in base if not _valid_coordinate(point.lat, point.lng))
    radius_m = outlier_radius_km * 1000
    main = tuple(
        point
        for point in valid
        if _distance_m(center_lat, center_lng, point.lat, point.lng) <= radius_m
    )
    if not main:
        main = valid
    outside = tuple(point for point in valid if point not in main)
    if main:
        bounds = fit_bounds(main)
    else:
        center_point = ReviewPoint(
            id="map-center",
            code="CENTER",
            title="Centro do mapa",
            address="",
            neighborhood="",
            lat=center_lat,
            lng=center_lng,
        )
        bounds = fit_bounds((center_point,))
    sectors = split_sectors(bounds)

    finalized: list[ReviewPoint] = []
    for point in base:
        if point in invalid:
            finalized.append(ReviewPoint(**{**point.__dict__, "location_status": "invalid"}))
            continue
        if point in outside:
            finalized.append(ReviewPoint(**{**point.__dict__, "location_status": "outside"}))
            continue
        codes = tuple(sector.code for sector in sectors if _contains(sector.bounds, point))
        finalized.append(ReviewPoint(**{**point.__dict__, "sectors": codes}))

    by_code = {point.code: point for point in finalized}
    warnings = []
    if outside:
        warnings.append(
            f"{len(outside)} ponto(s) fora do raio principal de {outlier_radius_km:g} km."
        )
    if invalid:
        warnings.append(f"{len(invalid)} ponto(s) com coordenadas inválidas.")
    return ReviewMapSnapshot(
        generated_at=generated_at or datetime.now().astimezone(),
        points=tuple(finalized),
        main_points=tuple(by_code[point.code] for point in main),
        outside_points=tuple(by_code[point.code] for point in outside),
        invalid_points=tuple(by_code[point.code] for point in invalid),
        bounds=bounds,
        sectors=sectors,
        warnings=tuple(warnings),
    )


class MapTilerRenderer:
    tile_size = 512
    max_zoom = 22

    def __init__(self, api_key: str, style_id: str, timeout_s: float = 30.0):
        if not api_key:
            raise ReviewMapConfigurationError("MAPTILER_API_KEY não está configurada.")
        self.api_key = api_key
        self.style_id = style_id
        self.timeout_s = timeout_s
        self._tile_cache: dict[tuple[int, int, int], Image.Image] = {}

    def render(self, bounds: GeoBounds, width_px: int, height_px: int) -> Image.Image:
        west_x, north_y, east_x, south_y = _world_bounds(bounds)
        span_x = east_x - west_x
        span_y = south_y - north_y
        zoom = min(
            self.max_zoom,
            max(
                0,
                math.ceil(
                    max(
                        math.log2(width_px / (span_x * self.tile_size)),
                        math.log2(height_px / (span_y * self.tile_size)),
                    )
                ),
            ),
        )
        world_size = self.tile_size * 2**zoom
        left_px = west_x * world_size
        top_px = north_y * world_size
        right_px = east_x * world_size
        bottom_px = south_y * world_size
        first_column = math.floor(left_px / self.tile_size)
        last_column = math.ceil(right_px / self.tile_size) - 1
        first_row = math.floor(top_px / self.tile_size)
        last_row = math.ceil(bottom_px / self.tile_size) - 1
        tile_columns = last_column - first_column + 1
        tile_rows = last_row - first_row + 1
        mosaic = Image.new(
            "RGB",
            (tile_columns * self.tile_size, tile_rows * self.tile_size),
            "#f4f1e9",
        )
        try:
            with httpx.Client(timeout=self.timeout_s) as client:
                for row in range(first_row, last_row + 1):
                    for column in range(first_column, last_column + 1):
                        cache_key = (zoom, column, row)
                        image = self._tile_cache.get(cache_key)
                        if image is None:
                            url = (
                                f"https://api.maptiler.com/maps/{self.style_id}/256/"
                                f"{zoom}/{column}/{row}@2x.png"
                            )
                            response = client.get(url, params={"key": self.api_key})
                            response.raise_for_status()
                            image = Image.open(io.BytesIO(response.content)).convert("RGB")
                            if image.size != (self.tile_size, self.tile_size):
                                image = image.resize(
                                    (self.tile_size, self.tile_size), Image.Resampling.LANCZOS
                                )
                            self._tile_cache[cache_key] = image
                        mosaic.paste(
                            image,
                            (
                                (column - first_column) * self.tile_size,
                                (row - first_row) * self.tile_size,
                            ),
                        )
        except httpx.HTTPStatusError as exc:
            raise ReviewMapRenderError(
                f"Falha ao obter o mapa-base (HTTP {exc.response.status_code})."
            ) from exc
        except httpx.RequestError as exc:
            raise ReviewMapRenderError(
                f"Falha ao obter o mapa-base ({exc.__class__.__name__})."
            ) from exc
        except OSError as exc:
            raise ReviewMapRenderError(f"Falha ao processar o mapa-base: {exc}") from exc
        crop_box = (
            left_px - first_column * self.tile_size,
            top_px - first_row * self.tile_size,
            right_px - first_column * self.tile_size,
            bottom_px - first_row * self.tile_size,
        )
        return mosaic.resize(
            (width_px, height_px),
            Image.Resampling.LANCZOS,
            box=crop_box,
        )


def _project_to_rect(
    point: ReviewPoint,
    bounds: GeoBounds,
    x: float,
    y: float,
    width: float,
    height: float,
) -> tuple[float, float]:
    west_x, north_y, east_x, south_y = _world_bounds(bounds)
    point_x, point_y = _world_xy(point.lng, point.lat)
    px = x + (point_x - west_x) / (east_x - west_x) * width
    py = y + height - (point_y - north_y) / (south_y - north_y) * height
    return px, py


def _draw_markers(
    document: canvas.Canvas,
    points: tuple[ReviewPoint, ...],
    bounds: GeoBounds,
    rect: tuple[float, float, float, float],
) -> None:
    x, y, width, height = rect
    occupied: list[tuple[float, float, float, float]] = []
    offsets = [(0.0, 0.0)]
    for radius in range(22, 292, 18):
        steps = max(12, round(2 * math.pi * radius / 18))
        offsets.extend(
            (
                math.cos(angle * 2 * math.pi / steps) * radius,
                math.sin(angle * 2 * math.pi / steps) * radius,
            )
            for angle in range(steps)
        )
    for point in points:
        if not _contains(bounds, point):
            continue
        anchor_x, anchor_y = _project_to_rect(point, bounds, x, y, width, height)
        label_width = 36
        label_height = 16
        label_x = anchor_x - label_width / 2
        label_y = anchor_y - label_height / 2
        for offset_x, offset_y in offsets:
            candidate_x = min(
                max(anchor_x + offset_x - label_width / 2, x + 1), x + width - label_width - 1
            )
            candidate_y = min(
                max(anchor_y + offset_y - label_height / 2, y + 1), y + height - label_height - 1
            )
            candidate = (
                candidate_x,
                candidate_y,
                candidate_x + label_width,
                candidate_y + label_height,
            )
            if not any(
                candidate[0] < used[2] + 2
                and candidate[2] + 2 > used[0]
                and candidate[1] < used[3] + 2
                and candidate[3] + 2 > used[1]
                for used in occupied
            ):
                label_x, label_y = candidate_x, candidate_y
                break
        occupied.append((label_x, label_y, label_x + label_width, label_y + label_height))
        document.setStrokeColor(colors.HexColor("#7c321f"))
        document.setLineWidth(0.7)
        if (
            abs(label_x + label_width / 2 - anchor_x) > 2
            or abs(label_y + label_height / 2 - anchor_y) > 2
        ):
            document.line(anchor_x, anchor_y, label_x + label_width / 2, label_y + label_height / 2)
        document.setFillColor(colors.HexColor("#c45732"))
        document.circle(anchor_x, anchor_y, 2.2, stroke=0, fill=1)
        document.setFillColor(colors.HexColor("#9d3f25"))
        document.roundRect(label_x, label_y, label_width, label_height, 4, stroke=0, fill=1)
        document.setFillColor(colors.white)
        document.setFont("Helvetica-Bold", 8)
        document.drawCentredString(label_x + label_width / 2, label_y + 4.5, point.code)


def _draw_scale(
    document: canvas.Canvas, bounds: GeoBounds, x: float, y: float, width: float
) -> None:
    center_lat = (bounds.south + bounds.north) / 2
    map_distance = _distance_m(center_lat, bounds.west, center_lat, bounds.east)
    choices = (100, 250, 500, 1000, 2000, 5000, 10000)
    target = map_distance * 0.16
    scale_m = min(choices, key=lambda value: abs(value - target))
    scale_width = width * scale_m / map_distance
    document.setStrokeColor(colors.HexColor("#303632"))
    document.setLineWidth(1.3)
    document.line(x, y, x + scale_width, y)
    document.line(x, y - 2, x, y + 2)
    document.line(x + scale_width, y - 2, x + scale_width, y + 2)
    document.setFillColor(colors.HexColor("#303632"))
    document.setFont("Helvetica", 6.5)
    label = f"{scale_m / 1000:g} km" if scale_m >= 1000 else f"{scale_m} m"
    document.drawString(x, y + 3, label)


def _draw_map_page(
    document: canvas.Canvas,
    page_size: tuple[float, float],
    title: str,
    points: tuple[ReviewPoint, ...],
    bounds: GeoBounds,
    renderer: BasemapRenderer,
    dpi: int,
    generated_at: datetime,
) -> None:
    page_width, page_height = page_size
    margin = 11 * mm
    header_height = 14 * mm
    footer_height = 8 * mm
    map_x = margin
    map_y = margin + footer_height
    map_width = page_width - 2 * margin
    map_height = page_height - 2 * margin - header_height - footer_height
    width_px = max(512, round(map_width / 72 * dpi))
    height_px = max(512, round(map_height / 72 * dpi))
    base = renderer.render(bounds, width_px, height_px)
    document.drawImage(
        ImageReader(base), map_x, map_y, map_width, map_height, preserveAspectRatio=False
    )
    document.setStrokeColor(colors.HexColor("#6d746e"))
    document.setLineWidth(0.6)
    document.rect(map_x, map_y, map_width, map_height, stroke=1, fill=0)
    _draw_markers(document, points, bounds, (map_x, map_y, map_width, map_height))
    _draw_scale(document, bounds, map_x + 9, map_y + 10, map_width)
    document.setFillColor(colors.HexColor("#202622"))
    document.setFont("Helvetica-Bold", 16)
    document.drawString(margin, page_height - margin - 10, title)
    document.setFont("Helvetica", 7.5)
    document.drawRightString(
        page_width - margin,
        page_height - margin - 9,
        f"Gerado em {generated_at:%d/%m/%Y %H:%M}",
    )
    document.setFont("Helvetica-Bold", 8)
    document.drawString(page_width - margin - 12, map_y + map_height - 17, "N")
    document.line(
        page_width - margin - 9,
        map_y + map_height - 28,
        page_width - margin - 9,
        map_y + map_height - 13,
    )
    document.line(
        page_width - margin - 9,
        map_y + map_height - 13,
        page_width - margin - 12,
        map_y + map_height - 18,
    )
    document.line(
        page_width - margin - 9,
        map_y + map_height - 13,
        page_width - margin - 6,
        map_y + map_height - 18,
    )
    document.setFillColor(colors.HexColor("#4c534e"))
    document.setFont("Helvetica", 6.2)
    document.drawString(margin, margin - 1, ATTRIBUTION)
    document.drawRightString(page_width - margin, margin - 1, f"{len(points)} ponto(s) nesta vista")
    document.showPage()


def _draw_exception_page(
    document: canvas.Canvas,
    page_size: tuple[float, float],
    snapshot: ReviewMapSnapshot,
    renderer: BasemapRenderer,
    dpi: int,
) -> None:
    page_width, page_height = page_size
    if snapshot.outside_points:
        outside_bounds = fit_bounds(snapshot.outside_points)
        _draw_map_page(
            document,
            page_size,
            "Pontos fora da área principal",
            snapshot.outside_points,
            outside_bounds,
            renderer,
            dpi,
            snapshot.generated_at,
        )
    if snapshot.invalid_points:
        margin = 16 * mm
        document.setFillColor(colors.HexColor("#202622"))
        document.setFont("Helvetica-Bold", 16)
        document.drawString(margin, page_height - margin, "Pontos com coordenadas inválidas")
        document.setFont("Helvetica", 9)
        y = page_height - margin - 24
        for point in snapshot.invalid_points:
            document.drawString(
                margin, y, f"{point.code} - {point.title}: {point.lat}, {point.lng}"
            )
            y -= 14
        document.setFont("Helvetica", 6.2)
        document.drawString(margin, margin, ATTRIBUTION)
        document.showPage()


def build_overview_pdf(snapshot: ReviewMapSnapshot, renderer: BasemapRenderer, dpi: int) -> bytes:
    output = io.BytesIO()
    page_size = landscape(A2)
    document = canvas.Canvas(output, pagesize=page_size, pageCompression=1)
    _draw_map_page(
        document,
        page_size,
        "Lisboa por Outros - mapa geral de revisão",
        snapshot.main_points,
        snapshot.bounds,
        renderer,
        dpi,
        snapshot.generated_at,
    )
    _draw_exception_page(document, page_size, snapshot, renderer, dpi)
    document.save()
    return output.getvalue()


def build_atlas_pdf(snapshot: ReviewMapSnapshot, renderer: BasemapRenderer, dpi: int) -> bytes:
    output = io.BytesIO()
    page_size = landscape(A4)
    document = canvas.Canvas(output, pagesize=page_size, pageCompression=1)
    _draw_map_page(
        document,
        page_size,
        "Lisboa por Outros - visão geral do atlas",
        snapshot.main_points,
        snapshot.bounds,
        renderer,
        dpi,
        snapshot.generated_at,
    )
    for sector in snapshot.sectors:
        sector_points = tuple(
            point for point in snapshot.main_points if _contains(sector.bounds, point)
        )
        _draw_map_page(
            document,
            page_size,
            f"Setor {sector.code}",
            sector_points,
            sector.bounds,
            renderer,
            dpi,
            snapshot.generated_at,
        )
    _draw_exception_page(document, page_size, snapshot, renderer, dpi)
    document.save()
    return output.getvalue()


def effective_raster_dpi(
    page_size: tuple[float, float], requested_dpi: int, max_dimension_px: int = 7000
) -> int:
    longest_side = max(page_size)
    return max(72, min(requested_dpi, math.floor(max_dimension_px * 72 / longest_side)))


def build_grid_pdf(
    snapshot: ReviewMapSnapshot,
    layout: ReviewGridLayout,
    renderer: BasemapRenderer,
    dpi: int,
) -> bytes:
    output = io.BytesIO()
    render_dpi = effective_raster_dpi(layout.page_size, dpi)
    document = canvas.Canvas(output, pagesize=layout.page_size, pageCompression=1)
    for page in layout.pages:
        page_points = tuple(
            point for point in snapshot.main_points if _contains(page.bounds, point)
        )
        _draw_map_page(
            document,
            layout.page_size,
            (
                f"Lisboa por Outros - {page.code} de {layout.sheet_count} - "
                f"{layout.paper_size} - linha {page.row}, coluna {page.column}"
            ),
            page_points,
            page.bounds,
            renderer,
            render_dpi,
            snapshot.generated_at,
        )
    _draw_exception_page(document, layout.page_size, snapshot, renderer, render_dpi)
    document.save()
    return output.getvalue()


def build_review_workbook(
    snapshot: ReviewMapSnapshot, layout: ReviewGridLayout | None = None
) -> bytes:
    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    sheet = workbook.add_worksheet("Pontos")
    title_format = workbook.add_format(
        {
            "bold": True,
            "font_size": 16,
            "font_color": "#FFFFFF",
            "bg_color": "#9D3F25",
            "align": "left",
            "valign": "vcenter",
        }
    )
    metadata_format = workbook.add_format({"font_color": "#5E655F", "italic": True})
    header_format = workbook.add_format(
        {
            "bold": True,
            "font_color": "#FFFFFF",
            "bg_color": "#303632",
            "border": 1,
            "align": "center",
            "valign": "vcenter",
            "text_wrap": True,
        }
    )
    text_format = workbook.add_format({"border": 1, "valign": "top", "text_wrap": True})
    code_format = workbook.add_format(
        {"border": 1, "bold": True, "font_color": "#9D3F25", "align": "center"}
    )
    coordinate_format = workbook.add_format({"border": 1, "num_format": "0.000000"})
    date_format = workbook.add_format({"border": 1, "num_format": "yyyy-mm-dd"})
    sheet.merge_range("A1:L1", "Lisboa por Outros - revisão dos pontos", title_format)
    sheet.merge_range(
        "A2:L2", f"Snapshot gerado em {snapshot.generated_at:%d/%m/%Y %H:%M}", metadata_format
    )
    headers = [
        "Código",
        "Ponto",
        "Endereço",
        "Bairro",
        "Latitude",
        "Longitude",
        "Página / setor",
        "Situação",
        "Correção sugerida",
        "Observações",
        "Revisor",
        "Data",
    ]
    for column, value in enumerate(headers):
        sheet.write(3, column, value, header_format)
    for index, point in enumerate(snapshot.points, start=4):
        if point.location_status == "invalid":
            pages = "Coordenada inválida"
        elif point.location_status == "outside":
            pages = "Fora da área principal"
        elif layout is not None:
            page_codes = [page.code for page in layout.pages if _contains(page.bounds, point)]
            pages = ", ".join(page_codes) if page_codes else "Área principal sem folha"
        else:
            pages = "A2 geral; Atlas geral" + (
                f"; {', '.join(point.sectors)}" if point.sectors else ""
            )
        values = [point.code, point.title, point.address, point.neighborhood]
        for column, value in enumerate(values):
            sheet.write(index, column, value, code_format if column == 0 else text_format)
        if _valid_coordinate(point.lat, point.lng):
            sheet.write_number(index, 4, point.lat, coordinate_format)
            sheet.write_number(index, 5, point.lng, coordinate_format)
        else:
            sheet.write(index, 4, str(point.lat), text_format)
            sheet.write(index, 5, str(point.lng), text_format)
        sheet.write(index, 6, pages, text_format)
        for column in range(7, 11):
            sheet.write_blank(index, column, None, text_format)
        sheet.write_blank(index, 11, None, date_format)
    last_row = max(4, len(snapshot.points) + 3)
    sheet.data_validation(
        4,
        7,
        last_row,
        7,
        {
            "validate": "list",
            "source": ["Correto", "Ajustar", "Remover", "Revisar"],
            "input_title": "Situação",
            "input_message": "Selecione o resultado da conferência.",
        },
    )
    status_colors = {
        "Correto": "#D9EAD3",
        "Ajustar": "#FCE5CD",
        "Remover": "#F4CCCC",
        "Revisar": "#FFF2CC",
    }
    for status, color in status_colors.items():
        sheet.conditional_format(
            4,
            7,
            last_row,
            7,
            {
                "type": "text",
                "criteria": "containing",
                "value": status,
                "format": workbook.add_format({"bg_color": color}),
            },
        )
    sheet.autofilter(3, 0, last_row, len(headers) - 1)
    sheet.freeze_panes(4, 1)
    sheet.set_row(0, 26)
    sheet.set_row(3, 32)
    sheet.set_column("A:A", 11)
    sheet.set_column("B:B", 28)
    sheet.set_column("C:C", 34)
    sheet.set_column("D:D", 20)
    sheet.set_column("E:F", 13)
    sheet.set_column("G:G", 26)
    sheet.set_column("H:H", 14)
    sheet.set_column("I:J", 30)
    sheet.set_column("K:K", 20)
    sheet.set_column("L:L", 12)
    sheet.set_landscape()
    sheet.fit_to_pages(1, 0)
    sheet.set_margins(0.25, 0.25, 0.5, 0.5)
    workbook.close()
    return output.getvalue()


def build_review_zip(
    snapshot: ReviewMapSnapshot,
    renderer: BasemapRenderer,
    dpi: int,
    *,
    include_a2: bool,
    include_a4_atlas: bool,
) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if include_a2:
            archive.writestr("mapa-geral-A2.pdf", build_overview_pdf(snapshot, renderer, dpi))
        if include_a4_atlas:
            archive.writestr("atlas-revisao-A4.pdf", build_atlas_pdf(snapshot, renderer, dpi))
        archive.writestr("pontos-revisao.xlsx", build_review_workbook(snapshot))
    return output.getvalue()


def build_custom_review_zip(
    snapshot: ReviewMapSnapshot,
    layout: ReviewGridLayout,
    renderer: BasemapRenderer,
    dpi: int,
) -> bytes:
    output = io.BytesIO()
    map_name = f"mapa-revisao-{layout.paper_size}-{layout.columns}x{layout.rows}.pdf"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(map_name, build_grid_pdf(snapshot, layout, renderer, dpi))
        archive.writestr("pontos-revisao.xlsx", build_review_workbook(snapshot, layout))
    return output.getvalue()
