import {
  addDays,
  chargesUntil,
  contractEnd,
  formatTl,
  localDate,
  overdueToNotify,
  type PathQuote,
} from '@papi/core';
import {
  buildChecklist,
  buildClaudePrompt,
  buildClientConfig,
  modulesFor,
  parseAnswers,
} from '@papi/modules';
import { z } from 'zod';
import type { CompanyRow, ProjectRow, Repo, SubscriptionRow } from '../repo/types.ts';
import { newDemoToken } from './demo.ts';

/** Operatör (K-5.2): won clients → project, setup form, Claude Code prompt, checklist, finance, reports. */
export interface OpsDeps {
  repo: Repo;
  /** Public Worker URL for the setup form link and the module metrics endpoint. */
  publicApiUrl?: string;
  notify?: (kind: 'payment' | 'approval_pending' | 'system_error', text: string) => Promise<void>;
  now?: () => Date;
}

const TZ = 'Europe/Istanbul';
const today = (d: OpsDeps) => localDate(d.now?.() ?? new Date(), TZ);
const base = (d: OpsDeps) => d.publicApiUrl?.replace(/\/$/, '') ?? null;

export function setupFormUrl(publicApiUrl: string, token: string): string {
  return `${publicApiUrl.replace(/\/$/, '')}/kurulum/${token}`;
}

export interface WonResult {
  projectId: string;
  formUrl: string | null;
  created: boolean;
}

/**
 * Proposal accepted → project (package + payment path from the proposal), subscription and first charges,
 * setup form link (K-14.4), provisional Claude Code prompt + checklist, Müşteri Yaşamı and Referans sequences.
 * Idempotent per proposal.
 */
