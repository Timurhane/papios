import type { InlineKeyboard, TgUpdate } from './types.ts';

export type Incoming =
  | { kind: 'command'; command: Command; args: string; chatId: number }
  | { kind: 'text'; text: string; chatId: number }
  | { kind: 'voice'; fileId: string; mimeType: string; duration: number; chatId: number }
  | { kind: 'callback'; callbackId: string; data: string; chatId: number; messageId: number }
  | { kind: 'unsupported'; chatId: number | null };

export const COMMANDS = [
  'bugun',
  'onaylar',
  'ekle',
  'ara',
  'rapor',
  'uyuyorum',
  'uyandim',
  'kota',
  'hazirlik',
  'gorusme',
  'teklif',
  'saat',
  'demo',
  'not',
  'tahsilat',
  'proje',
  'rutin',
  'start',
  'yardim',
] as const;
export type Command = (typeof COMMANDS)[number];

/** Sender id of an update, if any. */
export function senderId(update: TgUpdate): number | null {
  return (
    update.message?.from?.id ??
    update.callback_query?.from.id ??
    update.edited_message?.from?.id ??
    null
  );
}

/** K-15.1: only Timurhan's Telegram id is served; everyone else is silently ignored. */
export function isOwner(update: TgUpdate, ownerId: number): boolean {
  const id = senderId(update);
  const chatType = update.message?.chat.type ?? update.callback_query?.message?.chat.type;
  return id === ownerId && (chatType === undefined || chatType === 'private');
}

const ASCII_FOLD: Record<string, string> = {
  ü: 'u',
  ğ: 'g',
  ı: 'i',
  ş: 's',
  ç: 'c',
  ö: 'o',
  İ: 'i',
};

