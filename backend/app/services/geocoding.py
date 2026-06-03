import json
from dataclasses import dataclass
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import get_settings


@dataclass(frozen=True)
class GeocodingResult:
    lat: float
    lng: float


def build_geocoding_query(
    *,
    address: str,
    neighborhood: str | None,
    city: str,
    country: str,
) -> str:
    return ", ".join(item for item in [address, neighborhood, city, country] if item)


def geocode_address(
    *,
    address: str,
    neighborhood: str | None = None,
    city: str = "Lisboa",
    country: str = "Portugal",
) -> GeocodingResult:
    settings = get_settings()
    query = build_geocoding_query(
        address=address,
        neighborhood=neighborhood,
        city=city,
        country=country,
    )
    params = urlencode({"q": query, "format": "jsonv2", "limit": 1})
    request = Request(
        f"{settings.geocoding_base_url}?{params}",
        headers={"User-Agent": settings.geocoding_user_agent},
    )
    with urlopen(request, timeout=settings.geocoding_timeout_s) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if not payload:
        raise ValueError(f"Address not found: {query}")

    first = payload[0]
    return GeocodingResult(lat=float(first["lat"]), lng=float(first["lon"]))
