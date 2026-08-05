import { ApiClient } from '@ecosdelisboa/shared';
import { QueryClient } from '@tanstack/react-query';

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
export const ENABLE_MOCKS = import.meta.env.VITE_ENABLE_MOCKS === 'true' || import.meta.env.STORYBOOK === 'true';
export const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY ?? '';
export const ADMIN_MAP_STYLE_URL = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
  : 'https://demotiles.maplibre.org/style.json';
export const ADMIN_DEFAULT_LAT = Number(import.meta.env.VITE_CITY_DEFAULT_LAT ?? import.meta.env.VITE_MAP_CENTER_LAT ?? 38.7223);
export const ADMIN_DEFAULT_LNG = Number(import.meta.env.VITE_CITY_DEFAULT_LNG ?? import.meta.env.VITE_MAP_CENTER_LNG ?? -9.1393);
export const client = new ApiClient(API_BASE);
export const queryClient = new QueryClient();
export const TOKEN_KEY = 'ecosdelisboa.admin.token';
export const autoSyncQueryOptions = {
  refetchOnWindowFocus: true,
  refetchOnReconnect: true
};
