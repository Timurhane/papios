import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaults.ts';
import { detectCity, regionPriority } from './geo.ts';
import { extractSignals, mergeSignals } from './html.ts';
import { pageSpeedUrl, parsePageSpeed } from './pagespeed.ts';
import { computeScore, playbookForScore, type ScoreInput } from './scoring.ts';
import { detectSector } from './sector.ts';

const HOME = `<!doctype html><html lang="tr"><head><title>Örnek Diş Kliniği | Balıkesir</title>
<meta name="description" content="Balıkesir&#39;de implant ve ortodonti">
<meta name="generator" content="WordPress 6.6"></head><body>
<a href="https://www.instagram.com/ornekdis/">IG</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">paylaş</a>
<a href="/iletisim">İletişim</a><a href="tel:+90 266 123 45 67">Ara</a>
<p>Uzm. Dr. Ayşe Yılmaz kurucumuzdur. Şubelerimiz: Karesi, Altıeylül</p>
<footer>© 2019 Örnek | info@ornekdis.com</footer><script>var x="tawk.to"</script></body></html>`;

const CONTACT = `<html><body><form><input type="email"><textarea></textarea></form>
<a href="https://wa.me/905321234567">WhatsApp</a><a href="mailto:randevu@ornekdis.com">Mail</a>
<p>Adres: Atatürk Cad. No:1 Karesi/Balıkesir</p></body></html>`;

describe('extractSignals (K-9.1)', () => {
  const home = extractSignals(HOME, 'https://ornekdis.com/');

  it('reads page basics', () => {
    expect(home).toMatchObject({
      https: true,
      title: 'Örnek Diş Kliniği | Balıkesir',
      description: "Balıkesir'de implant ve ortodonti",
      lang: 'tr',
      generator: 'WordPress 6.6',
      chatWidget: 'tawk',
      copyrightYear: 2019,
      branches: true,
      contactPageUrl: 'https://ornekdis.com/iletisim',
    });
  });

  it('finds socials (ignoring share links), phones, emails and decision makers', () => {
    expect(home.socials).toEqual({ instagram: 'ornekdis' });
    expect(home.phones).toEqual(['902661234567']);
    expect(home.emails).toEqual(['info@ornekdis.com']);
    expect(home.decisionMakerHints[0]).toContain('Ayşe Yılmaz');
  });

  it('merges the contact page', () => {
    const merged = mergeSignals(home, extractSignals(CONTACT, 'https://ornekdis.com/iletisim'));
    expect(merged).toMatchObject({ hasContactForm: true, whatsapp: true });
    expect(merged.emails).toEqual(['info@ornekdis.com', 'randevu@ornekdis.com']);
    expect(merged.phones).toContain('905321234567');
  });

  it('caps very large pages', () => {
    const big = `<title>x</title>${'a'.repeat(1_000_000)}<a href="https://wa.me/1">w</a>`;
    expect(extractSignals(big, 'http://x.com').whatsapp).toBe(false);
  });
});

describe('PageSpeed', () => {
  it('requests only the needed fields', () => {
    const u = new URL(pageSpeedUrl('https://ornek.com', 'mobile', 'K'));
    expect(u.searchParams.get('strategy')).toBe('mobile');
    expect(u.searchParams.get('fields')).toContain('performance/score');
    expect(u.searchParams.get('key')).toBe('K');
  });

  it('parses scores', () => {
    expect(
      parsePageSpeed(
        {
          lighthouseResult: {
            categories: { performance: { score: 0.43 } },
            audits: { 'largest-contentful-paint': { numericValue: 5200 } },
          },
        },
        'mobile',
      ),
    ).toEqual({ strategy: 'mobile', performance: 43, lcpMs: 5200, tbtMs: null, cls: null });
  });
});

