import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicRoute } from '@ecosdelisboa/shared';
import { normalizeRouteAssets } from './routeAssets.ts';

test('resolves narrative route assets against the backend origin', () => {
  const route = {
    id: 'route-1',
    title_pt: 'Percurso',
    title: 'Percurso',
    segments: [
      {
        id: 'bridge-1',
        position: 0,
        kind: 'bridge',
        content: 'Introdução',
        content_pt: 'Introdução',
        audio_files: [{ id: 'bridge-audio', lang: 'pt', public_url: '/media/bridge.mp3' }]
      },
      {
        id: 'text-1',
        position: 1,
        kind: 'text',
        text: {
          id: 'text',
          content: 'Texto',
          content_pt: 'Texto',
          content_type: 'prose',
          author: { id: 'author', name: 'Autora', photo_url: '/media/author.jpg' },
          point: { id: 'point', title_pt: 'Lugar', lat: 38.7, lng: -9.1 },
          audio_files: [{ id: 'text-audio', lang: 'pt', public_url: '/media/text.mp3' }]
        }
      }
    ]
  } satisfies PublicRoute;

  const normalized = normalizeRouteAssets(route, 'https://api.example.test');
  const bridge = normalized.segments?.[0];
  const textSegment = normalized.segments?.[1];

  assert.equal(bridge?.kind === 'bridge' && bridge.audio_files[0].public_url, 'https://api.example.test/media/bridge.mp3');
  assert.equal(textSegment?.kind === 'text' && textSegment.text.audio_files?.[0].public_url, 'https://api.example.test/media/text.mp3');
  assert.equal(textSegment?.kind === 'text' && textSegment.text.author.photo_url, 'https://api.example.test/media/author.jpg');
  assert.deepEqual(normalized.items, normalized.segments);
});
