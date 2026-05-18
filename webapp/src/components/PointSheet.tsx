import { MapPin, X } from 'lucide-react';
import { api } from '../api/client';
import { localized, t } from '../i18n/messages';
import type { Lang, Point } from '../types';
import { AudioPlayer } from './AudioPlayer';

interface Props {
  point: Point | null;
  lang: Lang;
  onClose: () => void;
}

export function PointSheet({ point, lang, onClose }: Props) {
  if (!point) return null;

  const text = point.texts?.[0];
  const audio = point.audios?.find((item) => item.lang === lang) ?? point.audios?.[0];

  return (
    <aside className="point-sheet" aria-label={localized(point, 'title', lang)}>
      <button type="button" className="icon-button close" onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
      <div className="sheet-kicker">
        <MapPin size={15} />
        {point.neighborhood ?? point.address}
      </div>
      <h2>{localized(point, 'title', lang)}</h2>
      <p className="byline">{point.author?.name}</p>
      <AudioPlayer track={audio} label={t(lang, 'listen')} />
      {text ? (
        <div className="text-block">
          <span>{t(lang, 'transcript')}</span>
          <p>{localized(text, 'content', lang)}</p>
          <small>
            {t(lang, 'source')}: {text.source_work}
            {text.source_year ? `, ${text.source_year}` : ''}
          </small>
        </div>
      ) : null}
      <div className="sheet-actions">
        <a href={api.getRoutePodcastUrl(point.id)} aria-label="Podcast RSS">
          RSS
        </a>
      </div>
    </aside>
  );
}
