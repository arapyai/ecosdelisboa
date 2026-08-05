import type {
  AdminAudioFile,
  AdminAuthor,
  AdminLanguage,
  AdminPoint,
  AdminRoute,
  AdminText,
  AdminTranslation
} from '@ecosdelisboa/shared';
import type { Resource, ResourceItem } from './adminTypes';

export const mockAuthors: AdminAuthor[] = [
  { id: 'author-pessoa', name: 'Fernando Pessoa', bio_pt: 'Poeta', birth_year: 1888, death_year: 1935 },
  { id: 'author-saramago', name: 'Jose Saramago', bio_pt: 'Romancista', birth_year: 1922, death_year: 2010 }
];

export const mockPoints: AdminPoint[] = [
  {
    id: 'point-chiado',
    title_pt: 'Chiado',
    address: 'Largo do Chiado',
    neighborhood: 'Chiado',
    lat: 38.7107,
    lng: -9.1439
  },
  {
    id: 'point-alfama',
    title_pt: 'Alfama',
    address: 'Miradouro de Santa Luzia',
    neighborhood: 'Alfama',
    lat: 38.7117,
    lng: -9.1304
  }
];

export const mockTexts: AdminText[] = [
  {
    id: 'text-chiado',
    point_id: 'point-chiado',
    author_id: 'author-pessoa',
    content_pt: 'Aqui a cidade tem passos de escritório, café e fantasma.',
    source_work: 'Fragmento demonstrativo',
    source_year: 2026,
    content_type: 'prose',
    origin: 'manual'
  }
];

export const mockTranslations: AdminTranslation[] = [
  {
    id: 'translation-chiado-en',
    text_id: 'text-chiado',
    lang: 'en',
    content: 'Here the city has footsteps of office, cafe and ghost.',
    phonetic_content: null,
    status: 'approved',
    auto_translated: false,
    origin: 'manual',
    reviewed_by: 'admin@example.com',
    reviewed_at: null
  }
];

export const mockAudioFiles: AdminAudioFile[] = [];

export const mockRoutes: AdminRoute[] = [
  {
    id: 'route-baixa',
    title_pt: 'Baixa Literaria',
    description_pt: 'Percurso pelo centro',
    is_published: true,
    estimated_distance_m: 1800,
    estimated_duration_s: 3300,
    items: [{ position: 1, point_id: 'point-chiado' }]
  }
];

export const fallbackLanguages: AdminLanguage[] = [
  { code: 'pt', locale: 'pt-PT', country_code: 'PT', name: 'Portuguese', is_active: true, is_source: true },
  { code: 'en', locale: 'en-US', country_code: 'US', name: 'English', is_active: true, is_source: false },
  { code: 'es', locale: 'es-ES', country_code: 'ES', name: 'Spanish', is_active: true, is_source: false },
  { code: 'fr', locale: 'fr-FR', country_code: 'FR', name: 'French', is_active: true, is_source: false },
  { code: 'de', locale: 'de-DE', country_code: 'DE', name: 'German', is_active: true, is_source: false },
  { code: 'zh', locale: 'zh-CN', country_code: 'CN', name: 'Chinese', is_active: true, is_source: false }
];

export function fallbackFor(resource: Resource): ResourceItem[] {
  if (resource === 'authors') return mockAuthors;
  if (resource === 'points') return mockPoints;
  if (resource === 'texts') return mockTexts;
  return mockRoutes;
}
