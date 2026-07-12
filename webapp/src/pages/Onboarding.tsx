import type { CSSProperties } from 'react';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { cityConfig } from '../config/city';
import { t } from '../i18n/messages';
import type { Lang } from '../types';

interface Props {
  lang: Lang;
  onLanguage: (lang: Lang) => void;
  onDone: () => void;
}

export function Onboarding({ lang, onLanguage, onDone }: Props) {
  return (
    <main className="onboarding" style={{ '--onboarding-bg': `url("${cityConfig.assets.onboardingBackground}")` } as CSSProperties}>
      <div className="onboarding-title">
        <div className="brand-mark">
          <img src="/branding/literary-map-icon.png" alt="" />
        </div>
        <h1>{cityConfig.appName}</h1>
      </div>
      <p>{t(lang, 'tagline')}</p>
      <div className="language-card">
        <span>{t(lang, 'chooseLanguage')}</span>
        <LanguageSwitcher value={lang} onChange={onLanguage} />
      </div>
      <button type="button" className="primary-action" onClick={onDone}>
        {t(lang, 'start')}
      </button>
    </main>
  );
}
