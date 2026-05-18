import type { Lang } from '../types';

export const languages: { code: Lang; label: string; native: string }[] = [
  { code: 'pt', label: 'PT', native: 'Portugues' },
  { code: 'en', label: 'EN', native: 'English' },
  { code: 'es', label: 'ES', native: 'Espanol' },
  { code: 'fr', label: 'FR', native: 'Francais' },
  { code: 'de', label: 'DE', native: 'Deutsch' },
  { code: 'zh', label: 'ZH', native: '中文' }
];

export const messages = {
  pt: {
    tagline: 'A Cidade Escrita em Voz Alta.',
    chooseLanguage: 'Escolha o idioma',
    start: 'Entrar',
    map: 'Mapa',
    routes: 'Percursos',
    authors: 'Autores',
    nearby: 'Pontos proximos',
    filters: 'Filtros',
    allAuthors: 'Todos os autores',
    radius: 'Raio',
    listen: 'Ouvir',
    transcript: 'Transcricao',
    source: 'Fonte',
    offlineReady: 'Cache offline preparado para este bairro',
    routeList: 'Percursos publicados',
    guidedMode: 'Modo guiado',
    gpx: 'GPX',
    podcast: 'Podcast',
    authorProfile: 'Perfil do autor',
    points: 'pontos',
    empty: 'Ainda não há conteudo para estes filtros.',
    mockData: 'A mostrar dados de exemplo até a API responder.',
    apiOffline: 'API indisponível',
    currentVoice: 'Voz padrão',
    duration: 'min',
    distance: 'km'
  },
  en: {
    tagline: 'The City Written Aloud.',
    chooseLanguage: 'Choose language',
    start: 'Enter',
    map: 'Map',
    routes: 'Routes',
    authors: 'Authors',
    nearby: 'Nearby points',
    filters: 'Filters',
    allAuthors: 'All authors',
    radius: 'Radius',
    listen: 'Listen',
    transcript: 'Transcript',
    source: 'Source',
    offlineReady: 'Offline cache prepared for this neighborhood',
    routeList: 'Published routes',
    guidedMode: 'Guided mode',
    gpx: 'GPX',
    podcast: 'Podcast',
    authorProfile: 'Author profile',
    points: 'points',
    empty: 'No content for these filters yet.',
    mockData: 'Showing sample data until the API responds.',
    apiOffline: 'API unavailable',
    currentVoice: 'Default voice',
    duration: 'min',
    distance: 'km'
  }
} satisfies Partial<Record<Lang, Record<string, string>>>;

export function t(lang: Lang, key: keyof typeof messages.pt) {
  return messages[lang as 'pt' | 'en']?.[key] ?? messages.pt[key];
}

export function localized<T extends object>(item: T, field: string, lang: Lang) {
  const values = item as Record<string, unknown>;
  return (values[`${field}_${lang}`] as string | null | undefined) || (values[`${field}_pt`] as string | undefined) || '';
}
