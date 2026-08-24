import { Bell, BellOff, Filter, LocateFixed, Navigation } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { EmptyState, ErrorState } from '../components/AsyncState';
import { CityMap } from '../components/CityMap';
// import { OfflineCache } from '../components/OfflineCache';
import { PointSheet } from '../components/PointSheet';
import { cityConfig } from '../config/city';
import { useProximityNotifications } from '../hooks/useProximityNotifications';
import { useVisitorLocation } from '../hooks/useVisitorLocation';
import { localized, t } from '../i18n/messages';
import { distanceMeters, proximityCopy } from '../lib/proximity';
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
  const initialPointIdRef = useRef(new URLSearchParams(window.location.search).get('point'));
  const { currentLocation, searchLocation, status: locationStatus, retry } = useVisitorLocation();
  const copy = proximityCopy(lang);

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
        lat: searchLocation.lat,
        lng: searchLocation.lng,
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
  }, [authorId, lang, radius, reloadKey, searchLocation.lat, searchLocation.lng]);

  const pointsWithAuthors = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        author: point.author ?? point.authors?.[0] ?? authors.find((author) => author.id === point.author_id),
        distance_m: currentLocation ? distanceMeters(currentLocation, point) : undefined
      })).sort((left, right) => (left.distance_m ?? Number.POSITIVE_INFINITY) - (right.distance_m ?? Number.POSITIVE_INFINITY)),
    [authors, currentLocation, points]
  );
  const neighborhoods = useMemo(
    () => Array.from(new Set(pointsWithAuthors.map((point) => point.neighborhood).filter(Boolean))),
    [pointsWithAuthors]
  );
  const proximity = useProximityNotifications(currentLocation, pointsWithAuthors, lang);

  useEffect(() => {
    const initialPointId = initialPointIdRef.current;
    if (!initialPointId) return;
    const initialPoint = pointsWithAuthors.find((point) => point.id === initialPointId);
    if (!initialPoint) return;
    initialPointIdRef.current = null;
    setSelectedPoint(initialPoint);
    setSelectedTextId(null);
  }, [pointsWithAuthors]);

  useEffect(() => {
    const selectedId = selectedPoint?.id;
    if (!selectedId) return;
    let cancelled = false;
    api
      .getPoint(selectedId, lang)
      .then((result) => {
        if (cancelled) return;
        setSelectedPoint((current) => {
          if (!current || current.id !== selectedId) return current;
          return {
            ...current,
            ...result.data,
            author:
              result.data.author ??
              result.data.authors?.[0] ??
              current.author ??
              current.authors?.[0]
          };
        });
        setSelectedTextId((current) =>
          result.data.texts?.some((text) => text.id === current)
            ? current
            : result.data.texts?.[0]?.id ?? null
        );
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar o detalhe do ponto.');
      });
    return () => {
      cancelled = true;
    };
  }, [lang, selectedPoint?.id]);

  function selectPoint(point: Point) {
    setSelectedPoint(point);
    setSelectedTextId(null);
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
        <div className="location-controls">
          <div className={`location-status ${locationStatus}`}>
            <Navigation size={16} aria-hidden="true" />
            <span>{copy.location[locationStatus]}</span>
            {locationStatus === 'denied' || locationStatus === 'unavailable' ? (
              <button type="button" onClick={retry}>{copy.retry}</button>
            ) : null}
          </div>
          <button
            type="button"
            className={proximity.enabled ? 'proximity-toggle active' : 'proximity-toggle'}
            onClick={() => void proximity.toggle()}
            disabled={proximity.permission === 'denied'}
          >
            {proximity.enabled ? <Bell size={16} /> : <BellOff size={16} />}
            {proximity.permission === 'denied'
              ? copy.blocked
              : proximity.enabled
                ? copy.enabled
                : copy.enable}
          </button>
        </div>
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
                <small>
                  {point.author?.name}
                  {point.distance_m != null ? ` · ${formatPointDistance(point.distance_m)}` : ''}
                </small>
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
          userLocation={currentLocation}
          searchCenter={[searchLocation.lng, searchLocation.lat]}
        />
        {proximity.notice ? (
          <div className="proximity-notice" role="status">
            <Bell size={18} aria-hidden="true" />
            <div>
              <strong>{copy.nearbyTitle}</strong>
              <span>{copy.nearbyBody(localized(proximity.notice.point, 'title', lang))}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                selectPoint(proximity.notice!.point);
                proximity.dismiss();
              }}
            >
              {copy.openPoint}
            </button>
            <button type="button" className="dismiss" onClick={proximity.dismiss} aria-label={copy.dismiss}>×</button>
          </div>
        ) : null}
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

function formatPointDistance(distanceM: number) {
  return distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(1)} km`;
}
