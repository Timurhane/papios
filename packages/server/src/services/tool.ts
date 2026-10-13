import {
  buildToolReport,
  checkOutbound,
  localDate,
  normalizeDomain,
  normalizeEmail,
  normalizeName,
  sha256Hex,
  toolReportEmail,
  withUnsubscribeFooter,
  type LLMService,
  type ToolReport,
} from '@papi/core';
import type { Repo } from '../repo/types.ts';
import { analyzeCompanies } from './analist.ts';
import { newDemoToken } from './demo.ts';
import { upsertCompany } from './kasif.ts';
import { unsubscribeUrl, type OutreachDeps } from './ulak.ts';

/** K-12 analysis tool: a public form → analysis → report (on screen; by mail once mail is connected, K-12.6). */
export interface ToolDeps {
  repo: Repo;
  llm: LLMService;
  /** Present when mail is set up (decision A-1); the report then also goes by mail. */
  outreach?: OutreachDeps;
  publicApiUrl?: string;
  pageSpeedKey?: string;
  fetchFn?: typeof fetch;
  notify?: (kind: 'hot_reply' | 'system_error', text: string) => Promise<void>;
  now?: () => Date;
}

const now = (d: { now?: () => Date }) => d.now?.() ?? new Date();

export function toolReportUrl(publicApiUrl: string, token: string): string {
  return `${publicApiUrl.replace(/\/$/, '')}/analiz/r/${token}`;
}

export type SubmitResult =
  | { ok: true; token: string; requestId: string }
  | { ok: false; reason: 'daily_limit' | 'bad_query' };

/** A form submission (Turnstile and the per-IP limit are checked by the caller). */
export async function submitToolRequest(
  deps: ToolDeps,
  input: { query: string; email: string },
): Promise<SubmitResult> {
  const s = await deps.repo.getSettings();
  const t = now(deps);
  const tz = s.business_hours.timezone;
  const dayStart = new Date(`${localDate(t, tz)}T00:00:00+03:00`);
  if ((await deps.repo.toolRequestsSince(dayStart)) >= s.analysis_tool.daily_limit)
    return { ok: false, reason: 'daily_limit' };

  const query = input.query.trim();
  const looksLikeSite = /\.[a-z]{2,}/i.test(query) && !/\s/.test(query);
  const domain = looksLikeSite ? normalizeDomain(query) : null;
  const name = domain ? (domain.split('.')[0] ?? domain) : query;
  if (name.length < 2) return { ok: false, reason: 'bad_query' };
  const email = normalizeEmail(input.email) ?? input.email.trim().toLowerCase();

  const company = await upsertCompany(deps.repo, {
    name,
    name_norm: normalizeName(name),
    source: 'analysis_tool',
    ...(domain ? { domain, website_url: `https://${domain}/` } : {}),
  });
  await deps.repo.addContact(company.id, { email, source: 'analysis_tool' });

  const token = newDemoToken();
  const requestId = await deps.repo.createToolRequest({
    company_id: company.id,
    email,
    query,
    consent_at: t.toISOString(),
    consent_version: s.analysis_tool.consent_version,
    token_hash: await sha256Hex(token),
    expires_at: new Date(t.getTime() + s.analysis_tool.report_days * 86_400_000).toISOString(),
  });
  await deps.repo.addCompanyEvent(company.id, 'tool_request', 'Analiz aracından rapor istedi');
  // The job needs the plain token for the mail link; only the hash is kept on the request row.
  await deps.repo.enqueue('tool.analyze', { requestId, token }, { priority: 20 });
  await deps.repo.audit('tool.requested', { request_id: requestId, company_id: company.id });
  return { ok: true, token, requestId };
}

