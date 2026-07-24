import { Mic2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { EmptyState, ErrorState } from '../components/AsyncState';
import { localized, t } from '../i18n/messages';
import type { Author, DefaultVoice, Lang } from '../types';

interface Props {
  lang: Lang;
}

export function AuthorsPage({ lang }: Props) {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [voice, setVoice] = useState<DefaultVoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([api.getAuthors(), api.getDefaultVoice()])
      .then(([authorsResult, voiceResult]) => {
        if (cancelled) return;
        setAuthors(authorsResult.data);
        setVoice(voiceResult.data);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthors([]);
        setVoice(null);
        setError('Não foi possível carregar os autores.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <main className="authors-page">
      <section className="voice-strip">
        <Mic2 size={18} />
        <span>{t(lang, 'currentVoice')}</span>
        <strong>{voice?.voice_id ?? '-'}</strong>
      </section>
      <section className="author-grid">
        {error ? <ErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} /> : null}
        {loading ? <EmptyState message="A carregar..." /> : null}
        {!loading && !error && authors.length === 0 ? <EmptyState message={t(lang, 'empty')} /> : null}
        {authors.map((author) => (
          <article key={author.id} className="author-card">
            {author.photo_url ? <img src={author.photo_url} alt="" /> : <div className="author-placeholder">{author.name[0]}</div>}
            <div>
              <span>{t(lang, 'authorProfile')}</span>
              <h2>{author.name}</h2>
              <p>{localized(author, 'bio', lang)}</p>
              <small>
                {author.birth_year}
                {author.death_year ? `-${author.death_year}` : ''} · {author.points_count ?? 0} {t(lang, 'points')}
              </small>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
