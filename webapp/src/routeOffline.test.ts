import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicRoute } from '@ecosdelisboa/shared';
import { downloadRoute, readOfflineRoute, readRouteManifests, routeDownloadState } from './routeOffline.ts';

const route: PublicRoute = { id: 'route', title: 'Route', title_pt: 'Percurso', routing_status: 'ready', legs: [] };

test('tolerates missing and corrupt offline manifests', () => {
  assert.deepEqual(readRouteManifests({ getItem: () => null }), []);
  assert.deepEqual(readRouteManifests({ getItem: () => '{invalid' }), []);
});

test('distinguishes incomplete, ready and outdated route downloads', () => {
  const base = { route_id: 'route', route_version: 'wrong', lang: 'pt' as const, asset_urls: [], downloaded_at: 'now' };
  assert.equal(routeDownloadState(route, 'pt', []), 'missing');
  assert.equal(routeDownloadState(route, 'pt', [{ ...base, complete: false }]), 'incomplete');
  assert.equal(routeDownloadState(route, 'pt', [{ ...base, complete: true }]), 'update');
  assert.equal(routeDownloadState(route, 'pt', [{ ...base, route_version: 'route:ready:', complete: true }]), 'ready');
});

test('keeps an incomplete marker on network loss and serves a completed route without network', async () => {
  const values = new Map<string, string>();
  const responses = new Map<string, Response>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
  const cache = {
    put: async (request: RequestInfo | URL, response: Response) => { responses.set(String(request), response.clone()); },
    match: async (request: RequestInfo | URL) => responses.get(String(request))?.clone(),
    delete: async (request: RequestInfo | URL) => responses.delete(String(request))
  };
  Object.assign(globalThis, {
    window: { location: { origin: 'https://example.test', href: 'https://example.test/routes' }, caches: true },
    localStorage: storage,
    caches: { open: async () => cache, match: cache.match }
  });
  const downloadable = { ...route, cover_image_url: '/cover.jpg' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(downloadRoute(downloadable, 'pt'));
  assert.equal(readRouteManifests(storage)[0]?.complete, false);

  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  await downloadRoute(downloadable, 'pt');
  globalThis.fetch = async () => { throw new Error('offline again'); };
  assert.deepEqual(await readOfflineRoute('route', 'pt'), downloadable);
  globalThis.fetch = originalFetch;
});
