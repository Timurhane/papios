import fontkit from '@pdf-lib/fontkit';
import { formatTl, type PathQuote, type ProjectQuote, type VatMode, vatLabel } from '@papi/core';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface ProposalPdfData {
  number: string;
  /** YYYY-MM-DD */
  date: string;
  validUntil: string;
  companyName: string;
  packageName: string;
  packageSummary: string;
  intro: string;
  scope: string[];
  vatMode: VatMode;
  quote:
    | { kind: 'paths'; noSetup: PathQuote; setup: PathQuote }
    | { kind: 'project'; parts: { title: string; days: number }[]; project: ProjectQuote };
  founderDiscount: boolean;
}

// The bundled fonts are pre-subset to Latin + Turkish (fonttools); pdf-lib's own subsetter drops glyphs.
const SUBSET = false;
const A4: [number, number] = [595.28, 841.89];
const M = 48;
const INK = rgb(0.07, 0.07, 0.12);
const MUTED = rgb(0.42, 0.42, 0.5);
const VIOLET = rgb(0.545, 0.361, 0.965);
const LINE = rgb(0.88, 0.88, 0.92);

const trDate = (iso: string) =>
  new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${iso}T12:00:00Z`),
  );

export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

class Writer {
  y: number;
  page: PDFPage;
  constructor(
    private doc: PDFDocument,
    private regular: PDFFont,
    private bold: PDFFont,
  ) {
    this.page = doc.addPage(A4);
    this.y = A4[1] - M;
  }
  ensure(h: number) {
    if (this.y - h < M + 30) {
      this.page = this.doc.addPage(A4);
      this.y = A4[1] - M;
    }
  }
  text(
    t: string,
    o: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
      gap?: number;
    } = {},
  ) {
    const size = o.size ?? 10.5;
    const font = o.bold ? this.bold : this.regular;
    const x = o.x ?? M;
    const lines = wrap(font, t, size, o.width ?? A4[0] - x - M);
    for (const l of lines) {
      this.ensure(size * 1.5);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size * 1.45;
    }
    this.y -= o.gap ?? 0;
  }
  rule(gap = 10) {
    this.page.drawLine({
      start: { x: M, y: this.y },
      end: { x: A4[0] - M, y: this.y },
      thickness: 0.6,
      color: LINE,
    });
    this.y -= gap;
  }
}

/** K-13.6 / K-13.12: the proposal as a PDF, built in the browser. Fonts are Noto Sans (Turkish glyphs). */
export async function buildProposalPdf(
  d: ProposalPdfData,
  fonts: { regular: ArrayBuffer | Uint8Array; bold: ArrayBuffer | Uint8Array },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Teklif ${d.number} · ${d.companyName}`);
  doc.setAuthor('AJNA Digital');
  doc.setLanguage('tr-TR');
  const regular = await doc.embedFont(fonts.regular, { subset: SUBSET });
  const bold = await doc.embedFont(fonts.bold, { subset: SUBSET });
  const w = new Writer(doc, regular, bold);
  const vat = vatLabel(d.vatMode);

  // header
  w.page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: VIOLET });
  w.page.drawText('AJNA Digital', { x: M, y: w.y - 18, size: 18, font: bold, color: INK });
  w.page.drawText('AI. SYSTEMS. GROWTH. CREATIVE.', {
    x: M,
    y: w.y - 32,
    size: 7.5,
    font: regular,
    color: MUTED,
  });
  const right = (t: string, y: number, size: number, f: PDFFont, color = INK) =>
    w.page.drawText(t, { x: A4[0] - M - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  right(`Teklif ${d.number}`, w.y - 16, 11, bold);
  right(`Tarih: ${trDate(d.date)}`, w.y - 30, 8.5, regular, MUTED);
  right(`Geçerlilik: ${trDate(d.validUntil)}`, w.y - 42, 8.5, regular, MUTED);
  w.y -= 64;
  w.rule(18);

  w.text(d.companyName, { size: 15, bold: true, gap: 2 });
  w.text(`${d.packageName} — ${d.packageSummary}`, { color: MUTED, gap: 12 });
  w.text(d.intro, { size: 11, gap: 14 });

  w.text('Kapsam', { size: 12, bold: true, gap: 4 });
  for (const s of d.scope) {
    w.ensure(16);
    w.page.drawCircle({ x: M + 4, y: w.y - 7, size: 1.8, color: VIOLET });
    w.text(s, { x: M + 14, gap: 2 });
  }
  w.y -= 12;

  if (d.quote.kind === 'paths') {
    w.text('Ödeme seçenekleri', { size: 12, bold: true, gap: 8 });
    const colW = (A4[0] - 2 * M - 16) / 2;
    const boxH = 150;
    w.ensure(boxH + 10);
    const top = w.y;
    const col = (q: PathQuote, title: string, x: number) => {
      w.page.drawRectangle({
        x,
        y: top - boxH,
        width: colW,
        height: boxH,
        borderColor: LINE,
        borderWidth: 1,
      });
      let y = top - 20;
      const line = (
        t: string,
        o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {},
      ) => {
        for (const l of wrap(o.f ?? regular, t, o.size ?? 9.5, colW - 24)) {
          w.page.drawText(l, {
            x: x + 12,
            y,
            size: o.size ?? 9.5,
            font: o.f ?? regular,
            color: o.color ?? INK,
          });
          y -= (o.size ?? 9.5) * 1.45;
        }
      };
      line(title, { size: 11, f: bold });
      y -= 4;
      line(`${formatTl(q.monthlyKurus)} / ay`, { size: 16, f: bold, color: VIOLET });
      line(vat, { size: 8, color: MUTED });
      y -= 4;
      if (q.setupFeeKurus) line(`Kurulum: ${formatTl(q.setupFeeKurus)}`);
      else line('Kurulum bedeli yok');
      line(`${q.commitmentMonths} ay taahhüt`);
      if (q.discountedMonthlyKurus)
        line(`İlk ${q.discountedMonths} ay: ${formatTl(q.discountedMonthlyKurus)} / ay`, {
          f: bold,
        });
      line(`Başlangıçta: ${formatTl(q.dueAtStartKurus)}`);
      if (q.earlyExitSetupKurus)
        line(
          `Erken çıkışta kurulum bedelinin (${formatTl(q.earlyExitSetupKurus)}) kalan kısmı ödenir.`,
          { size: 8, color: MUTED },
        );
    };
    col(d.quote.noSetup, 'Kurulumsuz', M);
    col(d.quote.setup, 'Kurulumlu', M + colW + 16);
    w.y = top - boxH - 14;
  } else {
    w.text('Proje bedeli', { size: 12, bold: true, gap: 6 });
    for (const p of d.quote.parts) w.text(`${p.title} — ${p.days} gün`, { gap: 1 });
    w.y -= 4;
    w.text(`Toplam: ${formatTl(d.quote.project.projectKurus)} (${vat})`, {
      size: 13,
      bold: true,
      color: VIOLET,
      gap: 4,
    });
    w.text(
      `İsteğe bağlı aylık bakım: ${formatTl(d.quote.project.maintenanceMinKurus)} – ${formatTl(d.quote.project.maintenanceMaxKurus)} / ay. Kapsam dışı her talep ayrıca fiyatlanır.`,
      { color: MUTED, gap: 10 },
    );
  }

  if (d.founderDiscount)
    w.text('Kurucu müşteri indirimi uygulanmıştır (ilk müşterilerimize özel, sınırlı kontenjan).', {
      size: 9,
      color: MUTED,
      gap: 6,
    });
  w.text(`Bu teklif ${trDate(d.validUntil)} tarihine kadar geçerlidir.`, {
    size: 9,
    color: MUTED,
    gap: 18,
  });

  w.text('Timurhan', { bold: true, gap: 0 });
  w.text('AJNA Digital · ajnadigitalagency.com', { color: MUTED });

  for (const page of doc.getPages()) {
    page.drawText('Personel değil, refleks kuruyoruz.', {
      x: M,
      y: 28,
      size: 8,
      font: regular,
      color: MUTED,
    });
  }
  return doc.save();
}
