import assert from 'node:assert/strict';
import test from 'node:test';
import {
  excludeReviewCode,
  fitReviewMapBounds,
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

test('refits the preview around the remaining points', () => {
  const fallback = { west: -9.3, south: 38.6, east: -9, north: 38.9 };
  const points = [
    reviewPoint('P0001', 38.71, -9.15),
    reviewPoint('P0002', 38.73, -9.12)
  ];

  const bounds = fitReviewMapBounds(points, 2, fallback);

  assert.ok(bounds.west < -9.15);
  assert.ok(bounds.east > -9.12);
  assert.ok(bounds.south < 38.71);
  assert.ok(bounds.north > 38.73);
  assert.ok(bounds.east - bounds.west < fallback.east - fallback.west);
});

test('keeps the current bounds when there are no visible points', () => {
  const fallback = { west: -9.3, south: 38.6, east: -9, north: 38.9 };
  assert.equal(fitReviewMapBounds([], 2, fallback), fallback);
});

function reviewPoint(reviewCode: string, lat: number, lng: number) {
  return {
    id: reviewCode,
    review_code: reviewCode,
    title_pt: reviewCode,
    lat,
    lng,
    sectors: [],
    location_status: 'main' as const
  };
}
