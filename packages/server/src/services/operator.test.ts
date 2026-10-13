import { defaultSettings, quotePaths } from '@papi/core';
import { clientConfigSchema } from '@papi/modules';
import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../repo/memory.ts';
import {
  acceptMetrics,
  addNote,
  draftMonthlyReports,
  notifyOverdue,
  onClientWon,
  onSetupFormSubmitted,
  recordPayment,
  syncCharges,
  type OpsDeps,
} from './operator.ts';

const NOW = new Date('2026-10-13T07:00:00Z');

async function wonSetup(path: 'no_setup' | 'setup' = 'setup') {
  const repo = new MemoryRepo();
  let clock = NOW;
  repo.now = () => clock;
  const notes: { kind: string; text: string }[] = [];
  const deps: OpsDeps = {
    repo,
    publicApiUrl: 'https://api.test',
    notify: async (kind, text) => void notes.push({ kind, text }),
    now: () => clock,
  };
  const companyId = await repo.createCompany({
    name: 'Örnek Diş Kliniği',
    name_norm: 'ornek dis klinigi',
    source: 'telegram',
    emails: ['info@ornekdis.com'],
    instagram_handle: 'ornekdis',
  });
  await repo.addContact(companyId, { full_name: 'Ayşe Yılmaz', source: 'website' });
  const founder = { setupPct: 40, monthlyPct: 20, monthlyMonths: 3 };
  const p = await repo.createProposal({
    company_id: companyId,
    package_code: 'sistem',
    status: 'sent',
    vat_mode: 'excluded',
    valid_until: '2026-10-27',
    monthly_kurus: 2_550_000,
    founder_discount: founder,
    quote: { kind: 'paths', ...quotePaths(2_550_000, defaultSettings.pricing, founder) },
  });
  const won = await onClientWon(deps, p.id, path);
  return { repo, deps, notes, companyId, proposalId: p.id, won, setNow: (d: Date) => (clock = d) };
}

const ANSWERS = {
  business_name: 'Örnek Diş Kliniği',
  contact_name: 'Ayşe Yılmaz',
  contact_phone: '+90 532 111 22 33',
  contact_email: 'ayse@ornekdis.com',
  hours: 'Hafta içi 09:00–19:00',
  services: ['İmplant', 'Diş beyazlatma'],
  tone: 'samimi',
  channels: ['web', 'instagram', 'whatsapp'],
};

describe('Phase 5 acceptance: won → project + setup form + Claude Code prompt', () => {
  it('creates the project, finance, form link, prompt, checklist and client sequences', async () => {
    const { repo, won, companyId, notes } = await wonSetup('setup');
    expect(won.created).toBe(true);
    const project = repo.projects[0]!;
    expect(project).toMatchObject({
      package_code: 'sistem',
      payment_path: 'setup',
      monthly_kurus: 2_167_500,
      setup_fee_kurus: 1_530_000,
      started_on: '2026-10-13',
      contract_end: '2027-01-12',
      status: 'setup',
    });
    // setup fee + first (founder-discounted) month
    expect(repo.payments.map((p) => `${p.kind}:${p.amount_kurus}:${p.due_on}`)).toEqual([
      'setup:1530000:2026-10-13',
      'monthly:1734000:2026-10-13',
    ]);
    expect(won.formUrl).toMatch(/^https:\/\/api\.test\/kurulum\/[\w-]{43}$/);
    const arts = await repo.artifacts(project.id);
    expect(arts.find((a) => a.kind === 'claude_prompt')?.content).toContain(
      'müşterinin kendi hesaplarında',
    );
    expect((await repo.projectTasks(project.id)).length).toBeGreaterThan(5);
    expect(repo.enrollments.map((e) => `${e.playbook_id}:${e.anchor_date}`)).toEqual([
      'pb-musteri-yasami:2027-01-12',
      'pb-referans:null',
    ]);
    const c = await repo.getCompany(companyId);
    expect(c).toMatchObject({
      stage: 'won',
      next_step_kind: 'waiting',
      waiting_reason: 'Kurulum formu bekleniyor',
    });
    // the form link is a message → approval queue, never sent directly (K-2.1)
    const linkTouch = repo.touches.find((t) => t.body?.includes('/kurulum/'))!;
    expect(linkTouch).toMatchObject({
      status: 'awaiting_approval',
      channel: 'email',
      recipient: 'info@ornekdis.com',
    });
    expect(linkTouch.body).toMatch(/^Merhaba Ayşe Yılmaz,/);
    expect(notes[0]?.text).toContain('kazanıldı');
  });

  it('is idempotent per proposal', async () => {
    const { repo, deps, proposalId } = await wonSetup();
    const again = await onClientWon(deps, proposalId, 'setup');
    expect(again.created).toBe(false);
    expect(repo.projects).toHaveLength(1);
  });

  it('the submitted form produces the client config, final prompt and checklist (no model)', async () => {
    const { repo, deps, companyId } = await wonSetup();
    const form = repo.setupForms[0]!;
    expect(await repo.submitSetupForm(form.token, ANSWERS)).toBe(true);
    expect(await onSetupFormSubmitted(deps, form.project_id)).toBe(true);
    const arts = await repo.artifacts(form.project_id);
    const config = JSON.parse(arts.find((a) => a.kind === 'config')!.content);
    expect(clientConfigSchema.safeParse(config).success).toBe(true);
    expect(config.papi).toEqual({
      metrics_url: 'https://api.test/metrics/push',
      metrics_token: repo.projects[0]!.metrics_token,
    });
    expect(arts.find((a) => a.kind === 'claude_prompt')?.content).not.toContain(
      'Kurulum formu henüz gelmedi',
    );
    expect(
      (await repo.projectTasks(form.project_id)).some((t) => t.title.startsWith('WhatsApp:')),
    ).toBe(true);
    expect((await repo.getCompany(companyId))?.waiting_reason).toBe(
      'Kurulum: Claude Code promptunu çalıştır',
    );
  });
});

