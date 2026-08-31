import assert from 'node:assert/strict';
import test from 'node:test';
import {
  excludeReviewCode,
  restoreReviewCode
} from './reviewMap/reviewMapSelection.ts';

test('excludes a review code once and preserves the existing selection', () => {
  const initial = ['P0001'];

  assert.deepEqual(excludeReviewCode(initial, 'P0002'), ['P0001', 'P0002']);
  assert.deepEqual(excludeReviewCode(initial, 'P0001'), ['P0001']);
  assert.deepEqual(initial, ['P0001']);
});

test('restores only the selected review code', () => {
  assert.deepEqual(restoreReviewCode(['P0001', 'P0002'], 'P0001'), ['P0002']);
});
