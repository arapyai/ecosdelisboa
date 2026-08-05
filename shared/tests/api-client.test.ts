import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from '../src/index.ts';

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
