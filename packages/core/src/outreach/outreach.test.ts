import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaults.ts';
import { classifyReply, stripQuoted } from './classify.ts';
import { checkOutbound, type OutboundFacts } from './guard.ts';
import { planStep, type PlaybookStep, type StepContext } from './playbook.ts';
import {
  addDays,
  dailyEmailLimit,
  isBusinessTime,
  localDate,
  nextBusinessTime,
  sendGapMinutes,
} from './schedule.ts';
import {
  checkColdEmail,
  fillTemplate,
  findBannedPhrases,
  whatsappLink,
  withUnsubscribeFooter,
  wordCount,
  xIntentLink,
} from './text.ts';
import { signToken, verifyToken } from './token.ts';

const H = defaultSettings.business_hours;

describe('business hours (K-10.10, Europe/Istanbul)', () => {
  it('weekdays 09:30–18:00 Istanbul time', () => {
    expect(isBusinessTime(new Date('2026-10-13T07:00:00Z'), H)).toBe(true); // Tue 10:00 TR
    expect(isBusinessTime(new Date('2026-10-13T06:00:00Z'), H)).toBe(false); // 09:00 TR
    expect(isBusinessTime(new Date('2026-10-13T15:00:00Z'), H)).toBe(false); // 18:00 TR
    expect(isBusinessTime(new Date('2026-10-17T08:00:00Z'), H)).toBe(false); // Saturday
  });

  it('night approvals go out at the next business opening', () => {
    expect(nextBusinessTime(new Date('2026-10-13T21:00:00Z'), H).toISOString()).toBe(
      '2026-10-14T06:30:00.000Z',
    );
    expect(nextBusinessTime(new Date('2026-10-16T16:00:00Z'), H).toISOString()).toBe(
      '2026-10-19T06:30:00.000Z',
    ); // Fri evening → Mon
    const inside = new Date('2026-10-13T10:00:00Z');
    expect(nextBusinessTime(inside, H)).toBe(inside);
  });

  it('local dates and day math', () => {
    expect(localDate(new Date('2026-10-13T22:30:00Z'), 'Europe/Istanbul')).toBe('2026-10-14');
    expect(addDays('2026-10-13', 20)).toBe('2026-11-02');
  });
});

describe('sending limits (K-10.9)', () => {
  const cfg = defaultSettings.email_sending;
  it('warm-up raises the daily limit weekly up to the cap', () => {
    expect(dailyEmailLimit(cfg, null, '2026-10-13')).toBe(20);
    expect(dailyEmailLimit(cfg, '2026-10-13', '2026-10-19')).toBe(20);
    expect(dailyEmailLimit(cfg, '2026-10-13', '2026-10-20')).toBe(25);
    expect(dailyEmailLimit(cfg, '2026-01-01', '2026-10-13')).toBe(50);
  });
  it('random gaps stay within bounds', () => {
    expect(sendGapMinutes(cfg, () => 0)).toBe(cfg.min_gap_minutes);
    expect(sendGapMinutes(cfg, () => 0.9999)).toBe(cfg.max_gap_minutes);
  });
});

describe('text rules', () => {
  it('counts words and enforces the 80-word cold email rule (K-10.15)', () => {
    expect(wordCount('Merhaba Ayşe Hanım, sitenizin mobil hızı 35/100.')).toBe(7);
    expect(checkColdEmail('kelime '.repeat(80), 80).ok).toBe(true);
    expect(checkColdEmail('kelime '.repeat(81), 80)).toEqual({ ok: false, words: 81 });
  });
  it('builds one-click links (K-10.2, K-10.5)', () => {
    expect(whatsappLink('905321234567', 'Merhaba & selam')).toBe(
      'https://wa.me/905321234567?text=Merhaba%20%26%20selam',
    );
    expect(xIntentLink('a b')).toBe('https://x.com/intent/post?text=a%20b');
  });
  it('fills templates and spots banned phrases', () => {
    expect(fillTemplate('Merhaba {{ ad }},', { ad: 'Ayşe Hanım' })).toBe('Merhaba Ayşe Hanım,');
    expect(fillTemplate('Merhaba {{ad}},', {})).toBe('Merhaba ,');
    expect(findBannedPhrases('Hemen ARAYIN, kaçırmayın!', ['hemen arayın', 'bedava'])).toEqual([
      'hemen arayın',
    ]);
  });
  it('adds the unsubscribe footer', () => {
    expect(withUnsubscribeFooter('Gövde', 'https://x/u/t')).toContain(
      'almak istemiyorsanız: https://x/u/t',
    );
  });
});