export async function onClientWon(
  deps: OpsDeps,
  proposalId: string,
  path: 'no_setup' | 'setup' | null,
): Promise<WonResult> {
  const existing = await deps.repo.projectByProposal(proposalId);
  if (existing) {
    const form = await deps.repo.setupFormByProject(existing.id);
    const b = base(deps);
    return {
      projectId: existing.id,
      formUrl: form && b ? setupFormUrl(b, form.token) : null,
      created: false,
    };
  }
  const p = await deps.repo.getProposal(proposalId);
  if (!p) throw new Error('Teklif bulunamadı');
  const [company, packages, settings] = await Promise.all([
    deps.repo.getCompany(p.company_id),
    deps.repo.servicePackages(),
    deps.repo.getSettings(),
  ]);
  if (!company) throw new Error('Firma bulunamadı');
  const pkg = packages.find((x) => x.code === p.package_code);
  const day = today(deps);

  const q = p.quote as {
    kind?: string;
    noSetup?: PathQuote;
    setup?: PathQuote;
    project?: { projectKurus: number };
  };
  let chosen: PathQuote | null = null;
  let paymentPath: ProjectRow['payment_path'] = 'project';
  if (q.kind === 'paths' && q.noSetup && q.setup) {
    paymentPath = path ?? 'no_setup';
    chosen = paymentPath === 'setup' ? q.setup : q.noSetup;
  }
  const projectId = await deps.repo.createProject({
    company_id: company.id,
    proposal_id: p.id,
    name: `${company.name} — ${pkg?.name ?? p.package_code}`,
    package_code: p.package_code,
    payment_path: paymentPath,
    monthly_kurus: chosen?.monthlyKurus ?? null,
    setup_fee_kurus: chosen ? chosen.setupFeeKurus : null,
    project_kurus: q.kind === 'project' ? (q.project?.projectKurus ?? null) : null,
    started_on: day,
    contract_end: chosen ? contractEnd(day, chosen.commitmentMonths) : null,
    metrics_token: newDemoToken(),
  });

  // finance (K-13.8)
  if (chosen) {
    const subscriptionId = await deps.repo.createSubscription({
      company_id: company.id,
      project_id: projectId,
      monthly_kurus: chosen.monthlyKurus,
      discounted_monthly_kurus: chosen.discountedMonthlyKurus,
      discount_months: chosen.discountedMonths,
      started_on: day,
      commitment_months: chosen.commitmentMonths,
      day_of_month: Math.min(Number(day.slice(8, 10)), 28),
    });
    if (chosen.setupFeeKurus > 0)
      await deps.repo.ensurePayment({
        company_id: company.id,
        subscription_id: null,
        project_id: projectId,
        kind: 'setup',
        amount_kurus: chosen.setupFeeKurus,
        due_on: day,
      });
    await syncCharges(deps, day, subscriptionId);
  } else if (q.kind === 'project' && q.project) {
    await deps.repo.ensurePayment({
      company_id: company.id,
      subscription_id: null,
      project_id: projectId,
      kind: 'project',
      amount_kurus: q.project.projectKurus,
      due_on: day,
    });
  }

  // setup form + provisional outputs (the Claude Code prompt is regenerated when the form arrives)
  const token = newDemoToken();
  await deps.repo.createSetupForm({
    project_id: projectId,
    token,
    package_code: p.package_code,
    expires_at: new Date(
      (deps.now?.() ?? new Date()).getTime() +
        settings.operations.setup_form_valid_days * 86_400_000,
    ).toISOString(),
  });
  const checklist = buildChecklist(p.package_code);
  await deps.repo.replaceProjectTasks(projectId, checklist);
  await deps.repo.upsertArtifact(projectId, 'checklist', checklistText(checklist));
  await deps.repo.upsertArtifact(
    projectId,
    'claude_prompt',
    buildClaudePrompt(
      {
        client: { name: company.name, website: company.website_url },
        channels: { web: true, instagram: Boolean(company.instagram_handle), whatsapp: false },
        modules: modulesFor(p.package_code).map((m) => m.code),
      },
      pkg?.name ?? p.package_code,
    ) +
      '\n> Not: Kurulum formu henüz gelmedi; form gelince bu prompt ve papi-config.json yeniden üretilir.\n',
  );

  // K-11.3: client sequences
  const lifecycle = await deps.repo.getPlaybook('musteri_yasami');
  if (lifecycle)
    await deps.repo.createEnrollment(
      company.id,
      lifecycle.id,
      chosen ? contractEnd(day, chosen.commitmentMonths) : null,
    );
  const referral = await deps.repo.getPlaybook('referans');
  if (referral) await deps.repo.createEnrollment(company.id, referral.id, null);

  await deps.repo.updateCompany(company.id, {
    stage: 'won',
    next_step_kind: 'waiting',
    waiting_reason: 'Kurulum formu bekleniyor',
    waiting_until: addDays(day, 3),
  });
  await deps.repo.addCompanyEvent(
    company.id,
    'project_created',
    `Proje açıldı: ${pkg?.name ?? p.package_code}`,
  );
  await deps.repo.audit(
    'operator.project_created',
    { project_id: projectId, proposal_id: p.id },
    { type: 'agent', id: 'operator' },
  );

  const b = base(deps);
  const formUrl = b ? setupFormUrl(b, token) : null;
  if (formUrl) await queueFormLinkMessage(deps, company, formUrl);
  await deps.notify?.(
    'approval_pending',
    `🎉 ${company.name} kazanıldı. Proje açıldı${formUrl ? '; kurulum formu linki mesajı onay kuyruğunda (/onaylar)' : ''}.`,
  );
  return { projectId, formUrl, created: true };
}

/** The form link goes out like any message: as a draft awaiting approval (K-2.1). Template, no model. */
async function queueFormLinkMessage(deps: OpsDeps, company: CompanyRow, url: string) {
  const [settings, contact] = await Promise.all([
    deps.repo.getSettings(),
    deps.repo.primaryContact(company.id),
  ]);
  const email = company.emails[0] ?? null;
  const channel = email ? 'email' : company.phone_e164 ? 'whatsapp' : null;
  if (!channel) return;
  const text = [
    contact?.full_name ? `Merhaba ${contact.full_name},` : 'Merhaba,',
    '',
    "AJNA Digital'i seçtiğiniz için teşekkür ederiz. Kurulumu başlatabilmemiz için kısa bir form hazırladık; 5 dakikanızı alır:",
    url,
    '',
    settings.outreach.signature,
  ].join('\n');
  const subject = channel === 'email' ? 'Kurulum formu' : null;
  const touchId = await deps.repo.createTouch({
    company_id: company.id,
    channel,
    recipient: channel === 'email' ? email : company.phone_e164,
    subject,
    body: text,
    status: 'awaiting_approval',
  });
  const approvalId = await deps.repo.createApproval({
    kind: 'outreach',
    title: `Kurulum formu linki: ${company.name}`,
    payload: {
      text,
      subject,
      channel,
      touchId,
      personal: '',
      draftKind: 'setup_form_link',
      warnings: [],
    },
    agent: 'operator',
  });
  await deps.repo.updateTouch(touchId, { approval_id: approvalId });
}

