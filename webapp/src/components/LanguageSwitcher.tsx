import { languages } from '../i18n/messages';
import type { Lang } from '../types';

interface Props {
  value: Lang;
  onChange: (lang: Lang) => void;
  compact?: boolean;
}

export function LanguageSwitcher({ value, onChange, compact = false }: Props) {
  return (
    <div className={compact ? 'language-switcher compact' : 'language-switcher'} aria-label="Language">
      {languages.map((language) => (
        <button
          key={language.code}
          className={value === language.code ? 'active' : ''}
          type="button"
          onClick={() => onChange(language.code)}
          title={language.native}
        >
          {language.label}
        </button>
      ))}
    </div>
  );
}
