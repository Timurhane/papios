import { defaultSettings, LLMService, type LLMProvider } from '@papi/core';
import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../repo/memory.ts';
import type { MailTransport, OutgoingMail } from './mail.ts';
import { runToolAnalysis, submitToolRequest, toolReportByToken, type ToolDeps } from './tool.ts';

class FakeMail implements MailTransport {
  configured = true;
  sent: OutgoingMail[] = [];
  async send(m: OutgoingMail) {
    this.sent.push(m);
    return { messageId: `msg-${this.sent.length}`, threadId: null };
  }
  async fetchNew() {
    return { messages: [], cursor: null };
  }
}

// Sunday 23:00 Istanbul: outside business hours — the report still goes (K-2.2 exemption).
const NOW = new Date('2026-10-18T20:00:00Z');

const fetchFn = (async (input: string | URL) => {
  const url = String(input);
  if (url.includes('pagespeedonline'))
    return new Response(
      JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.35 } } } }),
    );
  if (url.startsWith('https://ornekklinik.com')) {
    const res = new Response('<title>Örnek Klinik</title><p>Balıkesir diş kliniği</p>', {
      headers: { 'content-type': 'text/html' },
    });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }
  throw new Error(`offline ${url}`);
}) as unknown as typeof fetch;

function setup(mailConnected = true) {
  const repo = new MemoryRepo();
  repo.now = () => NOW;
  const gemini: LLMProvider = {
    id: 'gemini',
    async generate(input) {
      const ids = (JSON.parse(input.messages[0]?.content ?? '[]') as { id: string }[]).map(
        (x) => x.id,
      );
      return {
        text: JSON.stringify({
          results: ids.map((id) => ({
            id,
            sector: 'Klinik / sağlık',
            city: 'Balıkesir',
            findings: [
              'Randevular yalnızca telefonla alınıyor.',
              'Sitede WhatsApp yok.',
              'Mobil hız düşük.',
            ],
            strongest_finding: 'Gece gelen randevu talepleri kaçıyor olabilir.',
          })),
        }),
        usage: { tokensIn: 1, tokensOut: 1 },
      };
    },
  };
  const llm = new LLMService({
    providers: { gemini },
    settings: defaultSettings.llm,
    store: repo.llmStore,
  });
  const mail = new FakeMail();
  const told: string[] = [];
  const deps: ToolDeps = {
    repo,
    llm,
    fetchFn,
    publicApiUrl: 'https://api.test',
    notify: async (_k, text) => void told.push(text),
    now: () => NOW,
    ...(mailConnected
      ? {
          outreach: {
            repo,
            llm,
            mail,
            publicApiUrl: 'https://api.test',
            tokenSecret: 'x'.repeat(40),
            now: () => NOW,
          },
        }
      : {}),
  };
  return { repo, deps, mail, told };
}

describe('analysis tool (K-12)', () => {
  it('form → Sıcak Gelen company + contact → report on screen and by mail, without approval', async () => {
    const { repo, deps, mail, told } = setup();
    const r = await submitToolRequest(deps, {
      query: 'ornekklinik.com',
      email: 'Sahibi@OrnekKlinik.com',
    });
    if (!r.ok) throw new Error('expected ok');
    expect(await toolReportByToken(deps, r.token)).toEqual({ state: 'pending' });
    const job = repo.jobs.find((j) => j.type === 'tool.analyze');
    expect(job?.payload).toEqual({ requestId: r.requestId, token: r.token });

    const report = await runToolAnalysis(deps, r.requestId, r.token);
    expect(report?.suggestions).toHaveLength(3);
    const view = await toolReportByToken(deps, r.token);
    expect(view.state).toBe('ready');

    const c = repo.companies[0];
    expect(c).toMatchObject({ source: 'analysis_tool', assigned_playbook: 'sicak_gelen' });
    expect(repo.approvals).toHaveLength(0);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe('sahibi@ornekklinik.com');
    expect(mail.sent[0]?.text).toContain(`https://api.test/analiz/r/${r.token}`);
    expect(mail.sent[0]?.text).toContain('https://api.test/u/');
    expect(told[0]).toContain('Sıcak Gelen: ornekklinik');
    expect(repo.toolRequests[0]?.token_hash).not.toBe(r.token);
  });

  it('never mails someone on the global suppression list', async () => {
    const { repo, deps, mail } = setup();
    await repo.suppress('email', 'ret@ornekklinik.com');
    const r = await submitToolRequest(deps, {
      query: 'ornekklinik.com',
      email: 'ret@ornekklinik.com',
    });
    if (!r.ok) throw new Error('expected ok');
    await runToolAnalysis(deps, r.requestId, r.token);
    expect(mail.sent).toHaveLength(0);
    expect((await toolReportByToken(deps, r.token)).state).toBe('ready');
  });

  it('shows the report on screen only while mail is not connected (K-12.6)', async () => {
    const { deps, mail } = setup(false);
    const r = await submitToolRequest(deps, { query: 'ornekklinik.com', email: 'a@b.com' });
    if (!r.ok) throw new Error('expected ok');
    await runToolAnalysis(deps, r.requestId, r.token);
    expect(mail.sent).toHaveLength(0);
    expect((await toolReportByToken(deps, r.token)).state).toBe('ready');
  });

  it('enforces the daily limit and expires report links', async () => {
    const { repo, deps } = setup(false);
    const s = await repo.getSettings();
    repo.settings = { ...s, analysis_tool: { ...s.analysis_tool, daily_limit: 1 } };
    const r = await submitToolRequest(deps, { query: 'Örnek Kuaför', email: 'a@b.com' });
    expect(r.ok).toBe(true);
    expect(await submitToolRequest(deps, { query: 'Başka', email: 'c@d.com' })).toEqual({
      ok: false,
      reason: 'daily_limit',
    });
    if (!r.ok) return;
    const later = { repo, now: () => new Date(NOW.getTime() + 31 * 86_400_000) };
    expect(await toolReportByToken(later, r.token)).toEqual({ state: 'expired' });
    expect(await toolReportByToken(deps, 'kisa')).toEqual({ state: 'not_found' });
  });
});
