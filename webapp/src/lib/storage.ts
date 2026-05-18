import type { Lang } from '../types';
import { cityConfig } from '../config/city';

const LANGUAGE_KEY = `${cityConfig.slug}.language`;
const ONBOARDED_KEY = `${cityConfig.slug}.onboarded`;

export function getStoredLanguage(): Lang {
  const value = localStorage.getItem(LANGUAGE_KEY);
  return value === 'en' || value === 'es' || value === 'fr' || value === 'de' || value === 'zh'
    ? value
    : cityConfig.defaultLanguage;
}

export function storeLanguage(lang: Lang) {
  localStorage.setItem(LANGUAGE_KEY, lang);
}

export function hasOnboarded() {
  return localStorage.getItem(ONBOARDED_KEY) === 'true';
}

export function storeOnboarded() {
  localStorage.setItem(ONBOARDED_KEY, 'true');
}
