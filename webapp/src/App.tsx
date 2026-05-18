import { BookOpen, Map, Users } from 'lucide-react';
import { useState } from 'react';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { cityConfig } from './config/city';
import { t } from './i18n/messages';
import { getStoredLanguage, hasOnboarded, storeLanguage, storeOnboarded } from './lib/storage';
import { AuthorsPage } from './pages/AuthorsPage';
import { MapPage } from './pages/MapPage';
import { Onboarding } from './pages/Onboarding';
import { RoutesPage } from './pages/RoutesPage';
import type { Lang } from './types';

type Tab = 'map' | 'routes' | 'authors';

export function App() {
  const [lang, setLang] = useState<Lang>(getStoredLanguage);
  const [onboarded, setOnboarded] = useState(hasOnboarded);
  const [tab, setTab] = useState<Tab>('map');

  function changeLanguage(next: Lang) {
    setLang(next);
    storeLanguage(next);
    document.documentElement.lang = next;
  }

  function finishOnboarding() {
    storeOnboarded();
    setOnboarded(true);
  }

  if (!onboarded) {
    return <Onboarding lang={lang} onLanguage={changeLanguage} onDone={finishOnboarding} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wordmark">
          <strong>{cityConfig.appName}</strong>
          <span>{t(lang, 'tagline')}</span>
        </div>
        <nav className="main-nav" aria-label="Main">
          <button type="button" className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
            <Map size={17} />
            {t(lang, 'map')}
          </button>
          <button type="button" className={tab === 'routes' ? 'active' : ''} onClick={() => setTab('routes')}>
            <BookOpen size={17} />
            {t(lang, 'routes')}
          </button>
          <button type="button" className={tab === 'authors' ? 'active' : ''} onClick={() => setTab('authors')}>
            <Users size={17} />
            {t(lang, 'authors')}
          </button>
        </nav>
        <LanguageSwitcher value={lang} onChange={changeLanguage} compact />
      </header>
      {tab === 'map' ? <MapPage lang={lang} /> : null}
      {tab === 'routes' ? <RoutesPage lang={lang} /> : null}
      {tab === 'authors' ? <AuthorsPage lang={lang} /> : null}
    </div>
  );
}
