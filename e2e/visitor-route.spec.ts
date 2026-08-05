import { expect, test, type Page } from '@playwright/test';
import { mapStyle, publicRoute } from './routeFixture';

async function prepareVisitor(page: Page, route = publicRoute) {
  await page.addInitScript(() => {
    localStorage.setItem('lisboa.onboarded', 'true');
    localStorage.setItem('lisboa.language', 'pt');
    class MockAudio extends EventTarget {
      static playCalls = 0;
      src: string;
      constructor(src: string) { super(); this.src = src; }
      play() { MockAudio.playCalls += 1; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
      pause() { return undefined; }
    }
    Object.defineProperty(window, 'Audio', { value: MockAudio });
    Object.defineProperty(window, '__audioPlayCalls', { get: () => MockAudio.playCalls });
  });
  await page.route('**/demotiles.maplibre.org/style.json', (request) => request.fulfill({ json: mapStyle }));
  await page.route(`**/api/v1/routes/${route.id}/approach`, (request) => request.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        geometry: { type: 'LineString', coordinates: [[-9.14, 38.7], [route.segments[0].text.point.lng, route.segments[0].text.point.lat]] },
        distance_m: 920,
        duration_s: 690,
        provider: 'stub',
        destination_segment_id: route.segments[0].id
      },
      meta: {}
    })
  }));
  await page.route(new RegExp(`/api/v1/routes/${route.id}\\?`), (request) => request.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: route, meta: {} })
  }));
  await page.route(/\/api\/v1\/routes\?/, (request) => request.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: [route], meta: { total: 1 } })
  }));
  await page.route('**/audio/*.mp3', (request) => request.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from([1, 2, 3, 4]) }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Percursos' }).click();
  await expect(page.getByRole('heading', { name: route.title })).toBeVisible();
}

test('visitor downloads, starts, listens, walks and completes the narrative', async ({ page }) => {
  await prepareVisitor(page);
  await page.getByRole('button', { name: /Baixar percurso/ }).click();
  await expect(page.getByText(/Disponível offline/)).toBeVisible();
  await page.getByRole('button', { name: 'Começar percurso' }).click();
  expect(await page.evaluate(() => (window as Window & { __audioPlayCalls?: number }).__audioPlayCalls)).toBe(0);
  await expect(page.getByText('Indo ao primeiro texto')).toBeVisible();
  await page.getByRole('button', { name: 'Cheguei' }).click();
  await page.getByRole('button', { name: 'Ouvir este texto' }).click();
  await expect(page.getByRole('button', { name: 'Ouvindo…' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar percurso' }).click();
  await page.getByRole('button', { name: 'Expandir informações' }).click();
  await expect(page.getByRole('button', { name: /Entre na malha da Baixa/ })).toBeVisible();
  await page.getByRole('button', { name: 'Cheguei' }).click();
  await page.getByRole('button', { name: 'Ouvir este texto' }).click();
  await page.getByRole('button', { name: 'Concluir percurso' }).click();
  await expect(page.getByText('Percurso concluído')).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('ecos-route-session:route-e2e') ?? '{}'));
  expect(session.phase).toBe('completed');
});

test('accurate GPS calculates and persists the route to the first text', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition: (success: PositionCallback) => {
        success({ coords: { latitude: 38.7, longitude: -9.14, accuracy: 9 } } as GeolocationPosition);
        return 1;
      },
      clearWatch: () => undefined
    } });
  });
  await prepareVisitor(page);
  await page.getByRole('button', { name: 'Começar percurso' }).click();
  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('ecos-route-session:route-e2e') ?? '{}');
    return session.approach_leg?.distance_m;
  })).toBe(920);
  await expect(page.getByRole('button', { name: 'Recentralizar na minha localização' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cheguei' })).toBeVisible();
});

test('downloaded route remains available after the API network disappears', async ({ page }) => {
  await prepareVisitor(page);
  await page.getByRole('button', { name: /Baixar percurso/ }).click();
  await expect(page.getByText(/Disponível offline/)).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await page.route(/^http:\/\/localhost:8000\/api\//, (request) => request.abort('internetdisconnected'));
  await page.reload();
  await page.getByRole('button', { name: 'Percursos' }).click();
  await expect(page.getByText(publicRoute.title).first()).toBeVisible();
});

test('manual arrival remains available with imprecise GPS and absent audio', async ({ page }) => {
  const noAudio = { ...publicRoute, segments: publicRoute.segments.map((segment) =>
    segment.kind === 'text' ? { ...segment, text: { ...segment.text, audio_files: [] } } : segment) };
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition: (success: PositionCallback) => {
        success({ coords: { latitude: 38.7, longitude: -9.13, accuracy: 120 } } as GeolocationPosition);
        return 1;
      },
      clearWatch: () => undefined
    } });
  });
  await prepareVisitor(page, noAudio);
  await page.getByRole('button', { name: 'Começar percurso' }).click();
  await expect(page.getByText(/precisão do GPS está baixa/)).toBeVisible();
  await page.getByRole('button', { name: 'Cheguei' }).click();
  await expect(page.getByText(/Áudio indisponível/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar percurso' })).toBeEnabled();
});

test('manual arrival remains available when location permission is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
        return 1;
      },
      clearWatch: () => undefined
    } });
  });
  await prepareVisitor(page);
  await page.getByRole('button', { name: 'Começar percurso' }).click();
  await expect(page.getByText(/Permissão de localização negada/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cheguei' })).toBeEnabled();
});

test('mobile walking keeps a full-screen map and a compact bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareVisitor(page);
  await page.getByRole('button', { name: 'Começar percurso' }).click();

  const layout = await page.evaluate(() => {
    const session = document.querySelector<HTMLElement>('.guided-route-session');
    const map = document.querySelector<HTMLElement>('.guided-route-map');
    const panel = document.querySelector<HTMLElement>('.guided-route-panel');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      session: session?.getBoundingClientRect().toJSON(),
      map: map?.getBoundingClientRect().toJSON(),
      panel: panel?.getBoundingClientRect().toJSON(),
      panelCollapsed: panel?.classList.contains('collapsed')
    };
  });

  expect(layout.session?.width).toBe(layout.viewport.width);
  expect(layout.session?.height).toBe(layout.viewport.height);
  expect(layout.map?.width).toBe(layout.viewport.width);
  expect(layout.map?.height).toBe(layout.viewport.height);
  expect(layout.panelCollapsed).toBe(true);
  expect(layout.panel?.height).toBeLessThanOrEqual(140);
  await expect(page.getByRole('button', { name: 'Cheguei' })).toBeVisible();
});
