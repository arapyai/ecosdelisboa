import type {
  AdminAudioFile,
  AdminAuthor,
  AdminLanguage,
  AdminPoint,
  AdminText,
  AdminTranslation,
  AdminVoice,
  ContentGenerationBatch,
  GenerationPolicy
} from '@ecosdelisboa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { redirectIfAuthError } from '../adminApi';
import { autoSyncQueryOptions, client } from '../adminConfig';
import type { Draft } from '../adminTypes';
import { ResourceFields } from '../resources/ResourceFields';
import { draftFromItem, emptyDraft, serializeDraft } from '../resources/resourceModel';
import { TextVersionsEditor } from './TextVersionsEditor';
import {
  highlightParts,
  matchesAdvancedFilters,
  textMatchesSearch,
  type TextListFilters
} from './textListModel';

type DrawerMode = 'create' | 'edit' | 'bulk' | null;

const emptyFilters: TextListFilters = { language: '', status: '', origin: '', audio: '', gap: '' };

export function TextsPanel({
  token,
  onAuthExpired,
  importedTextIds,
  reviewBatchId,
  onImportedTextIdsConsumed
}: {
  token: string;
  onAuthExpired: () => void;
  importedTextIds?: string[];
  reviewBatchId?: string;
  onImportedTextIdsConsumed?: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<DrawerMode>(null);
  const [editing, setEditing] = useState<AdminText | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft('texts'));
  const [initialDraft, setInitialDraft] = useState<Draft>(emptyDraft('texts'));
  const [translationDirty, setTranslationDirty] = useState(false);
  const [activeLanguage, setActiveLanguage] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [filters, setFilters] = useState<TextListFilters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewQueue, setReviewQueue] = useState<Array<{ text_id: string; lang: string }>>([]);
  const [bulkSource, setBulkSource] = useState<'texts' | 'csv'>('texts');
  const [message, setMessage] = useState('');

  const textsQuery = useQuery({
    queryKey: ['admin-resource', 'texts', token],
    queryFn: () => client.get<AdminText[]>('/api/v1/admin/texts', token),
    ...autoSyncQueryOptions
  });
  const authorsQuery = useQuery({
    queryKey: ['admin-options', 'authors', token],
    queryFn: () => client.get<AdminAuthor[]>('/api/v1/admin/authors', token),
    ...autoSyncQueryOptions
  });
  const pointsQuery = useQuery({
    queryKey: ['admin-options', 'points', token],
    queryFn: () => client.get<AdminPoint[]>('/api/v1/admin/points', token),
    ...autoSyncQueryOptions
  });
  const languagesQuery = useQuery({
    queryKey: ['admin-languages', token],
    queryFn: () => client.get<AdminLanguage[]>('/api/v1/admin/languages?active=true', token),
    ...autoSyncQueryOptions
  });
  const translationsQuery = useQuery({
    queryKey: ['admin-translations', token],
    queryFn: () => client.get<AdminTranslation[]>('/api/v1/admin/translations', token),
    ...autoSyncQueryOptions
  });
  const audioQuery = useQuery({
    queryKey: ['admin-audio', token],
    queryFn: () => client.get<AdminAudioFile[]>('/api/v1/admin/audio', token),
    ...autoSyncQueryOptions
  });
  const voicesQuery = useQuery({
    queryKey: ['admin-voices', token],
    queryFn: () => client.get<AdminVoice[]>('/api/v1/admin/voices', token),
    ...autoSyncQueryOptions
  });
  const reviewBatchQuery = useQuery({
    queryKey: ['generation-batch', reviewBatchId, token],
    queryFn: () => client.get<ContentGenerationBatch>(`/api/v1/admin/automation/batches/${reviewBatchId}`, token),
    enabled: Boolean(reviewBatchId),
    refetchInterval: 2000
  });

  const texts = textsQuery.data ?? [];
  const authors = authorsQuery.data ?? [];
  const points = pointsQuery.data ?? [];
  const languages = languagesQuery.data ?? [];
  const translations = translationsQuery.data ?? [];
  const audios = audioQuery.data ?? [];
  const sourceLanguage = languages.find((item) => item.is_source)?.code ?? 'pt';
  const authorById = useMemo(() => new Map(authors.map((item) => [item.id, item.name])), [authors]);
  const pointById = useMemo(() => new Map(points.map((item) => [item.id, item.title_pt])), [points]);
  const translationsByText = useMemo(() => groupByText(translations), [translations]);
  const audiosByText = useMemo(() => groupByText(audios), [audios]);
  const filteredTexts = useMemo(
    () => texts.filter((text) => {
      const context = {
        authorName: authorById.get(text.author_id) ?? '',
        pointName: pointById.get(text.point_id) ?? ''
      };
      return textMatchesSearch(text, context, deferredSearch)
        && matchesAdvancedFilters(text, filters, translations, audios, sourceLanguage);
    }),
    [audios, authorById, deferredSearch, filters, pointById, sourceLanguage, texts, translations]
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft) || translationDirty;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const selectedVisible = filteredTexts.filter((item) => selected.has(item.id)).length;

  useEffect(() => {
    if (!importedTextIds?.length) return;
    setSelected(new Set(importedTextIds));
    setBulkSource('csv');
    setMode('bulk');
    onImportedTextIdsConsumed?.();
  }, [importedTextIds, onImportedTextIdsConsumed]);

  useEffect(() => {
    const pending = reviewBatchQuery.data?.pending_reviews ?? [];
    if (!pending.length) return;
    setReviewQueue(pending);
    openReview(pending[0]);
  }, [reviewBatchQuery.data?.id]);

  function confirmClose() {
    return !dirty || window.confirm('Descartar as alterações ainda não guardadas?');
  }

  function closeDrawer() {
    if (!confirmClose()) return;
    setMode(null);
    setEditing(null);
    setDraft(emptyDraft('texts'));
    setInitialDraft(emptyDraft('texts'));
    setTranslationDirty(false);
    setActiveLanguage(undefined);
  }

  function openCreate() {
    if (!confirmClose()) return;
    const nextDraft = emptyDraft('texts');
    setEditing(null);
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setMode('create');
    setActiveLanguage(sourceLanguage);
  }

  function openBulk() {
    if (!confirmClose()) return;
    setBulkSource('texts');
    setMode('bulk');
  }

  function openEdit(text: AdminText, language?: string) {
    if (!confirmClose()) return;
    const nextDraft = draftFromItem('texts', text);
    setEditing(text);
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setMode('edit');
    setActiveLanguage(language ?? sourceLanguage);
    setTranslationDirty(false);
  }

  function openReview(review: { text_id: string; lang: string }) {
    const text = texts.find((item) => item.id === review.text_id);
    if (text) openEdit(text, review.lang);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = serializeDraft('texts', draft);
      return editing
        ? client.put<AdminText>(`/api/v1/admin/texts/${editing.id}`, payload, token)
        : client.post<AdminText>('/api/v1/admin/texts', payload, token);
    },
    onSuccess: async (saved) => {
      setEditing(saved);
      const nextDraft = draftFromItem('texts', saved);
      setDraft(nextDraft);
      setInitialDraft(nextDraft);
      setMode('edit');
      setMessage('Texto guardado.');
      await queryClient.invalidateQueries({ queryKey: ['admin-resource', 'texts', token] });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage('Não foi possível guardar o texto.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (text: AdminText) => client.delete<{ deleted: boolean }>(`/api/v1/admin/texts/${text.id}`, token),
    onSuccess: async () => {
      setMode(null);
      setEditing(null);
      setDraft(emptyDraft('texts'));
      setInitialDraft(emptyDraft('texts'));
      setTranslationDirty(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-resource', 'texts', token] });
    },
    onError: (cause) => redirectIfAuthError(cause, onAuthExpired)
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  function toggleSelection(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (selectedVisible === filteredTexts.length) filteredTexts.forEach((item) => next.delete(item.id));
      else filteredTexts.forEach((item) => next.add(item.id));
      return next;
    });
  }

  function reviewed() {
    queryClient.invalidateQueries({ queryKey: ['admin-translations', token] });
    queryClient.invalidateQueries({ queryKey: ['generation-batch', reviewBatchId, token] });
    const next = reviewQueue.slice(1);
    setReviewQueue(next);
    if (next[0]) openReview(next[0]);
  }

  return (
    <section className={`content-panel text-workspace ${mode ? 'drawer-open' : ''}`}>
      <div className="text-list-pane">
        <header className="texts-heading">
          <div><h2>Textos</h2><p>{filteredTexts.length} de {texts.length} textos</p></div>
          <button type="button" onClick={openCreate}>＋ Novo texto</button>
        </header>

        <div className="text-search-toolbar">
          <label className="text-search-field">
            <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="m15.5 15.5 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={search}
              placeholder="Buscar por texto, autor, obra ou ponto…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button type="button" className="secondary-action more-filters" onClick={() => setFiltersOpen((value) => !value)}>
            Mais filtros {activeFilterCount ? <span>{activeFilterCount}</span> : null}
          </button>
        </div>

        {filtersOpen ? (
          <AdvancedFilters
            filters={filters}
            languages={languages}
            onChange={setFilters}
            onClear={() => setFilters(emptyFilters)}
          />
        ) : null}

        {selected.size ? (
          <div className="bulk-selection-bar">
            <span>{selected.size} texto{selected.size === 1 ? '' : 's'} selecionado{selected.size === 1 ? '' : 's'}</span>
            <button type="button" onClick={openBulk}>Gerar conteúdo</button>
            <button type="button" className="text-action" onClick={() => setSelected(new Set())}>Limpar seleção</button>
          </div>
        ) : null}

        {textsQuery.isError ? <p className="users-error">Não foi possível carregar os textos.</p> : null}
        <div className="table-wrap editorial-table-wrap" aria-busy={textsQuery.isLoading}>
          <table className="editorial-table">
            <thead><tr>
              <th><input aria-label="Selecionar resultados" type="checkbox" checked={Boolean(filteredTexts.length) && selectedVisible === filteredTexts.length} onChange={toggleAllVisible} /></th>
              <th>Texto</th><th>Ponto</th><th>Autor</th><th>Obra</th><th>Idiomas</th><th><span className="sr-only">Ações</span></th>
            </tr></thead>
            <tbody>
              {filteredTexts.map((text) => (
                <tr key={text.id} className={editing?.id === text.id ? 'selected-row' : ''}>
                  <td><input aria-label="Selecionar texto" type="checkbox" checked={selected.has(text.id)} onChange={() => toggleSelection(text.id)} /></td>
                  <td className="text-excerpt-cell" onClick={() => openEdit(text)}>
                    <strong><Highlighted value={firstLine(text.content_pt)} query={deferredSearch} /></strong>
                    <p><Highlighted value={text.content_pt} query={deferredSearch} /></p>
                  </td>
                  <td><Highlighted value={pointById.get(text.point_id) ?? '—'} query={deferredSearch} /></td>
                  <td><Highlighted value={authorById.get(text.author_id) ?? '—'} query={deferredSearch} /></td>
                  <td><Highlighted value={text.source_work ?? '—'} query={deferredSearch} /></td>
                  <td><LanguageMatrix
                    text={text}
                    languages={languages}
                    sourceLanguage={sourceLanguage}
                    translations={translationsByText.get(text.id) ?? []}
                    audios={audiosByText.get(text.id) ?? []}
                    onLanguage={(language) => openEdit(text, language)}
                  /></td>
                  <td><button type="button" className="text-action" onClick={() => openEdit(text)}>Editar</button></td>
                </tr>
              ))}
              {!textsQuery.isLoading && !filteredTexts.length ? <tr><td colSpan={7}>Nenhum texto corresponde à busca.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {mode === 'bulk' ? (
        <BulkGenerationDrawer
          token={token}
          textIds={[...selected]}
          languages={languages}
          voices={voicesQuery.data ?? []}
          batchSource={bulkSource}
          onClose={() => setMode(null)}
          onCreated={() => { setMode(null); setSelected(new Set()); }}
          onAuthExpired={onAuthExpired}
        />
      ) : null}

      {mode === 'create' || mode === 'edit' ? (
        <aside className="text-editor-drawer" aria-label={editing ? 'Editar texto' : 'Novo texto'}>
          <header className="text-editor-header">
            <div><h3>{editing ? 'Editar texto' : 'Novo texto'}</h3><span className={dirty ? 'unsaved' : 'saved'}>{dirty ? 'Alterações por guardar' : 'Guardado'}</span></div>
            <button type="button" className="close-editor" aria-label="Fechar" onClick={closeDrawer}>×</button>
          </header>
          <form onSubmit={submit}>
            <TextVersionsEditor
              baseDraft={draft}
              languages={languages}
              text={editing}
              token={token}
              translations={translations}
              audios={audios}
              voices={voicesQuery.data ?? []}
              audioLoading={audioQuery.isLoading}
              audioError={audioQuery.isError}
              initialLanguage={activeLanguage}
              onAuthExpired={onAuthExpired}
              onBaseDraft={setDraft}
              onTranslationsChanged={() => translationsQuery.refetch()}
              onAudiosChanged={() => audioQuery.refetch()}
              onDirtyChange={setTranslationDirty}
              onReviewed={reviewQueue.length ? reviewed : undefined}
              metadataFields={(
                <ResourceFields
                  resource="texts"
                  draft={draft}
                  context={{ authors, authorsReady: authorsQuery.isSuccess, points, pointsReady: pointsQuery.isSuccess }}
                  onDraft={setDraft}
                />
              )}
            />
            {message ? <p className="drawer-message" role="status">{message}</p> : null}
            <footer className="text-editor-footer">
              {editing ? <button type="button" className="danger-link" onClick={() => {
                if (window.confirm('Apagar este texto e suas versões?')) deleteMutation.mutate(editing);
              }}>Apagar texto</button> : <span />}
              <div><button type="button" className="secondary-action" onClick={closeDrawer}>Cancelar</button><button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? 'A guardar…' : 'Guardar alterações'}</button></div>
            </footer>
          </form>
        </aside>
      ) : null}
    </section>
  );
}