describe('sector and region', () => {
  it('detects high-value sectors from Turkish text', () => {
    expect(detectSector('Örnek Diş Kliniği', 'implant ve ortodonti')).toMatchObject({
      code: 'clinic',
      tier: 'high',
    });
    expect(detectSector('Yılmaz Emlak Gayrimenkul')).toMatchObject({ code: 'real_estate' });
    expect(detectSector('Lezzet Restoran')).toMatchObject({ tier: 'medium' });
    expect(detectSector('Bilinmeyen İş')).toBeNull();
  });

  it('finds the city and its priority (Balıkesir → Marmara → Türkiye)', () => {
    expect(detectCity('Atatürk Cad. No:1 Karesi/Balıkesir')).toBe('Balıkesir');
    expect(detectCity('İZMİR merkez')).toBe('İzmir');
    const p = defaultSettings.region_priority;
    expect(regionPriority('Balıkesir', p)).toBe(1);
    expect(regionPriority('Bursa', p)).toBe(2);
    expect(regionPriority('Ankara', p)).toBe(3);
    expect(regionPriority(null, p)).toBe(3);
  });
});

describe('scoring (K-9.3, K-9.4)', () => {
  const base: ScoreInput = {
    sectorTier: 'high',
    sectorLabel: 'Klinik / sağlık',
    regionPriority: 1,
    maxRegionPriority: 3,
    size: { branches: true, manyChannels: true },
    site: {
      exists: true,
      https: true,
      mobilePerformance: 38,
      whatsapp: false,
      booking: false,
      onlineOrder: false,
      contactForm: false,
      chatWidget: false,
      socialCount: 1,
      stale: true,
    },
    activeSignals: [],
    reach: { phone: true, email: true, decisionMaker: true, channels: 3 },
  };

  it('a high-value local clinic with gaps scores 70+ → Soğuk Ana', () => {
    const r = computeScore(base, defaultSettings.scoring);
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.fit).toBeLessThanOrEqual(40);
    expect(r.pain).toBeLessThanOrEqual(40);
    expect(r.reach).toBeLessThanOrEqual(20);
    expect(r.rationale.some((l) => l.includes('Mobil hız düşük (38/100)'))).toBe(true);
    expect(playbookForScore(r.total, defaultSettings.scoring.thresholds)).toBe('soguk_ana');
  });

  it('a well-equipped low-value business lands on the waitlist', () => {
    const r = computeScore(
      {
        ...base,
        sectorTier: 'low',
        sectorLabel: 'Perakende',
        regionPriority: 3,
        size: { branches: false, manyChannels: false },
        site: {
          ...base.site,
          mobilePerformance: 92,
          whatsapp: true,
          booking: true,
          contactForm: true,
          chatWidget: true,
          stale: false,
        },
        reach: { phone: true, email: false, decisionMaker: false, channels: 1 },
      },
      defaultSettings.scoring,
    );
    expect(r.total).toBeLessThan(50);
    expect(playbookForScore(r.total, defaultSettings.scoring.thresholds)).toBeNull();
  });

  it('weights come from settings', () => {
    const cfg = { ...defaultSettings.scoring, weights: { fit: 20, pain: 60, reach: 20 } };
    const r = computeScore(base, cfg);
    expect(r.fit).toBeLessThanOrEqual(20);
    expect(r.pain).toBeLessThanOrEqual(60);
  });

  it('50-69 → Hafif Soğuk', () => {
    expect(playbookForScore(55, defaultSettings.scoring.thresholds)).toBe('hafif_soguk');
  });
});

describe('extractSignals performance', () => {
  it('stays fast on pathological input', () => {
    const inputs = [
      'a'.repeat(400_000),
      `${'<form>'.repeat(20_000)}`,
      `${'Dr. '.repeat(50_000)}`,
      `${'1 '.repeat(100_000)}`,
    ];
    for (const html of inputs) {
      const t = performance.now();
      extractSignals(html, 'https://x.com');
      expect(performance.now() - t).toBeLessThan(500);
    }
  });
});
