import type { AdminAudioFile, AdminText, AdminTranslation } from '@ecosdelisboa/shared';

export type TextListContext = {
  authorName: string;
  pointName: string;
};

export type TextListFilters = {
  language: string;
  status: string;
  origin: string;
  audio: string;
  gap: string;
};

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function textMatchesSearch(text: AdminText, context: TextListContext, query: string) {
  const normalized = normalizeSearch(query);
  if (!normalized) return true;
  return [text.content_pt, text.source_work ?? '', context.authorName, context.pointName]
    .some((value) => normalizeSearch(value).includes(normalized));
}

export function highlightParts(value: string, query: string) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return [{ value, match: false }];
  const normalizedValue = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const start = normalizedValue.toLowerCase().indexOf(normalizedQuery);
  if (start < 0) return [{ value, match: false }];
  return [
    { value: value.slice(0, start), match: false },
    { value: value.slice(start, start + normalizedQuery.length), match: true },
    { value: value.slice(start + normalizedQuery.length), match: false }
  ].filter((part) => part.value);
}

export function matchesAdvancedFilters(
  text: AdminText,
  filters: TextListFilters,
  translations: AdminTranslation[],
  audios: AdminAudioFile[],
  sourceLanguage: string
) {
  const versions = translations.filter((item) => item.text_id === text.id);
  const audioVersions = audios.filter((item) => item.text_id === text.id);
  const hasLanguage = !filters.language || filters.language === sourceLanguage
    ? !filters.language || Boolean(text.content_pt.trim())
    : versions.some((item) => item.lang === filters.language);
  const hasStatus = !filters.status || versions.some((item) => item.status === filters.status);
  const hasOrigin = !filters.origin || text.origin === filters.origin || versions.some((item) => item.origin === filters.origin);
  const scopedAudio = filters.language
    ? audioVersions.filter((item) => item.lang === filters.language)
    : audioVersions;
  const hasAudio = !filters.audio
    || (filters.audio === 'missing' && scopedAudio.length === 0)
    || (filters.audio === 'manual' && scopedAudio.some((item) => item.manually_uploaded))
    || (filters.audio === 'automatic' && scopedAudio.some((item) => !item.manually_uploaded));
  const hasGap = !filters.gap
    || (filters.gap === 'missing-source-audio' && !audioVersions.some((item) => item.lang === sourceLanguage))
    || (filters.gap === 'missing-translation' && !versions.some((item) => item.lang === (filters.language || 'en')))
    || (filters.gap === 'pending-review' && versions.some((item) => item.status === 'pending'));
  return hasLanguage && hasStatus && hasOrigin && hasAudio && hasGap;
}
