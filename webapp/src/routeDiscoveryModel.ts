import { routeSegments, type PublicRoute, type PublicRouteSegment, type SupportedLanguage } from '@ecosdelisboa/shared';

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

export function narrativeTextNumber(segments: PublicRouteSegment[], segmentId: string): number {
  return segments
    .filter((segment) => segment.kind === 'text')
    .findIndex((segment) => segment.id === segmentId) + 1;
}

export function segmentHasAudio(segment: PublicRouteSegment, lang: SupportedLanguage): boolean {
  const audioFiles = segment.kind === 'text'
    ? segment.text.audio_files ?? []
    : segment.kind === 'bridge'
      ? segment.audio_files
      : [];
  return audioFiles.some((audio) => audio.lang === lang && Boolean(audio.public_url));
}