function AdvancedFilters({ filters, languages, onChange, onClear }: {
  filters: TextListFilters;
  languages: AdminLanguage[];
  onChange: (filters: TextListFilters) => void;
  onClear: () => void;
}) {
  return <div className="advanced-filters">
    <label>Idioma<select value={filters.language} onChange={(event) => onChange({ ...filters, language: event.target.value })}><option value="">Todos</option>{languages.map((item) => <option key={item.code} value={item.code}>{item.code.toUpperCase()} · {item.name}</option>)}</select></label>
    <label>Revisão<select value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value })}><option value="">Todas</option><option value="pending">Pendente</option><option value="approved">Aprovada</option><option value="rejected">Rejeitada</option></select></label>
    <label>Origem<select value={filters.origin} onChange={(event) => onChange({ ...filters, origin: event.target.value })}><option value="">Todas</option><option value="manual">Manual</option><option value="automatic">IA</option><option value="import">CSV</option></select></label>
    <label>Áudio<select value={filters.audio} onChange={(event) => onChange({ ...filters, audio: event.target.value })}><option value="">Todos</option><option value="missing">Ausente</option><option value="automatic">Gerado</option><option value="manual">Manual</option></select></label>
    <label>Pendência<select value={filters.gap} onChange={(event) => onChange({ ...filters, gap: event.target.value })}><option value="">Todas</option><option value="missing-source-audio">Sem áudio-fonte</option><option value="missing-translation">Sem tradução</option><option value="pending-review">Aguardando revisão</option></select></label>
    <button type="button" className="text-action" onClick={onClear}>Limpar filtros</button>
  </div>;
}

