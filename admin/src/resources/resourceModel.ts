import type { AdminAudioFile, AdminRouteItem, AdminText, AdminTranslation } from '@ecosdelisboa/shared';
import { ADMIN_DEFAULT_LAT, ADMIN_DEFAULT_LNG } from '../adminConfig';
import type { Draft, DraftValue, Resource, ResourceItem } from '../adminTypes';

export function emptyDraft(resource: Resource): Draft {
  if (resource === 'authors') {
    return { name: '', bio_pt: '', birth_year: '', death_year: '', photo_url: '', elevenlabs_voice_id: '' };
  }
  if (resource === 'points') {
    return {
      title_pt: '',
      address: '',
      neighborhood: '',
      lat: ADMIN_DEFAULT_LAT,
      lng: ADMIN_DEFAULT_LNG
    };
  }
  if (resource === 'texts') {
    return {
      point_id: '',
      author_id: '',
      content_pt: '',
      phonetic_content: '',
      source_work: '',
      source_year: '',
      content_type: 'prose'
    };
  }
  return {
    title_pt: '',
    description_pt: '',
    cover_image_url: '',
    difficulty: 'easy',
    is_published: false,
    estimated_distance_m: '',
    estimated_duration_s: '',
    items: []
  };
}


export function columnsFor(resource: Resource) {
  if (resource === 'authors') return ['name', 'bio_pt', 'birth_year'];
  if (resource === 'points') return ['title_pt', 'neighborhood', 'lat', 'lng'];
  if (resource === 'texts') return ['content_pt', 'origin', 'author_id', 'source_work', 'content_type', 'pt', 'en'];
  return ['title_pt', 'is_published', 'estimated_distance_m', 'estimated_duration_s'];
}


export function formatCell(
  item: ResourceItem,
  column: string,
  context?: { translations: AdminTranslation[]; audios: AdminAudioFile[]; sourceLanguage: string }
) {
  if ((column === 'pt' || column === 'en') && context) {
    return textLanguageSummary(item as AdminText, column, context);
  }
  const value = (item as unknown as Record<string, unknown>)[column];
  if (column === 'origin') return originLabel(String(value || 'manual'));
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (value === null || value === undefined || value === '') return '-';
  return String(value).slice(0, 100);
}


function textLanguageSummary(
  text: AdminText,
  lang: string,
  context: { translations: AdminTranslation[]; audios: AdminAudioFile[]; sourceLanguage: string }
) {
  const hasText =
    lang === context.sourceLanguage
      ? Boolean(text.content_pt.trim())
      : context.translations.some((translation) => translation.text_id === text.id && translation.lang === lang);
  const audio = context.audios.find((item) => item.text_id === text.id && item.lang === lang);
  const textLabel = hasText ? 'texto ok' : 'sem texto';
  const audioLabel = audio ? (audio.manually_uploaded ? 'áudio manual' : 'áudio IA') : 'sem áudio';
  return `${textLabel} · ${audioLabel}`;
}


function originLabel(origin: string) {
  if (origin === 'import') return 'CSV';
  if (origin === 'automatic') return 'Automático';
  return 'Manual';
}











export function draftFromItem(resource: Resource, item: ResourceItem): Draft {
  const draft = emptyDraft(resource);
  Object.keys(draft).forEach((key) => {
    const value = (item as unknown as Record<string, unknown>)[key];
    if (value !== undefined) draft[key] = key === 'items' ? routeItemsFromDraft(value) : (value as DraftValue);
  });
  return draft;
}


export function serializeDraft(resource: Resource, draft: Draft) {
  const clean = Object.fromEntries(
    Object.entries(draft).map(([key, value]) => {
      if (value === '') return [key, null];
      if (['birth_year', 'death_year', 'source_year', 'estimated_distance_m', 'estimated_duration_s', 'lat', 'lng'].includes(key)) {
        return [key, value === null ? null : Number(value)];
      }
      return [key, value];
    })
  );

  if (resource === 'routes') {
    return {
      ...clean,
      items: routeItemsFromDraft(draft.items)
        .map((item) => ({
          ...item,
          point_id: item.point_id || null,
          waypoint_lat: item.waypoint_lat ?? null,
          waypoint_lng: item.waypoint_lng ?? null,
          transition_text_pt: item.transition_text_pt || null
        }))
        .filter((item) => item.point_id || (item.waypoint_lat !== null && item.waypoint_lng !== null))
    };
  }

  return clean;
}


function routeItemsFromDraft(value: unknown): AdminRouteItem[] {
  return Array.isArray(value) ? (value as AdminRouteItem[]) : [];
}