/** Job: analyse, store the report, start Sıcak Gelen, mail the report (exempt from approval, K-2.2). */
export async function runToolAnalysis(
  deps: ToolDeps,
  requestId: string,
  reportToken?: string,
): Promise<ToolReport | null> {
  const req = await deps.repo.getToolRequest(requestId);
  if (!req || req.status !== 'queued' || !req.company_id) return null;
  const company = await deps.repo.getCompany(req.company_id);
  if (!company) return null;

  const [o] = await analyzeCompanies(
    {
      repo: deps.repo,
      llm: deps.llm,
      pageSpeedKey: deps.pageSpeedKey,
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    },
    [company],
    'light',
  );
  // A site that cannot be read over plain HTTP still gets a report ("no working website" view).
  const report = buildToolReport({
    business: company.name,
    site: o?.checks?.site ?? null,
    mobile: o?.checks?.mobile ?? null,
    desktop: o?.checks?.desktop ?? null,
    findings: o?.findings ?? [],
    strongest: o?.strongestFinding ?? null,
  });
  await deps.repo.updateToolRequest(req.id, {
    status: 'ready',
    report: report as unknown as Record<string, unknown>,
  });

  // K-12.4: the person is a warm lead; Sıcak Gelen starts (its first step is this report).
  await deps.repo.updateCompany(company.id, {
    stage: 'analyzed',
    next_step_kind: 'playbook',
    assigned_playbook: 'sicak_gelen',
    waiting_reason: null,
    waiting_until: null,
  });
  const fresh = await deps.repo.getCompany(company.id);
  await deps.notify?.(
    'hot_reply',
    `🔥 Sıcak Gelen: ${company.name} analiz aracını kullandı${fresh?.score != null ? ` (puan ${fresh.score})` : ''}. Sıcak Gelen dizisi başladı; bugün aramayı unutma.`,
  );

  if (reportToken) await mailReport(deps, req.id, reportToken, report);
  return report;
}

/** The report mail goes through the central guard like every outbound message (K-2.1). */
export async function mailReport(
  deps: ToolDeps,
  requestId: string,
  reportToken: string,
  report: ToolReport,
): Promise<'sent' | 'not_configured' | 'blocked'> {
  const o = deps.outreach;
  const req = await deps.repo.getToolRequest(requestId);
  if (!o || !o.mail.configured || !req?.email || !req.company_id || !deps.publicApiUrl)
    return 'not_configured';
  const settings = await deps.repo.getSettings();
  const t = now(deps);
  const { subject, text } = toolReportEmail(report, toolReportUrl(deps.publicApiUrl, reportToken));
  const touchId = await deps.repo.createTouch({
    company_id: req.company_id,
    channel: 'email',
    status: 'drafted',
    recipient: req.email,
    subject,
    body: text,
  });
  const url = await unsubscribeUrl(o, touchId);
  const body = withUnsubscribeFooter(text, url);
  const verdict = checkOutbound(
    {
      channel: 'email',
      recipient: req.email,
      body,
      cold: false,
      suppressed: await deps.repo.isSuppressed('email', req.email),
      approval: 'none',
      exemptKind: 'analysis_tool_report',
      // The person asked for this report; it does not count against weekly contact limits.
      sentToRecipientLast7Days: 0,
      sentEmailsToday: 0,
      dailyEmailLimit: 1,
      unsubscribeUrl: url,
      now: t,
    },
    settings,
  );
  if (!verdict.ok) {
    await deps.repo.updateTouch(touchId, {
      status: 'failed',
      skip_reason: verdict.reasons.join('; '),
    });
    await deps.repo.audit('tool.report_blocked', {
      request_id: requestId,
      reasons: verdict.reasons,
    });
    return 'blocked';
  }
  const sent = await o.mail.send({
    to: req.email,
    fromName: settings.outreach.sender_name,
    subject,
    text: body,
    unsubscribeUrl: url,
  });
  await deps.repo.updateTouch(touchId, {
    status: 'sent',
    sent_at: t.toISOString(),
    body,
    provider_message_id: sent.messageId,
    thread_id: sent.threadId,
  });
  await deps.repo.updateToolRequest(requestId, { mailed_at: t.toISOString() });
  await deps.repo.addCompanyEvent(
    req.company_id,
    'touch_sent',
    'Analiz raporu e-postayla gönderildi',
  );
  await deps.repo.audit(
    'tool.report_mailed',
    { request_id: requestId, touch_id: touchId },
    { type: 'agent', id: 'analist' },
  );
  return 'sent';
}

export type ToolView =
  | { state: 'not_found' }
  | { state: 'expired' }
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'ready'; report: ToolReport };

/** GET /analiz/r/:token — the report link reads only its own row. */
export async function toolReportByToken(
  deps: Pick<ToolDeps, 'repo' | 'now'>,
  token: string,
): Promise<ToolView> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return { state: 'not_found' };
  const req = await deps.repo.toolRequestByTokenHash(await sha256Hex(token));
  if (!req) return { state: 'not_found' };
  if (Date.parse(req.expires_at) < now(deps).getTime()) return { state: 'expired' };
  if (req.status === 'queued') return { state: 'pending' };
  if (req.status === 'failed' || !req.report) return { state: 'failed' };
  return { state: 'ready', report: req.report as unknown as ToolReport };
}
