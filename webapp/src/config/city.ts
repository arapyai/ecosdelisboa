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

export const cityConfig: CityConfig = {
  appName: 'Lisboa por Outros',
  cityName: 'Lisboa',
  slug: 'lisboa',
  defaultLanguage: 'pt',
  map: {
    center: [-9.1393, 38.7223],
    zoom: 12.2,
    defaultRadius: 1500,
    styleUrl: import.meta.env.VITE_MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${import.meta.env.VITE_MAPTILER_KEY}`
      : 'https://demotiles.maplibre.org/style.json'
  },
  assets: {
    onboardingBackground: '/images/aayush-gupta-ljhCEaHYWJ8-unsplash.jpg'
  },
  api: {
    defaultLat: 38.7223,
    defaultLng: -9.1393
  },
  cache: {
    appShell: 'lisboa-por-outros-v1',
    neighborhoodPrefetch: 'lisboa-neighborhood-prefetch'
  }
};
