import { Footprints, Headphones, MapIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { localized, t } from '../i18n/messages';
import type { Lang, Route } from '../types';

interface Props {
  lang: Lang;
}

export function RoutesPage({ lang }: Props) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState<Route | null>(null);

  useEffect(() => {
    api.getRoutes().then((result) => {
      setRoutes(result.data);
      setSelected(result.data[0] ?? null);
    });
  }, []);

  return (
    <main className="routes-page">
      <section>
        <div className="section-heading">
          <span>{t(lang, 'routeList')}</span>
          <strong>{routes.length}</strong>
        </div>
        <div className="route-grid">
          {routes.map((route) => (
            <button key={route.id} type="button" className="route-card" onClick={() => setSelected(route)}>
              {route.cover_image_url ? <img src={route.cover_image_url} alt="" /> : null}
              <span>{localized(route, 'title', lang)}</span>
              <small>
                {route.distance_m ? `${(route.distance_m / 1000).toFixed(1)} ${t(lang, 'distance')}` : ''}
                {route.duration_min ? ` · ${route.duration_min} ${t(lang, 'duration')}` : ''}
              </small>
            </button>
          ))}
        </div>
      </section>
      {selected ? (
        <aside className="route-detail">
          <h2>{localized(selected, 'title', lang)}</h2>
          <p>{localized(selected, 'description', lang)}</p>
          <div className="route-actions">
            <a href={api.getRouteGpxUrl(selected.id)}>
              <MapIcon size={16} />
              {t(lang, 'gpx')}
            </a>
            <a href={api.getRoutePodcastUrl(selected.id)}>
              <Headphones size={16} />
              {t(lang, 'podcast')}
            </a>
            <button type="button">
              <Footprints size={16} />
              {t(lang, 'guidedMode')}
            </button>
          </div>
          <ol className="route-points">
            {selected.points?.map((item) => (
              <li key={item.id}>
                <strong>{item.order_index}</strong>
                <span>{item.point ? localized(item.point, 'title', lang) : `${item.lat_override}, ${item.lng_override}`}</span>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
    </main>
  );
}
