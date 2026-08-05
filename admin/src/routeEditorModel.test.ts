import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminRouteSegment, AdminText } from '@ecosdelisboa/shared';
import {
  addTextSegment,
  filterAvailableTexts,
  reorderSegments,
  serializeRouteDraft
} from './routes/routeEditorModel.ts';

const texts: AdminText[] = [
  {
    id: 'garrett',
    point_id: 'terreiro',
    author_id: 'a1',
    content_pt: 'O Tejo abria a narrativa.',
    content_type: 'prose',
    source_work: 'Viagens',
    author: { id: 'a1', name: 'Almeida Garrett' },
    point: { id: 'terreiro', title_pt: 'Terreiro do Paço', lat: 38.7, lng: -9.13 }
  },
  {
    id: 'pessoa-1',
    point_id: 'douradores',
    author_id: 'a2',
    content_pt: 'A rua estreita parecia infinita.',
    content_type: 'prose',
    author: { id: 'a2', name: 'Bernardo Soares' },
    point: { id: 'douradores', title_pt: 'Rua dos Douradores', lat: 38.71, lng: -9.14 }
  },
  {
    id: 'pessoa-2',
    point_id: 'douradores',
    author_id: 'a2',
    content_pt: 'Outro fragmento na mesma rua.',
    content_type: 'prose',
    author: { id: 'a2', name: 'Fernando Pessoa' },
    point: { id: 'douradores', title_pt: 'Rua dos Douradores', lat: 38.71, lng: -9.14 }
  }
];

test('searches by author, work, excerpt and place', () => {
  assert.deepEqual(filterAvailableTexts(texts, 'garrett viagens', []).map((text) => text.id), [
    'garrett'
  ]);
  assert.deepEqual(filterAvailableTexts(texts, 'rua estreita', []).map((text) => text.id), [
    'pessoa-1'
  ]);
  assert.equal(filterAvailableTexts(texts, 'douradores', []).length, 2);
});

test('keeps multiple texts at one point as independent narrative segments', () => {
  const selected = addTextSegment(addTextSegment([], texts[1]), texts[2]);
  assert.deepEqual(
    selected.map((segment) => [segment.text_id, segment.text?.point?.id]),
    [
      ['pessoa-1', 'douradores'],
      ['pessoa-2', 'douradores']
    ]
  );
});

test('reorders and serializes texts and bridges without point ids', () => {
  const segments: AdminRouteSegment[] = [
    { position: 1, kind: 'text', text_id: 'one' },
    { position: 2, kind: 'bridge', bridge_content_pt: ' Transição ' },
    { position: 3, kind: 'text', text_id: 'two' }
  ];
  const reordered = reorderSegments(segments, 2, 0);
  const payload = serializeRouteDraft({
    title_pt: ' Percurso ',
    slug: ' percurso ',
    description_pt: '',
    cover_image_url: '',
    difficulty: 'easy',
    is_published: false,
    segments: reordered
  });

  assert.deepEqual(payload.segments, [
    { position: 1, kind: 'text', text_id: 'two' },
    { position: 2, kind: 'text', text_id: 'one' },
    { position: 3, kind: 'bridge', bridge_content_pt: 'Transição' }
  ]);
  assert.ok(payload.segments.every((segment) => !('point_id' in segment)));
});
