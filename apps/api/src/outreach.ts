import {
  encodeTouchCallback,
  formatApprovalGroup,
  instagramProfileLink,
  isBusinessTime,
  whatsappLink,
  xIntentLink,
  type InlineKeyboard,
} from '@papi/core';
import {
  advanceEnrollments,
  autoEnroll,
  CHANNEL_LABEL,
  processInbound,
  reconcilePanelDecisions,
  reconcileProposalDecisions,
  sendNextEmail,
  type OutreachDeps,
  type Repo,
  type TelegramApi,
  type TouchRow,
} from '@papi/server';
import { isQuiet } from './notify.ts';

export interface OutreachTickDeps {
  repo: Repo;
  tg: TelegramApi;
  ownerChatId: number;
  outreach: OutreachDeps;
}

const ONE_CLICK_READY = ['whatsapp', 'instagram_dm', 'linkedin', 'x', 'phone_call', 'visit'];
const NOTIFIED_KEEP = 300;

/**
 * One outreach step per cron minute, rotating, so each invocation stays inside the Workers budget:
 * 0 → enrol + draft, 1 → send one email, 2 → read the inbox, 3 → one-click reminders.
 */
export async function runOutreachStep(d: OutreachTickDeps, now: Date): Promise<string> {
  switch (now.getUTCMinutes() % 4) {
    case 0: {
      await autoEnroll(d.outreach, 3);
      const before = new Set((await d.repo.listPendingApprovals(200)).map((a) => a.id));
      const r = await advanceEnrollments(d.outreach, crypto.randomUUID());
      if (r.drafts > 0) await announceApprovals(d, before);
      return `advance:${r.drafts}/${r.tasks}/${r.skipped}/${r.completed}`;
    }
    case 1: {
      const decided =
        (await reconcilePanelDecisions(d.outreach)) +
        (await reconcileProposalDecisions({ repo: d.repo }));
      return `panel:${decided} send:${await sendNextEmail(d.outreach)}`;
    }
    case 2: {
      if (!d.outreach.mail.configured) return 'inbox:not_configured';
      const cursor = await d.repo.getState<string>('mail_cursor');
      const { messages, cursor: next } = await d.outreach.mail.fetchNew(cursor);
      const n = await processInbound(d.outreach, messages);
      if (next) await d.repo.setState('mail_cursor', next);
      return `inbox:${n}`;
    }
    default:
      return `oneclick:${await remindOneClick(d, now)}`;
  }
}

/** New drafts → one grouped Telegram message with approve/edit/reject buttons (K-15.3). */
async function announceApprovals(d: OutreachTickDeps, before: Set<string>) {
  const fresh = (await d.repo.listPendingApprovals(200)).filter((a) => !before.has(a.id));
  if (fresh.length === 0) return;
  if (await isQuiet(d.repo)) {
    const held =
      (await d.repo.getState<{ kind: string; text: string; at: string }[]>('held_notifications')) ??
      [];
    held.push({
      kind: 'approval_pending',
      text: `${fresh.length} yeni taslak onay bekliyor (/onaylar)`,
      at: new Date().toISOString(),
    });
    await d.repo.setState('held_notifications', held.slice(-100));
    return;
  }
  const settings = await d.repo.getSettings();
  if (!settings.notifications.approval_pending) return;
  const batch = fresh[0]?.batch_id ?? null;
  const { text, keyboard } = formatApprovalGroup(
    fresh.map((a) => ({
      id: a.id,
      title: a.title,
      preview: typeof a.payload.text === 'string' ? a.payload.text : '',
    })),
    batch && fresh.every((a) => a.batch_id === batch) ? batch : null,
  );
  await d.tg.sendMessage(d.ownerChatId, text, { html: true, keyboard });
}

/** K-10.2–K-10.6, K-10.16: one-click items and call tasks, only in business hours. */
async function remindOneClick(d: OutreachTickDeps, now: Date): Promise<number> {
  const settings = await d.repo.getSettings();
  if (!isBusinessTime(now, settings.business_hours) || (await isQuiet(d.repo, now))) return 0;
  const notified = new Set((await d.repo.getState<string[]>('oneclick_notified')) ?? []);
  const ready = (await d.repo.touchesByStatus(['ready'], 20, now)).filter(
    (t) => ONE_CLICK_READY.includes(t.channel) && !notified.has(t.id),
  );
  for (const t of ready.slice(0, 5)) {
    const company = await d.repo.getCompany(t.company_id);
    const { text, keyboard } = oneClickMessage(t, company?.name ?? '');
    await d.tg.sendMessage(d.ownerChatId, text, { keyboard });
    notified.add(t.id);
  }
  if (ready.length) await d.repo.setState('oneclick_notified', [...notified].slice(-NOTIFIED_KEEP));
  return Math.min(ready.length, 5);
}

export function oneClickMessage(
  t: TouchRow,
  companyName: string,
): { text: string; keyboard: InlineKeyboard } {
  const body = t.body ?? '';
  const done = {
    text:
      t.channel === 'phone_call'
        ? '✅ Aradım'
        : t.channel === 'visit'
          ? '✅ Gittim'
          : '✅ Gönderdim',
    callback_data: encodeTouchCallback(t.id, 'ok'),
  };
  const skip = { text: '⏭ Atla', callback_data: encodeTouchCallback(t.id, 'no') };
  const open =
    t.channel === 'whatsapp' && t.recipient
      ? { text: "WhatsApp'ta aç", url: whatsappLink(t.recipient, body) }
      : t.channel === 'instagram_dm' && t.recipient
        ? { text: 'Profili aç', url: instagramProfileLink(t.recipient) }
        : t.channel === 'linkedin' && t.recipient
          ? { text: 'Profili aç', url: t.recipient }
          : t.channel === 'x'
            ? { text: "X'te paylaş", url: xIntentLink(body) }
            : null;
  const header = `${CHANNEL_LABEL[t.channel]} — ${companyName}`;
  const hint =
    t.channel === 'instagram_dm' || t.channel === 'linkedin'
      ? '\n(Mesajı kopyalayıp profile yapıştır.)'
      : t.channel === 'phone_call' && t.recipient
        ? `\nTelefon: +${t.recipient}`
        : '';
  return {
    text: `${header}${hint}\n\n${body}`,
    keyboard: [...(open ? [[open]] : []), [done, skip]],
  };
}
