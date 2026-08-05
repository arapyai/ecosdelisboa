import type { Lang } from '../types';

export interface CityConfig {
  appName: string;
  cityName: string;
  slug: string;
  defaultLanguage: Lang;
  map: {
    center: [number, number];
    zoom: number;
    defaultRadius: number;
    styleUrl: string;
  };
  assets: {
    onboardingBackground: string;
  };
  api: {
    defaultLat: number;
    defaultLng: number;
  };
  cache: {
    appShell: string;
    neighborhoodPrefetch: string;
  };
}

const fallbackCity = {
  appName: 'Lisbon Literary Map',
  cityName: 'Lisboa',
  slug: 'lisboa',
  defaultLanguage: 'pt' as Lang,
  lat: 38.7223,
  lng: -9.1393,
  zoom: 12.2,
  radius: 1500,
  onboardingBackground: '/images/aayush-gupta-ljhCEaHYWJ8-unsplash.jpg'
};

function envString(name: string, fallback: string) {
  const value = import.meta.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function envNumber(name: string, fallback: number) {
  const value = Number(import.meta.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const appName = envString('VITE_APP_NAME', fallbackCity.appName);
const cityName = envString('VITE_CITY_NAME', fallbackCity.cityName);
const citySlug = envString('VITE_CITY_SLUG', fallbackCity.slug);
const defaultLat = envNumber('VITE_CITY_DEFAULT_LAT', fallbackCity.lat);
const defaultLng = envNumber('VITE_CITY_DEFAULT_LNG', fallbackCity.lng);
const mapCenterLat = envNumber('VITE_MAP_CENTER_LAT', defaultLat);
const mapCenterLng = envNumber('VITE_MAP_CENTER_LNG', defaultLng);
const mapZoom = envNumber('VITE_MAP_ZOOM', fallbackCity.zoom);
const defaultRadius = envNumber('VITE_MAP_DEFAULT_RADIUS', fallbackCity.radius);
const onboardingBackground = envString(
  'VITE_ONBOARDING_BACKGROUND',
  fallbackCity.onboardingBackground
);
const mapStyleUrl = import.meta.env.VITE_MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`
  : 'https://demotiles.maplibre.org/style.json';

export const cityConfig: CityConfig = {
  appName,
  cityName,
  slug: citySlug,
  defaultLanguage: envString('VITE_DEFAULT_LANGUAGE', fallbackCity.defaultLanguage) as Lang,
  map: {
    center: [mapCenterLng, mapCenterLat],
    zoom: mapZoom,
    defaultRadius,
    styleUrl: mapStyleUrl
  },
  assets: {
    onboardingBackground
  },
  api: {
    defaultLat,
    defaultLng
  },
  cache: {
    appShell: `${citySlug}-app-shell-v1`,
    neighborhoodPrefetch: `${citySlug}-neighborhood-prefetch`
  }
};
