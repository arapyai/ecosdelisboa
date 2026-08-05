import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicRoute } from '@ecosdelisboa/shared';
import {
  advanceRouteSession,
  bridgesAfterActiveText,
  confirmArrival,
  initialRouteSession,
  markListening,
  registerLocation,
  restoreRouteSession,
  startRouteSession
} from './routeSession.ts';

const route: PublicRoute = {
  id: 'route',
  title_pt: 'Percurso',
  title: 'Percurso',
  routing_status: 'ready',
  segments: [
    { id: 'intro', position: 0, kind: 'bridge', content: 'Intro', content_pt: 'Intro', audio_files: [] },
    {
      id: 'one', position: 1, kind: 'text',
      text: { id: 'text-1', content: 'Um', content_pt: 'Um', content_type: 'prose', author: { id: 'a', name: 'Autora' }, point: { id: 'p1', title_pt: 'Um', lat: 38.7, lng: -9.1 } }
    },
    { id: 'bridge', position: 2, kind: 'bridge', content: 'Walk', content_pt: 'Ande', audio_files: [] },
    {
      id: 'two', position: 3, kind: 'text',
      text: { id: 'text-2', content: 'Dois', content_pt: 'Dois', content_type: 'prose', author: { id: 'b', name: 'Autor' }, point: { id: 'p2', title_pt: 'Dois', lat: 38.701, lng: -9.1 } }
    }
  ],
  legs: [{ id: 'leg', position: 0, from_segment_id: 'one', to_segment_id: 'two', geometry: { type: 'LineString', coordinates: [[-9.1, 38.7], [-9.1, 38.701]] }, waypoints: [], distance_m: 111, duration_s: 90, provider: 'stub' }]
};

test('moves through the explicit visitor phases without implicit audio playback', () => {
  let session = startRouteSession(initialRouteSession(route));
  assert.equal(session.phase, 'going_to_first_text');
  session = confirmArrival(session);
  assert.equal(session.phase, 'arrived');
  session = markListening(session);
  assert.equal(session.phase, 'listening');
  session = advanceRouteSession(route, session);
  assert.equal(session.phase, 'walking');
  assert.equal(session.active_leg_position, 0);
  assert.deepEqual(bridgesAfterActiveText(route, 0).map((bridge) => bridge.id), ['bridge']);
});

test('requires two accurate readings and rejects poor accuracy for automatic arrival', () => {
  let session = startRouteSession(initialRouteSession(route));
  session = registerLocation(route, session, { lat: 38.7, lng: -9.1, accuracy: 8 });
  assert.equal(session.phase, 'going_to_first_text');
  assert.equal(session.consecutive_arrival_readings, 1);
  session = registerLocation(route, session, { lat: 38.7, lng: -9.1, accuracy: 90 });
  assert.equal(session.consecutive_arrival_readings, 0);
  session = registerLocation(route, session, { lat: 38.7, lng: -9.1, accuracy: 8 });
  session = registerLocation(route, session, { lat: 38.7, lng: -9.1, accuracy: 8 });
  assert.equal(session.phase, 'arrived');
});

test('restores only sessions for the same persisted route version', () => {
  const session = initialRouteSession(route);
  assert.deepEqual(restoreRouteSession(route, JSON.stringify(session)), session);
  assert.equal(restoreRouteSession({ ...route, legs: [{ ...route.legs![0], duration_s: 91 }] }, JSON.stringify(session)), null);
  assert.equal(restoreRouteSession(route, '{broken'), null);
});
