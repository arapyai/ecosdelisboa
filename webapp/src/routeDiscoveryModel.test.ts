import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicRoute } from '@ecosdelisboa/shared';
import {
  preserveSelectedRoute,
  narrativeTextNumber,
  routeAudioDuration,
  routeNarrativeLabels,
  segmentHasAudio
} from './routeDiscoveryModel.ts';

const route: PublicRoute = {
  id: 'route',
  title_pt: 'Percurso',
  title: 'Route',
  segments: [
    {
      id: 'text-segment',
      position: 1,
      kind: 'text',
      text: {
        id: 'text',
        content: 'English text',
        content_pt: 'Texto português',
        content_type: 'prose',
        author: { id: 'author', name: 'Fernando Pessoa' },
        point: { id: 'point', title_pt: 'Rua dos Douradores', lat: 38.7, lng: -9.1 },
        audio_files: [
          { id: 'pt', lang: 'pt', duration_s: 30 },
          { id: 'en', lang: 'en', duration_s: 42 }
        ]
      }
    },
    {
      id: 'bridge',
      position: 2,
      kind: 'bridge',
      content: 'Walk uphill.',
      content_pt: 'Suba a rua.',
      audio_files: [{ id: 'bridge-en', lang: 'en', duration_s: 8 }]
    }
  ]
};

test('keeps narrative labels text-led and location secondary', () => {
  assert.deepEqual(routeNarrativeLabels(route), [
    'Fernando Pessoa — Rua dos Douradores',
    'bridge'
  ]);
});

test('calculates audio duration in the selected language without mixing tracks', () => {
  assert.equal(routeAudioDuration(route, 'pt'), 30);
  assert.equal(routeAudioDuration(route, 'en'), 50);
});

test('preserves selection across language reloads when route still exists', () => {
  const other = { ...route, id: 'other' };
  assert.equal(preserveSelectedRoute([route, other], 'other'), 'other');
  assert.equal(preserveSelectedRoute([route], 'missing'), 'route');
});

test('numbers only text steps and shows audio only for a real localized file', () => {
  const segments = route.segments ?? [];
  assert.equal(narrativeTextNumber(segments, 'text-segment'), 1);
  assert.equal(segmentHasAudio(segments[0]!, 'pt'), false);
  const textSegment = segments[0]!;
  if (textSegment.kind !== 'text') throw new Error('expected text fixture');
  const ready = {
    ...textSegment,
    text: { ...textSegment.text, audio_files: [{ id: 'ready', lang: 'pt', public_url: '/ready.mp3' }] }
  };
  assert.equal(segmentHasAudio(ready, 'pt'), true);
});