export function checklistText(items: { title: string; module: string | null }[]): string {
  return items.map((i) => `- [ ] ${i.title}${i.module ? ` (${i.module})` : ''}`).join('\n');
}

/**
 * The client submitted the setup form: client config (JSON), Claude Code prompt and checklist are produced
 * from templates. Answers are client data and never reach a model (K-14.4).
 */
export async function onSetupFormSubmitted(deps: OpsDeps, projectId: string): Promise<boolean> {
  const project = await deps.repo.getProject(projectId);
  const form = await deps.repo.setupFormByProject(projectId);
  if (!project || !form) return false;
  const company = await deps.repo.getCompany(project.company_id);
  if (!company) return false;
  const parsed = parseAnswers(form.package_code, form.answers);
  if (!parsed.ok) return false;
  const packages = await deps.repo.servicePackages();
  const pkgName =
    packages.find((x) => x.code === project.package_code)?.name ?? project.package_code;
  const b = base(deps);
  const config = buildClientConfig({
    packageCode: project.package_code,
    answers: parsed.answers,
    company: {
      name: company.name,
      sector: company.sector,
      city: company.city,
      website: company.website_url,
      instagram: company.instagram_handle,
    },
    metricsUrl: b ? `${b}/metrics/push` : null,
    metricsToken: project.metrics_token,
  });
  const checklist = buildChecklist(project.package_code, config);
  await deps.repo.upsertArtifact(projectId, 'config', JSON.stringify(config, null, 2));
  await deps.repo.upsertArtifact(projectId, 'claude_prompt', buildClaudePrompt(config, pkgName));
  await deps.repo.upsertArtifact(projectId, 'checklist', checklistText(checklist));
  await deps.repo.replaceProjectTasks(projectId, checklist);
  await deps.repo.updateCompany(company.id, {
    next_step_kind: 'waiting',
    waiting_reason: 'Kurulum: Claude Code promptunu çalıştır',
    waiting_until: addDays(today(deps), 2),
  });
  await deps.repo.addCompanyEvent(
    company.id,
    'setup_form',
    'Kurulum formu dolduruldu; kurulum promptu hazır',
  );
  await deps.notify?.(
    'approval_pending',
    `📝 ${company.name} kurulum formunu doldurdu. Claude Code promptu panelde hazır.`,
  );
  return true;
}

// --- finance (K-13.8) ----------------------------------------------------------------------------

/** Creates the monthly charges that are due by `day` (idempotent). */
export async function syncCharges(
  deps: OpsDeps,
  day: string,
  onlySubscription?: string,
): Promise<number> {
  let created = 0;
  const subs: SubscriptionRow[] = (await deps.repo.activeSubscriptions(200)).filter(
    (s) => !onlySubscription || s.id === onlySubscription,
  );
  for (const s of subs)
    for (const c of chargesUntil(s, day))
      if (
        await deps.repo.ensurePayment({
          company_id: s.company_id,
          subscription_id: s.id,
          project_id: s.project_id,
          kind: 'monthly',
          amount_kurus: c.amount_kurus,
          due_on: c.due_on,
        })
      )
        created++;
  return created;
}

/** K-15.4: overdue charges are reported once on Telegram. */
export async function notifyOverdue(deps: OpsDeps): Promise<number> {
  const settings = await deps.repo.getSettings();
  const late = overdueToNotify(
    await deps.repo.duePayments(200),
    today(deps),
    settings.operations.overdue_grace_days,
  );
  for (const p of late) {
    const c = await deps.repo.getCompany(p.company_id);
    await deps.notify?.(
      'payment',
      `⏰ Gecikmiş tahsilat: ${c?.name ?? 'Firma'} — ${formatTl(p.amount_kurus)} (vade ${p.due_on})`,
    );
    await deps.repo.markPayment(p.id, { overdue_notified_on: today(deps) });
  }
  return late.length;
}

/** "/tahsilat {firma}": the oldest open charge of the company is marked paid today. */
export async function recordPayment(
  deps: OpsDeps,
  companyId: string,
): Promise<{ amount: number; due_on: string } | null> {
  const open = (await deps.repo.duePayments(200)).filter((p) => p.company_id === companyId);
  const first = open[0];
  if (!first) return null;
  await deps.repo.markPayment(first.id, { status: 'paid', paid_on: today(deps) });
  await deps.repo.addCompanyEvent(
    companyId,
    'payment',
    `Tahsilat: ${formatTl(first.amount_kurus)}`,
  );
  return { amount: first.amount_kurus, due_on: first.due_on };
}

