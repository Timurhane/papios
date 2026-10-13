import type { Settings } from '../settings/schema.ts';
import type { Channel } from './playbook.ts';
import { isBusinessTime } from './schedule.ts';
import { checkColdEmail, hasUnsubscribeLink } from './text.ts';

export interface OutboundFacts {
  channel: Channel;
  recipient: string | null;
  body: string;
  /** True for the first cold email of a sequence (80-word rule applies). */
  cold: boolean;
  suppressed: boolean;
  approval: 'approved' | 'pending' | 'none';
  /** Only 'analysis_tool_report' may skip approval (K-2.2). */
  exemptKind: string | null;
  sentToRecipientLast7Days: number;
  sentEmailsToday: number;
  dailyEmailLimit: number;
  unsubscribeUrl: string | null;
  now: Date;
}

export type GuardResult = { ok: true } | { ok: false; reasons: string[]; retryLater: boolean };

/**
 * Central outbound guard (CLAUDE.md code rule; K-2.1, K-10.*). Every send path must call this and must
 * not send when it returns ok=false. The database trigger enforces suppression a second time.
 */
export function checkOutbound(
  f: OutboundFacts,
  s: Pick<Settings, 'business_hours' | 'contact_limits' | 'cold_email' | 'approval_rules'>,
): GuardResult {
  const hard: string[] = [];
  const later: string[] = [];

  if (f.suppressed) hard.push('alıcı reddedenler listesinde');
  const exempt =
    f.exemptKind !== null && (s.approval_rules.exempt_kinds as string[]).includes(f.exemptKind);
  if (f.approval !== 'approved' && !exempt) hard.push('onaylanmamış');
  if (!f.recipient && f.channel !== 'x') hard.push('alıcı yok');

  if (f.channel === 'email') {
    if (!f.unsubscribeUrl || !hasUnsubscribeLink(f.body, f.unsubscribeUrl))
      hard.push('çıkış linki yok');
    if (f.cold) {
      const c = checkColdEmail(stripFooter(f.body), s.cold_email.max_words);
      if (!c.ok) hard.push(`soğuk mail ${c.words} kelime (sınır ${s.cold_email.max_words})`);
    }
    if (f.sentEmailsToday >= f.dailyEmailLimit) later.push('günlük mail limiti doldu');
  }

  if (f.sentToRecipientLast7Days >= s.contact_limits.max_touches_per_person_per_week)
    later.push('bu kişiye bu hafta 2 temas yapıldı');
  if (!exempt && !isBusinessTime(f.now, s.business_hours)) later.push('iş saati dışında');

  if (hard.length) return { ok: false, reasons: [...hard, ...later], retryLater: false };
  if (later.length) return { ok: false, reasons: later, retryLater: true };
  return { ok: true };
}

function stripFooter(body: string): string {
  const i = body.lastIndexOf('\n--\n');
  return i === -1 ? body : body.slice(0, i);
}