describe('signed tokens (K-17.4)', () => {
  const secret = 's'.repeat(40);
  it('verifies its own tokens and rejects tampering', async () => {
    const t = await signToken(secret, 'unsubscribe', 'abc-123');
    expect(await verifyToken(secret, 'unsubscribe', t)).toBe('abc-123');
    expect(await verifyToken(secret, 'demo', t)).toBeNull();
    expect(await verifyToken(secret, 'unsubscribe', t.replace('abc', 'abd'))).toBeNull();
    expect(await verifyToken('x'.repeat(40), 'unsubscribe', t)).toBeNull();
    expect(await verifyToken(secret, 'unsubscribe', 'nodot')).toBeNull();
  });
  it('refuses weak secrets', async () => {
    await expect(signToken('short', 'u', '1')).rejects.toThrow();
  });
});

describe('reply classification (K-13.4, rules only: replies are personal data)', () => {
  it.each([
    ['Lütfen bir daha yazmayın.', 'do_not_contact'],
    ['Bizi listeden çıkarın lütfen', 'do_not_contact'],
    ['İlgilenmiyoruz, teşekkürler.', 'no'],
    ['Şu an değil, sezon sonu tekrar konuşalım.', 'later'],
    ['Merhaba, fiyat bilgisi alabilir miyim?', 'interested'],
    ['Görüşebiliriz, perşembe uygun mu?', 'interested'],
    ['Hangi programlarla çalışıyorsunuz?', 'question'],
    ['Tamam.', 'unknown'],
  ] as const)('%s → %s', (body, cls) => {
    expect(classifyReply({ body })).toBe(cls);
  });

  it('detects auto replies from headers and subjects', () => {
    expect(classifyReply({ body: 'x', headers: { 'Auto-Submitted': 'auto-replied' } })).toBe(
      'auto_reply',
    );
    expect(classifyReply({ subject: 'Otomatik yanıt: Merhaba', body: 'İzindeyim' })).toBe(
      'auto_reply',
    );
  });

  it('ignores the quoted original (our own words must not trigger rules)', () => {
    const body = 'Tamam, teşekkürler.\n\n13 Eki 2026 tarihinde Papi yazdı:\n> fiyat teklifimiz';
    expect(stripQuoted(body)).toBe('Tamam, teşekkürler.');
    expect(classifyReply({ body })).toBe('unknown');
  });
});

const step = (over: Partial<PlaybookStep>): PlaybookStep => ({
  position: 1,
  day_offset: 1,
  anchor: 'start',
  repeat_every_days: null,
  channel: 'email',
  angle: 'x',
  conditions: {},
  requires_approval: true,
  approval_exempt_kind: null,
  ...over,
});
const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  reach: { email: 'info@ornek.com', phone: null, instagram: 'ornek', linkedin: null },
  facts: {},
  founderSlotsAvailable: true,
  contractEnd: null,
  ...over,
});

