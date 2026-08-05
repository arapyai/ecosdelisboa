import { routeSegments, type PublicRoute } from '@ecosdelisboa/shared';
import { Footprints, Headphones, MapIcon, Navigation, Timer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { EmptyState, ErrorState } from '../components/AsyncState';
import { GuidedRouteSession } from '../components/GuidedRouteSession';
import { OfflineRouteButton } from '../components/OfflineRouteButton';
import { RouteDiscoveryMap } from '../components/RouteDiscoveryMap';
import { preserveSelectedRoute, routeAudioDuration } from '../routeDiscoveryModel';
import type { Lang } from '../types';

interface Props {
  lang: Lang;
}

export function RoutesPage({ lang }: Props) {
  const [routes, setRoutes] = useState<PublicRoute[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<PublicRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeRoute, setActiveRoute] = useState<PublicRoute | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getRoutes(lang)
      .then((result) => {
        if (cancelled) return;
        setRoutes(result.data);
        setSelectedId((current) => preserveSelectedRoute(result.data, current));
      })
      .catch(() => {
        if (cancelled) return;
        setRoutes([]);
        setSelectedId(undefined);
        setError(lang === 'en' ? 'Routes could not be loaded.' : 'Não foi possível carregar os percursos.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, reloadKey]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');
    api
      .getRoute(selectedId, lang)
      .then((result) => {
        if (!cancelled) setDetail(result.data);
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setDetailError(lang === 'en' ? 'Route details could not be loaded.' : 'Não foi possível carregar o detalhe.');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, selectedId]);

  const selectedSummary = routes.find((route) => route.id === selectedId) ?? null;
  const segments = detail ? routeSegments(detail) : [];
  const audioDuration = useMemo(() => (detail ? routeAudioDuration(detail, lang) : 0), [detail, lang]);

  if (activeRoute) return <GuidedRouteSession route={activeRoute} lang={lang} onClose={() => setActiveRoute(null)} />;

  return (
    <main className="routes-discovery-page">
      <header className="routes-hero">
        <div>
          <span>{lang === 'en' ? 'Literary walks' : 'Percursos literários'}</span>
          <h1>{lang === 'en' ? 'Choose a story through Lisbon' : 'Escolha uma história por Lisboa'}</h1>
          <p>
            {lang === 'en'
              ? 'Walk from text to text, listen at each place, and let the narrative guide the city.'
              : 'Caminhe de texto em texto, ouça em cada lugar e deixe a narrativa conduzir a cidade.'}
          </p>
        </div>
        <strong>{routes.length}</strong>
      </header>

      {error ? <ErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} /> : null}
      {loading ? <EmptyState message={lang === 'en' ? 'Loading routes…' : 'A carregar percursos…'} /> : null}
      {!loading && !error && routes.length === 0 ? (
        <EmptyState message={lang === 'en' ? 'No routes are available yet.' : 'Ainda não há percursos disponíveis.'} />
      ) : null}

      {!loading && routes.length ? (
        <div className="route-discovery-layout">
          <aside className="route-discovery-list" aria-label={lang === 'en' ? 'Available routes' : 'Percursos disponíveis'}>
            {routes.map((route) => (
              <button
                type="button"
                key={route.id}
                className={`discovery-route-card${route.id === selectedId ? ' selected' : ''}`}
                onClick={() => setSelectedId(route.id)}
              >
                {route.cover_image_url ? <img src={route.cover_image_url} alt="" /> : <div className="route-cover-placeholder" />}
                <div>
                  <span>{route.title}</span>
                  <small>{route.authors?.join(' · ') || (lang === 'en' ? 'Lisbon authors' : 'Autores de Lisboa')}</small>
                  <p>{route.description}</p>
                  <div className="route-card-facts">
                    <span><Footprints size={14} /> {formatDistance(route.estimated_distance_m)}</span>
                    <span><Timer size={14} /> {formatDuration(route.estimated_duration_s, lang)}</span>
                    <span><Headphones size={14} /> {route.text_count ?? 0} {lang === 'en' ? 'texts' : 'textos'}</span>
                  </div>
                </div>
              </button>
            ))}
          </aside>

          <section className="route-discovery-stage">
            <RouteDiscoveryMap route={detail ?? selectedSummary} />
            <div className="route-detail-sheet">
              {detailError ? <ErrorState message={detailError} onRetry={() => setSelectedId((id) => id)} /> : null}
              {detailLoading ? <EmptyState message={lang === 'en' ? 'Opening the narrative…' : 'A abrir a narrativa…'} /> : null}
              {detail && !detailLoading ? (
                <>
                  <div className="route-detail-heading">
                    <div>
                      <span>{detail.authors?.join(' · ')}</span>
                      <h2>{detail.title}</h2>
                    </div>
                    <div className="route-detail-metrics">
                      <strong>{formatDistance(detail.estimated_distance_m)}</strong>
                      <span>{formatDuration(detail.estimated_duration_s, lang)}</span>
                      {audioDuration ? <span>{Math.ceil(audioDuration / 60)} min {lang === 'en' ? 'audio' : 'de áudio'}</span> : null}
                    </div>
                  </div>
                  <p className="route-description">{detail.description}</p>
                  <div className="route-primary-actions">
                    <button type="button" onClick={() => setActiveRoute(detail)}>
                      <Navigation size={17} />
                      {lang === 'en' ? 'Start route' : 'Começar percurso'}
                    </button>
                    <OfflineRouteButton route={detail} lang={lang} />
                  </div>
                  <div className="route-export-links">
                    <a href={api.getRouteGpxUrl(detail.id, lang)}><MapIcon size={15} /> GPX</a>
                    <a href={api.getRoutePodcastUrl(detail.id, lang)}><Headphones size={15} /> RSS</a>
                  </div>
                  <ol className="narrative-preview-list">
                    {segments.map((segment) =>
                      segment.kind === 'text' ? (
                        <li key={segment.id} className="text-preview-step">
                          <strong>{segment.position}</strong>
                          <div>
                            <span>{segment.text.author.name}</span>
                            <h3>{segment.text.source_work || excerpt(segment.text.content, 72)}</h3>
                            <small>⌖ {segment.text.point.title_pt}{segment.text.point.neighborhood ? ` · ${segment.text.point.neighborhood}` : ''}</small>
                          </div>
                          <Headphones size={18} aria-label={lang === 'en' ? 'Audio available' : 'Áudio disponível'} />
                        </li>
                      ) : segment.kind === 'bridge' ? (
                        <li key={segment.id} className="bridge-preview-step">
                          <strong>↝</strong>
                          <div>
                            <span>{lang === 'en' ? 'Curatorial bridge' : 'Ponte curatorial'}</span>
                            <p>{segment.content}</p>
                          </div>
                        </li>
                      ) : null
                    )}
                  </ol>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function formatDistance(distance?: number | null) {
  if (!distance) return '—';
  return distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
}

function formatDuration(duration: number | null | undefined, lang: Lang) {
  if (!duration) return '—';
  const minutes = Math.max(1, Math.round(duration / 60));
  return `${minutes} ${lang === 'en' ? 'min walk' : 'min a pé'}`;
}

function excerpt(value: string, length: number) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > length ? `${compact.slice(0, length)}…` : compact;
}
