import { describe, expect, it } from 'vitest';
import { extractSignals } from './html.ts';
import { buildToolReport, toolReportEmail } from './tool-report.ts';

const site = extractSignals(
  '<html><head><title>Örnek Klinik</title></head><body><a href="https://instagram.com/ornek">ig</a></body></html>',
  'https://ornek.com/',
);

describe('analysis tool report (K-12.3)', () => {
  it('has speed, channels, reviews and exactly three de-duplicated suggestions', () => {
    const r = buildToolReport({
      business: 'Örnek Klinik',
      site,
      mobile: { strategy: 'mobile', performance: 35, lcpMs: null, tbtMs: null, cls: null },
      desktop: { strategy: 'desktop', performance: 80, lcpMs: null, tbtMs: null, cls: null },
      findings: [
        'Randevular yalnızca telefonla alınıyor.',
        'randevular yalnızca telefonla alınıyor.',
      ],
      strongest: 'Mobil site yavaş.',
    });
    expect(r.speed).toMatchObject({ mobile: 35, desktop: 80 });
    expect(r.speed.verdict).toContain('yavaş');
    expect(r.channels.find((c) => c.label === 'Instagram bağlantısı')?.present).toBe(true);
    expect(r.channels.find((c) => c.label === 'WhatsApp bağlantısı')?.present).toBe(false);
    expect(r.suggestions).toHaveLength(3);
    expect(r.suggestions[0]).toBe('Randevular yalnızca telefonla alınıyor.');
    expect(r.suggestions[1]).toContain('WhatsApp');
  });

  it('works without a website and renders a plain-text email with the report link', () => {
    const r = buildToolReport({
      business: 'Sitesiz Usta',
      site: null,
      mobile: null,
      desktop: null,
      findings: [],
      strongest: null,
    });
    expect(r.speed.verdict).toContain('web siteniz bulunamadı');
    expect(r.suggestions).toHaveLength(3);
    const m = toolReportEmail(r, 'https://api.test/analiz/r/abc');
    expect(m.subject).toBe('Sitesiz Usta için dijital analiz raporunuz');
    expect(m.text).toContain('Raporun tamamı: https://api.test/analiz/r/abc');
    expect(m.text).toContain('1. ');
  });
});
