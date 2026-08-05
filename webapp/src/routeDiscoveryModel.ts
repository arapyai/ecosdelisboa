import { routeSegments, type PublicRoute, type SupportedLanguage } from '@ecosdelisboa/shared';

export function routeAudioDuration(route: PublicRoute, lang: SupportedLanguage): number {
  return routeSegments(route).reduce((total, segment) => {
    const audios =
      segment.kind === 'text'
        ? segment.text.audio_files ?? []
        : segment.kind === 'bridge'
          ? segment.audio_files
          : [];
    return total + (audios.find((audio) => audio.lang === lang)?.duration_s ?? 0);
  }, 0);
}

export function routeNarrativeLabels(route: PublicRoute): string[] {
  return routeSegments(route).flatMap((segment) =>
    segment.kind === 'text'
      ? [`${segment.text.author.name} — ${segment.text.point.title_pt}`]
      : segment.kind === 'bridge'
        ? ['bridge']
        : []
  );
}

export function preserveSelectedRoute(routes: PublicRoute[], selectedId?: string): string | undefined {
  return selectedId && routes.some((route) => route.id === selectedId)
    ? selectedId
    : routes[0]?.id;
}
