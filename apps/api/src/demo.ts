import type { ChatMessage, LLMService } from '@papi/core';
import { demoChat, type Repo } from '@papi/server';
import { z } from 'zod';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const STYLE = `
  *{box-sizing:border-box} body{margin:0;min-height:100vh;background:#05050a;color:#ededf5;
    font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;padding:16px}
  main{max-width:560px;width:100%;display:flex;flex-direction:column;gap:12px}
  header h1{font-size:20px;margin:0} header p{margin:4px 0 0;color:#a3a3bb;font-size:14px}
  #log{flex:1;min-height:50vh;background:#0c0c16;border:1px solid #1f1f33;border-radius:16px;padding:16px;
    display:flex;flex-direction:column;gap:10px;overflow-y:auto}
  .m{max-width:85%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
  .u{align-self:flex-end;background:linear-gradient(90deg,#8b5cf6,#3b82f6);color:#fff}
  .a{align-self:flex-start;background:#17172a}
  form{display:flex;gap:8px} input{flex:1;height:46px;border-radius:12px;border:1px solid #1f1f33;background:#11111d;
    color:#ededf5;padding:0 14px;font-size:16px} button{height:46px;border:0;border-radius:12px;padding:0 18px;
    font-weight:600;color:#fff;background:linear-gradient(90deg,#8b5cf6,#3b82f6);cursor:pointer}
  button:disabled{opacity:.5} small{color:#6b6b85;text-align:center}`;

const shell = (title: string, body: string, head = '') => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style>${head}</head>
<body><main>${body}<small>Bu demo AJNA Digital tarafından hazırlanmıştır · ajnadigitalagency.com</small></main></body></html>`;

export function demoExpiredPage(): string {
  return shell(
    'Demo süresi doldu',
    `<header><h1>Bu demonun süresi doldu</h1><p>Kendi işletmenize özel asistanı yeniden görmek için AJNA Digital'e yazabilirsiniz.</p></header>`,
  );
}

export function demoNotFoundPage(): string {
  return shell(
    'Demo bulunamadı',
    '<header><h1>Demo bulunamadı</h1><p>Bağlantıyı kontrol edin.</p></header>',
  );
}

export function demoPage(opts: {
  businessName: string;
  expiresAt: string;
  turnstileSiteKey: string | null;
}): string {
  const until = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(opts.expiresAt));
  const head = opts.turnstileSiteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>'
    : '';
  return shell(
    `${opts.businessName} · Asistan demosu`,
    `<header><h1>${esc(opts.businessName)} · Mesaj asistanı</h1>
<p>Müşterilerinizin yazacağı gibi bir mesaj yazın; asistan işletmeniz adına cevap versin. Demo ${esc(until)} tarihine kadar açık.</p></header>
<div id="log" aria-live="polite"><div class="m a">Merhaba! ${esc(opts.businessName)} adına size nasıl yardımcı olabilirim?</div></div>
<div id="ts"></div>
<form id="f"><input id="q" maxlength="500" autocomplete="off" placeholder="Örn: Yarın için randevu alabilir miyim?" aria-label="Mesajınız"><button id="b">Gönder</button></form>
<script>
(() => {
  const siteKey = ${JSON.stringify(opts.turnstileSiteKey)};
  const log = document.getElementById('log'), f = document.getElementById('f'), q = document.getElementById('q'), b = document.getElementById('b');
  const history = []; let token = null, widget = null, waiters = [];
  const add = (cls, text) => { const d = document.createElement('div'); d.className = 'm ' + cls; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; };
  const nextToken = () => !siteKey ? Promise.resolve('') : token ? Promise.resolve(token) : new Promise((r) => waiters.push(r));
  window.addEventListener('load', () => {
    if (!siteKey || !window.turnstile) return;
    widget = turnstile.render('#ts', { sitekey: siteKey, appearance: 'interaction-only',
      callback: (t) => { token = t; waiters.splice(0).forEach((w) => w(t)); } });
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const text = q.value.trim(); if (!text) return;
    q.value = ''; b.disabled = true; add('u', text);
    try {
      const t = await nextToken(); token = null;
      const res = await fetch(location.pathname + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, history, turnstileToken: t }) });
      const j = await res.json();
      const reply = j.reply || j.message || 'Şu an cevap veremiyorum, biraz sonra tekrar deneyin.';
      add('a', reply);
      if (j.reply) { history.push({ role: 'user', content: text }, { role: 'assistant', content: j.reply }); }
    } catch { add('a', 'Bağlantı hatası, tekrar deneyin.'); }
    finally { b.disabled = false; if (widget !== null) turnstile.reset(widget); }
  });
})();
</script>`,
    head,
  );
}

const chatSchema = z.object({
  message: z.string().min(1).max(500),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(20)
    .default([]),
  turnstileToken: z.string().max(4096).default(''),
});

const LIMIT_TEXT: Record<string, string> = {
  not_found: 'Demo bulunamadı.',
  expired: 'Bu demonun süresi doldu.',
  demo_limit: 'Bugünlük demo mesaj sınırına ulaşıldı. Yarın tekrar deneyebilirsiniz.',
  total_limit: 'Demo şu an yoğun. Biraz sonra tekrar deneyin.',
  empty: 'Bir mesaj yazın.',
  rate: 'Çok hızlı mesaj gönderiliyor; biraz bekleyin.',
  bot: 'Doğrulama başarısız; sayfayı yenileyip tekrar deneyin.',
  bad_request: 'Geçersiz istek.',
};

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** K-3.12: Cloudflare Turnstile server-side check. */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!res.ok) return false;
  return Boolean(((await res.json()) as { success?: boolean }).success);
}

export interface DemoChatDeps {
  repo: Repo;
  llm: LLMService;
  /** null outside production: Turnstile is skipped in development and tests. */
  turnstileSecret: string | null;
  requireTurnstile: boolean;
  fetchImpl?: typeof fetch;
}

/** POST /demo/:token/chat → { reply } or { message } with an HTTP status. */
export async function handleDemoChat(
  deps: DemoChatDeps,
  token: string,
  raw: unknown,
  ip: string | null,
): Promise<{
  status: 200 | 400 | 403 | 404 | 410 | 429;
  body: { reply?: string; message?: string };
}> {
  const parsed = chatSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { message: LIMIT_TEXT.bad_request } };
  const { message, history, turnstileToken } = parsed.data;

  if (deps.requireTurnstile) {
    if (!deps.turnstileSecret) return { status: 403, body: { message: LIMIT_TEXT.bot } };
    if (!(await verifyTurnstile(deps.turnstileSecret, turnstileToken, ip, deps.fetchImpl)))
      return { status: 403, body: { message: LIMIT_TEXT.bot } };
  }
  // per-IP limit, IP hashed (not stored raw): 20 messages per 10 minutes
  const key = `demo:${await sha256Hex(ip ?? 'unknown')}`;
  if (!(await deps.repo.hitRateLimit(key, 600, 20)))
    return { status: 429, body: { message: LIMIT_TEXT.rate } };

  const r = await demoChat(
    { repo: deps.repo, llm: deps.llm },
    token,
    message,
    history as ChatMessage[],
  );
  if (r.ok) return { status: 200, body: { reply: r.reply } };
  const status =
    r.reason === 'not_found'
      ? 404
      : r.reason === 'expired'
        ? 410
        : r.reason === 'empty'
          ? 400
          : 429;
  return { status, body: { message: LIMIT_TEXT[r.reason] ?? LIMIT_TEXT.bad_request } };
}
