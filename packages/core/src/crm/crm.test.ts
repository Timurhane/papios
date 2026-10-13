import { describe, expect, it } from 'vitest';
import { csvToImportRows, parseCsv } from './csv.ts';
import {
  dedupeKeys,
  detectLink,
  foldTurkish,
  normalizeDomain,
  normalizeName,
  normalizePhone,
} from './normalize.ts';

describe('normalization (K-8.10)', () => {
  it('folds Turkish letters', () => {
    expect(foldTurkish('İSTANBUL Çiçekçi Şükrü Ağa Öğün')).toBe('istanbul cicekci sukru aga ogun');
  });

  it('normalizes company names, dropping legal suffixes', () => {
    expect(normalizeName('Örnek Diş Kliniği Ltd. Şti.')).toBe('ornek dis klinigi');
    expect(normalizeName('ÖRNEK DİŞ KLİNİĞİ')).toBe('ornek dis klinigi');
    expect(normalizeName('Yılmaz İnşaat San. ve Tic. A.Ş.')).toBe('yilmaz');
  });

  it('normalizes domains', () => {
    expect(normalizeDomain('https://www.Ornek.com.tr/iletisim?x=1')).toBe('ornek.com.tr');
    expect(normalizeDomain('ornek.com')).toBe('ornek.com');
    expect(normalizeDomain('not a domain')).toBeNull();
  });

  it('normalizes Turkish phone numbers', () => {
    expect(normalizePhone('0532 123 45 67')).toBe('905321234567');
    expect(normalizePhone('+90 (266) 123 45 67')).toBe('902661234567');
    expect(normalizePhone('5321234567')).toBe('905321234567');
    expect(normalizePhone('123')).toBeNull();
  });

  it('builds dedupe keys', () => {
    expect(
      dedupeKeys({
        name: 'Örnek Ltd. Şti.',
        website: 'www.ornek.com',
        phone: '0532 123 45 67',
        instagram: '@Ornek',
        city: 'Balıkesir',
      }),
    ).toEqual({
      domain: 'ornek.com',
      phone: '905321234567',
      instagram: 'ornek',
      nameNorm: 'ornek',
      city: 'balikesir',
    });
  });
});

describe('detectLink (K-8.6)', () => {
  it('recognizes websites, Instagram, Maps and others', () => {
    expect(detectLink('https://www.ornekklinik.com/hakkimizda')).toEqual({
      kind: 'website',
      url: 'https://www.ornekklinik.com/hakkimizda',
      domain: 'ornekklinik.com',
    });
    expect(detectLink('ornekklinik.com')).toMatchObject({
      kind: 'website',
      domain: 'ornekklinik.com',
    });
    expect(detectLink('https://instagram.com/ornek.klinik/')).toEqual({
      kind: 'instagram',
      handle: 'ornek.klinik',
    });
    expect(detectLink('https://www.instagram.com/p/abc')).toMatchObject({ kind: 'unknown' });
    expect(
      detectLink('https://www.google.com/maps/place/%C3%96rnek+Klinik/@39.6,27.8,17z'),
    ).toMatchObject({ kind: 'maps', name: 'Örnek Klinik' });
    expect(detectLink('https://maps.app.goo.gl/abc123')).toMatchObject({
      kind: 'maps',
      name: null,
    });
    expect(detectLink('https://facebook.com/ornek')).toMatchObject({ kind: 'unknown' });
    expect(detectLink('::::')).toBeNull();
  });
});

describe('CSV import (K-8.5)', () => {
  it('parses quoted fields and detects the delimiter', () => {
    expect(parseCsv('a;b\n"x;1";"he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'he said "hi"'],
    ]);
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('maps Turkish headers and drops rows without a name', () => {
    const { rows, unknownHeaders } = csvToImportRows(
      'Firma Adı;Web Sitesi;Telefon;Şehir;Not\nÖrnek Klinik;ornek.com;0532 123 45 67;Balıkesir;x\n;y.com;;;\n',
    );
    expect(rows).toEqual([
      { name: 'Örnek Klinik', website: 'ornek.com', phone: '0532 123 45 67', city: 'Balıkesir' },
    ]);
    expect(unknownHeaders).toEqual(['Not']);
  });
});
