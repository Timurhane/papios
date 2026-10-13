import {
  encodeSlotCallback,
  encodeVatCallback,
  splitMessage,
  type InlineKeyboard,
} from '@papi/core';
import {
  createDemo,
  demoUrl,
  draftProposal,
  formatSlot,
  meetingBrief,
  onProposalDecided,
  proposeMeeting,
  recordMeetingNote,
  scheduleMeeting,
  setProposalVat,
  type CompanyRow,
  type Repo,
  type SalesDeps,
  type TelegramApi,
} from '@papi/server';

export interface SalesBotDeps {
  repo: Repo;
  tg: TelegramApi;
  sales?: SalesDeps;
  publicApiUrl?: string;
  panelUrl?: string;
}

interface AwaitingNote {
  companyId: string;
  name: string;
  until: string;
}

const PACKAGES = ['refleks', 'sistem', 'operasyon', 'ozel'];
const NOTE_WINDOW_MS = 12 * 3_600_000;

export const SALES_HELP = `/hazirlik {firma} – görüşme öncesi hazırlık notu
/gorusme {firma} – görüşme notunu al (sonraki yazı/sesli not), teklif taslağı çıkar
/teklif {firma} [paket] – teklif taslağı (refleks, sistem, operasyon)
/saat {firma} – görüşme için 3 uygun saat
/demo {firma} – 14 günlük kişiye özel demo linki`;

async function resolveCompany(
  deps: SalesBotDeps,
  chatId: number,
  query: string,
  usage: string,
): Promise<CompanyRow | null> {
  if (!query.trim()) {
    await deps.tg.sendMessage(chatId, `Kullanım: ${usage}`);
    return null;
  }
  const hits = await deps.repo.searchCompanies(query.trim(), 5);
  const exact = hits.find(
    (h) => h.name.toLocaleLowerCase('tr') === query.trim().toLocaleLowerCase('tr'),
  );
  if (exact) return exact;
  if (hits.length === 1) return hits[0] ?? null;
  await deps.tg.sendMessage(
    chatId,
    hits.length
      ? `Birden fazla firma buldum, tam adını yaz:\n${hits.map((h) => `• ${h.name}${h.city ? ` (${h.city})` : ''}`).join('\n')}`
      : `"${query}" adında firma bulamadım.`,
  );
  return null;
}

function notReady(deps: SalesBotDeps, chatId: number) {
  return deps.tg.sendMessage(chatId, 'Satış modülü henüz hazır değil.');
}