describe('finance', () => {
  it('monthly charges are created once; overdue reported once; /tahsilat pays the oldest', async () => {
    const { repo, deps, notes, setNow, companyId } = await wonSetup('no_setup');
    expect(repo.payments.map((p) => p.amount_kurus)).toEqual([2_040_000]); // first month, founder −20%
    setNow(new Date('2026-12-20T07:00:00Z'));
    expect(await syncCharges(deps, '2026-12-20')).toBe(2);
    expect(await syncCharges(deps, '2026-12-20')).toBe(0);
    expect(await notifyOverdue(deps)).toBe(3);
    expect(await notifyOverdue(deps)).toBe(0);
    expect(notes.filter((n) => n.kind === 'payment')).toHaveLength(3);
    const paid = await recordPayment(deps, companyId);
    expect(paid).toEqual({ amount: 2_040_000, due_on: '2026-10-13' });
    expect(repo.payments[0]).toMatchObject({ status: 'paid', paid_on: '2026-12-20' });
  });
});

describe('module metrics and monthly report', () => {
  it('accepts counts only with the project token and drafts the report on the 1st', async () => {
    const { repo, deps, setNow } = await wonSetup();
    const form = repo.setupForms[0]!;
    await repo.submitSetupForm(form.token, ANSWERS);
    const token = repo.projects[0]!.metrics_token;
    expect(await acceptMetrics(repo, 'x'.repeat(43), { period: '2026-10-01', metrics: {} })).toBe(
      'unauthorized',
    );
    expect(await acceptMetrics(repo, token, { period: '2026-10-15', metrics: {} })).toBe('invalid');
    expect(
      await acceptMetrics(repo, token, {
        period: '2026-10-01',
        metrics: { messages_in: 412, leads: 37, email: 'x' },
      }),
    ).toBe('invalid');
    expect(
      await acceptMetrics(repo, token, {
        period: '2026-10-01',
        metrics: { messages_in: 412, leads: 37 },
      }),
    ).toBe('ok');

    setNow(new Date('2026-11-01T06:00:00Z'));
    expect(await draftMonthlyReports(deps)).toBe(1);
    const t = repo.touches.find((x) => x.subject?.endsWith('aylık rapor'))!;
    expect(t).toMatchObject({ status: 'awaiting_approval', recipient: 'ayse@ornekdis.com' });
    expect(t.body).toContain('Ekim 2026');
    expect(t.body).toContain('Gelen mesaj: 412');
  });
});

describe('notes', () => {
  it('extracts hashtags', async () => {
    const repo = new MemoryRepo();
    const r = await addNote(
      { repo },
      'Klinikler için #randevu #Fikir: hatırlatma paketi',
      'telegram_text',
    );
    expect(r.tags).toEqual(['randevu', 'fikir']);
  });
});