function LanguageMatrix({ text, languages, sourceLanguage, translations, audios, onLanguage }: {
  text: AdminText;
  languages: AdminLanguage[];
  sourceLanguage: string;
  translations: AdminTranslation[];
  audios: AdminAudioFile[];
  onLanguage: (language: string) => void;
}) {
  return <div className="language-matrix">{languages.map((language) => {
    const hasText = language.code === sourceLanguage ? Boolean(text.content_pt.trim()) : translations.some((item) => item.lang === language.code && item.content?.trim());
    const hasAudio = audios.some((item) => item.lang === language.code);
    const label = `${language.name}: ${hasText ? 'com texto' : 'sem texto'}, ${hasAudio ? 'com áudio' : 'sem áudio'}`;
    return <button key={language.code} type="button" className={hasText ? 'has-text' : 'missing-text'} title={label} aria-label={label} onClick={() => onLanguage(language.code)}>{language.code.toUpperCase()}{hasAudio ? <SpeakerIcon /> : null}</button>;
  })}</div>;
}

function BulkGenerationDrawer({ token, textIds, languages, voices, batchSource, onClose, onCreated, onAuthExpired }: {
  token: string;
  textIds: string[];
  languages: AdminLanguage[];
  voices: AdminVoice[];
  batchSource: 'texts' | 'csv';
  onClose: () => void;
  onCreated: () => void;
  onAuthExpired: () => void;
}) {
  const queryClient = useQueryClient();
  const sourceLanguage = languages.find((item) => item.is_source)?.code ?? 'pt';
  const initial = languages.some((item) => item.code === 'en' && !item.is_source) ? ['en'] : languages.filter((item) => !item.is_source).slice(0, 1).map((item) => item.code);
  const [enabledLanguages, setEnabledLanguages] = useState<Set<string>>(() => new Set([sourceLanguage, ...initial]));
  const [autoApproveTranslations, setAutoApproveTranslations] = useState(true);
  const [policy, setPolicy] = useState<GenerationPolicy>('missing_only');
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const generationLanguages = useMemo(
    () => [...languages].sort((first, second) => Number(second.is_source) - Number(first.is_source)),
    [languages]
  );
  const targetLanguages = generationLanguages.filter((language) => !language.is_source && enabledLanguages.has(language.code));
  const compatibleVoices = (language: string) => voices.filter((voice) => {
    const voiceLanguages = voice.languages?.length ? voice.languages : voice.lang ? [voice.lang] : [];
    return !voiceLanguages.length || voiceLanguages.includes(language as AdminLanguage['code']);
  });
  const defaultVoice = (language: string) => {
    const compatible = compatibleVoices(language);
    return compatible.find((voice) => voice.is_default) ?? compatible[0];
  };
  const selectedVoiceId = (language: string) => voiceOverrides[language] ?? defaultVoice(language)?.elevenlabs_id ?? '';
  const selectedVoice = (language: string) => voices.find((voice) => voice.elevenlabs_id === selectedVoiceId(language));
  const mutation = useMutation({
    mutationFn: () => client.post<ContentGenerationBatch>('/api/v1/admin/automation/batches', {
      text_ids: textIds,
      target_languages: targetLanguages.map((language) => language.code),
      audio_languages: targetLanguages.map((language) => language.code),
      generate_source_audio: enabledLanguages.has(sourceLanguage),
      generate_translated_audio: targetLanguages.length > 0,
      auto_approve_translations: autoApproveTranslations,
      voice_overrides: Object.fromEntries(generationLanguages.flatMap((language) => {
        if (!enabledLanguages.has(language.code)) return [];
        const voiceId = selectedVoiceId(language.code);
        return voiceId ? [[language.code, voiceId]] : [];
      })),
      policy,
      source: batchSource
    }, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['generation-batches', token] });
      onCreated();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a geração.');
    }
  });
  return <aside className="text-editor-drawer bulk-drawer" aria-label="Gerar conteúdo em lote">
    <header className="text-editor-header"><div><h3>Gerar conteúdo</h3><span>{textIds.length} texto{textIds.length === 1 ? '' : 's'} selecionado{textIds.length === 1 ? '' : 's'}</span></div><button type="button" className="close-editor" aria-label="Fechar" onClick={onClose}>×</button></header>
    <div className="bulk-drawer-body">
      <section><h4>Idiomas e vozes</h4>
        <p>Marque os idiomas que deseja gerar e escolha a voz de cada um.</p>
        <label className="bulk-check batch-auto-approve"><input type="checkbox" checked={autoApproveTranslations} onChange={(event) => setAutoApproveTranslations(event.target.checked)} /><span><strong>Aprovar traduções automaticamente</strong><small>{autoApproveTranslations ? 'O áudio será gerado assim que cada tradução ficar pronta.' : 'As traduções ficarão pendentes para revisão antes do áudio.'}</small></span></label>
        <div className="batch-voice-grid" aria-label="Geração e voz por idioma">
          {generationLanguages.map((language) => {
            const enabled = enabledLanguages.has(language.code);
            const availableVoices = compatibleVoices(language.code);
            const voice = selectedVoice(language.code);
            const voiceLanguages = voice?.languages?.length ? voice.languages : voice?.lang ? [voice.lang] : [];
            return <div className={`batch-voice-row${enabled ? ' enabled' : ''}`} key={language.code}>
              <label className="batch-language-toggle">
                <input type="checkbox" checked={enabled} onChange={() => setEnabledLanguages((current) => { const next = new Set(current); if (next.has(language.code)) next.delete(language.code); else next.add(language.code); return next; })} />
                <span><strong>{language.code.toUpperCase()} · {language.name}</strong><small>{language.is_source ? 'Gerar áudio original' : 'Gerar tradução e áudio'}</small></span>
              </label>
              <label className="batch-voice-select">
                <span>Voz</span>
                <select disabled={!enabled} value={selectedVoiceId(language.code)} onChange={(event) => setVoiceOverrides((current) => ({ ...current, [language.code]: event.target.value }))}>
                  {!availableVoices.length ? <option value="">Automática (regra do texto)</option> : null}
                  {availableVoices.map((item) => <option key={item.id} value={item.elevenlabs_id}>{item.name}{item.is_default ? ' · padrão' : ''}</option>)}
                </select>
              </label>
              <span className="voice-language-meta">{voiceLanguages.length ? `Idioma${voiceLanguages.length === 1 ? '' : 's'} da voz: ${voiceLanguages.map((code) => code.toUpperCase()).join(', ')}` : 'Voz sem restrição de idioma'}</span>
            </div>;
          })}
        </div>
      </section>
      <details className="advanced-disclosure"><summary>Opções avançadas</summary><label className="bulk-check"><input type="checkbox" checked={policy === 'replace_automatic'} onChange={(event) => setPolicy(event.target.checked ? 'replace_automatic' : 'missing_only')} />Regenerar conteúdo criado por IA</label><p>Conteúdo revisto manualmente e áudio enviado manualmente nunca serão substituídos.</p></details>
      {error ? <p className="form-error bulk-error" role="alert">{error}</p> : null}
    </div>
    <footer className="text-editor-footer"><span /><div><button type="button" className="secondary-action" onClick={onClose}>Cancelar</button><button type="button" disabled={mutation.isPending || !enabledLanguages.size} onClick={() => { setError(''); mutation.mutate(); }}>{mutation.isPending ? 'A iniciar…' : 'Iniciar geração'}</button></div></footer>
  </aside>;
}

function Highlighted({ value, query }: { value: string; query: string }) {
  return <>{highlightParts(value, query).map((part, index) => part.match ? <mark key={index}>{part.value}</mark> : <span key={index}>{part.value}</span>)}</>;
}

function SpeakerIcon() {
  return <svg className="speaker-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" /><path d="M16 8.2c1.2 1 1.8 2.2 1.8 3.8S17.2 14.8 16 15.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function firstLine(value: string) {
  const sentence = value.split(/[.!?\n]/)[0]?.trim();
  return sentence || value.slice(0, 56) || 'Texto sem conteúdo';
}

function groupByText<T extends { text_id: string }>(items: T[]) {
  const grouped = new Map<string, T[]>();
  items.forEach((item) => grouped.set(item.text_id, [...(grouped.get(item.text_id) ?? []), item]));
  return grouped;
}
