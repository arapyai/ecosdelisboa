import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PublicRoute } from '@ecosdelisboa/shared';
import type { Lang } from '../types';
import {
  downloadRoute,
  estimateRouteBytes,
  readRouteManifests,
  removeOfflineRoute,
  routeDownloadState,
  type DownloadProgress
} from '../routeOffline';

interface Props { route: PublicRoute; lang: Lang; }

export function OfflineRouteButton({ route, lang }: Props) {
  const [state, setState] = useState(() => routeDownloadState(route, lang));
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(() => readRouteManifests().find((item) => item.route_id === route.id && item.lang === lang)?.estimated_bytes ?? null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setState(routeDownloadState(route, lang));
    setProgress(null);
    setError('');
    if (state !== 'ready') void estimateRouteBytes(route).then(setEstimatedBytes);
  }, [lang, route, state]);

  const download = async () => {
    setError('');
    setProgress({ completed: 0, total: 1, bytes: 0 });
    try {
      const manifest = await downloadRoute(route, lang, setProgress);
      setEstimatedBytes(manifest.estimated_bytes ?? null);
      setState('ready');
    } catch {
      setState('incomplete');
      setError(lang === 'en' ? 'The download is incomplete. Try again when connected.' : 'O download ficou incompleto. Tente novamente quando houver rede.');
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    await removeOfflineRoute(route.id, lang);
    setState('missing');
  };

  if (state === 'ready') return (
    <div className="offline-route-control ready">
      <span>{lang === 'en' ? 'Available offline' : 'Disponível offline'}{estimatedBytes ? ` · ${formatBytes(estimatedBytes)}` : ''}</span>
      <button type="button" onClick={remove} aria-label={lang === 'en' ? 'Remove download' : 'Remover download'}><Trash2 size={15} /></button>
    </div>
  );

  return (
    <div className="offline-route-download">
      <button type="button" className="secondary-route-action" onClick={download} disabled={progress !== null}>
        {state === 'update' || state === 'incomplete' ? <RefreshCw size={17} /> : <Download size={17} />}
        {progress ? `${Math.round((progress.completed / progress.total) * 100)}%` : state === 'update' ? (lang === 'en' ? 'Update download' : 'Atualizar download') : state === 'incomplete' ? (lang === 'en' ? 'Resume download' : 'Retomar download') : (lang === 'en' ? 'Download route' : 'Baixar percurso')}
        {!progress && estimatedBytes ? <small>{formatBytes(estimatedBytes)}</small> : null}
      </button>
      {progress ? <progress value={progress.completed} max={progress.total} /> : null}
      {error ? <small className="offline-download-error">{error}</small> : null}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
