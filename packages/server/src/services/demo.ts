import { redactPersonal, type ChatMessage, type LLMService } from '@papi/core';
import { demoAssistant } from '@papi/prompts';
import type { CompanyRow, Repo } from '../repo/types.ts';

export interface DemoDeps {
  repo: Repo;
  now?: () => Date;
}

const MAX_MESSAGE = 500;
const MAX_HISTORY = 6;

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes: an unguessable capability token (K-13.7, K-17.4). */
export function newDemoToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Everything the demo assistant may know: the business's own public information, nothing else. */
export function demoSnapshot(c: CompanyRow): Record<string, unknown> {
  return {
    isletme: c.name,
    sektor: c.sector,
    il: c.city,
    ilce: c.district,
    adres: c.address,
    web: c.website_url,
    instagram: c.instagram_handle ? `@${c.instagram_handle}` : null,
    telefon: c.phone_e164 ? `+${c.phone_e164}` : null,
  };
}

/** Creates (or reuses the active) 14-day demo for a company. */
export async function createDemo(
  deps: DemoDeps,
  companyId: string,
): Promise<{ token: string; expiresAt: string; reused: boolean }> {
  const active = await deps.repo.activeDemo(companyId);
  if (active) return { token: active.token, expiresAt: active.expires_at, reused: true };
  const company = await deps.repo.getCompany(companyId);
  if (!company) throw new Error('Firma bulunamadı');
  const settings = await deps.repo.getSettings();
  const now = deps.now?.() ?? new Date();
  const expiresAt = new Date(now.getTime() + settings.demo.ttl_days * 86_400_000).toISOString();
  const token = newDemoToken();
  await deps.repo.createDemo({
    company_id: companyId,
    token,
    snapshot: demoSnapshot(company),
    expires_at: expiresAt,
  });
  await deps.repo.addCompanyEvent(companyId, 'demo_created', 'Kişiye özel demo oluşturuldu');
  return { token, expiresAt, reused: false };
}

export function demoUrl(publicApiUrl: string, token: string): string {
  return `${publicApiUrl.replace(/\/$/, '')}/demo/${token}`;
}

export type DemoChatResult =
  | { ok: true; reply: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'demo_limit' | 'total_limit' | 'empty' };

/**
 * One visitor message on a public demo page. Limits are enforced in the database (per demo and in
 * total per day); visitor text is redacted (K-4.9) and never stored, only counted.
 */
export async function demoChat(
  deps: DemoDeps & { llm: LLMService },
  token: string,
  message: string,
  history: ChatMessage[],
): Promise<DemoChatResult> {
  const text = message.trim().slice(0, MAX_MESSAGE);
  if (!text) return { ok: false, reason: 'empty' };
  const settings = await deps.repo.getSettings();
  const hit = await deps.repo.demoTouch(
    token,
    'message',
    settings.demo.messages_per_demo_per_day,
    settings.demo.messages_total_per_day,
  );
  if (hit.result !== 'ok' || !hit.snapshot) {
    return { ok: false, reason: hit.result === 'ok' ? 'not_found' : hit.result };
  }
  const clean = (s: string) => redactPersonal(s.slice(0, MAX_MESSAGE)).text;
  const messages: ChatMessage[] = [
    ...history.slice(-MAX_HISTORY).map((m) => ({
      role: m.role,
      content: m.role === 'user' ? clean(m.content) : m.content.slice(0, 800),
    })),
    { role: 'user', content: clean(text) },
  ];
  const res = await deps.llm.generate({
    agent: 'demo',
    task: 'demo.chat',
    tier: 'light',
    dataClass: 'internal',
    promptId: demoAssistant.id,
    promptVersion: demoAssistant.version,
    system: `${demoAssistant.text}\n\nİşletme bilgileri:\n${JSON.stringify(hit.snapshot)}`,
    messages,
    maxOutputTokens: 300,
  });
  return { ok: true, reply: res.text.trim() };
}
