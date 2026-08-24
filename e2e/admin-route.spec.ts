import { expect, test } from '@playwright/test';
import { adminTexts, mapStyle } from './routeFixture';

test('admin creates, orders, bridges, routes, previews and publishes a narrative route', async ({ page }) => {
  let savedRoute: Record<string, unknown> | null = null;
  let recalculateFails = false;
  let publishedPayload: Record<string, unknown> | null = null;
  await page.addInitScript(() => localStorage.setItem('ecosdelisboa.admin.token', 'e2e-token'));
  await page.route('**/demotiles.maplibre.org/style.json', (request) => request.fulfill({ json: mapStyle }));
  await page.route('**/api/v1/admin/**', async (request) => {
    const url = new URL(request.request().url());
    const method = request.request().method();
    const envelope = (data: unknown) => request.fulfill({ json: { data, meta: {} } });
    if (url.pathname.endsWith('/auth/me')) return envelope({ id: 'admin', email: 'admin@example.com', is_active: true });
    if (url.pathname.endsWith('/texts')) return envelope(adminTexts);
    if (url.pathname.endsWith('/routes') && method === 'GET') return envelope([]);
    if (url.pathname.endsWith('/routes') && method === 'POST') {
      const payload = request.request().postDataJSON();
      const segments = payload.segments.map((segment: Record<string, unknown>, index: number) => ({
        ...segment, id: `segment-${index}`,
        text: segment.kind === 'text' ? adminTexts.find((text) => text.id === segment.text_id) : undefined,
        translations: [], audio_files: []
      }));
      savedRoute = { ...payload, id: 'route-admin-e2e', routing_status: 'pending', migration_status: 'ready', estimated_distance_m: null, estimated_duration_s: null, segments, legs: [] };
      return envelope(savedRoute);
    }
    if (url.pathname.endsWith('/recalculate') && method === 'POST') {
      if (recalculateFails) return request.fulfill({ status: 503, json: { detail: 'routing unavailable' } });
      const payload = request.request().postDataJSON();
      const segments = (savedRoute?.segments ?? []) as Array<Record<string, unknown>>;
      const result = {
        route_id: 'route-admin-e2e', routing_status: 'ready', estimated_distance_m: 180, estimated_duration_s: 150,
        legs: [{ id: 'leg', position: 0, from_segment_id: segments[0]?.id, to_segment_id: segments[2]?.id, geometry: { type: 'LineString', coordinates: [[-9.136, 38.707], [-9.137, 38.709]] }, waypoints: payload.legs[0]?.waypoints ?? [], distance_m: 180, duration_s: 150, provider: 'stub' }]
      };
      savedRoute = { ...savedRoute, ...result };
      return envelope(result);
    }
    if (url.pathname.includes('/readiness')) return envelope({ lang: url.searchParams.get('lang') ?? 'pt', ready: true, issues: [] });
    if (url.pathname.endsWith('/route-admin-e2e') && method === 'PUT') {
      publishedPayload = request.request().postDataJSON();
      savedRoute = { ...savedRoute, ...publishedPayload };
      return envelope(savedRoute);
    }
    return envelope([]);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Percursos' }).click();
  await page.getByRole('button', { name: 'Novo' }).click();
  await page.getByLabel('Título em português').fill('Percurso E2E');
  await page.getByRole('button', { name: /Almeida Garrett/ }).click();
  await page.getByRole('button', { name: /Fernando Pessoa/ }).click();
  await page.getByRole('button', { name: '+ Ponte curatorial' }).click();
  await page.locator('.narrative-card.bridge textarea').fill('A praça dá lugar à rua.');
  await page.locator('.narrative-card.bridge').getByRole('button', { name: 'Mover para cima' }).click();
  await expect(page.locator('.narrative-card').nth(1)).toContainText('Ponte curatorial');
  await page.getByRole('button', { name: 'Guardar percurso' }).click();
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Percurso E2E 2 textos/ })).toBeVisible();

  await page.getByRole('button', { name: '+ Waypoint no mapa' }).click();
  await expect(page.getByText('Clique no mapa para fixar o waypoint')).toBeVisible();
  await page.locator('.route-map canvas').click({ position: { x: 180, y: 140 } });
  await expect(page.getByText(/Waypoint adicionado/)).toBeVisible();
  await page.getByRole('button', { name: 'Recalcular caminhada' }).click();
  await expect(page.getByText('Rota pedonal recalculada e guardada.')).toBeVisible();
  await expect(page.getByText('Preview do visitante')).toBeVisible();
  await expect(page.getByText('Almeida Garrett').last()).toBeVisible();

  recalculateFails = true;
  await page.getByRole('button', { name: 'Recalcular caminhada' }).click();
  await expect(page.getByText(/última geometria válida foi preservada/)).toBeVisible();
  await page.getByLabel('Publicar').check();
  await page.getByRole('button', { name: 'Guardar percurso' }).click();
  await expect.poll(() => publishedPayload?.is_published).toBe(true);
});
