import type { ClientConfig } from './config.ts';
import {
  anthropicClient,
  detectLead,
  geminiClient,
  systemPrompt,
  type ChatTurn,
  type LlmClient,
} from './assistant.ts';
import { parseMetaWebhook, sendInstagram, sendWhatsapp, verifyMetaSignature } from './meta.ts';
import { widgetScript } from './widget.ts';

/** Minimal KV surface (Cloudflare Workers KV) so the handler stays testable without Workers types. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  LLM_API_KEY?: string;
  META_APP_SECRET?: string;
  META_PAGE_TOKEN?: string;
  META_VERIFY_TOKEN?: string;
  /** K-14.5: WhatsApp stays off unless the client approved Meta's per-conversation fees. */
  WHATSAPP_ENABLED?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;
  NOTIFY_TELEGRAM_TOKEN?: string;
  NOTIFY_TELEGRAM_CHAT?: string;
  /** Origin of the client's website for the chat widget (CORS). */
  ALLOWED_ORIGIN?: string;
  METRICS?: KvLike;
}

export interface HandlerDeps {
  config: ClientConfig;
  env: Env;
  fetchImpl?: typeof fetch;
  llm?: LlmClient;
  now?: () => Date;
}

const MAX_MESSAGE = 600;
const MAX_HISTORY = 10;

const month = (d: Date) => d.toISOString().slice(0, 7);

async function bump(deps: HandlerDeps, counts: Record<string, number>) {
  const kv = deps.env.METRICS;
  if (!kv) return;
  const key = `m:${month(deps.now?.() ?? new Date())}`;
  const cur = JSON.parse((await kv.get(key)) ?? '{}') as Record<string, number>;
  for (const [k, v] of Object.entries(counts)) cur[k] = (cur[k] ?? 0) + v;
  await kv.put(key, JSON.stringify(cur));
}

function llmFor(deps: HandlerDeps): LlmClient {
  if (deps.llm) return deps.llm;
  const key = deps.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY missing');
  const { provider, model } = deps.config.llm;
  return provider === 'anthropic'
    ? anthropicClient(key, model, deps.fetchImpl)
    : geminiClient(key, model, deps.fetchImpl);
}

async function notifyOwner(deps: HandlerDeps, text: string) {
  const { NOTIFY_TELEGRAM_TOKEN: token, NOTIFY_TELEGRAM_CHAT: chat } = deps.env;
  if (!token || !chat) return;
  await (deps.fetchImpl ?? fetch)(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  });
}

/** One customer message → assistant answer; a phone or e-mail in it notifies the owner (lead). */
export async function answer(
  deps: HandlerDeps,
  channel: string,
  text: string,
  history: ChatTurn[] = [],
): Promise<string> {
  const message = text.trim().slice(0, MAX_MESSAGE);
  const turns: ChatTurn[] = [
    ...history
      .slice(-MAX_HISTORY)
      .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE) })),
    { role: 'user', content: message },
  ];
  const reply = await llmFor(deps).reply(systemPrompt(deps.config), turns);
  const lead = detectLead(message);
  await bump(deps, { messages_in: 1, replies: reply ? 1 : 0, leads: lead ? 1 : 0 });
  if (lead)
    await notifyOwner(
      deps,
      `🔔 Yeni ilgilenen (${channel}): ${[lead.phone, lead.email].filter(Boolean).join(' · ')}\n\n"${message.slice(0, 300)}"`,
    );
  return reply;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const url = new URL(req.url);
  const cors: Record<string, string> = deps.env.ALLOWED_ORIGIN
    ? { 'access-control-allow-origin': deps.env.ALLOWED_ORIGIN, vary: 'origin' }
    : {};

  if (url.pathname === '/widget.js' && req.method === 'GET') {
    if (!deps.config.channels.web) return new Response('not found', { status: 404 });
    return new Response(widgetScript(url.origin, deps.config.client.name), {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  }

  if (url.pathname === '/chat') {
    if (!deps.config.channels.web) return json({ error: 'not_found' }, 404);
    if (req.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type',
        },
      });
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let body: { message?: unknown; history?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json({ error: 'bad_request' }, 400, cors);
    }
    if (typeof body.message !== 'string' || !body.message.trim())
      return json({ error: 'bad_request' }, 400, cors);
    const history = Array.isArray(body.history)
      ? (body.history as ChatTurn[]).filter(
          (t) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.content === 'string',
        )
      : [];
    try {
      return json({ reply: await answer(deps, 'web', body.message, history) }, 200, cors);
    } catch {
      return json(
        { reply: 'Şu an cevap veremiyorum; lütfen biraz sonra tekrar deneyin.' },
        200,
        cors,
      );
    }
  }

  if (url.pathname === '/meta/webhook') {
    if (req.method === 'GET') {
      // subscription handshake
      const ok =
        url.searchParams.get('hub.mode') === 'subscribe' &&
        !!deps.env.META_VERIFY_TOKEN &&
        url.searchParams.get('hub.verify_token') === deps.env.META_VERIFY_TOKEN;
      return ok
        ? new Response(url.searchParams.get('hub.challenge') ?? '')
        : new Response('forbidden', { status: 403 });
    }
    const raw = await req.text();
    if (
      !deps.env.META_APP_SECRET ||
      !(await verifyMetaSignature(
        deps.env.META_APP_SECRET,
        raw,
        req.headers.get('x-hub-signature-256'),
      ))
    )
      return new Response('forbidden', { status: 403 });
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    for (const dm of parseMetaWebhook(payload)) {
      if (
        dm.channel === 'instagram' &&
        deps.config.channels.instagram &&
        deps.env.META_PAGE_TOKEN
      ) {
        const reply = await answer(deps, 'instagram', dm.text);
        if (reply)
          await sendInstagram(deps.env.META_PAGE_TOKEN, dm.senderId, reply, deps.fetchImpl);
      }
      if (
        dm.channel === 'whatsapp' &&
        deps.config.channels.whatsapp &&
        deps.env.WHATSAPP_ENABLED === 'true' &&
        deps.env.WHATSAPP_TOKEN &&
        deps.env.WHATSAPP_PHONE_ID
      ) {
        const reply = await answer(deps, 'whatsapp', dm.text);
        if (reply)
          await sendWhatsapp(
            deps.env.WHATSAPP_TOKEN,
            deps.env.WHATSAPP_PHONE_ID,
            dm.senderId,
            reply,
            deps.fetchImpl,
          );
      }
    }
    return new Response('ok');
  }

  return new Response('not found', { status: 404 });
}

/** Monthly cron: last month's counts (no personal data) → Papi, for the client report. */
export async function pushMetrics(deps: HandlerDeps): Promise<boolean> {
  const { metrics_url, metrics_token } = deps.config.papi;
  const kv = deps.env.METRICS;
  if (!metrics_url || !kv) return false;
  const now = deps.now?.() ?? new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const counts = JSON.parse((await kv.get(`m:${month(prev)}`)) ?? '{}') as Record<string, number>;
  const res = await (deps.fetchImpl ?? fetch)(metrics_url, {
    method: 'POST',
    headers: { authorization: `Bearer ${metrics_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ period: `${month(prev)}-01`, metrics: counts }),
  });
  return res.ok;
}
