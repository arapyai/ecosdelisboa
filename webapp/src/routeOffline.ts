import {
  routeAssetUrls,
  routeVersion,
  type OfflineRouteManifest,
  type PublicRoute,
  type SupportedLanguage
} from '@ecosdelisboa/shared';

export const ROUTE_CACHE_NAME = 'ecos-narrative-routes-v1';
const MANIFESTS_KEY = 'ecos-offline-route-manifests';

export interface StoredRouteManifest extends OfflineRouteManifest {
  complete: boolean;
}

export interface DownloadProgress {
  completed: number;
  total: number;
  bytes: number;
}

export function routeDetailCacheUrl(routeId: string, lang: SupportedLanguage) {
  return new URL(`/__offline_routes/${routeId}/${lang}.json`, window.location.origin).href;
}

export function readRouteManifests(storage: Pick<Storage, 'getItem'> = localStorage): StoredRouteManifest[] {
  try {
    const value = JSON.parse(storage.getItem(MANIFESTS_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function routeDownloadState(route: PublicRoute, lang: SupportedLanguage, manifests = readRouteManifests()) {
  const manifest = manifests.find((item) => item.route_id === route.id && item.lang === lang);
  if (!manifest) return 'missing' as const;
  if (!manifest.complete) return 'incomplete' as const;
  if (manifest.route_version !== routeVersion(route)) return 'update' as const;
  return 'ready' as const;
}

export async function estimateRouteBytes(route: PublicRoute) {
  let bytes = new Blob([JSON.stringify(route)]).size;
  await Promise.all(routeAssetUrls(route).map(async (url) => {
    try {
      const response = await fetch(resolveAssetUrl(url), { method: 'HEAD' });
      bytes += Number(response.headers.get('content-length') ?? 0);
    } catch {
      // The exact size is optional; downloading still works without HEAD support.
    }
  }));
  return bytes;
}

export async function downloadRoute(
  route: PublicRoute,
  lang: SupportedLanguage,
  onProgress: (progress: DownloadProgress) => void = () => undefined
): Promise<StoredRouteManifest> {
  if (!('caches' in window)) throw new Error('Cache API unavailable');
  const cache = await caches.open(ROUTE_CACHE_NAME);
  const assetUrls = routeAssetUrls(route).map(resolveAssetUrl);
  const previous = findManifest(route.id, lang);
  const incomplete: StoredRouteManifest = {
    route_id: route.id,
    route_version: routeVersion(route),
    lang,
    asset_urls: assetUrls,
    downloaded_at: new Date().toISOString(),
    estimated_bytes: previous?.estimated_bytes,
    complete: false
  };
  writeManifest(incomplete);
  let bytes = new Blob([JSON.stringify(route)]).size;
  onProgress({ completed: 0, total: assetUrls.length + 1, bytes });
  for (let index = 0; index < assetUrls.length; index += 1) {
    const url = assetUrls[index];
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Asset download failed: ${response.status}`);
    const copy = response.clone();
    bytes += (await copy.blob()).size;
    await cache.put(url, response);
    onProgress({ completed: index + 1, total: assetUrls.length + 1, bytes });
  }
  await cache.put(
    routeDetailCacheUrl(route.id, lang),
    new Response(JSON.stringify(route), { headers: { 'content-type': 'application/json' } })
  );
  onProgress({ completed: assetUrls.length + 1, total: assetUrls.length + 1, bytes });
  const complete = { ...incomplete, complete: true, estimated_bytes: bytes, downloaded_at: new Date().toISOString() };
  writeManifest(complete);
  return complete;
}

export async function readOfflineRoute(routeId: string, lang: SupportedLanguage): Promise<PublicRoute | null> {
  if (!('caches' in window)) return null;
  const manifest = findManifest(routeId, lang);
  if (!manifest?.complete) return null;
  const response = await caches.match(routeDetailCacheUrl(routeId, lang));
  return response ? response.json() as Promise<PublicRoute> : null;
}

export async function listOfflineRoutes(lang: SupportedLanguage) {
  const manifests = readRouteManifests().filter((manifest) => manifest.lang === lang && manifest.complete);
  return (await Promise.all(manifests.map((manifest) => readOfflineRoute(manifest.route_id, lang))))
    .filter((route): route is PublicRoute => route !== null);
}

export async function removeOfflineRoute(routeId: string, lang: SupportedLanguage) {
  if (!('caches' in window)) return;
  const manifest = findManifest(routeId, lang);
  const cache = await caches.open(ROUTE_CACHE_NAME);
  await Promise.all((manifest?.asset_urls ?? []).map((url) => cache.delete(url)));
  await cache.delete(routeDetailCacheUrl(routeId, lang));
  const remaining = readRouteManifests().filter((item) => item.route_id !== routeId || item.lang !== lang);
  localStorage.setItem(MANIFESTS_KEY, JSON.stringify(remaining));
}

export async function offlinePlayableUrl(url: string) {
  if (!('caches' in window)) return url;
  const response = await caches.match(resolveAssetUrl(url));
  return response ? URL.createObjectURL(await response.blob()) : url;
}

function findManifest(routeId: string, lang: SupportedLanguage) {
  return readRouteManifests().find((item) => item.route_id === routeId && item.lang === lang);
}

function writeManifest(manifest: StoredRouteManifest) {
  const others = readRouteManifests().filter((item) => item.route_id !== manifest.route_id || item.lang !== manifest.lang);
  localStorage.setItem(MANIFESTS_KEY, JSON.stringify([...others, manifest]));
}

function resolveAssetUrl(url: string) {
  return new URL(url, window.location.href).href;
}