// --- module metrics and the monthly client report --------------------------------------------------

export const metricsPushSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-01$/),
  metrics: z
    .record(z.string().regex(/^[a-z_]{1,40}$/), z.number().int().min(0).max(1_000_000_000))
    .refine((m) => Object.keys(m).length <= 20, 'too many metrics'),
});

/** Modules post aggregate counts only (no personal data) with the project's metrics token. */
export async function acceptMetrics(
  repo: Repo,
  token: string,
  raw: unknown,
): Promise<'ok' | 'unauthorized' | 'invalid'> {
  if (token.length < 40) return 'unauthorized';
  const project = await repo.projectByMetricsToken(token);
  if (!project) return 'unauthorized';
  const parsed = metricsPushSchema.safeParse(raw);
  if (!parsed.success) return 'invalid';
  await repo.upsertModuleMetrics(project.id, parsed.data.period, parsed.data.metrics);
  return 'ok';
}

const METRIC_LABEL: Record<string, string> = {
  messages_in: 'Gelen mesaj',
  replies: 'Asistanın verdiği cevap',
  avg_reply_seconds: 'Ortalama cevap süresi (sn)',
  leads: 'Yakalanan aday',
  appointments: 'Randevu / sipariş',
  reminders_sent: 'Gönderilen hatırlatma',
  reviews_requested: 'İstenen Google yorumu',
  reviews_received: 'Gelen Google yorumu',
  followups_sent: 'Gönderilen takip mesajı',
};

const MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

export function previousPeriod(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
}

/** Monthly client report text: numbers from the modules, template only (no model, K-4.7). */
export function reportText(
  clientName: string,
  period: string,
  metrics: Record<string, number>,
  signature: string,
): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const lines = Object.entries(metrics).map(
    ([k, v]) => `• ${METRIC_LABEL[k] ?? k}: ${v.toLocaleString('tr-TR')}`,
  );
  return [
    'Merhaba,',
    '',
    `${clientName} için ${MONTHS[m - 1]} ${y} ayı özeti:`,
    '',
    ...lines,
    '',
    'Sorunuz ya da eklemek istediğiniz bir şey olursa yazmanız yeterli.',
    '',
    signature,
  ].join('\n');
}

/** 1st of the month: a report draft per active project with metrics for last month → approval queue. */
export async function draftMonthlyReports(deps: OpsDeps): Promise<number> {
  const day = today(deps);
  const period = previousPeriod(day);
  const settings = await deps.repo.getSettings();
  let made = 0;
  for (const project of await deps.repo.activeProjects(100)) {
    const metrics = await deps.repo.moduleMetrics(project.id, period);
    if (!metrics || Object.keys(metrics).length === 0) continue;
    const company = await deps.repo.getCompany(project.company_id);
    if (!company) continue;
    const contact = await deps.repo.setupContact(project.id);
    const email = contact.email ?? company.emails[0] ?? null;
    if (!email) continue;
    const text = reportText(company.name, period, metrics, settings.outreach.signature);
    const subject = `${company.name} — aylık rapor`;
    const touchId = await deps.repo.createTouch({
      company_id: company.id,
      channel: 'email',
      recipient: email,
      subject,
      body: text,
      status: 'awaiting_approval',
    });
    const approvalId = await deps.repo.createApproval({
      kind: 'outreach',
      title: `Aylık rapor: ${company.name} (${period.slice(0, 7)})`,
      payload: {
        text,
        subject,
        channel: 'email',
        touchId,
        personal: '',
        draftKind: 'client_report',
        warnings: [],
      },
      agent: 'operator',
    });
    await deps.repo.updateTouch(touchId, { approval_id: approvalId });
    made++;
  }
  return made;
}

// --- notes ------------------------------------------------------------------------------------------

export async function addNote(
  deps: Pick<OpsDeps, 'repo'>,
  body: string,
  source: 'telegram_text' | 'telegram_voice' | 'panel',
  links: { companyId?: string | null; projectId?: string | null } = {},
): Promise<{ id: string; tags: string[] }> {
  const tags = [
    ...new Set(
      [...body.matchAll(/#([\p{L}\d_-]{2,30})/gu)].map((m) => (m[1] ?? '').toLocaleLowerCase('tr')),
    ),
  ];
  const id = await deps.repo.addNote({
    body: body.trim(),
    tags,
    source,
    company_id: links.companyId ?? null,
    project_id: links.projectId ?? null,
  });
  return { id, tags };
}
