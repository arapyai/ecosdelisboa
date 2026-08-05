import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminTranslation } from '@ecosdelisboa/shared';
import { mergeTranslationDrafts } from './textVersionDrafts.ts';

const translation = (content: string): AdminTranslation => ({
  id: 'translation-en',
  text_id: 'text-1',
  lang: 'en',
  content,
  phonetic_content: null,
  status: 'pending',
  origin: 'automatic'
});

test('keeps unsaved draft when switching languages and backend data refreshes', () => {
  const current = {
    en: {
      content: 'Unsaved local edit',
      phoneticContent: '',
      status: 'pending' as const,
      dirty: true
    }
  };

  const next = mergeTranslationDrafts(current, [translation('Backend refresh')]);

  assert.equal(next.en.content, 'Unsaved local edit');
  assert.equal(next.en.dirty, true);
});

test('hydrates clean language draft from backend translation', () => {
  const next = mergeTranslationDrafts({}, [translation('Backend translation')]);

  assert.equal(next.en.content, 'Backend translation');
  assert.equal(next.en.dirty, false);
});