export async function handleSalesCommand(
  command: 'hazirlik' | 'gorusme' | 'teklif' | 'saat' | 'demo',
  args: string,
  chatId: number,
  deps: SalesBotDeps,
): Promise<void> {
  if (!deps.sales) return void (await notReady(deps, chatId));
  const sales = deps.sales;
  switch (command) {
    case 'hazirlik': {
      const c = await resolveCompany(deps, chatId, args, '/hazirlik {firma}');
      if (!c) return;
      await deps.tg.sendChatAction(chatId, 'typing');
      for (const part of splitMessage(await meetingBrief(sales, c.id)))
        await deps.tg.sendMessage(chatId, part);
      return;
    }
    case 'gorusme': {
      const c = await resolveCompany(deps, chatId, args, '/gorusme {firma}');
      if (!c) return;
      await deps.repo.setState('awaiting_meeting_note', {
        companyId: c.id,
        name: c.name,
        until: new Date(Date.now() + NOTE_WINDOW_MS).toISOString(),
      } satisfies AwaitingNote);
      await deps.tg.sendMessage(
        chatId,
        `📝 ${c.name} görüşme notunu yaz ya da sesli anlat: ihtiyaçlar, bütçe, itirazlar, sonraki adım.\n\n` +
          'Not: Sesli notta kişi adı ve telefon söyleme; ses yazıya çevrilirken bunlar ayıklanamaz. ' +
          'Yazılı notta ayıklama otomatik.',
      );
      return;
    }
    case 'teklif': {
      const words = args.trim().split(/\s+/);
      const last = (words.at(-1) ?? '').toLocaleLowerCase('tr');
      const pkg = PACKAGES.includes(last) ? last : null;
      const query = pkg ? words.slice(0, -1).join(' ') : args;
      const c = await resolveCompany(
        deps,
        chatId,
        query,
        '/teklif {firma} [refleks|sistem|operasyon]',
      );
      if (!c) return;
      await deps.tg.sendChatAction(chatId, 'typing');
      const meeting = await deps.repo.latestMeeting(c.id);
      const r = await draftProposal(sales, c.id, {
        packageCode: pkg ?? meeting?.notes?.suggested_package ?? 'sistem',
        meetingId: meeting?.id ?? null,
        needs: meeting?.notes?.needs ?? [],
      });
      await proposalCreatedMessage(deps, chatId, c.name, r);
      return;
    }
    case 'saat': {
      const c = await resolveCompany(deps, chatId, args, '/saat {firma}');
      if (!c) return;
      const { meetingId, slots } = await proposeMeeting(sales, c.id);
      if (!slots.length) {
        await deps.tg.sendMessage(chatId, 'Önümüzdeki günlerde uygun saat bulamadım.');
        return;
      }
      const keyboard: InlineKeyboard = slots.map((s, i) => [
        { text: `✅ ${formatSlot(s)}`, callback_data: encodeSlotCallback(meetingId, i) },
      ]);
      await deps.tg.sendMessage(
        chatId,
        `🗓️ ${c.name} için uygun saatler${sales.calendar.configured ? ' (takvimindeki dolu saatler atlandı)' : ' (takvim bağlı değil; yalnızca iş saatine göre)'}:\n` +
          slots.map((s) => `• ${formatSlot(s)}`).join('\n') +
          '\n\nFirma birini seçince butona bas; görüşmeyi kaydedeyim.',
        { keyboard },
      );
      return;
    }
    case 'demo': {
      const c = await resolveCompany(deps, chatId, args, '/demo {firma}');
      if (!c) return;
      if (!deps.publicApiUrl) {
        await deps.tg.sendMessage(
          chatId,
          'Demo linki için genel adres (PUBLIC_API_URL) henüz ayarlı değil.',
        );
        return;
      }
      const d = await createDemo(sales, c.id);
      const until = new Intl.DateTimeFormat('tr-TR', {
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/Istanbul',
      }).format(new Date(d.expiresAt));
      await deps.tg.sendMessage(
        chatId,
        `🤖 ${c.name} demosu ${d.reused ? '(zaten açık olan)' : 'hazır'} — ${until} tarihine kadar açık:\n${demoUrl(deps.publicApiUrl, d.token)}\n\nLinki firmaya göndermek senin onayınla olur (tek tık mesajı).`,
      );
      return;
    }
  }
}

async function proposalCreatedMessage(
  deps: SalesBotDeps,
  chatId: number,
  companyName: string,
  r: { id: string; number: string; needsVat: boolean; approvalId: string | null },
) {
  if (r.needsVat) {
    await deps.tg.sendMessage(
      chatId,
      `📄 ${companyName} için teklif taslağı ${r.number} hazır. Fiyatlar KDV dahil mi, hariç mi?`,
      {
        keyboard: [
          [
            { text: 'KDV hariç (+ KDV)', callback_data: encodeVatCallback(r.id, 'excluded') },
            { text: 'KDV dahil', callback_data: encodeVatCallback(r.id, 'included') },
          ],
        ],
      },
    );
  } else {
    await deps.tg.sendMessage(
      chatId,
      `📄 ${companyName} teklif taslağı ${r.number} onay kuyruğunda (/onaylar).`,
    );
  }
}

