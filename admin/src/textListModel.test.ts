import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminText } from '@ecosdelisboa/shared';
import { highlightParts, normalizeSearch, textMatchesSearch } from './texts/textListModel.ts';

const text: AdminText = {
  id: 'text-1', point_id: 'point-1', author_id: 'author-1', content_pt: 'Coração de Lisboa',
  source_work: 'Livro do Tejo', content_type: 'prose', origin: 'manual'
};

test('normalizes accents and matches text or editorial relations', () => {
  assert.equal(normalizeSearch('  Coração '), 'coracao');
  assert.equal(textMatchesSearch(text, { authorName: 'Fernando Pessoa', pointName: 'Chiado' }, 'pessoa'), true);
  assert.equal(textMatchesSearch(text, { authorName: 'Fernando Pessoa', pointName: 'Chiado' }, 'coracao'), true);
});

test('returns safe highlight segments', () => {
  assert.deepEqual(highlightParts('Fernando Pessoa', 'pessoa'), [
    { value: 'Fernando ', match: false },
    { value: 'Pessoa', match: true }
  ]);
});
