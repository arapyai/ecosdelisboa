import { Filter, LocateFixed } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { EmptyState, ErrorState } from '../components/AsyncState';
import { CityMap } from '../components/CityMap';
// import { OfflineCache } from '../components/OfflineCache';
import { PointSheet } from '../components/PointSheet';
import { cityConfig } from '../config/city';
import { localized, t } from '../i18n/messages';
import type { Author, Lang, Point } from '../types';

interface Props {
  lang: Lang;
}

export function MapPage({ lang }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [authorId, setAuthorId] = useState('');
  const [radius, setRadius] = useState(cityConfig.map.defaultRadius);
  const [isMock, setIsMock] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getAuthors()
      .then((result) => {
        if (!cancelled) setAuthors(result.data);
      })
      .catch(() => {
        if (!cancelled) setAuthors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getPoints({
        lat: cityConfig.api.defaultLat,
        lng: cityConfig.api.defaultLng,
        radius,
        lang,
        author_id: authorId
      })
      .then((result) => {
        if (cancelled) return;
        setPoints(result.data);
        setSelectedPoint((current) =>
          current && result.data.some((point) => point.id === current.id) ? current : null
        );
        setIsMock(result.isMock);
      })
      .catch(() => {
        if (cancelled) return;
        setPoints([]);
        setSelectedPoint(null);
        setSelectedTextId(null);
        setIsMock(false);
        setError('Não foi possível carregar os pontos.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authorId, lang, radius, reloadKey]);

  const pointsWithAuthors = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        author: point.author ?? point.authors?.[0] ?? authors.find((author) => author.id === point.author_id)
      })),
    [authors, points]
  );
  const neighborhoods = useMemo(
    () => Array.from(new Set(pointsWithAuthors.map((point) => point.neighborhood).filter(Boolean))),
    [pointsWithAuthors]
  );

  async function selectPoint(point: Point) {
    setSelectedPoint(point);
    setSelectedTextId(null);
    try {
      const result = await api.getPoint(point.id, lang);
      const loadedPoint = {
        ...point,
        ...result.data,
        author: result.data.author ?? result.data.authors?.[0] ?? point.author ?? point.authors?.[0] ?? authors.find((author) => author.id === point.author_id)
      };
      setSelectedPoint(loadedPoint);
      if (loadedPoint.texts && loadedPoint.texts.length > 0) {
        setSelectedTextId(loadedPoint.texts[0].id);
      }
    } catch {
      setError('Não foi possível carregar o detalhe do ponto.');
    }
  }

  function selectText(point: Point, textId: string) {
    setSelectedTextId(textId);
  }

  return (
    <main className="map-page">
      <section className="map-sidebar">
        <div className="section-heading">
          <span>{t(lang, 'nearby')}</span>
          <strong>{pointsWithAuthors.length}</strong>
        </div>
        {isMock ? <p className="notice">{t(lang, 'mockData')}</p> : null}
        {error ? <ErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} /> : null}
        <div className="filter-panel">
          <label>
            <Filter size={15} />
            {t(lang, 'filters')}
          </label>
          <select value={authorId} onChange={(event) => setAuthorId(event.target.value)}>
            <option value="">{t(lang, 'allAuthors')}</option>
            {authors.map((author) => (
              <option key={author.id} value={author.id}>
                {author.name}
              </option>
            ))}
          </select>
          <div className="range-row">
            <span>{t(lang, 'radius')}</span>
            <input
              min="500"
              max="5000"
              step="250"
              value={radius}
              onChange={(event) => setRadius(Number(event.target.value))}
              type="range"
            />
            <strong>{radius} m</strong>
          </div>
        </div>
        {/* <OfflineCache points={points} lang={lang} /> */}
        <div className="neighborhoods">
          {neighborhoods.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <div className="point-list">
          {!loading && !error && pointsWithAuthors.length === 0 ? <EmptyState message={t(lang, 'empty')} /> : null}
          {loading ? <EmptyState message="A carregar..." /> : null}
          {pointsWithAuthors.map((point) => (
            <button
              key={point.id}
              type="button"
              className={selectedPoint?.id === point.id ? 'point-row active' : 'point-row'}
              onClick={() => selectPoint(point)}
            >
              <LocateFixed size={16} />
              <span>
                <strong>{localized(point, 'title', lang)}</strong>
                <small>{point.author?.name}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="map-stage">
        <CityMap
          points={pointsWithAuthors}
          selected={selectedPoint}
          onSelect={selectPoint}
          selectedTextId={selectedTextId}
          onSelectText={selectText}
        />
        <PointSheet
          point={selectedPoint}
          lang={lang}
          onClose={() => {
            setSelectedPoint(null);
            setSelectedTextId(null);
          }}
          selectedTextId={selectedTextId}
        />
      </section>
    </main>
  );
}
