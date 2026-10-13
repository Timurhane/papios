import { z } from 'zod';
import type { PackageCode } from './catalog.ts';

/** K-14.4 setup form, filled by the client. Answers are client data (client_sensitive). */
export type FieldType =
  'text' | 'email' | 'phone' | 'url' | 'textarea' | 'lines' | 'choice' | 'multi';

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string;
  options?: { value: string; label: string }[];
  max?: number;
}

const COMMON: FormField[] = [
  { key: 'business_name', label: 'İşletme adı', type: 'text', required: true, max: 120 },
  {
    key: 'contact_name',
    label: 'Bildirimleri alacak kişi',
    type: 'text',
    required: true,
    max: 120,
  },
  { key: 'contact_phone', label: 'Telefonu', type: 'phone', required: true, max: 30 },
  { key: 'contact_email', label: 'E-postası', type: 'email', required: true, max: 200 },
  {
    key: 'hours',
    label: 'Çalışma saatleri',
    type: 'textarea',
    required: true,
    help: 'Örn: Hafta içi 09:00–19:00, cumartesi 10:00–16:00, pazar kapalı',
    max: 1000,
  },
  {
    key: 'services',
    label: 'Hizmetler ve fiyatlar',
    type: 'lines',
    required: true,
    help: 'Her satıra bir hizmet; paylaşmak istediğiniz fiyatları yanına yazın.',
    max: 4000,
  },
  {
    key: 'faq',
    label: 'Sık sorulan sorular ve cevapları',
    type: 'textarea',
    required: false,
    max: 6000,
  },
  {
    key: 'tone',
    label: 'Asistan nasıl konuşsun?',
    type: 'choice',
    required: true,
    options: [
      { value: 'samimi', label: 'Samimi' },
      { value: 'resmi', label: 'Resmi' },
      { value: 'kisa', label: 'Kısa ve net' },
    ],
  },
  {
    key: 'channels',
    label: 'Hangi kanallardan gelen mesajlara cevap verilsin?',
    type: 'multi',
    required: true,
    options: [
      { value: 'web', label: 'Web sitesi sohbet kutusu' },
      { value: 'instagram', label: 'Instagram DM' },
      { value: 'whatsapp', label: 'WhatsApp (Meta ücretlendirir)' },
    ],
  },
  { key: 'website', label: 'Web siteniz', type: 'url', required: false, max: 300 },
  { key: 'instagram', label: 'Instagram kullanıcı adınız', type: 'text', required: false, max: 60 },
  {
    key: 'booking',
    label: 'Randevu veya sipariş nasıl alınıyor?',
    type: 'textarea',
    required: false,
    help: 'Link, telefon ya da kullandığınız programın adı',
    max: 1000,
  },
  {
    key: 'handoff',
    label: 'Asistanın cevaplamayıp size bırakması gereken konular',
    type: 'textarea',
    required: false,
    max: 2000,
  },
];

const SYSTEM_EXTRA: FormField[] = [
  {
    key: 'reminders',
    label: 'Hangi hatırlatmalar gitsin ve ne kadar önce?',
    type: 'textarea',
    required: false,
    help: 'Örn: randevudan 1 gün ve 2 saat önce; ödeme gününden 3 gün önce',
    max: 1000,
  },
  {
    key: 'google_profile',
    label: 'Google İşletme profili linkiniz',
    type: 'url',
    required: false,
    max: 300,
  },
  {
    key: 'software',
    label: 'Randevu/muhasebe için kullandığınız program',
    type: 'text',
    required: false,
    max: 200,
  },
];

export function formFieldsFor(pkg: PackageCode | string): FormField[] {
  return pkg === 'sistem' || pkg === 'operasyon' ? [...COMMON, ...SYSTEM_EXTRA] : COMMON;
}

export type FormAnswers = Record<string, string | string[]>;

function fieldSchema(f: FormField): z.ZodType {
  const max = f.max ?? 2000;
  const opts = (f.options ?? []).map((o) => o.value) as [string, ...string[]];
  let s: z.ZodType;
  switch (f.type) {
    case 'email':
      s = z.email().max(max);
      break;
    case 'url':
      s = z.url({ protocol: /^https?$/ }).max(max);
      break;
    case 'phone':
      s = z
        .string()
        .trim()
        .max(max)
        .regex(/^[+\d][\d\s()-]{6,}$/, 'Geçerli bir telefon yazın');
      break;
    case 'lines':
      s = z
        .array(z.string().trim().min(1).max(300))
        .min(f.required ? 1 : 0)
        .max(100);
      break;
    case 'choice':
      s = z.enum(opts);
      break;
    case 'multi':
      s = z
        .array(z.enum(opts))
        .min(f.required ? 1 : 0)
        .max(opts.length);
      break;
    default:
      s = z
        .string()
        .trim()
        .min(f.required ? 1 : 0)
        .max(max);
  }
  return f.required ? s : s.optional();
}

/** Validates (and normalizes) submitted answers for a package's form. */
export function parseAnswers(
  pkg: PackageCode | string,
  raw: Record<string, unknown>,
): { ok: true; answers: FormAnswers } | { ok: false; errors: Record<string, string> } {
  const fields = formFieldsFor(pkg);
  const normalized: Record<string, unknown> = {};
  for (const f of fields) {
    let v = raw[f.key];
    if (typeof v === 'string') v = v.trim();
    if (f.type === 'lines' && typeof v === 'string')
      v = v
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    if (f.type === 'multi' && typeof v === 'string') v = v ? [v] : [];
    if (v === '' || (Array.isArray(v) && v.length === 0 && !f.required)) v = undefined;
    normalized[f.key] = v;
  }
  const shape = Object.fromEntries(fields.map((f) => [f.key, fieldSchema(f)]));
  const r = z.object(shape).safeParse(normalized);
  if (r.success) {
    const answers = Object.fromEntries(
      Object.entries(r.data).filter(([, v]) => v !== undefined),
    ) as FormAnswers;
    return { ok: true, answers };
  }
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? '_');
    errors[key] ??=
      fields.find((f) => f.key === key)?.required && normalized[key] === undefined
        ? 'Bu alan zorunlu'
        : issue.message.startsWith('Geçerli')
          ? issue.message
          : 'Geçersiz değer';
  }
  return { ok: false, errors };
}
