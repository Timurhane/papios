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
