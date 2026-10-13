import { encodeApprovalCallback, RateLimitedError } from '@papi/core';
import { describe, expect, it } from 'vitest';
import { handleUpdate } from './bot.ts';
import { callbackUpdate, OWNER, setup, STRANGER, textUpdate, voiceUpdate } from './test/fakes.ts';

describe('Phase 1 acceptance', () => {
  it('voice note → transcribed → Papi searches the knowledge base and answers', async () => {
    const { deps, tg, repo, inputs } = setup(
      [
        '{"action":"tool","tool":"search_knowledge","args":{"query":"slogan"}}',
        '{"action":"reply","text":"Sloganımız: Personel değil, refleks kuruyoruz."}',
      ],
      'Sloganımız neydi?',
    );
    expect(await handleUpdate(voiceUpdate(OWNER), deps)).toBe('handled');
    expect(tg.texts()).toEqual([
      '🎙️ Sloganımız neydi?',
      'Sloganımız: Personel değil, refleks kuruyoruz.',
    ]);
    expect(inputs[1]?.messages.at(-1)?.content).toContain('Personel değil, refleks kuruyoruz.');
    expect(repo.conversation.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(repo.llmStore.calls.map((c) => c.tier)).toEqual(['transcribe', 'medium', 'medium']);
  });

  it('falls back to Groq when Gemini is rate limited', async () => {
    const { deps, tg, repo } = setup([new RateLimitedError('gemini')]);
    await handleUpdate(textUpdate(OWNER, 'Selam'), deps);
    expect(tg.texts()).toEqual(['groq']);
    expect(repo.llmStore.calls.map((c) => `${c.provider}:${c.status}`)).toEqual([
      'gemini:rate_limited',
      'groq:ok',
    ]);
  });

  it('ignores strangers silently and logs them', async () => {
    const { deps, tg, repo, inputs } = setup();
    expect(await handleUpdate(textUpdate(STRANGER, '/onaylar'), deps)).toBe('ignored');
    expect(tg.sent).toHaveLength(0);
    expect(inputs).toHaveLength(0);
    expect(repo.auditLog).toEqual([
      { action: 'telegram.ignored', details: { from_id: STRANGER, update_id: 1 } },
    ]);
  });
});

describe('commands', () => {
  it('/ara answers from the knowledge base without calling a model', async () => {
    const { deps, tg, inputs } = setup();
    await handleUpdate(textUpdate(OWNER, '/ara refleks'), deps);
    expect(tg.texts()[0]).toContain('Slogan: Personel değil, refleks kuruyoruz.');
    expect(inputs).toHaveLength(0);
  });

  it('/ekle queues a lead job and rejects bad links', async () => {
    const { deps, tg, repo } = setup();
    await handleUpdate(textUpdate(OWNER, '/ekle notalink'), deps);
    expect(repo.jobs).toHaveLength(0);
    await handleUpdate(textUpdate(OWNER, '/ekle https://www.ornekklinik.com/'), deps);
    expect(repo.jobs[0]).toMatchObject({
      type: 'lead.add_from_link',
      heavy: false,
      payload: { url: 'https://www.ornekklinik.com/' },
    });
    expect(tg.texts()[1]).toContain('ornekklinik.com');
  });

  it('/uyuyorum holds routine notifications; /uyandim summarizes them', async () => {
    const { deps, tg, repo } = setup();
    await handleUpdate(textUpdate(OWNER, '/uyuyorum'), deps);
    expect(repo.state.get('quiet_mode')).toMatchObject({ on: true });
    const { notify } = await import('./notify.ts');
    expect(
      await notify({ repo, tg, ownerChatId: OWNER }, 'daily_report', 'Günlük rapor hazır'),
    ).toBe('held');
    expect(await notify({ repo, tg, ownerChatId: OWNER }, 'system_error', 'Bağlantı koptu')).toBe(
      'sent',
    );
    expect(tg.sent.at(-1)?.opts?.silent).toBe(true);
    await handleUpdate(textUpdate(OWNER, '/uyandım'), deps);
    expect(repo.state.get('quiet_mode')).toMatchObject({ on: false });
    expect(tg.texts().at(-1)).toContain('Günlük rapor hazır');
  });

  it('a bare link is treated as a lead without calling a model (K-2.3)', async () => {
    const { deps, tg, repo, inputs } = setup();
    await handleUpdate(textUpdate(OWNER, 'ornekklinik.com'), deps);
    expect(repo.jobs[0]).toMatchObject({ type: 'lead.add_from_link' });
    expect(inputs).toHaveLength(0);
    expect(tg.texts()[0]).toContain('kuyruğa alındı');
  });

  it('/kota lists buckets', async () => {
    const { deps, tg } = setup();
    await handleUpdate(textUpdate(OWNER, '/kota'), deps);
    expect(tg.texts()[0]).toContain('gemini: 0/250');
  });

  it('a failing turn is recorded and the user is told', async () => {
    const { deps, tg, repo } = setup([new Error('boom'), new Error('boom')]);
    repo.settings.llm.routing.medium.fallback = null;
    await handleUpdate(textUpdate(OWNER, 'Selam'), deps);
    expect(tg.texts().at(-1)).toContain('Bir hata oldu');
    expect(repo.errors[0]).toMatchObject({ source: 'telegram', severity: 'error' });
  });
});

describe('approvals via buttons (K-15.3)', () => {
  async function withApprovals() {
    const ctx = setup(['Merhaba, kısa versiyon.']);
    const batch = '11111111-2222-4333-8444-555555555555';
    const a = await ctx.repo.createApproval({
      kind: 'cold_email',
      title: 'Mail: Örnek Klinik',
      payload: { text: 'Uzun taslak' },
      batchId: batch,
      agent: 'ulak',
    });
    const b = await ctx.repo.createApproval({
      kind: 'cold_email',
      title: 'Mail: Örnek Galeri',
      payload: { text: 'Taslak 2' },
      batchId: batch,
      agent: 'ulak',
    });
    return { ...ctx, a, b, batch };
  }

  it('/onaylar groups pending items with bulk buttons', async () => {
    const { deps, tg } = await withApprovals();
    await handleUpdate(textUpdate(OWNER, '/onaylar'), deps);
    expect(tg.sent[0]?.text).toContain('2 iş onay bekliyor');
    expect(tg.sent[0]?.opts?.keyboard?.at(-1)?.[0]?.text).toBe('✅ Tümünü onayla');
  });

  it('approve and reject update status and style memory', async () => {
    const { deps, repo, a, b } = await withApprovals();
    await handleUpdate(
      callbackUpdate(OWNER, encodeApprovalCallback({ scope: 'item', id: a, op: 'ok' })),
      deps,
    );
    await handleUpdate(
      callbackUpdate(OWNER, encodeApprovalCallback({ scope: 'item', id: b, op: 'no' })),
      deps,
    );
    expect(repo.approvals.map((x) => x.status)).toEqual(['approved', 'rejected']);
    expect(repo.styleMemory).toHaveLength(2);
  });

  it('bulk approve', async () => {
    const { deps, repo, batch, tg } = await withApprovals();
    await handleUpdate(
      callbackUpdate(OWNER, encodeApprovalCallback({ scope: 'batch', id: batch, op: 'ok' })),
      deps,
    );
    expect(repo.approvals.every((x) => x.status === 'approved')).toBe(true);
    expect(tg.answered[0]?.text).toBe('2 iş onaylandı');
  });

  it('edit: the next message becomes the correction and a revise job is queued', async () => {
    const { deps, repo, a, tg } = await withApprovals();
    await handleUpdate(
      callbackUpdate(OWNER, encodeApprovalCallback({ scope: 'item', id: a, op: 'ed' })),
      deps,
    );
    await handleUpdate(textUpdate(OWNER, 'Daha kısa yaz'), deps);
    expect(repo.approvals[0]).toMatchObject({
      status: 'needs_revision',
      correction: 'Daha kısa yaz',
    });
    expect(repo.jobs.map((j) => j.type)).toEqual(['approval.revise']);
    expect(tg.texts().at(-1)).toContain('Taslağı düzeltip');
  });

  it('a stranger cannot press approval buttons', async () => {
    const { deps, repo, a } = await withApprovals();
    await handleUpdate(
      callbackUpdate(STRANGER, encodeApprovalCallback({ scope: 'item', id: a, op: 'ok' })),
      deps,
    );
    expect(repo.approvals[0]?.status).toBe('pending');
  });
});
