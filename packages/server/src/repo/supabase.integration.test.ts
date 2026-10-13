import { AJNA_TENANT_ID, defaultSettings, dispatch, JobRegistry } from '@papi/core';
import { describe, expect, it } from 'vitest';
import { SupabaseRepo } from './supabase.ts';

// Runs only against a real local Supabase stack (CI "database" job). Skipped otherwise.
const url = process.env.SUPABASE_IT_URL;
const key = process.env.SUPABASE_IT_SERVICE_KEY;

describe.skipIf(!url || !key)('SupabaseRepo against real Supabase', () => {
  const repo = () => new SupabaseRepo(url ?? '', key ?? '', AJNA_TENANT_ID);
  const tag = `it-${Date.now()}`;

  it('loads seeded settings', async () => {
    const s = await repo().getSettings();
    expect(s.email_sending.daily_limit).toBe(defaultSettings.email_sending.daily_limit);
    expect(s.llm.routing.medium.model).toBe(defaultSettings.llm.routing.medium.model);
  });

  it('reserves quota through app.consume_quota', async () => {
    const r = repo();
    expect(await r.llmStore.consumeQuota(`${tag}a`.replace(/[^a-z]/g, ''), 1, 10, 'UTC')).toBe(
      true,
    );
    expect(await r.llmStore.consumeQuota(`${tag}a`.replace(/[^a-z]/g, ''), 1, 10, 'UTC')).toBe(
      false,
    );
  });

  it('caches and logs LLM calls', async () => {
    const r = repo();
    const k = 'a'.repeat(63) + String(Date.now() % 10);
    await r.llmStore.setCache(k, { hello: tag }, 1);
    expect(await r.llmStore.getCache(k)).toEqual({ hello: tag });
    await r.llmStore.logCall({
      agent: 'it',
      task: tag,
      tier: 'light',
      provider: 'gemini',
      model: 'm',
      dataClass: 'internal',
      tokensIn: 1,
      tokensOut: 1,
      durationMs: 1,
      cached: false,
      status: 'ok',
    });
    expect((await r.usageSummary()).llmCallsToday).toBeGreaterThan(0);
  });

  it('runs the queue: enqueue, claim, complete, retry, dead', async () => {
    const r = repo();
    await r.enqueue(`${tag}.ok`, { a: 1 });
    await r.enqueue(`${tag}.fail`, {});
    let ran = 0;
    const registry = new JobRegistry()
      .register(`${tag}.ok`, async (job) => {
        expect(job.payload).toEqual({ a: 1 });
        ran++;
      })
      .register(`${tag}.fail`, async () => {
        throw new Error('expected');
      });
    const res = await dispatch({ store: r.queueStore, registry, worker: 'it', limit: 50 });
    expect(ran).toBe(1);
    expect(res.done + res.retried + res.dead).toBeGreaterThanOrEqual(2);
    expect(await r.enqueue('it.unique', {}, { unique: true })).not.toBeNull();
    expect(await r.enqueue('it.unique', {}, { unique: true })).toBeNull();
  });

  it('stores knowledge and finds it by text and by vector', async () => {
    const r = repo();
    const id = await r.addKnowledge('other', `Test ${tag}`, `zebra ${tag}`);
    expect((await r.searchKnowledgeByText(`zebra ${tag}`, 3))[0]?.id).toBe(id);
    const missing = await r.missingEmbeddings('knowledge_items', 1000);
    expect(missing.some((m) => m.id === id)).toBe(true);
    const v = Array.from({ length: 768 }, (_, i) => (i === 7 ? 1 : 0));
    await r.setEmbedding('knowledge_items', id, v);
    expect((await r.searchKnowledgeByVector(v, 1))[0]?.id).toBe(id);
  });

  it('approvals lifecycle, conversation, state and audit', async () => {
    const r = repo();
    const batch = crypto.randomUUID();
    const a = await r.createApproval({
      kind: 'cold_email',
      title: tag,
      payload: { text: 'x' },
      batchId: batch,
      agent: 'it',
    });
    expect((await r.listPendingApprovals(500)).some((x) => x.id === a)).toBe(true);
    expect(await r.decideApproval(a, 'needs_revision', 'kısalt')).toBe(true);
    expect(await r.decideApproval(a, 'approved')).toBe(false);
    const b = await r.createApproval({
      kind: 'cold_email',
      title: tag,
      payload: { text: 'y' },
      batchId: batch,
      agent: 'it',
      supersedes: a,
    });
    expect(await r.decideBatch(batch, 'approved')).toEqual([b]);
    expect((await r.getApproval(b))?.status).toBe('approved');
    await r.addStyleMemory({
      draftKind: 'cold_email',
      original: 'x',
      revised: 'y',
      instruction: 'kısalt',
      verdict: 'edited',
    });

    await r.appendConversation('telegram', 'user', tag);
    expect((await r.recentConversation('telegram', 1))[0]?.content).toBe(tag);
    await r.setState('quiet_mode', { on: true, since: tag });
    expect(await r.getState('quiet_mode')).toEqual({ on: true, since: tag });
    await r.audit('it.test', { tag });
    expect((await r.countAuditSince(new Date(Date.now() - 60_000)))['it.test']).toBeGreaterThan(0);
    await r.recordError('it', 'warning', tag);
    expect(await r.getFlag('client_portal')).toBe(false);
  });
});
