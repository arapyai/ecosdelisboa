import {
  ApiClient,
  type PublicAuthorSummary,
  type PublicDefaultVoice,
  type PublicPointDetail,
  type PublicPointSummary,
  type PublicRoute
} from '@ecosdelisboa/shared';
import type { Author, DefaultVoice, Lang, Point, Route } from '../types';
import { mockAuthors, mockPoints, mockRoutes, mockVoice } from './mock';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const client = new ApiClient(API_BASE);

export interface PointQuery {
  lat?: number;
  lng?: number;
  radius?: number;
  lang?: Lang;
  author_id?: string;
}

function toQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function withMockFallback<T>(call: () => Promise<T>, fallback: T): Promise<{ data: T; isMock: boolean }> {
  try {
    return { data: await call(), isMock: false };
  } catch {
    return { data: fallback, isMock: true };
  }
}

function normalizeAuthor(author: PublicAuthorSummary | Author): Author {
  const backendAuthor = author as PublicAuthorSummary;
  return {
    ...author,
    points_count: (author as Author).points_count ?? backendAuthor.point_count
  };
}

function normalizePoint(point: Point | PublicPointSummary | PublicPointDetail, lang?: Lang): Point {
  const backendPoint = point as PublicPointDetail;
  const texts = backendPoint.texts?.map((text) => ({
    id: text.id,
    point_id: point.id,
    content_pt: 'content_pt' in text ? text.content_pt : '',
    content_en: lang === 'en' && 'content' in text ? text.content : undefined,
    source_work: text.source_work,
    source_year: text.source_year,
    content_type: text.content_type
  }));

  const audios = backendPoint.texts?.flatMap((text) =>
    text.audio_files?.map((audio) => ({
      id: audio.id,
      lang: audio.lang,
      url: audio.public_url ?? '',
      duration_sec: audio.duration_s ?? undefined
    })) ?? []
  );

  return {
    ...point,
    texts: texts ?? (point as Point).texts,
    audios: audios?.length ? audios : (point as Point).audios
  };
}

function normalizeRoute(route: PublicRoute | Route): Route {
  const backendRoute = route as PublicRoute;
  return {
    ...route,
    distance_m: (route as Route).distance_m ?? backendRoute.estimated_distance_m,
    duration_min:
      (route as Route).duration_min ?? (backendRoute.estimated_duration_s ? Math.round(backendRoute.estimated_duration_s / 60) : undefined),
    published: (route as Route).published ?? backendRoute.is_published,
    points:
      (route as Route).points ??
      backendRoute.items?.map((item) => ({
        id: item.id,
        route_id: backendRoute.id,
        point_id: item.point?.id,
        point: item.point
          ? {
              id: item.point.id,
              author_id: '',
              title_pt: item.point.title_pt,
              lat: item.point.lat,
              lng: item.point.lng
            }
          : undefined,
        lat_override: item.waypoint?.lat,
        lng_override: item.waypoint?.lng,
        order_index: item.position,
        transition_text_pt: item.transition_text_pt
      }))
  };
}

function normalizeVoice(voice: PublicDefaultVoice | DefaultVoice): DefaultVoice {
  const backendVoice = voice as PublicDefaultVoice;
  return {
    voice_id: (voice as DefaultVoice).voice_id ?? backendVoice.elevenlabs_id,
    provider: (voice as DefaultVoice).provider ?? 'elevenlabs'
  };
}

export const api = {
  getPoints(params: PointQuery) {
    const fallback = params.author_id ? mockPoints.filter((point) => point.author_id === params.author_id) : mockPoints;
    return withMockFallback(
      () =>
        client.get<PublicPointSummary[]>(
          `/api/v1/points${toQuery({
            lat: params.lat,
            lng: params.lng,
            radius: params.radius,
            lang: params.lang,
            author_id: params.author_id
          })}`
        ).then((points) => points.map((point) => normalizePoint(point, params.lang))),
      fallback
    );
  },
  getPoint(id: string, lang?: Lang) {
    return withMockFallback(
      () => client.get<PublicPointDetail>(`/api/v1/points/${id}${toQuery({ lang })}`).then((point) => normalizePoint(point, lang)),
      mockPoints.find((point) => point.id === id) ?? mockPoints[0]
    );
  },
  getAuthors() {
    return withMockFallback(() => client.get<PublicAuthorSummary[]>('/api/v1/authors').then((authors) => authors.map(normalizeAuthor)), mockAuthors);
  },
  getAuthor(id: string) {
    return withMockFallback(
      () => client.get<PublicAuthorSummary>(`/api/v1/authors/${id}`).then(normalizeAuthor),
      mockAuthors.find((author) => author.id === id) ?? mockAuthors[0]
    );
  },
  getRoutes() {
    return withMockFallback(() => client.get<PublicRoute[]>('/api/v1/routes').then((routes) => routes.map(normalizeRoute)), mockRoutes);
  },
  getRoute(id: string) {
    return withMockFallback(
      () => client.get<PublicRoute>(`/api/v1/routes/${id}`).then(normalizeRoute),
      mockRoutes.find((route) => route.id === id) ?? mockRoutes[0]
    );
  },
  getRouteGpxUrl(id: string) {
    return `${API_BASE}/api/v1/routes/${id}/gpx`;
  },
  getRoutePodcastUrl(id: string) {
    return `${API_BASE}/api/v1/routes/${id}/podcast.rss`;
  },
  getDefaultVoice() {
    return withMockFallback(() => client.get<PublicDefaultVoice>('/api/v1/voices/default').then(normalizeVoice), mockVoice);
  }
};
