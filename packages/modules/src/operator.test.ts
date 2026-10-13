import { describe, expect, it } from 'vitest';
import { modulesFor } from './catalog.ts';
import { clientConfigSchema } from './config.ts';
import { formFieldsFor, parseAnswers } from './form.ts';
import { buildChecklist, buildClaudePrompt, buildClientConfig } from './operator.ts';

const raw = {
  business_name: 'Örnek Diş Kliniği',
  contact_name: 'Ayşe Yılmaz',
  contact_phone: '+90 532 111 22 33',
  contact_email: 'ayse@ornekdis.com',
  hours: 'Hafta içi 09:00–19:00',
  services: 'İmplant — 25.000 TL\nDiş beyazlatma\n',
  tone: 'samimi',
  channels: ['web', 'instagram', 'whatsapp'],
  instagram: '@ornekdis',
  google_profile: 'https://g.page/ornekdis',
};

describe('setup form (K-14.4)', () => {
  it('Sistem asks for reminders and Google profile; Refleks does not', () => {
    expect(formFieldsFor('sistem').map((f) => f.key)).toContain('google_profile');
    expect(formFieldsFor('refleks').map((f) => f.key)).not.toContain('google_profile');
  });

  it('normalizes lines and validates required fields', () => {
    const ok = parseAnswers('sistem', raw);
    expect(ok.ok && ok.answers.services).toEqual(['İmplant — 25.000 TL', 'Diş beyazlatma']);
    const bad = parseAnswers('sistem', { ...raw, contact_email: 'yok', hours: '' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.hours).toBe('Bu alan zorunlu');
      expect(bad.errors.contact_email).toBeDefined();
    }
  });
});

describe('Operatör outputs (K-14.2)', () => {
  const parsed = parseAnswers('sistem', raw);
  if (!parsed.ok) throw new Error('fixture');
  const config = buildClientConfig({
    packageCode: 'sistem',
    answers: parsed.answers,
    company: {
      name: 'Örnek',
      sector: 'Klinik / sağlık',
      city: 'Balıkesir',
      website: 'https://ornekdis.com',
      instagram: null,
    },
    metricsUrl: 'https://api.test/metrics/push',
    metricsToken: 'm'.repeat(43),
  });

  it('builds a config that satisfies the module schema', () => {
    expect(clientConfigSchema.safeParse(config).success).toBe(true);
    expect(config.client.instagram).toBe('ornekdis');
    expect(config.channels).toEqual({ web: true, instagram: true, whatsapp: true });
    expect(config.modules).toEqual(modulesFor('sistem').map((m) => m.code));
    expect(config.llm.paid_tier_recommended).toBe(true);
  });

  it('checklist covers every module, WhatsApp opt-in, tests and handover', () => {
    const items = buildChecklist('sistem', config).map((i) => i.title);
    expect(items).toContain('Site sohbet kutusu kodu siteye eklendi');
    expect(items.some((t) => t.startsWith('WhatsApp: müşteri Meta ücretlerini onayladı'))).toBe(
      true,
    );
    expect(items.filter((t) => t.endsWith('TESTS.md listesi geçti'))).toHaveLength(5);
    expect(items.at(-1)).toBe('Müşteriyle teslim görüşmesi yapıldı');
  });

  it('Claude Code prompt: own accounts, no secrets in repo, all modules and steps', () => {
    const p = buildClaudePrompt(config, 'Sistem');
    expect(p).toContain('müşterinin kendi hesaplarında');
    expect(p).toContain('wrangler secret put');
    expect(p).toContain('ornek-dis-klinigi-asistan');
    expect(p).toContain('META_PAGE_TOKEN');
    expect(p).toContain('Google yorum toplama ve cevaplama');
    // client contact data stays in the config file, not in the prompt
    expect(p).not.toContain('ayse@ornekdis.com');
    expect(p).not.toContain('532');
  });
});
