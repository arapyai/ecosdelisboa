import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request

from app.core.config import get_settings
from app.services.http_client import open_url


@dataclass(frozen=True)
class GeocodingResult:
    lat: float
    lng: float


@dataclass
class GeocodingService:
    base_url: str | None = None
    api_key: str | None = None

    def geocode(
        self,
        *,
        address: str,
        neighborhood: str | None = None,
        city: str = "Lisboa",
        country: str = "Portugal",
    ) -> GeocodingResult:
        settings = get_settings()
        provider = settings.geocoding_provider or "nominatim"
        query = build_geocoding_query(
            address=address,
            neighborhood=neighborhood,
            city=city,
            country=country,
        )
        if provider == "mapbox":
            return self._geocode_mapbox(settings, query, country)
        return self._geocode_nominatim(settings, query)

    def _geocode_nominatim(
        self, settings, query: str,
    ) -> GeocodingResult:
        params: dict[str, str | int] = {"q": query, "format": "jsonv2", "limit": 1}
        api_key = self.api_key or settings.geocoding_api_key
        if api_key and settings.geocoding_api_key_query_param:
            params[settings.geocoding_api_key_query_param] = api_key

        headers = {"User-Agent": settings.geocoding_user_agent}
        if api_key and settings.geocoding_api_key_header:
            headers[settings.geocoding_api_key_header] = api_key

        request = Request(
            f"{(self.base_url or settings.geocoding_base_url)}?{urlencode(params)}",
            headers=headers,
        )
        payload = self._fetch(request, settings)
        return parse_nominatim_payload(payload, query)

    def _geocode_mapbox(
        self, settings, query: str, country: str,
    ) -> GeocodingResult:
        from urllib.parse import quote

        api_key = self.api_key or settings.geocoding_api_key or ""
        base = (self.base_url or settings.geocoding_base_url).rstrip("/")
        country_code = _country_to_iso(country) if country else None
        url = f"{base}/{quote(query)}.json?access_token={api_key}&limit=1"
        if country_code:
            url += f"&country={country_code}"
        request = Request(url)
        payload = self._fetch(request, settings)
        return parse_mapbox_payload(payload, query)

    def _fetch(self, request: Request, settings) -> object:
        try:
            with open_url(request, timeout=settings.geocoding_timeout_s) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            message = exc.read().decode("utf-8", "ignore")
            raise ValueError(f"geocoding request failed: {exc.code} {message}") from exc
        except URLError as exc:
            raise ValueError(f"geocoding request failed: {exc.reason}") from exc


def build_geocoding_query(
    *,
    address: str,
    neighborhood: str | None,
    city: str,
    country: str,
) -> str:
    return ", ".join(item for item in [address, neighborhood, city, country] if item)


def parse_nominatim_payload(payload: object, query: str) -> GeocodingResult:
    if not isinstance(payload, list) or not payload:
        raise ValueError(f"Address not found: {query}")

    first = payload[0]
    if not isinstance(first, dict) or "lat" not in first or "lon" not in first:
        raise ValueError("geocoding response is invalid")

    return GeocodingResult(lat=float(first["lat"]), lng=float(first["lon"]))


def parse_mapbox_payload(payload: object, query: str) -> GeocodingResult:
    if not isinstance(payload, dict):
        raise ValueError(f"Address not found: {query}")
    features = payload.get("features", [])
    if not features:
        raise ValueError(f"Address not found: {query}")

    first = features[0]
    center = first.get("center")
    if not isinstance(center, list) or len(center) < 2:
        raise ValueError("geocoding response is invalid")

    return GeocodingResult(lat=float(center[1]), lng=float(center[0]))


_COUNTRY_TO_ISO = {
    "portugal": "pt",
    "brasil": "br",
    "brazil": "br",
    "espanha": "es",
    "spain": "es",
    "frança": "fr",
    "france": "fr",
    "inglaterra": "gb",
    "england": "gb",
    "reino unido": "gb",
    "united kingdom": "gb",
    "eua": "us",
    "estados unidos": "us",
    "united states": "us",
}


def _country_to_iso(country: str) -> str | None:
    return _COUNTRY_TO_ISO.get(country.strip().lower())


def geocode_address(
    *,
    address: str,
    neighborhood: str | None = None,
    city: str = "Lisboa",
    country: str = "Portugal",
) -> GeocodingResult:
    return GeocodingService().geocode(
        address=address,
        neighborhood=neighborhood,
        city=city,
        country=country,
    )
