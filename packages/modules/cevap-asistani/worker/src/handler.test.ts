import { describe, expect, it } from 'vitest';
import config from '../papi-config.json';
import { clientConfigSchema, type ClientConfig } from './config.ts';
import { detectLead, systemPrompt } from './assistant.ts';
import { handle, pushMetrics, type HandlerDeps, type KvLike } from './handler.ts';
import { parseMetaWebhook } from './meta.ts';

const base = clientConfigSchema.parse(config);

class MemKv implements KvLike {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.data.set(k, v);
  }
}

function deps(over: Partial<ClientConfig> = {}, env: HandlerDeps['env'] = {}) {
  const calls: { url: string; body: string }[] = [];
  const kv = new MemKv();
  const prompts: string[] = [];
  const d: HandlerDeps = {
    config: { ...base, ...over },
    env: { METRICS: kv, NOTIFY_TELEGRAM_TOKEN: 't', NOTIFY_TELEGRAM_CHAT: '1', ...env },
    now: () => new Date('2026-10-13T10:00:00Z'),
    llm: {
      async reply(system) {
        prompts.push(system);
        return 'Tabii, yarın 14:00 uygun.';
      },
    },
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  };
  return { d, calls, kv, prompts };
}

async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

describe('cevap asistanı (K-14.3 reference implementation)', () => {
  it('builds its instructions only from the client config', () => {
    const p = systemPrompt(base);
    expect(p).toContain('Örnek Diş Kliniği adına');
    expect(p).toContain('- İmplant');
    expect(p).toContain('Fiyat pazarlığı, şikayetler');
    expect(p).not.toContain(base.contact.phone); // owner's own contact is not handed to customers
  });

  it('web chat answers, counts, and notifies the owner when a lead leaves a number', async () => {
    const { d, calls, kv } = deps({}, { ALLOWED_ORIGIN: 'https://ornek.example' });
    const res = await handle(
      new Request('https://w.test/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Yarın randevu var mı? Numaram 0532 111 22 33' }),
      }),
      d,
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('https://ornek.example');
    expect(((await res.json()) as { reply: string }).reply).toContain('14:00');
    expect(JSON.parse(kv.data.get('m:2026-10') ?? '{}')).toEqual({
      messages_in: 1,
      replies: 1,
      leads: 1,
    });
    expect(
      calls.some((c) => c.url.includes('api.telegram.org') && c.body.includes('0532 111 22 33')),
    ).toBe(true);
  });

  it('serves the widget only when the web channel is on', async () => {
    expect((await handle(new Request('https://w.test/widget.js'), deps().d)).status).toBe(200);
    const off = deps({ channels: { web: false, instagram: true, whatsapp: false } }).d;
    expect((await handle(new Request('https://w.test/widget.js'), off)).status).toBe(404);
  });

  it('Instagram webhook: handshake, signature check, reply via the Graph API', async () => {
    const { d, calls } = deps(
      {},
      { META_VERIFY_TOKEN: 'v', META_APP_SECRET: 's', META_PAGE_TOKEN: 'p' },
    );
    const hs = await handle(
      new Request(
        'https://w.test/meta/webhook?hub.mode=subscribe&hub.verify_token=v&hub.challenge=42',
      ),
      d,
    );
    expect(await hs.text()).toBe('42');
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ messaging: [{ sender: { id: 'u1' }, message: { text: 'Fiyat nedir?' } }] }],
    });
    const forged = await handle(
      new Request('https://w.test/meta/webhook', {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': 'sha256=00' },
      }),
      d,
    );
    expect(forged.status).toBe(403);
    const ok = await handle(
      new Request('https://w.test/meta/webhook', {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': await sign('s', body) },
      }),
      d,
    );
    expect(ok.status).toBe(200);
    const sent = calls.find((c) => c.url.includes('graph.facebook.com'));
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({
      recipient: { id: 'u1' },
      message: { text: 'Tabii, yarın 14:00 uygun.' },
    });
  });

  it('WhatsApp stays off unless explicitly enabled (K-14.5)', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '905321112233', type: 'text', text: { body: 'Merhaba' } }],
              },
            },
          ],
        },
      ],
    });
    const env = { META_APP_SECRET: 's', WHATSAPP_TOKEN: 'w', WHATSAPP_PHONE_ID: '1' };
    const on = { channels: { web: true, instagram: true, whatsapp: true } };
    const off = deps(on, env);
    await handle(
      new Request('https://w.test/meta/webhook', {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': await sign('s', body) },
      }),
      off.d,
    );
    expect(off.calls.some((c) => c.url.includes('/messages'))).toBe(false);
    const enabled = deps(on, { ...env, WHATSAPP_ENABLED: 'true' });
    await handle(
      new Request('https://w.test/meta/webhook', {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': await sign('s', body) },
      }),
      enabled.d,
    );
    expect(enabled.calls.some((c) => c.url.endsWith('/1/messages'))).toBe(true);
  });

  it('pushes last month’s counts to Papi with the project token', async () => {
    const { d, calls, kv } = deps({
      papi: { metrics_url: 'https://api.test/metrics/push', metrics_token: 'x'.repeat(43) },
    });
    kv.data.set('m:2026-09', JSON.stringify({ messages_in: 40, leads: 3 }));
    expect(await pushMetrics(d)).toBe(true);
    const call = calls.find((c) => c.url === 'https://api.test/metrics/push')!;
    expect(JSON.parse(call.body)).toEqual({
      period: '2026-09-01',
      metrics: { messages_in: 40, leads: 3 },
    });
  });

  it('lead detection and webhook parsing helpers', () => {
    expect(detectLead('beni arayın 0532 111 22 33')?.phone).toBe('0532 111 22 33');
    expect(detectLead('mail: a@b.co')?.email).toBe('a@b.co');
    expect(detectLead('fiyat nedir')).toBeNull();
    expect(
      parseMetaWebhook({
        object: 'instagram',
        entry: [{ messaging: [{ sender: { id: 'x' }, message: { text: 'echo', is_echo: true } }] }],
      }),
    ).toEqual([]);
  });
});
