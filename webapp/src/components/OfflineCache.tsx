import { DownloadCloud } from 'lucide-react';
import { cityConfig } from '../config/city';
import { t } from '../i18n/messages';
import type { Lang, Point } from '../types';

interface Props {
  points: Point[];
  lang: Lang;
}

export function OfflineCache({ points, lang }: Props) {
  async function prefetch() {
    const requests = points.flatMap((point) => [
      `/api/v1/points/${point.id}`,
      ...(point.audios?.map((audio) => audio.url).filter(Boolean) ?? [])
    ]);
    const cache = await caches.open(cityConfig.cache.neighborhoodPrefetch);
    await Promise.all(requests.map((url) => fetch(url).then((response) => cache.put(url, response)).catch(() => undefined)));
  }

  return (
    <button type="button" className="cache-button" onClick={prefetch}>
      <DownloadCloud size={17} />
      {t(lang, 'offlineReady')}
    </button>
  );
}
