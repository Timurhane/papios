import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('api', () => {
  const app = createApp();

  it('GET /health reports ok', async () => {
    const res = await app.request('/health', {}, { APP_ENV: 'test' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'papi-api', env: 'test' });
  });

  it('returns 500 without leaking details when env is invalid', async () => {
    const res = await app.request('/health', {}, { APP_ENV: 'nope' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
  });

  it('unknown routes return 404 json', async () => {
    const res = await app.request('/nope', {}, { APP_ENV: 'test' });
    expect(res.status).toBe(404);
  });
});
