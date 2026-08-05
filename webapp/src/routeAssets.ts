import { routeSegments, type PublicAudioFile, type PublicRoute } from '@ecosdelisboa/shared';

function assetUrl(url: string | null | undefined, apiBase: string) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${apiBase}${url}`;
}

function normalizeAudio(audio: PublicAudioFile, apiBase: string): PublicAudioFile {
  return { ...audio, public_url: assetUrl(audio.public_url, apiBase) };
}

export function normalizeRouteAssets(route: PublicRoute, apiBase: string): PublicRoute {
  const segments = routeSegments(route).map((segment) => {
    if (segment.kind === 'text') {
      return {
        ...segment,
        text: {
          ...segment.text,
          author: {
            ...segment.text.author,
            photo_url: assetUrl(segment.text.author.photo_url, apiBase)
          },
          audio_files: segment.text.audio_files?.map((audio) => normalizeAudio(audio, apiBase))
        }
      };
    }
    if (segment.kind === 'bridge') {
      return {
        ...segment,
        audio_files: segment.audio_files.map((audio) => normalizeAudio(audio, apiBase))
      };
    }
    return segment;
  });

  return {
    ...route,
    cover_image_url: assetUrl(route.cover_image_url, apiBase),
    segments,
    items: segments
  };
}