/** Text or transcribed voice while a meeting note is awaited. Returns true when it was consumed. */
export async function maybeMeetingNote(
  text: string,
  fromVoice: boolean,
  chatId: number,
  deps: SalesBotDeps,
): Promise<boolean> {
  const st = await deps.repo.getState<AwaitingNote | null>('awaiting_meeting_note');
  if (!st?.companyId) return false;
  await deps.repo.setState('awaiting_meeting_note', null);
  if (Date.parse(st.until) < Date.now() || !deps.sales) return false;
  await deps.tg.sendChatAction(chatId, 'typing');
  const r = await recordMeetingNote(
    deps.sales,
    st.companyId,
    text,
    fromVoice ? 'telegram_voice' : 'telegram_text',
  );
  const n = r.notes;
  const lines = [
    `✅ ${st.name} görüşme notu kaydedildi.`,
    '',
    n.summary,
    ...(n.needs.length ? ['', 'İhtiyaçlar:', ...n.needs.map((x) => `• ${x}`)] : []),
    ...(n.objections.length ? ['', 'İtirazlar:', ...n.objections.map((x) => `• ${x}`)] : []),
    ...(n.next_step ? ['', `Sonraki adım: ${n.next_step}`] : []),
  ];
  for (const part of splitMessage(lines.join('\n'))) await deps.tg.sendMessage(chatId, part);
  if (r.proposal) await proposalCreatedMessage(deps, chatId, st.name, r.proposal);
  else
    await deps.tg.sendMessage(
      chatId,
      'Uygun paketi seçemedim; /teklif {firma} {paket} ile ya da panelde Teklif stüdyosundan hazırlayabilirim.',
    );
  return true;
}

/** pv:/ms: callbacks. Returns true when handled. */
export async function handleSalesCallback(
  callbackId: string,
  vat: { proposalId: string; mode: 'included' | 'excluded' } | null,
  slot: { meetingId: string; index: number } | null,
  chatId: number,
  deps: SalesBotDeps,
): Promise<boolean> {
  if (!vat && !slot) return false;
  if (!deps.sales) {
    await deps.tg.answerCallback(callbackId, 'Henüz hazır değil');
    return true;
  }
  if (vat) {
    const approvalId = await setProposalVat(deps.sales, vat.proposalId, vat.mode);
    await deps.tg.answerCallback(
      callbackId,
      approvalId ? 'Onay kuyruğuna eklendi' : 'Bu teklif artık beklemiyor',
    );
    if (approvalId) await deps.tg.sendMessage(chatId, 'Teklif onay kuyruğunda: /onaylar');
    return true;
  }
  if (slot) {
    const m = await deps.repo.getMeeting(slot.meetingId);
    const start = m?.status === 'proposed' ? m.proposed_slots[slot.index] : undefined;
    if (!m || !start) {
      await deps.tg.answerCallback(callbackId, 'Bu öneri artık geçerli değil');
      return true;
    }
    await scheduleMeeting(deps.sales, m.id, new Date(start));
    await deps.tg.answerCallback(callbackId, 'Görüşme kaydedildi ✅');
    await deps.tg.sendMessage(
      chatId,
      `🗓️ Görüşme kaydedildi: ${formatSlot(new Date(start))}${deps.sales.calendar.configured ? ' (takvimine eklendi)' : ''}. Öncesinde /hazirlik ile not hazırlayabilirim.`,
    );
  }
  return true;
}

/** After a proposal approval: next step message with the panel link (PDF is made there, K-13.12). */
export async function afterProposalDecision(
  approvalId: string,
  status: 'approved' | 'rejected',
  chatId: number,
  deps: SalesBotDeps,
) {
  if (!deps.sales) return;
  const p = await onProposalDecided(deps.sales, approvalId, status);
  if (!p || status !== 'approved') return;
  const link = deps.panelUrl ? `\n${deps.panelUrl.replace(/\/$/, '')}/teklifler/${p.id}` : '';
  await deps.tg.sendMessage(
    chatId,
    `📄 Teklif ${p.number} onaylandı. PDF'i panelde oluşturup gönderebilirsin:${link}`,
  );
}
