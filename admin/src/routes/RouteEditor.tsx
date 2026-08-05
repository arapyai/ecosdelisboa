import {
  ApiError,
  type AdminRoute,
  type AdminRouteSegment,
  type AdminText,
  type RouteReadiness
} from '@ecosdelisboa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { client } from '../adminConfig';
import { putMp3, redirectIfAuthError } from '../adminApi';
import {
  addBridgeSegment,
  addLegWaypoint,
  addTextSegment,
  draftFingerprint,
  emptyRouteDraft,
  filterAvailableTexts,
  normalizePositions,
  removeLegWaypoint,
  reorderSegments,
  routeDraftFromRoute,
  serializeRouteDraft,
  waypointDraftFromLegs,
  type RouteLegWaypointDraft,
  type RouteDraft
} from './routeEditorModel';
import { RouteMap } from './RouteMap';

const NEW_ROUTE_ID = 'new';

export function RouteEditor({
  token,
  onAuthExpired
}: {
  token: string;
  onAuthExpired: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<RouteDraft>(emptyRouteDraft);
  const [savedFingerprint, setSavedFingerprint] = useState(draftFingerprint(emptyRouteDraft()));
  const [search, setSearch] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const [selectedLegPosition, setSelectedLegPosition] = useState(0);
  const [legWaypoints, setLegWaypoints] = useState<RouteLegWaypointDraft[]>([]);
  const [addingWaypoint, setAddingWaypoint] = useState(false);
  const [previewLang, setPreviewLang] = useState<'pt' | 'en'>('pt');
  const [bridgeEnglish, setBridgeEnglish] = useState('');

  const routesQuery = useQuery({
    queryKey: ['narrative-routes', token],
    queryFn: () => client.listAdminRoutes(token)
  });
  const textsQuery = useQuery({
    queryKey: ['route-texts', token],
    queryFn: () => client.get<AdminText[]>('/api/v1/admin/texts', token)
  });
  const routes = routesQuery.data ?? [];
  const selectedRoute = routes.find((route) => route.id === selectedId);
  const dirty = draftFingerprint(draft) !== savedFingerprint;
  const availableTexts = useMemo(
    () => filterAvailableTexts(textsQuery.data ?? [], search, draft.segments),
    [draft.segments, search, textsQuery.data]
  );
  const textSegments = draft.segments.filter((segment) => segment.kind === 'text');
  const selectedSegment =
    draft.segments.find((segment) => segment.id === selectedSegmentId) ?? draft.segments[0];
  const selectedLegWaypoints =
    legWaypoints.find((leg) => leg.position === selectedLegPosition)?.waypoints ?? [];
  const canUseServerTools = Boolean(selectedId && selectedId !== NEW_ROUTE_ID && !dirty);
  const ptReadiness = useQuery({
    queryKey: ['route-readiness', selectedId, 'pt', token],
    queryFn: () => client.getRouteReadiness(selectedId!, 'pt', token),
    enabled: canUseServerTools
  });
  const enReadiness = useQuery({
    queryKey: ['route-readiness', selectedId, 'en', token],
    queryFn: () => client.getRouteReadiness(selectedId!, 'en', token),
    enabled: canUseServerTools
  });

  useEffect(() => {
    if (selectedId || !routes.length) return;
    setSelectedId(routes[0].id);
  }, [routes, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const baseline =
      selectedId === NEW_ROUTE_ID || !selectedRoute
        ? emptyRouteDraft()
        : routeDraftFromRoute(selectedRoute);
    const local = readLocalDraft(selectedId);
    const next = local ?? baseline;
    setDraft(next);
    setSavedFingerprint(draftFingerprint(baseline));
    setMessage(local ? 'Rascunho local restaurado.' : '');
    setSelectedSegmentId(next.segments[0]?.id);
  }, [selectedId, selectedRoute]);

  useEffect(() => {
    setLegWaypoints(waypointDraftFromLegs(selectedRoute?.legs));
  }, [selectedRoute?.legs]);

  useEffect(() => {
    setBridgeEnglish(
      selectedSegment?.kind === 'bridge'
        ? selectedSegment.translations?.find((translation) => translation.lang === 'en')?.content ?? ''
        : ''
    );
  }, [selectedSegment]);

  useEffect(() => {
    if (!selectedId) return;
    localStorage.setItem(storageKey(selectedId), JSON.stringify(draft));
  }, [draft, selectedId]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = serializeRouteDraft(draft);
      return selectedId === NEW_ROUTE_ID
        ? client.post<AdminRoute>('/api/v1/admin/routes', payload, token)
        : client.put<AdminRoute>(`/api/v1/admin/routes/${selectedId}`, payload, token);
    },
    onSuccess: (saved) => {
      localStorage.removeItem(storageKey(selectedId ?? NEW_ROUTE_ID));
      queryClient.setQueryData<AdminRoute[]>(['narrative-routes', token], (current = []) => {
        const exists = current.some((route) => route.id === saved.id);
        return exists
          ? current.map((route) => (route.id === saved.id ? saved : route))
          : [saved, ...current];
      });
      const next = routeDraftFromRoute(saved);
      setSelectedId(saved.id);
      setDraft(next);
      setSavedFingerprint(draftFingerprint(next));
      setMessage('Percurso guardado no servidor.');
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      if (cause instanceof ApiError && cause.status === 409) {
        setMessage('Ainda não pode publicar: consulte as pendências de PT/EN e da rota.');
        return;
      }
      setMessage('Não foi possível guardar o percurso. O rascunho continua neste dispositivo.');
    }
  });

  const recalculateMutation = useMutation({
    mutationFn: () => client.recalculateRoute(selectedId!, legWaypoints, token),
    onSuccess: (result) => {
      queryClient.setQueryData<AdminRoute[]>(['narrative-routes', token], (current = []) =>
        current.map((route) =>
          route.id === result.route_id
            ? {
                ...route,
                routing_status: result.routing_status,
                estimated_distance_m: result.estimated_distance_m,
                estimated_duration_s: result.estimated_duration_s,
                legs: result.legs
              }
            : route
        )
      );
      setLegWaypoints(waypointDraftFromLegs(result.legs));
      queryClient.invalidateQueries({ queryKey: ['route-readiness', selectedId] });
      setMessage('Rota pedonal recalculada e guardada.');
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage('O provedor de rotas falhou. A última geometria válida foi preservada.');
    }
  });

  const bridgeTranslationMutation = useMutation({
    mutationFn: () =>
      client.put<{ id: string; lang: string; content: string; status: 'approved' }>(
        `/api/v1/admin/routes/${selectedId}/segments/${selectedSegment?.id}/translations/en`,
        { content: bridgeEnglish, status: 'approved' },
        token
      ),
    onSuccess: (translation) => {
      updateSelectedSegment({
        translations: [
          ...(selectedSegment?.translations ?? []).filter((item) => item.lang !== 'en'),
          translation
        ]
      });
      queryClient.invalidateQueries({ queryKey: ['route-readiness', selectedId] });
      setMessage('Ponte EN revista e guardada.');
    }
  });

  const bridgeAudioMutation = useMutation({
    mutationFn: (lang: 'pt' | 'en') =>
      client.post<{ audio?: NonNullable<AdminRouteSegment['audio_files']>[number] | null }>(
        `/api/v1/admin/routes/${selectedId}/segments/${selectedSegment?.id}/audio/${lang}/generate`,
        {},
        token
      ),
    onSuccess: (result) => {
      if (result.audio) replaceSelectedBridgeAudio(result.audio);
      queryClient.invalidateQueries({ queryKey: ['route-readiness', selectedId] });
      setMessage(result.audio ? 'Áudio da ponte atualizado.' : 'A geração de áudio não foi concluída.');
    }
  });

  function selectRoute(routeId: string) {
    if (dirty && !window.confirm('Há alterações não guardadas. Trocar de percurso mesmo assim?')) return;
    setSelectedId(routeId);
    setSearch('');
    setMessage('');
  }

  function setSegments(segments: AdminRouteSegment[]) {
    setDraft((current) => ({ ...current, segments: normalizePositions(segments) }));
  }

  function updateSelectedSegment(patch: Partial<AdminRouteSegment>) {
    if (!selectedSegment?.id) return;
    const update = (segments: AdminRouteSegment[] = []) =>
      segments.map((segment) =>
        segment.id === selectedSegment.id ? ({ ...segment, ...patch } as AdminRouteSegment) : segment
      );
    setDraft((current) => ({ ...current, segments: update(current.segments) }));
    queryClient.setQueryData<AdminRoute[]>(['narrative-routes', token], (current = []) =>
      current.map((route) =>
        route.id === selectedId ? { ...route, segments: update(route.segments) } : route
      )
    );
  }

  function replaceSelectedBridgeAudio(
    audio: NonNullable<AdminRouteSegment['audio_files']>[number]
  ) {
    updateSelectedSegment({
      audio_files: [
        ...(selectedSegment?.audio_files ?? []).filter((item) => item.lang !== audio.lang),
        audio
      ]
    });
  }

  async function uploadBridgeAudio(lang: 'pt' | 'en', file?: File) {
    if (!file || !selectedId || !selectedSegment?.id) return;
    try {
      const audio = await putMp3<NonNullable<AdminRouteSegment['audio_files']>[number]>(
        `/api/v1/admin/routes/${selectedId}/segments/${selectedSegment.id}/audio/${lang}/upload`,
        file,
        token
      );
      replaceSelectedBridgeAudio(audio);
      queryClient.invalidateQueries({ queryKey: ['route-readiness', selectedId] });
      setMessage(`Áudio manual ${lang.toUpperCase()} guardado e protegido.`);
    } catch (cause) {
      if (!redirectIfAuthError(cause, onAuthExpired)) setMessage('Falha no upload do áudio da ponte.');
    }
  }

  if (routesQuery.isLoading || textsQuery.isLoading) {
    return <section className="route-loading">A preparar o editor narrativo…</section>;
  }

  if (routesQuery.isError || textsQuery.isError) {
    return (
      <section className="content-panel admin-state error-state">
        <p>Não foi possível carregar percursos e textos.</p>
        <button type="button" onClick={() => { routesQuery.refetch(); textsQuery.refetch(); }}>
          Tentar novamente
        </button>
      </section>
    );
  }

  return (
    <section className="route-editor-shell">
      <header className="route-editor-header">
        <div>
          <span className="eyebrow">Percursos narrativos</span>
          <h2>{draft.title_pt || 'Novo percurso'}</h2>
          <p>A narrativa ordena textos. O mapa apenas situa essa sequência em Lisboa.</p>
        </div>
        <div className="route-header-actions">
          <label className="route-publish-toggle">
            <input
              type="checkbox"
              checked={draft.is_published}
              onChange={(event) => setDraft({ ...draft, is_published: event.target.checked })}
            />
            Publicar
          </label>
          <button type="button" className="secondary-action" onClick={() => selectRoute(NEW_ROUTE_ID)}>
            Novo
          </button>
          <button
            type="button"
            disabled={saveMutation.isPending || !draft.title_pt.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'A guardar…' : 'Guardar percurso'}
          </button>
        </div>
      </header>

      <div className="route-status-line" aria-live="polite">
        <span className={dirty ? 'unsaved' : 'saved'}>{dirty ? 'Alterações por guardar' : 'Guardado'}</span>
        {message ? <span>{message}</span> : null}
      </div>

      <div className="route-editor-grid">
        <aside className="route-catalog">
          <div className="route-catalog-heading">
            <h3>Percursos</h3>
            <span>{routes.length}</span>
          </div>
          <div className="route-list">
            {routes.map((route) => (
              <button
                type="button"
                key={route.id}
                className={selectedId === route.id ? 'active' : ''}
                onClick={() => selectRoute(route.id)}
              >
                <strong>{route.title_pt}</strong>
                <small>{route.segments?.filter((segment) => segment.kind === 'text').length ?? 0} textos</small>
              </button>
            ))}
          </div>

          <div className="available-texts-heading">
            <h3>Textos disponíveis</h3>
            <span>{availableTexts.length}</span>
          </div>
          <input
            type="search"
            value={search}
            placeholder="Autor, obra, excerto ou lugar"
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="available-text-list">
            {availableTexts.map((text) => (
              <button
                type="button"
                key={text.id}
                className="available-text-card"
                onClick={() => setSegments(addTextSegment(draft.segments, text))}
              >
                <strong>{text.author?.name ?? 'Autor por definir'}</strong>
                <span>{text.source_work || excerpt(text.content_pt, 74)}</span>
                <small>⌖ {text.point?.title_pt ?? 'Lugar por definir'}</small>
              </button>
            ))}
            {!availableTexts.length ? <p>Nenhum texto corresponde à busca.</p> : null}
          </div>
        </aside>

        <main className="route-narrative-editor">
          <section className="route-metadata-card">
            <label>
              Título em português
              <input
                value={draft.title_pt}
                onChange={(event) => setDraft({ ...draft, title_pt: event.target.value })}
              />
            </label>
            <label>
              Slug
              <input
                value={draft.slug}
                placeholder="do-tejo-ao-chiado"
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
              />
            </label>
            <label className="route-wide-field">
              Descrição
              <textarea
                value={draft.description_pt}
                onChange={(event) => setDraft({ ...draft, description_pt: event.target.value })}
              />
            </label>
            <label>
              Dificuldade
              <select
                value={draft.difficulty}
                onChange={(event) => setDraft({ ...draft, difficulty: event.target.value })}
              >
                <option value="easy">Fácil</option>
                <option value="medium">Média</option>
                <option value="hard">Difícil</option>
              </select>
            </label>
            <label>
              Imagem de capa
              <input
                type="url"
                value={draft.cover_image_url}
                onChange={(event) => setDraft({ ...draft, cover_image_url: event.target.value })}
              />
            </label>
          </section>

          <div className="route-builder-columns">
          <div className="route-story-column">
          <div className="narrative-heading">
            <div>
              <span className="eyebrow">Sequência narrativa</span>
              <h3>{draft.segments.length} segmentos</h3>
            </div>
            <button
              type="button"
              className="secondary-action"
              onClick={() => setSegments(addBridgeSegment(draft.segments))}
            >
              + Ponte curatorial
            </button>
          </div>

          <div className="narrative-sequence">
            {draft.segments.map((segment, index) => (
              <article
                key={segment.id ?? `${segment.kind}-${index}`}
                className={`narrative-card ${segment.kind}${segment.id === selectedSegmentId ? ' selected' : ''}`}
                draggable
                onClick={() => setSelectedSegmentId(segment.id)}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) setSegments(reorderSegments(draft.segments, dragIndex, index));
                  setDragIndex(null);
                }}
              >
                <div className="narrative-order">{index + 1}</div>
                {segment.kind === 'text' ? (
                  <div className="narrative-copy">
                    <span className="segment-kind">Texto</span>
                    <h4>{segment.text?.author?.name ?? 'Texto selecionado'}</h4>
                    <p>{segment.text?.source_work || excerpt(segment.text?.content_pt ?? '', 120)}</p>
                    <small>⌖ {segment.text?.point?.title_pt ?? 'Localização herdada do texto'}</small>
                  </div>
                ) : (
                  <label className="narrative-copy bridge-copy">
                    <span className="segment-kind">Ponte curatorial</span>
                    <textarea
                      value={segment.bridge_content_pt ?? ''}
                      placeholder="Introduza a passagem narrativa entre os textos…"
                      onChange={(event) =>
                        setSegments(
                          draft.segments.map((item, currentIndex) =>
                            currentIndex === index
                              ? { ...item, bridge_content_pt: event.target.value }
                              : item
                          )
                        )
                      }
                    />
                  </label>
                )}
                <div className="narrative-actions">
                  <button
                    type="button"
                    className="text-action"
                    disabled={index === 0}
                    onClick={() => setSegments(reorderSegments(draft.segments, index, index - 1))}
                    aria-label="Mover para cima"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="text-action"
                    disabled={index === draft.segments.length - 1}
                    onClick={() => setSegments(reorderSegments(draft.segments, index, index + 1))}
                    aria-label="Mover para baixo"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="text-action delete-text-action"
                    onClick={() => setSegments(draft.segments.filter((_, current) => current !== index))}
                  >
                    Remover
                  </button>
                </div>
              </article>
            ))}
            {!draft.segments.length ? (
              <div className="empty-narrative">
                <strong>A narrativa começa com um texto.</strong>
                <p>Escolha um texto disponível; a localização virá com ele.</p>
              </div>
            ) : null}
          </div>
          </div>

          <aside className="route-spatial-column">
            <section className="route-map-card">
              <div className="spatial-heading">
                <div>
                  <span className="eyebrow">Caminhada</span>
                  <h3>Mapa e pernas</h3>
                </div>
                <span className={`routing-state ${dirty ? 'stale' : selectedRoute?.routing_status ?? 'pending'}`}>
                  {dirty ? 'rota desatualizada' : routingLabel(selectedRoute?.routing_status)}
                </span>
              </div>
              <RouteMap
                segments={draft.segments}
                legs={selectedRoute?.legs ?? []}
                waypointDrafts={legWaypoints}
                selectedSegmentId={selectedSegmentId}
                addingWaypoint={addingWaypoint}
                onSelectSegment={setSelectedSegmentId}
                onAddWaypoint={(waypoint) => {
                  setLegWaypoints(addLegWaypoint(legWaypoints, selectedLegPosition, waypoint));
                  setAddingWaypoint(false);
                  setMessage('Waypoint adicionado à perna. Recalcule para o guardar.');
                }}
              />
              <div className="route-metrics">
                <div><strong>{formatDistance(selectedRoute?.estimated_distance_m)}</strong><span>distância</span></div>
                <div><strong>{formatDuration(selectedRoute?.estimated_duration_s)}</strong><span>caminhada</span></div>
                <div><strong>{textSegments.length}</strong><span>textos</span></div>
              </div>
              <div className="waypoint-editor">
                <label>
                  Perna pedonal
                  <select
                    value={selectedLegPosition}
                    onChange={(event) => setSelectedLegPosition(Number(event.target.value))}
                  >
                    {Array.from({ length: Math.max(0, textSegments.length - 1) }, (_, position) => (
                      <option key={position} value={position}>Perna {position + 1}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={!canUseServerTools || textSegments.length < 2}
                  onClick={() => setAddingWaypoint((current) => !current)}
                >
                  {addingWaypoint ? 'Cancelar waypoint' : '+ Waypoint no mapa'}
                </button>
                {selectedLegWaypoints.map((waypoint, index) => (
                  <div className="waypoint-row" key={`${waypoint.lat}-${waypoint.lng}-${index}`}>
                    <span>{waypoint.lat.toFixed(5)}, {waypoint.lng.toFixed(5)}</span>
                    <button
                      type="button"
                      className="text-action delete-text-action"
                      onClick={() =>
                        setLegWaypoints(
                          removeLegWaypoint(legWaypoints, selectedLegPosition, index)
                        )
                      }
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="recalculate-route"
                disabled={!canUseServerTools || textSegments.length < 2 || recalculateMutation.isPending}
                onClick={() => recalculateMutation.mutate()}
              >
                {recalculateMutation.isPending ? 'A calcular rota…' : 'Recalcular caminhada'}
              </button>
            </section>

            <section className="route-readiness-card">
              <div className="spatial-heading">
                <div>
                  <span className="eyebrow">Publicação</span>
                  <h3>Prontidão PT/EN</h3>
                </div>
              </div>
              {!canUseServerTools ? <p>Guarde a narrativa antes de verificar as pendências.</p> : null}
              {canUseServerTools ? (
                <>
                  <ReadinessSummary label="PT" readiness={ptReadiness.data} loading={ptReadiness.isLoading} onIssue={setSelectedSegmentId} />
                  <ReadinessSummary label="EN" readiness={enReadiness.data} loading={enReadiness.isLoading} onIssue={setSelectedSegmentId} />
                </>
              ) : null}
            </section>

            <section className="route-preview-card">
              <div className="spatial-heading">
                <div>
                  <span className="eyebrow">Preview do visitante</span>
                  <h3>{selectedSegment ? `Etapa ${selectedSegment.position}` : 'Escolha uma etapa'}</h3>
                </div>
                <select value={previewLang} onChange={(event) => setPreviewLang(event.target.value as 'pt' | 'en')}>
                  <option value="pt">PT</option>
                  <option value="en">EN</option>
                </select>
              </div>
              <RouteSegmentPreview segment={selectedSegment} lang={previewLang} />
            </section>
            {selectedSegment?.kind === 'bridge' ? (
              <section className="route-bridge-editorial-card">
                <div className="spatial-heading">
                  <div>
                    <span className="eyebrow">Ponte selecionada</span>
                    <h3>EN e áudio curatorial</h3>
                  </div>
                </div>
                <label>
                  Texto em inglês
                  <textarea
                    value={bridgeEnglish}
                    onChange={(event) => setBridgeEnglish(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={!canUseServerTools || !selectedSegment.id || !bridgeEnglish.trim() || bridgeTranslationMutation.isPending}
                  onClick={() => bridgeTranslationMutation.mutate()}
                >
                  Rever e guardar EN
                </button>
                {(['pt', 'en'] as const).map((lang) => {
                  const audio = selectedSegment.audio_files?.find((item) => item.lang === lang);
                  return (
                    <div className="bridge-audio-row" key={lang}>
                      <div>
                        <strong>{lang.toUpperCase()}</strong>
                        <span>{audio?.public_url ? (audio.manually_uploaded ? 'manual protegido' : 'gerado') : 'em falta'}</span>
                      </div>
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={!canUseServerTools || bridgeAudioMutation.isPending}
                        onClick={() => bridgeAudioMutation.mutate(lang)}
                      >
                        Gerar
                      </button>
                      <label className="bridge-upload-action">
                        MP3
                        <input
                          type="file"
                          accept="audio/mpeg,.mp3"
                          disabled={!canUseServerTools}
                          onChange={(event) => uploadBridgeAudio(lang, event.target.files?.[0])}
                        />
                      </label>
                    </div>
                  );
                })}
              </section>
            ) : null}
          </aside>
          </div>
        </main>
      </div>
    </section>
  );
}

function storageKey(routeId: string) {
  return `ecosdelisboa.route-draft.${routeId}`;
}

function readLocalDraft(routeId: string): RouteDraft | null {
  try {
    const stored = localStorage.getItem(storageKey(routeId));
    return stored ? (JSON.parse(stored) as RouteDraft) : null;
  } catch {
    return null;
  }
}

function excerpt(value: string, length: number) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > length ? `${compact.slice(0, length)}…` : compact;
}

function ReadinessSummary({
  label,
  readiness,
  loading,
  onIssue
}: {
  label: string;
  readiness?: RouteReadiness;
  loading: boolean;
  onIssue: (segmentId: string) => void;
}) {
  return (
    <div className={`readiness-language${readiness?.ready ? ' ready' : ''}`}>
      <div>
        <strong>{label}</strong>
        <span>{loading ? 'a verificar…' : readiness?.ready ? 'pronto' : `${readiness?.issues.length ?? 0} pendências`}</span>
      </div>
      {readiness?.issues.slice(0, 5).map((issue) =>
        issue.segment_id ? (
          <button type="button" key={`${issue.code}-${issue.path}`} onClick={() => onIssue(issue.segment_id!)}>
            {readinessIssueLabel(issue.code)}
          </button>
        ) : (
          <p key={`${issue.code}-${issue.path}`}>{readinessIssueLabel(issue.code)}</p>
        )
      )}
    </div>
  );
}

function RouteSegmentPreview({
  segment,
  lang
}: {
  segment?: AdminRouteSegment;
  lang: 'pt' | 'en';
}) {
  if (!segment) return <p>Selecione um texto ou uma ponte na sequência.</p>;
  if (segment.kind === 'text') {
    const translation = segment.text?.translations?.find(
      (item) => item.lang === lang && item.status === 'approved'
    );
    const content = lang === 'pt' ? segment.text?.content_pt : translation?.content;
    const audio = segment.text?.audio_files?.find((item) => item.lang === lang && item.public_url);
    return (
      <div className="visitor-preview-copy">
        <span>{segment.text?.author?.name ?? 'Autor'}</span>
        <h4>{segment.text?.source_work ?? segment.text?.point?.title_pt ?? 'Texto'}</h4>
        <small>⌖ {segment.text?.point?.title_pt ?? 'Lugar por definir'}</small>
        <p>{content || `Tradução ${lang.toUpperCase()} em falta.`}</p>
        {audio?.public_url ? <audio controls preload="none" src={audio.public_url} /> : <em>Áudio {lang.toUpperCase()} em falta</em>}
      </div>
    );
  }
  const translation = segment.translations?.find(
    (item) => item.lang === lang && item.status === 'approved'
  );
  const content = lang === 'pt' ? segment.bridge_content_pt : translation?.content;
  const audio = segment.audio_files?.find((item) => item.lang === lang && item.public_url);
  return (
    <div className="visitor-preview-copy bridge-preview-copy">
      <span>Ponte curatorial</span>
      <p>{content || `Tradução ${lang.toUpperCase()} em falta.`}</p>
      {audio?.public_url ? <audio controls preload="none" src={audio.public_url} /> : <em>Áudio {lang.toUpperCase()} em falta</em>}
    </div>
  );
}

function readinessIssueLabel(code: string) {
  const labels: Record<string, string> = {
    missing_title: 'Completar título',
    missing_description: 'Completar descrição',
    missing_difficulty: 'Definir dificuldade',
    missing_route_translation: 'Traduzir metadados',
    too_few_texts: 'Adicionar pelo menos dois textos',
    missing_text_translation: 'Rever tradução do texto',
    missing_text_audio: 'Gerar áudio do texto',
    missing_bridge_translation: 'Traduzir ponte',
    missing_bridge_audio: 'Gerar áudio da ponte',
    routing_stale: 'Recalcular caminhada',
    legacy_segment: 'Rever etapa legada'
  };
  return labels[code] ?? code;
}

function routingLabel(status?: string) {
  if (status === 'ready') return 'rota atual';
  if (status === 'failed') return 'falhou';
  if (status === 'stale') return 'desatualizada';
  return 'por calcular';
}

function formatDistance(distance?: number | null) {
  if (!distance) return '—';
  return distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
}

function formatDuration(duration?: number | null) {
  if (!duration) return '—';
  return `${Math.max(1, Math.round(duration / 60))} min`;
}
