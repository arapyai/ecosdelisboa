import type { AdminAudioFile, AdminTranslation } from '@ecosdelisboa/shared';
import type { QueryClient } from '@tanstack/react-query';

export function updateTranslationCache(queryClient: QueryClient, token: string, nextTranslation: AdminTranslation) {
  queryClient.setQueryData<AdminTranslation[]>(['admin-translations', token], (current) => {
    const list = current ?? [];
    const matches = (translation: AdminTranslation) =>
      translation.id === nextTranslation.id ||
      (translation.text_id === nextTranslation.text_id && translation.lang === nextTranslation.lang);
    if (!list.some(matches)) return [nextTranslation, ...list];
    return list.map((translation) => (matches(translation) ? nextTranslation : translation));
  });
}

export function removeTranslationCache(queryClient: QueryClient, token: string, translationId: string) {
  queryClient.setQueryData<AdminTranslation[]>(['admin-translations', token], (current) =>
    (current ?? []).filter((translation) => translation.id !== translationId)
  );
}

export function updateAudioCache(queryClient: QueryClient, token: string, nextAudio: AdminAudioFile) {
  queryClient.setQueryData<AdminAudioFile[]>(['admin-audio', token], (current) => {
    const list = current ?? [];
    const exists = list.some((audio) => audio.text_id === nextAudio.text_id && audio.lang === nextAudio.lang);
    if (!exists) return [nextAudio, ...list];
    return list.map((audio) => (audio.text_id === nextAudio.text_id && audio.lang === nextAudio.lang ? nextAudio : audio));
  });
}

export function removeAudioCache(queryClient: QueryClient, token: string, textId: string, lang: string) {
  queryClient.setQueryData<AdminAudioFile[]>(['admin-audio', token], (current) =>
    (current ?? []).filter((audio) => audio.text_id !== textId || audio.lang !== lang)
  );
}
