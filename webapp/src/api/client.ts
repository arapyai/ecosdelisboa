import {
  ApiClient,
  type PublicAudioFile,
  type PublicAuthorSummary,
  type PublicDefaultVoice,
  type PublicPointDetail,
  type PublicPointSummary,
  type PublicRoute,
  type PublicRouteSegment
} from '@ecosdelisboa/shared';
import type { Author, DefaultVoice, Lang, Point, Route } from '../types';
import { listOfflineRoutes, readOfflineRoute } from '../routeOffline';
import { normalizeRouteAssets } from '../routeAssets';
import { mockAuthors, mockPoints, mockRoutes, mockVoice } from './mock';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const ENABLE_MOCKS = import.meta.env.VITE_ENABLE_MOCKS === 'true' || import.meta.env.STORYBOOK === 'true';
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

function toAssetUrl(url?: string | null) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE}${url}`;
}

function normalizeAudio(audio: PublicAudioFile) {
  return {
    id: audio.id,
    lang: audio.lang,
    url: toAssetUrl(audio.public_url),
    duration_sec: audio.duration_s ?? undefined,
    voice_id: audio.voice_id
  };
}

async function withMockFallback<T>(call: () => Promise<T>, fallback: T): Promise<{ data: T; isMock: boolean }> {
  try {
    return { data: await call(), isMock: false };
  } catch (cause) {
    if (!ENABLE_MOCKS) throw cause;
    return { data: fallback, isMock: true };
  }
}

export function mocksEnabled() {
  return ENABLE_MOCKS;
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
  const texts = backendPoint.texts?.map((text) => {
    const sourceLang = text.source_lang ?? 'pt';
    const content = text.content ?? text.content_pt;
    const contentLang = text.content_lang ?? (content === text.content_pt ? sourceLang : lang ?? sourceLang);
    return {
      id: text.id,
      point_id: point.id,
      author_id: text.author_id ?? text.author?.id,
      author: text.author ? normalizeAuthor(text.author) : undefined,
      content,
      content_pt: text.content_pt,
      content_en: lang === 'en' ? content : undefined,
      content_lang: contentLang,
      source_lang: sourceLang,
      is_translation: text.is_translation ?? contentLang !== sourceLang,
      is_fallback: text.is_fallback ?? Boolean(lang && lang !== sourceLang && contentLang !== lang),
      source_work: text.source_work,
      source_year: text.source_year,
      content_type: text.content_type,
      audios: text.audio_files?.map(normalizeAudio).filter((audio) => audio.url) ?? []
    };
  });

  const audios = backendPoint.texts?.flatMap((text) =>
    text.audio_files?.map(normalizeAudio).filter((audio) => audio.url) ?? []
  );

  return {
    ...point,
    author: (point as Point).author ?? (backendPoint.author ? normalizeAuthor(backendPoint.author) : backendPoint.authors?.[0] ? normalizeAuthor(backendPoint.authors[0]) : undefined),
    texts: texts ?? (point as Point).texts,
    audios: audios?.length ? audios : (point as Point).audios
  };
}

function legacyMockRoute(route: Route, lang: Lang): PublicRoute {
  const segments: PublicRouteSegment[] = (route.points ?? []).map((item) => {
    const text = item.point?.texts?.[0];
    if (!item.point || !text || !text.author) {
      return {
        id: item.id,
        position: item.order_index,
        kind: 'legacy' as const,
        point: item.point,
        waypoint:
          item.lat_override != null && item.lng_override != null
            ? { lat: item.lat_override, lng: item.lng_override }
            : undefined
      };
    }
    return {
      id: item.id,
      position: item.order_index,
      kind: 'text' as const,
      text: {
        id: text.id,
        content: lang === 'en' ? text.content_en || text.content_pt : text.content_pt,
        content_pt: text.content_pt,
        content_type: text.content_type,
        source_work: text.source_work,
        source_year: text.source_year,
        author: text.author,
        point: item.point,
        audio_files: (text.audios ?? []).map((audio) => ({
          id: audio.id,
          lang: audio.lang,
          public_url: audio.url,
          duration_s: audio.duration_sec,
          voice_id: audio.voice_id
        }))
      }
    };
  });
  return {
    id: route.id,
    title_pt: route.title_pt,
    description_pt: route.description_pt,
    title: lang === 'en' ? route.title_en || route.title_pt : route.title_pt,
    description:
      lang === 'en' ? route.description_en || route.description_pt : route.description_pt,
    cover_image_url: route.cover_image_url,
    is_published: route.published,
    estimated_distance_m: route.distance_m,
    estimated_duration_s: route.duration_min ? route.duration_min * 60 : undefined,
    text_count: segments.filter((segment) => segment.kind === 'text').length,
    authors: [...new Set(segments.flatMap((segment) => (segment.kind === 'text' ? [segment.text.author.name] : [])))],
    segments,
    items: segments,
    legs: []
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
  async getRoutes(lang: Lang) {
    try {
      return { data: (await client.listRoutes(lang)).map((route) => normalizeRouteAssets(route, API_BASE)), isMock: false };
    } catch (cause) {
      const offline = await listOfflineRoutes(lang);
      if (offline.length) return { data: offline, isMock: false };
      if (!ENABLE_MOCKS) throw cause;
      return { data: mockRoutes.map((route) => legacyMockRoute(route, lang)), isMock: true };
    }
  },
  async getRoute(id: string, lang: Lang) {
    try {
      return { data: normalizeRouteAssets(await client.getRoute(id, lang), API_BASE), isMock: false };
    } catch (cause) {
      const offline = await readOfflineRoute(id, lang);
      if (offline) return { data: offline, isMock: false };
      if (!ENABLE_MOCKS) throw cause;
      return { data: legacyMockRoute(mockRoutes.find((route) => route.id === id) ?? mockRoutes[0], lang), isMock: true };
    }
  },
  calculateRouteApproach(id: string, location: { lat: number; lng: number }) {
    return client.calculateRouteApproach(id, location);
  },
  getRouteGpxUrl(id: string, lang: Lang) {
    return `${API_BASE}/api/v1/routes/${id}/gpx?lang=${encodeURIComponent(lang)}`;
  },
  getRoutePodcastUrl(id: string, lang: Lang) {
    return `${API_BASE}/api/v1/routes/${id}/podcast.rss?lang=${encodeURIComponent(lang)}`;
  },
  getDefaultVoice() {
    return withMockFallback(() => client.get<PublicDefaultVoice>('/api/v1/voices/default').then(normalizeVoice), mockVoice);
  }
};