describe('playbook engine (K-11.1)', () => {
  const steps = [
    step({ position: 1, day_offset: 1 }),
    step({ position: 2, day_offset: 3, channel: 'whatsapp', conditions: { requires: ['phone'] } }),
    step({ position: 3, day_offset: 5, channel: 'instagram_dm' }),
  ];

  it('G1 is due on the start day, G5 four days later', () => {
    expect(planStep(steps, 1, '2026-10-13', ctx())).toMatchObject({
      kind: 'due',
      dueDate: '2026-10-13',
      recipient: 'info@ornek.com',
    });
    expect(planStep(steps, 3, '2026-10-13', ctx())).toMatchObject({
      kind: 'due',
      dueDate: '2026-10-17',
      recipient: 'ornek',
    });
  });

  it('skips a step whose channel is unreachable', () => {
    expect(planStep(steps, 2, '2026-10-13', ctx())).toMatchObject({
      kind: 'skip',
      reason: 'Telefon yok',
    });
  });

  it('is done after the last step', () => {
    expect(planStep(steps, 4, '2026-10-13', ctx())).toEqual({ kind: 'done' });
  });

  it('founder-discount steps only when slots really exist (K-11.5)', () => {
    const s = [step({ conditions: { requires_founder_slots_true_state: true } })];
    expect(planStep(s, 1, '2026-10-13', ctx({ founderSlotsAvailable: false }))).toMatchObject({
      kind: 'skip',
    });
  });

  it('contract-end anchored steps', () => {
    const s = [step({ anchor: 'contract_end', day_offset: -30 })];
    expect(planStep(s, 1, '2026-10-13', ctx({ contractEnd: '2027-10-13' }))).toMatchObject({
      kind: 'due',
      dueDate: '2027-09-13',
    });
  });
});

describe('outbound guard', () => {
  const unsub = 'https://api.papi/u/tok';
  const good: OutboundFacts = {
    channel: 'email',
    recipient: 'info@ornek.com',
    body: withUnsubscribeFooter('Kısa ve somut bir mesaj.', unsub),
    cold: true,
    suppressed: false,
    approval: 'approved',
    exemptKind: null,
    sentToRecipientLast7Days: 0,
    sentEmailsToday: 0,
    dailyEmailLimit: 20,
    unsubscribeUrl: unsub,
    now: new Date('2026-10-13T08:00:00Z'),
  };

  it('passes a compliant email', () => {
    expect(checkOutbound(good, defaultSettings)).toEqual({ ok: true });
  });

  it('never sends to a suppressed recipient, even if approved (K-10.13)', () => {
    expect(checkOutbound({ ...good, suppressed: true }, defaultSettings)).toMatchObject({
      ok: false,
      retryLater: false,
    });
  });

  it('requires approval except for the analysis tool report (K-2.1, K-2.2)', () => {
    expect(checkOutbound({ ...good, approval: 'pending' }, defaultSettings)).toMatchObject({
      ok: false,
      retryLater: false,
    });
    expect(
      checkOutbound(
        { ...good, approval: 'none', exemptKind: 'analysis_tool_report', cold: false },
        defaultSettings,
      ),
    ).toEqual({ ok: true });
    expect(
      checkOutbound({ ...good, approval: 'none', exemptKind: 'cold_email' }, defaultSettings),
    ).toMatchObject({ ok: false });
  });

  it('requires the unsubscribe link and the 80-word limit', () => {
    expect(checkOutbound({ ...good, body: 'Linksiz' }, defaultSettings)).toMatchObject({
      ok: false,
      reasons: ['çıkış linki yok'],
    });
    const long = withUnsubscribeFooter('kelime '.repeat(81), unsub);
    expect(checkOutbound({ ...good, body: long }, defaultSettings)).toMatchObject({
      ok: false,
      reasons: [expect.stringContaining('81 kelime')],
    });
  });

  it('defers outside business hours, over the daily limit or the weekly per-person limit', () => {
    expect(
      checkOutbound({ ...good, now: new Date('2026-10-13T20:00:00Z') }, defaultSettings),
    ).toMatchObject({ ok: false, retryLater: true });
    expect(checkOutbound({ ...good, sentEmailsToday: 20 }, defaultSettings)).toMatchObject({
      ok: false,
      retryLater: true,
    });
    expect(checkOutbound({ ...good, sentToRecipientLast7Days: 2 }, defaultSettings)).toMatchObject({
      ok: false,
      retryLater: true,
    });
  });
});