export function parseCommand(text: string): { command: Command; args: string } | null {
  const m = /^\/([\p{L}_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!m) return null;
  const name = (m[1] ?? '').toLowerCase().replace(/[üğışçöİ]/g, (c) => ASCII_FOLD[c] ?? c);
  if (!(COMMANDS as readonly string[]).includes(name)) return null;
  return { command: name as Command, args: (m[2] ?? '').trim() };
}

export function classifyUpdate(update: TgUpdate): Incoming {
  const cb = update.callback_query;
  if (cb) {
    return {
      kind: 'callback',
      callbackId: cb.id,
      data: cb.data ?? '',
      chatId: cb.message?.chat.id ?? cb.from.id,
      messageId: cb.message?.message_id ?? 0,
    };
  }
  const msg = update.message;
  if (!msg) return { kind: 'unsupported', chatId: null };
  const voice = msg.voice ?? msg.audio;
  if (voice) {
    return {
      kind: 'voice',
      fileId: voice.file_id,
      mimeType: voice.mime_type ?? 'audio/ogg',
      duration: voice.duration,
      chatId: msg.chat.id,
    };
  }
  if (msg.text) {
    const cmd = parseCommand(msg.text);
    if (cmd) return { kind: 'command', ...cmd, chatId: msg.chat.id };
    return { kind: 'text', text: msg.text, chatId: msg.chat.id };
  }
  return { kind: 'unsupported', chatId: msg.chat.id };
}

// --- approvals ---------------------------------------------------------------------------------

export type ApprovalOp = 'ok' | 'ed' | 'no';

export interface ApprovalCallback {
  scope: 'item' | 'batch';
  id: string;
  op: ApprovalOp;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** callback_data must stay within Telegram's 64-byte limit: "ap:<uuid>:<op>" is 42 bytes. */
export function encodeApprovalCallback(c: ApprovalCallback): string {
  return `${c.scope === 'item' ? 'ap' : 'ab'}:${c.id}:${c.op}`;
}

export function decodeApprovalCallback(data: string): ApprovalCallback | null {
  const [prefix, id, op] = data.split(':');
  if ((prefix !== 'ap' && prefix !== 'ab') || !id || !UUID.test(id)) return null;
  if (op !== 'ok' && op !== 'ed' && op !== 'no') return null;
  if (prefix === 'ab' && op === 'ed') return null;
  return { scope: prefix === 'ap' ? 'item' : 'batch', id, op };
}

export interface ApprovalItem {
  id: string;
  title: string;
  preview: string;
}

/** One-click queue / task buttons: "tk:<touchId>:ok" (Gönderdim / Aradım) or ":no" (Atla). */
export function encodeTouchCallback(touchId: string, op: 'ok' | 'no'): string {
  return `tk:${touchId}:${op}`;
}

export function decodeTouchCallback(data: string): { touchId: string; op: 'ok' | 'no' } | null {
  const [prefix, id, op] = data.split(':');
  if (prefix !== 'tk' || !id || !UUID.test(id) || (op !== 'ok' && op !== 'no')) return null;
  return { touchId: id, op };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** K-15.3: one grouped message per batch with per-item and bulk buttons. */
export function formatApprovalGroup(
  items: ApprovalItem[],
  batchId: string | null,
): { text: string; keyboard: InlineKeyboard } {
  const lines = items.map(
    (it, i) => `<b>${i + 1}. ${escapeHtml(it.title)}</b>\n${escapeHtml(truncate(it.preview, 600))}`,
  );
  const keyboard: InlineKeyboard = items.map((it, i) => [
    {
      text: `✅ ${i + 1}`,
      callback_data: encodeApprovalCallback({ scope: 'item', id: it.id, op: 'ok' }),
    },
    {
      text: `✏️ ${i + 1}`,
      callback_data: encodeApprovalCallback({ scope: 'item', id: it.id, op: 'ed' }),
    },
    {
      text: `❌ ${i + 1}`,
      callback_data: encodeApprovalCallback({ scope: 'item', id: it.id, op: 'no' }),
    },
  ]);
  if (batchId && items.length > 1) {
    keyboard.push([
      {
        text: '✅ Tümünü onayla',
        callback_data: encodeApprovalCallback({ scope: 'batch', id: batchId, op: 'ok' }),
      },
      {
        text: '❌ Tümünü reddet',
        callback_data: encodeApprovalCallback({ scope: 'batch', id: batchId, op: 'no' }),
      },
    ]);
  }
  const header = items.length === 1 ? 'Onay bekliyor:' : `${items.length} iş onay bekliyor:`;
  return { text: `${header}\n\n${lines.join('\n\n')}`, keyboard };
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Splits long replies under Telegram's 4096-character message limit. */
export function splitMessage(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

// --- notifications -----------------------------------------------------------------------------

export type NotificationKind =
  'hot_reply' | 'payment' | 'system_error' | 'approval_pending' | 'daily_report' | 'business_news';

export type Delivery = 'send' | 'send_silent' | 'hold' | 'drop';

/**
 * K-15.4/K-15.5: everything is instant while awake. In quiet mode only system errors and hot replies
 * get through (silently if `urgent_as_silent`); the rest is held for the /uyandim summary.
 */
export function decideDelivery(
  kind: NotificationKind,
  quiet: boolean,
  prefs: Record<NotificationKind, boolean>,
  urgentAsSilent: boolean,
): Delivery {
  if (!prefs[kind]) return 'drop';
  if (!quiet) return 'send';
  if (kind === 'system_error' || kind === 'hot_reply')
    return urgentAsSilent ? 'send_silent' : 'send';
  return 'hold';
}

/** Is `now` inside the optional automatic quiet window (Europe/Istanbul, may cross midnight)? */
export function inQuietWindow(
  window: { start: string; end: string } | null,
  now: Date,
  timeZone = 'Europe/Istanbul',
): boolean {
  if (!window) return false;
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const { start, end } = window;
  return start <= end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

const UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Proposal VAT answer (K-7.2): pv:<proposalId>:i (included) | e (excluded). */
export function encodeVatCallback(proposalId: string, mode: 'included' | 'excluded'): string {
  return `pv:${proposalId}:${mode === 'included' ? 'i' : 'e'}`;
}
export function decodeVatCallback(
  data: string,
): { proposalId: string; mode: 'included' | 'excluded' } | null {
  const m = new RegExp(`^pv:(${UUID_SRC}):([ie])$`).exec(data);
  return m ? { proposalId: m[1] ?? '', mode: m[2] === 'i' ? 'included' : 'excluded' } : null;
}

/** Meeting slot chosen by the company: ms:<meetingId>:<index>. */
export function encodeSlotCallback(meetingId: string, index: number): string {
  return `ms:${meetingId}:${index}`;
}
export function decodeSlotCallback(data: string): { meetingId: string; index: number } | null {
  const m = new RegExp(`^ms:(${UUID_SRC}):(\\d)$`).exec(data);
  return m ? { meetingId: m[1] ?? '', index: Number(m[2]) } : null;
}
