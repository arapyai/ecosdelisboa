import type {
  AdminAudioFile,
  AdminLanguage,
  AdminText,
  AdminTranslation,
  TextOrigin,
  TranslationStatus
} from '@ecosdelisboa/shared';
import type { Resource, ResourceItem } from '../adminTypes';

const translationStatusOptions: Array<{ value: TranslationStatus; label: string }> = [
  { value: 'pending', label: 'Pendente' },
  { value: 'approved', label: 'Aprovada' },
  { value: 'rejected', label: 'Rejeitada' }
];

const originOptions: Array<{ value: TextOrigin; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'automatic', label: 'Automático' },
  { value: 'import', label: 'CSV/importação' }
];

function languageLabel(language: AdminLanguage) {
  return `${language.code.toUpperCase()} · ${language.name}${language.is_source ? ' · fonte' : ''}`;
}

export function TextFilters({
  search,
  language,
  status,
  origin,
  audio,
  gap,
  languages,
  onSearch,
  onLanguage,
  onStatus,
  onOrigin,
  onAudio,
  onGap
}: {
  search: string;
  language: string;
  status: string;
  origin: string;
  audio: string;
  gap: string;
  languages: AdminLanguage[];
  onSearch: (value: string) => void;
  onLanguage: (value: string) => void;
  onStatus: (value: string) => void;
  onOrigin: (value: string) => void;
  onAudio: (value: string) => void;
  onGap: (value: string) => void;
}) {
  return (
    <section className="filter-panel">
      <label>
        Filtrar conteúdo
        <input value={search} onChange={(event) => onSearch(event.target.value)} type="search" />
      </label>
      <label>
        Idioma
        <select value={language} onChange={(event) => onLanguage(event.target.value)}>
          <option value="">Todos</option>
          {languages.map((item) => (
            <option key={item.code} value={item.code}>{languageLabel(item)}</option>
          ))}
        </select>
      </label>
      <label>
        Estado
        <select value={status} onChange={(event) => onStatus(event.target.value)}>
          <option value="">Todos</option>
          {translationStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        Origem
        <select value={origin} onChange={(event) => onOrigin(event.target.value)}>
          <option value="">Todas</option>
          {originOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label>
        Áudio
        <select value={audio} onChange={(event) => onAudio(event.target.value)}>
          <option value="">Todos</option>
          <option value="missing">Sem áudio</option>
          <option value="automatic">Gerado automaticamente</option>
          <option value="manual">Enviado manualmente</option>
        </select>
      </label>
      <label>
        Lacunas PT/EN
        <select value={gap} onChange={(event) => onGap(event.target.value)}>
          <option value="">Todas</option>
          <option value="missing-text-pt">Sem texto PT</option>
          <option value="missing-audio-pt">Sem áudio PT</option>
          <option value="missing-text-en">Sem tradução EN</option>
          <option value="missing-audio-en">Sem áudio EN</option>
        </select>
      </label>
    </section>
  );
}


export function filterResourceItems(
  resource: Resource,
  items: ResourceItem[],
  filters: {
    textSearch: string;
    textLanguage: string;
    textStatus: string;
    textOrigin: string;
    textAudio: string;
    textGap: string;
    translations: AdminTranslation[];
    audios: AdminAudioFile[];
    sourceLanguage: string;
  }
) {
  if (resource !== 'texts') return items;
  const normalizedSearch = filters.textSearch.trim().toLowerCase();
  return items.filter((item) => {
    const text = item as AdminText;
    const textTranslations = filters.translations.filter((translation) => translation.text_id === text.id);
    const textAudios = filters.audios.filter((audio) => audio.text_id === text.id);
    const sourceOrigin = text.origin ?? 'manual';
    const matchesSearch = !normalizedSearch || text.content_pt.toLowerCase().includes(normalizedSearch);
    const matchesLanguage = matchesTextLanguage(text, textTranslations, filters.textLanguage, filters.sourceLanguage);
    const matchesStatus = !filters.textStatus || textTranslations.some((translation) => translation.status === filters.textStatus);
    const matchesOrigin =
      !filters.textOrigin ||
      sourceOrigin === filters.textOrigin ||
      textTranslations.some((translation) => translation.origin === filters.textOrigin);
    const matchesAudio = matchesAudioFilter(textAudios, filters.textLanguage, filters.textAudio);
    const matchesGap = matchesGapFilter(text, textTranslations, textAudios, filters.textGap, filters.sourceLanguage);
    return matchesSearch && matchesLanguage && matchesStatus && matchesOrigin && matchesAudio && matchesGap;
  });
}

function matchesTextLanguage(
  text: AdminText,
  translations: AdminTranslation[],
  language: string,
  sourceLanguage: string
) {
  if (!language) return true;
  if (language === sourceLanguage) return Boolean(text.content_pt.trim());
  return translations.some((translation) => translation.lang === language);
}

function matchesAudioFilter(audios: AdminAudioFile[], language: string, audioFilter: string) {
  if (!audioFilter) return true;
  const scopedAudios = language ? audios.filter((audio) => audio.lang === language) : audios;
  if (audioFilter === 'missing') return scopedAudios.length === 0;
  if (audioFilter === 'manual') return scopedAudios.some((audio) => audio.manually_uploaded);
  if (audioFilter === 'automatic') return scopedAudios.some((audio) => !audio.manually_uploaded);
  return true;
}

function matchesGapFilter(
  text: AdminText,
  translations: AdminTranslation[],
  audios: AdminAudioFile[],
  gap: string,
  sourceLanguage: string
) {
  if (!gap) return true;
  if (gap === 'missing-text-pt') return !text.content_pt.trim();
  if (gap === 'missing-audio-pt') return !audios.some((audio) => audio.lang === 'pt');
  if (gap === 'missing-text-en') {
    return sourceLanguage === 'en'
      ? !text.content_pt.trim()
      : !translations.some((translation) => translation.lang === 'en');
  }
  if (gap === 'missing-audio-en') return !audios.some((audio) => audio.lang === 'en');
  return true;
}


