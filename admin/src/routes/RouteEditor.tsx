import { ApiError, type AdminRoute, type AdminRouteSegment, type AdminText } from '@ecosdelisboa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { client } from '../adminConfig';
import { redirectIfAuthError } from '../adminApi';
import {
  addBridgeSegment,
  addTextSegment,
  draftFingerprint,
  emptyRouteDraft,
  filterAvailableTexts,
  normalizePositions,
  reorderSegments,
  routeDraftFromRoute,
  serializeRouteDraft,
  type RouteDraft
} from './routeEditorModel';

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
  }, [selectedId, selectedRoute]);

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

  function selectRoute(routeId: string) {
    if (dirty && !window.confirm('Há alterações não guardadas. Trocar de percurso mesmo assim?')) return;
    setSelectedId(routeId);
    setSearch('');
    setMessage('');
  }

  function setSegments(segments: AdminRouteSegment[]) {
    setDraft((current) => ({ ...current, segments: normalizePositions(segments) }));
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
                className={`narrative-card ${segment.kind}`}
                draggable
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
