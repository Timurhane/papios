import { dispatch } from '@papi/core';
import { describe, expect, it } from 'vitest';
import { OWNER, setup } from '../test/fakes.ts';
import { buildRegistry, scheduledJobs } from './handlers.ts';

async function run(ctx: ReturnType<typeof setup>) {
  return dispatch({
    store: ctx.repo.queueStore,
    registry: buildRegistry({ repo: ctx.repo, llm: ctx.llm, tg: ctx.tg, ownerChatId: OWNER }),
    worker: 'test',
    limit: 10,
  });
}

describe('job handlers', () => {
  it('embed.missing fills knowledge embeddings', async () => {
    const ctx = setup();
    await ctx.repo.enqueue('embed.missing', {});
    expect(await run(ctx)).toMatchObject({ done: 1 });
    expect(ctx.repo.knowledge.every((k) => k.embedding)).toBe(true);
  });

  it('approval.revise creates a corrected draft and offers it for approval', async () => {
    const ctx = setup(['Kısa taslak.']);
    const id = await ctx.repo.createApproval({
      kind: 'cold_email',
      title: 'Mail',
      payload: { text: 'Uzun taslak' },
      agent: 'ulak',
    });
    await ctx.repo.decideApproval(id, 'needs_revision', 'Kısalt');
    await ctx.repo.enqueue('approval.revise', { approvalId: id });
    await run(ctx);
    expect(ctx.repo.approvals.map((a) => a.status)).toEqual(['superseded', 'pending']);
    expect(ctx.repo.approvals[1]?.payload.text).toBe('Kısa taslak.');
    expect(ctx.inputs[0]?.messages[0]?.content).toContain('Düzeltme talimatı:\nKısalt');
    expect(ctx.tg.sent[0]?.text).toContain('(düzeltildi)');
  });

  it('llm.verify_models warns about models the provider does not list', async () => {
    const ctx = setup();
    await ctx.repo.enqueue('llm.verify_models', {});
    await run(ctx);
    expect(ctx.repo.errors[0]?.message).toContain('gemini/gemini-flash-lite-latest');
    expect(ctx.tg.texts()[0]).toContain('bulunamadı');
  });

  it('schedules maintenance on fixed minutes', () => {
    expect(scheduledJobs(new Date('2026-10-13T10:15:00Z')).map((j) => j.type)).toEqual([
      'embed.missing',
    ]);
    expect(scheduledJobs(new Date('2026-10-13T03:07:00Z')).map((j) => j.type)).toEqual([
      'llm.verify_models',
    ]);
    expect(scheduledJobs(new Date('2026-10-13T10:16:00Z'))).toEqual([]);
  });
});

describe('Phase 2 acceptance: Telegram link → analysed card', () => {
  it('a queued link becomes a scored company and a Telegram card in one cron tick', async () => {
    const ctx = setup([
      JSON.stringify({
        results: [
          {
            id: 'ID',
            sector: 'Diş kliniği',
            city: 'Balıkesir',
            findings: [
              'Randevular telefonla alınıyor olabilir.',
              'WhatsApp yok, sorular gecikebilir.',
              'Mobil site yavaş, ziyaretçi kaçabilir.',
            ],
            strongest_finding: 'Mobil site yavaş olduğu için randevu talepleri kaçıyor olabilir.',
          },
        ],
      }),
    ]);
    const html =
      '<title>Örnek Diş Kliniği</title><p>Karesi/Balıkesir</p><a href="tel:02661234567">t</a>';
    const fetchFn = (async (input: string) => {
      const url = String(input);
      if (url.includes('pagespeedonline'))
        return new Response(
          JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.3 } } } }),
        );
      if (!url.startsWith('https://ornekdis.com')) throw new Error('offline');
      const res = new Response(html, { headers: { 'content-type': 'text/html' } });
      Object.defineProperty(res, 'url', { value: 'https://ornekdis.com/' });
      return res;
    }) as unknown as typeof fetch;
    // The scripted summary must carry the real company id: patch it in once the company exists.
    const realGenerate = ctx.llm.generateStructured.bind(ctx.llm);
    ctx.llm.generateStructured = (async (req: Parameters<typeof realGenerate>[0]) => {
      const id = ctx.repo.companies[0]?.id ?? 'ID';
      req.messages = req.messages.map((m) => ({ ...m }));
      const out = await realGenerate(req);
      return { ...out, data: JSON.parse(JSON.stringify(out.data).replaceAll('"ID"', `"${id}"`)) };
    }) as typeof ctx.llm.generateStructured;

    await ctx.repo.enqueue('lead.add_from_link', { url: 'https://ornekdis.com/' });
    const started = Date.now();
    await dispatch({
      store: ctx.repo.queueStore,
      registry: buildRegistry({
        repo: ctx.repo,
        llm: ctx.llm,
        tg: ctx.tg,
        ownerChatId: OWNER,
        fetchFn,
        panelUrl: 'https://papi.pages.dev',
      }),
      worker: 'test',
      limit: 1,
    });
    expect(Date.now() - started).toBeLessThan(5 * 60_000);
    const company = ctx.repo.companies[0];
    expect(company).toMatchObject({
      name: 'Örnek Diş Kliniği',
      stage: 'analyzed',
      next_step_kind: 'playbook',
    });
    expect(['soguk_ana', 'hafif_soguk']).toContain(company?.assigned_playbook);
    expect(ctx.tg.texts().at(-1)).toContain('Örnek Diş Kliniği');
    expect(ctx.tg.texts().at(-1)).toMatch(/\/100 → (Soğuk Ana|Hafif Soğuk)/);
    expect(ctx.tg.texts().at(-1)).toContain('Mobil site yavaş olduğu için');
    expect(ctx.tg.texts().at(-1)).toContain(`https://papi.pages.dev/crm/${company?.id}`);
  });
});
