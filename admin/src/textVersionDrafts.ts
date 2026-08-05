import type { AdminTranslation, TranslationStatus } from '@ecosdelisboa/shared';

export type TextVersionDraft = {
  content: string;
  phoneticContent: string;
  status: TranslationStatus;
  dirty: boolean;
};

export function translationToDraft(translation?: AdminTranslation): TextVersionDraft {
  return {
    content: translation?.content ?? '',
    phoneticContent: translation?.phonetic_content ?? '',
    status: translation?.status ?? 'pending',
    dirty: false
  };
}

export function mergeTranslationDrafts(
  current: Record<string, TextVersionDraft>,
  translations: AdminTranslation[]
) {
  const next = { ...current };
  translations.forEach((translation) => {
    if (next[translation.lang]?.dirty) return;
    next[translation.lang] = translationToDraft(translation);
  });
  return next;
}
