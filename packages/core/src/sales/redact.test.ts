import { describe, expect, it } from 'vitest';
import { redactPersonal } from './redact.ts';

describe('redactPersonal (K-4.9)', () => {
  it('removes emails, phones, IBAN and TC numbers', () => {
    const r = redactPersonal(
      'Bana ali.veli@ornek.com ya da 0532 123 45 67 / +90 (532) 123-45-67 üzerinden ulaşın. IBAN TR33 0006 1005 1978 6457 8413 26, TC 12345678901.',
    );
    expect(r.text).not.toMatch(/ornek\.com|532|TR33|12345678901/);
    expect(r.text).toContain('[e-posta]');
    expect(r.text).toContain('[telefon]');
    expect(r.text).toContain('[IBAN]');
    expect(r.text).toContain('[kimlik no]');
  });

  it('removes known contact names and titled / honorific names', () => {
    const r = redactPersonal(
      'Merhaba, Ayşe Hanım ile konuştuk. Dr. Mehmet Kaya randevu sistemini soruyor. Sayın Ali Demir bilgi istedi. Yılmaz da onaylıyor.',
      { names: ['Uzm. Dr. Ayşe Yılmaz'] },
    );
    expect(r.text).not.toMatch(/Ayşe|Mehmet|Kaya|Ali Demir|Yılmaz/);
    expect(r.text).toContain('[kişi] Hanım');
    expect(r.text).toContain('randevu sistemini soruyor');
  });

  it('drops the signature block after a sign-off line', () => {
    const r = redactPersonal(
      'Fiyat bilgisi alabilir miyiz?\n\nSaygılarımla,\nAhmet Yıldız\nGenel Müdür\nYıldız İnşaat',
    );
    expect(r.text).toBe('Fiyat bilgisi alabilir miyiz?');
  });

  it('keeps the business need intact', () => {
    const need =
      'Instagram mesajlarına geç dönüyoruz, haftada 40 talep kaçıyor. Bütçemiz aylık 20 bin civarı.';
    expect(redactPersonal(need).text).toBe(need);
  });
});
