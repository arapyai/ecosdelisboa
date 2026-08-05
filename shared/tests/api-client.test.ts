import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiClient,
  ApiError,
  routeAssetUrls,
  routeSegments,
  routeVersion,
  type PublicRoute
} from '../src/index.ts';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('ApiClient surfaces API unavailable errors', async () => {
  globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;

  const client = new ApiClient('https://api.example.test');

  await assert.rejects(() => client.get('/api/v1/points'), /fetch failed/);
});

test('ApiClient rejects invalid JSON responses', async () => {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token'))
    } as Response)) as typeof fetch;

  const client = new ApiClient('https://api.example.test');

  await assert.rejects(() => client.get('/api/v1/points'), /Unexpected token/);
});

test('ApiClient preserves HTTP status on failed responses', async () => {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: false,
      status: 503
    } as Response)) as typeof fetch;

  const client = new ApiClient('https://api.example.test');

  await assert.rejects(
    () => client.get('/api/v1/points'),
    (error) => error instanceof ApiError && error.status === 503 && error.path === '/api/v1/points'
  );
});

test('route client sends language and unwraps narrative route envelopes', async () => {
  const requested: string[] = [];
  globalThis.fetch = ((input) => {
    requested.push(String(input));
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: 'route-1', title: 'From the Tagus', title_pt: 'Do Tejo' }],
          meta: { total: 1 }
        })
    } as Response);
  }) as typeof fetch;

  const client = new ApiClient('https://api.example.test');
  const routes = await client.listRoutes('en');

  assert.equal(requested[0], 'https://api.example.test/api/v1/routes?lang=en');
  assert.equal(routes[0].title, 'From the Tagus');
});

test('ApiError exposes structured publication readiness', async () => {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: { code: 'route_not_ready' } })
    } as Response)) as typeof fetch;
  const client = new ApiClient();

  await assert.rejects(
    () => client.post('/api/v1/admin/routes', {}, 'token'),
    (error) =>
      error instanceof ApiError &&
      error.status === 409 &&
      (error.detail as { code: string }).code === 'route_not_ready'
  );
});

test('route helpers preserve items compatibility and collect offline assets', () => {
  const route = {
    id: 'route-1',
    title: 'Route',
    title_pt: 'Percurso',
    cover_image_url: '/cover.jpg',
    routing_status: 'ready',
    legs: [
      {
        id: 'leg-1',
        position: 0,
        from_segment_id: 'one',
        to_segment_id: 'two',
        geometry: { type: 'LineString', coordinates: [[-9.1, 38.7]] },
        waypoints: [],
        distance_m: 100,
        duration_s: 60,
        provider: 'stub'
      }
    ],
    items: [
      {
        id: 'segment-1',
        position: 0,
        kind: 'text',
        text: {
          id: 'text-1',
          content: 'Text',
          content_pt: 'Texto',
          content_type: 'prose',
          author: { id: 'author-1', name: 'Author', photo_url: '/author.jpg' },
          point: { id: 'point-1', title_pt: 'Place', lat: 38.7, lng: -9.1 },
          audio_files: [{ id: 'audio-1', lang: 'pt', public_url: '/audio.mp3' }]
        }
      }
    ]
  } satisfies PublicRoute;

  assert.equal(routeSegments(route).length, 1);
  assert.deepEqual(routeAssetUrls(route), ['/cover.jpg', '/author.jpg', '/audio.mp3']);
  assert.equal(routeVersion(route), 'route-1:ready:leg-1:100:60');
});
