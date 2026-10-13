import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultSettings, quotePaths, quoteProject } from '@papi/core';
import { describe, expect, it } from 'vitest';
import { buildProposalPdf, wrap } from './pdf';

const fonts = {
  regular: Uint8Array.from(
    readFileSync(resolve(__dirname, '../../public/fonts/NotoSans-Regular.ttf')),
  ),
  bold: Uint8Array.from(readFileSync(resolve(__dirname, '../../public/fonts/NotoSans-Bold.ttf'))),
};

const base = {
  number: 'AJNA-2026-0001',
  date: '2026-10-13',
  validUntil: '2026-10-27',
  companyName: 'Örnek Diş Kliniği',
  packageName: 'Sistem',
  packageSummary: "Refleks'in tamamı + satış, randevu ve yorum otomasyonları.",
  intro:
    'Görüşmemizde Instagram ve WhatsApp mesajlarına geç dönüldüğünü, haftada onlarca randevu talebinin kaçtığını konuştuk. Sistem paketi gece gelen mesajları da anında karşılar ve randevuya çevirir.',
  scope: [
    'Instagram ve WhatsApp mesajlarına anında cevap',
    'Randevu ve ödeme hatırlatmaları',
    'Google yorum toplama ve cevaplama',
  ],
  vatMode: 'excluded' as const,
  founderDiscount: true,
};

describe('proposal PDF (K-13.12)', () => {
  it('builds a PDF with Turkish text and both payment paths', async () => {
    const q = quotePaths(2_550_000, defaultSettings.pricing, {
      setupPct: 40,
      monthlyPct: 20,
      monthlyMonths: 3,
    });
    const bytes = await buildProposalPdf({ ...base, quote: { kind: 'paths', ...q } }, fonts);
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5_000);
    expect(bytes.length).toBeLessThan(200_000); // fonts are subset
  });

  it('builds a custom project proposal', async () => {
    const parts = [
      { title: 'ERP entegrasyonu', days: 6 },
      { title: 'Yönetim paneli', days: 4 },
    ];
    const project = quoteProject(parts, {
      ...defaultSettings.pricing.custom_project,
      daily_rate_kurus: 1_000_000,
      uncertainty_pct: 20,
    });
    const bytes = await buildProposalPdf(
      {
        ...base,
        packageName: 'Özel',
        quote: { kind: 'project', parts, project },
        founderDiscount: false,
      },
      fonts,
    );
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  it('wraps long text within the width', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const f = await doc.embedFont(fonts.regular);
    const lines = wrap(f, 'kelime '.repeat(60), 10, 200);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(f.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(200);
  });
});
