import { describe, expect, it } from 'vitest';
import {
  classifyUpdate,
  decideDelivery,
  decodeApprovalCallback,
  encodeApprovalCallback,
  formatApprovalGroup,
  inQuietWindow,
  isOwner,
  parseCommand,
  splitMessage,
} from './logic.ts';
import type { TgUpdate } from './types.ts';

const OWNER = 111;
const msg = (from: number, extra: object = {}, chatType = 'private'): TgUpdate => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    from: { id: from },
    chat: { id: from, type: chatType },
    ...extra,
  },
});

describe('owner whitelist (K-15.1)', () => {
  it('accepts only the owner in a private chat', () => {
    expect(isOwner(msg(OWNER, { text: 'selam' }), OWNER)).toBe(true);
    expect(isOwner(msg(222, { text: 'selam' }), OWNER)).toBe(false);
    expect(isOwner(msg(OWNER, { text: 'selam' }, 'group'), OWNER)).toBe(false);
    expect(isOwner({ update_id: 1 }, OWNER)).toBe(false);
  });

  it('checks the callback sender too', () => {
    const cb: TgUpdate = {
      update_id: 2,
      callback_query: { id: 'c', from: { id: 999 }, data: 'x' },
    };
    expect(isOwner(cb, OWNER)).toBe(false);
  });
});

describe('commands', () => {
  it('parses commands, bot mentions and Turkish spellings', () => {
    expect(parseCommand('/bugun')).toEqual({ command: 'bugun', args: '' });
    expect(parseCommand('/bugün')).toEqual({ command: 'bugun', args: '' });
    expect(parseCommand('/uyandım')).toEqual({ command: 'uyandim', args: '' });
    expect(parseCommand('/ekle@papi_bot https://ornek.com')).toEqual({
      command: 'ekle',
      args: 'https://ornek.com',
    });
    expect(parseCommand('/ara  slogan nedir')).toEqual({ command: 'ara', args: 'slogan nedir' });
    expect(parseCommand('/bilinmeyen')).toBeNull();
    expect(parseCommand('selam /bugun')).toBeNull();
  });

  it('classifies text, voice and commands', () => {
    expect(classifyUpdate(msg(OWNER, { text: '/kota' }))).toMatchObject({
      kind: 'command',
      command: 'kota',
    });
    expect(classifyUpdate(msg(OWNER, { text: 'merhaba' }))).toMatchObject({
      kind: 'text',
      text: 'merhaba',
    });
    expect(
      classifyUpdate(msg(OWNER, { voice: { file_id: 'f', duration: 3, mime_type: 'audio/ogg' } })),
    ).toMatchObject({
      kind: 'voice',
      fileId: 'f',
    });
  });
});

describe('approval callbacks', () => {
  const id = '3f2b8c1e-1d2a-4b3c-9d4e-5f6a7b8c9d0e';

  it('round-trips and stays under 64 bytes', () => {
    const data = encodeApprovalCallback({ scope: 'item', id, op: 'ed' });
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
    expect(decodeApprovalCallback(data)).toEqual({ scope: 'item', id, op: 'ed' });
  });

  it('rejects tampered data', () => {
    expect(decodeApprovalCallback('ap:not-a-uuid:ok')).toBeNull();
    expect(decodeApprovalCallback(`ap:${id}:send`)).toBeNull();
    expect(decodeApprovalCallback(`ab:${id}:ed`)).toBeNull();
  });

  it('groups items with per-item and bulk buttons', () => {
    const { text, keyboard } = formatApprovalGroup(
      [
        { id, title: 'Mail: Ornek <Klinik>', preview: 'Merhaba' },
        { id, title: 'WhatsApp: Galeri', preview: 'Selam' },
      ],
      id,
    );
    expect(text).toContain('2 iş onay bekliyor');
    expect(text).toContain('&lt;Klinik&gt;');
    expect(keyboard).toHaveLength(3);
    expect(keyboard[2]?.[0]?.text).toBe('✅ Tümünü onayla');
  });
});

describe('notifications (K-15.4, K-15.5)', () => {
  const prefs = {
    hot_reply: true,
    payment: true,
    system_error: true,
    approval_pending: true,
    daily_report: true,
    business_news: false,
  };

  it('sends everything while awake, drops disabled kinds', () => {
    expect(decideDelivery('daily_report', false, prefs, true)).toBe('send');
    expect(decideDelivery('business_news', false, prefs, true)).toBe('drop');
  });

  it('in quiet mode only errors and hot replies get through', () => {
    expect(decideDelivery('system_error', true, prefs, true)).toBe('send_silent');
    expect(decideDelivery('hot_reply', true, prefs, false)).toBe('send');
    expect(decideDelivery('approval_pending', true, prefs, true)).toBe('hold');
  });

  it('quiet window can cross midnight (Istanbul time)', () => {
    const w = { start: '23:00', end: '07:00' };
    expect(inQuietWindow(w, new Date('2026-10-13T21:30:00Z'))).toBe(true); // 00:30 TR
    expect(inQuietWindow(w, new Date('2026-10-13T09:00:00Z'))).toBe(false); // 12:00 TR
    expect(inQuietWindow(null, new Date())).toBe(false);
  });
});

describe('splitMessage', () => {
  it('splits long text under the limit', () => {
    const parts = splitMessage('a\n'.repeat(3000), 4000);
    expect(parts.every((p) => p.length <= 4000)).toBe(true);
    expect(parts.join('\n').replace(/\n/g, '').length).toBe(3000);
  });
});
