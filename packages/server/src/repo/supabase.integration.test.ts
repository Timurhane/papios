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

  it('sales: packages, numbered proposals, acceptance, demos and rate limits', async () => {
    const r = repo();
    expect((await r.servicePackages()).map((p) => p.code)).toEqual([
      'refleks',
      'sistem',
      'operasyon',
      'ozel',
    ]);
    expect((await r.founderTerms())?.setupMaxPct).toBe(40);
    const companyId = await r.createCompany({
      name: `IT ${tag}`,
      name_norm: `it ${tag}`,
      source: 'manual',
    });
    await r.updateCompany(companyId, {
      next_step_kind: 'waiting',
      waiting_reason: 'it',
      waiting_until: '2030-01-01',
    });
    const p = await r.createProposal({
      company_id: companyId,
      package_code: 'sistem',
      monthly_kurus: 2_550_000,
      status: 'draft',
      valid_until: '2030-01-01',
      scope: ['a'],
    });
    expect(p.number).toMatch(/^AJNA-\d{4}-\d{4}$/);
    await r.updateProposal(p.id, { vat_mode: 'excluded', status: 'sent' });
    expect((await r.getProposal(p.id))?.monthly_kurus).toBe(2_550_000);
    expect((await r.proposalsByStatus(['sent'], 50)).some((x) => x.id === p.id)).toBe(true);
    expect(await r.acceptProposal(p.id)).toBe(true);

    const token = `${tag}`.padEnd(43, 'x');
    await r.createDemo({
      company_id: companyId,
      token,
      snapshot: { name: 'IT' },
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect((await r.activeDemo(companyId))?.token).toBe(token);
    expect((await r.demoTouch(token, 'visit', 1, 100)).snapshot).toEqual({ name: 'IT' });
    expect((await r.demoTouch(token, 'message', 1, 100)).result).toBe('ok');
    expect((await r.demoTouch(token, 'message', 1, 100)).result).toBe('demo_limit');
    expect(await r.hitRateLimit(`it:${tag}`, 60, 1)).toBe(true);
    expect(await r.hitRateLimit(`it:${tag}`, 60, 1)).toBe(false);
  });

  it('operations: project, setup form rpc, charges, metrics, notes', async () => {
    const r = repo();
    const companyId = await r.createCompany({
      name: `OPS ${tag}`,
      name_norm: `ops ${tag}`,
      source: 'manual',
    });
    await r.updateCompany(companyId, {
      next_step_kind: 'waiting',
      waiting_reason: 'it',
      waiting_until: '2030-01-01',
    });
    const projectId = await r.createProject({
      company_id: companyId,
      proposal_id: null,
      name: 'OPS',
      package_code: 'refleks',
      payment_path: 'no_setup',
      monthly_kurus: 1_750_000,
      setup_fee_kurus: 0,
      project_kurus: null,
      started_on: '2026-10-13',
      contract_end: '2027-10-12',
      metrics_token: `${tag}`.padEnd(43, 'm'),
    });
    expect((await r.getProject(projectId))?.monthly_kurus).toBe(1_750_000);
    const token = `${tag}`.padEnd(43, 'f');
    await r.createSetupForm({
      project_id: projectId,
      token,
      package_code: 'refleks',
      expires_at: '2030-01-01T00:00:00Z',
    });
    expect((await r.setupFormByToken(token)).businessName).toBe(`OPS ${tag}`);
    expect(await r.submitSetupForm(token, { hours: '9-18' })).toBe(true);
    expect(await r.submitSetupForm(token, { hours: 'x' })).toBe(false);
    await r.replaceProjectTasks(projectId, [{ title: 'a', module: null }]);
    expect(await r.projectTasks(projectId)).toEqual([
      { title: 'a', module_code: null, done: false },
    ]);
    await r.upsertArtifact(projectId, 'claude_prompt', 'v1');
    await r.upsertArtifact(projectId, 'claude_prompt', 'v2');
    expect(await r.artifacts(projectId)).toEqual([{ kind: 'claude_prompt', content: 'v2' }]);
    const subId = await r.createSubscription({
      company_id: companyId,
      project_id: projectId,
      monthly_kurus: 1_750_000,
      discounted_monthly_kurus: null,
      discount_months: 0,
      started_on: '2026-10-13',
      commitment_months: 12,
      day_of_month: 13,
    });
    const charge = {
      company_id: companyId,
      subscription_id: subId,
      project_id: projectId,
      kind: 'monthly' as const,
      amount_kurus: 1_750_000,
      due_on: '2026-10-13',
    };
    expect(await r.ensurePayment(charge)).toBe(true);
    expect(await r.ensurePayment(charge)).toBe(false);
    const due = (await r.duePayments(500)).find((p) => p.subscription_id === subId)!;
    expect(due.amount_kurus).toBe(1_750_000);
    await r.markPayment(due.id, { status: 'paid', paid_on: '2026-10-14' });
    await r.upsertModuleMetrics(projectId, '2026-10-01', { messages_in: 5 });
    expect(await r.moduleMetrics(projectId, '2026-10-01')).toEqual({ messages_in: 5 });
    await r.addNote({
      body: `not ${tag}`,
      tags: ['it'],
      source: 'panel',
      company_id: companyId,
      project_id: null,
    });
    expect((await r.recentNotes(5, tag)).length).toBe(1);
    expect(await r.companyFacts(companyId)).toEqual({ satisfaction_positive: false });
  });
});
