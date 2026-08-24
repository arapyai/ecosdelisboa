import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canNotifyPoint,
  distanceMeters,
  isLocationInPortugal,
  pointsWithinRadius,
  PROXIMITY_NOTIFICATION_COOLDOWN_MS
} from './proximity.ts';
import type { Point } from '../types.ts';

test('recognizes mainland Portugal and its islands without treating foreign cities as local', () => {
  assert.equal(isLocationInPortugal({ lat: 38.7223, lng: -9.1393 }), true);
  assert.equal(isLocationInPortugal({ lat: 41.1579, lng: -8.6291 }), true);
  assert.equal(isLocationInPortugal({ lat: 32.6669, lng: -16.9241 }), true);
  assert.equal(isLocationInPortugal({ lat: 37.7412, lng: -25.6756 }), true);
  assert.equal(isLocationInPortugal({ lat: 40.4168, lng: -3.7038 }), false);
  assert.equal(isLocationInPortugal({ lat: 48.8566, lng: 2.3522 }), false);
});

test('calculates proximity and returns the nearest point first', () => {
  const location = { lat: 38.7223, lng: -9.1393, accuracy: 10 };
  const points = [
    { id: 'far', title_pt: 'Far', lat: 38.724, lng: -9.1393 },
    { id: 'near', title_pt: 'Near', lat: 38.7225, lng: -9.1393 }
  ] as Point[];
  const nearby = pointsWithinRadius(location, points, 100);
  assert.deepEqual(nearby.map(({ point }) => point.id), ['near']);
  assert.ok(distanceMeters(location, points[0]) > 100);
});

test('allows one notification per point every 24 hours', () => {
  const now = 2_000_000_000_000;
  assert.equal(canNotifyPoint(undefined, now), true);
  assert.equal(canNotifyPoint(now - PROXIMITY_NOTIFICATION_COOLDOWN_MS + 1, now), false);
  assert.equal(canNotifyPoint(now - PROXIMITY_NOTIFICATION_COOLDOWN_MS, now), true);
});
