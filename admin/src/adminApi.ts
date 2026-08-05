import { ApiError, isEnvelope } from '@ecosdelisboa/shared';
import { API_BASE, ENABLE_MOCKS } from './adminConfig';

export function isAuthError(cause: unknown) {
  return cause instanceof ApiError && (cause.status === 401 || cause.status === 403);
}

export function fallbackUnlessAuth<T>(cause: unknown, fallback: T, onAuthExpired: () => void): T {
  if (isAuthError(cause)) {
    onAuthExpired();
    throw cause;
  }
  if (!ENABLE_MOCKS) throw cause;
  return fallback;
}

export function redirectIfAuthError(cause: unknown, onAuthExpired: () => void) {
  if (!isAuthError(cause)) return false;
  onAuthExpired();
  return true;
}

export function toQuery(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function toAssetUrl(url?: string | null) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE}${url}`;
}

export async function postCsv<T>(path: string, file: File, token: string): Promise<T> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body
  });

  if (!response.ok) {
    throw new ApiError(`Falha ao enviar CSV: ${path}`, response.status, path);
  }

  const payload = (await response.json()) as T;
  return isEnvelope(payload) ? payload.data : payload;
}

export async function postFile<T>(path: string, file: File, token: string): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    body
  });
  if (!response.ok) throw new ApiError(`Falha ao enviar pacote: ${path}`, response.status, path);
  const payload = (await response.json()) as T;
  return isEnvelope(payload) ? payload.data : payload;
}

export async function postBlob(path: string, payload: unknown, token: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/zip',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new ApiError(`Falha ao exportar pacote: ${path}`, response.status, path);
  return response.blob();
}

export async function putMp3<T>(path: string, file: File, token: string): Promise<T> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body
  });

  if (!response.ok) {
    throw new ApiError(`Falha ao enviar MP3: ${path}`, response.status, path);
  }

  const payload = (await response.json()) as T;
  return isEnvelope(payload) ? payload.data : payload;
}

export async function fetchCsvTemplate(token: string) {
  const path = '/api/v1/admin/points/import/template';
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new ApiError('Não foi possível baixar o modelo CSV.', response.status, path);
  }

  return response.blob();
}
