import { Filter, LocateFixed } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
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
  const [authorId, setAuthorId] = useState('');
  const [radius, setRadius] = useState(cityConfig.map.defaultRadius);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    api.getAuthors().then((result) => setAuthors(result.data));
  }, []);

  useEffect(() => {
    api
      .getPoints({
        lat: cityConfig.api.defaultLat,
        lng: cityConfig.api.defaultLng,
        radius,
        lang,
        author_id: authorId
      })
      .then((result) => {
        setPoints(result.data);
        setSelectedPoint((current) =>
          current && result.data.some((point) => point.id === current.id) ? current : null
        );
        setIsMock(result.isMock);
      });
  }, [authorId, lang, radius]);

  const pointsWithAuthors = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        author: point.author ?? authors.find((author) => author.id === point.author_id)
      })),
    [authors, points]
  );
  const neighborhoods = useMemo(
    () => Array.from(new Set(pointsWithAuthors.map((point) => point.neighborhood).filter(Boolean))),
    [pointsWithAuthors]
  );

  async function selectPoint(point: Point) {
    setSelectedPoint(point);
    const result = await api.getPoint(point.id, lang);
    setSelectedPoint({
      ...point,
      ...result.data,
      author: result.data.author ?? point.author ?? authors.find((author) => author.id === point.author_id)
    });
  }

  return (
    <main className="map-page">
      <section className="map-sidebar">
        <div className="section-heading">
          <span>{t(lang, 'nearby')}</span>
          <strong>{pointsWithAuthors.length}</strong>
        </div>
        {isMock ? <p className="notice">{t(lang, 'mockData')}</p> : null}
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
        <CityMap points={pointsWithAuthors} selected={selectedPoint} onSelect={selectPoint} />
        <PointSheet point={selectedPoint} lang={lang} onClose={() => setSelectedPoint(null)} />
      </section>
    </main>
  );
}
