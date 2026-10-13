import { MODULES, modulesFor, type DeliveryModule } from './catalog.ts';
import { clientConfigSchema, type ClientConfig } from './config.ts';
import type { FormAnswers } from './form.ts';

/**
 * K-14.2 Operatör outputs, produced by code from templates (no model: the answers are client data, K-4.7).
 */
export interface OperatorInput {
  packageCode: string;
  answers: FormAnswers;
  company: {
    name: string;
    sector: string | null;
    city: string | null;
    website: string | null;
    instagram: string | null;
  };
  metricsUrl: string | null;
  metricsToken: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function buildClientConfig(i: OperatorInput): ClientConfig {
  const channels = list(i.answers.channels);
  return clientConfigSchema.parse({
    version: 1,
    client: {
      name: str(i.answers.business_name) ?? i.company.name,
      sector: i.company.sector,
      city: i.company.city,
      website: str(i.answers.website) ?? i.company.website,
      instagram: (str(i.answers.instagram) ?? i.company.instagram)?.replace(/^@/, '') ?? null,
    },
    contact: {
      name: str(i.answers.contact_name),
      phone: str(i.answers.contact_phone),
      email: str(i.answers.contact_email),
    },
    hours: str(i.answers.hours),
    services: list(i.answers.services),
    faq: str(i.answers.faq) ?? '',
    tone: str(i.answers.tone) ?? 'samimi',
    booking: str(i.answers.booking),
    handoff: str(i.answers.handoff),
    channels: {
      web: channels.includes('web'),
      instagram: channels.includes('instagram'),
      whatsapp: channels.includes('whatsapp'),
    },
    modules: modulesFor(i.packageCode).map((m) => m.code),
    reminders: str(i.answers.reminders),
    google_profile: str(i.answers.google_profile),
    software: str(i.answers.software),
    papi: { metrics_url: i.metricsUrl, metrics_token: i.metricsToken },
    llm: { provider: 'gemini', model: 'gemini-flash-latest', paid_tier_recommended: true },
  });
}

/** Checklist items: common delivery steps + each module's setup steps + tests + handover. */
export function buildChecklist(
  packageCode: string,
  config?: ClientConfig,
): { title: string; module: string | null }[] {
  const mods = modulesFor(packageCode);
  const items: { title: string; module: string | null }[] = [
    { title: 'Kurulum formu gözden geçirildi', module: null },
    {
      title:
        'Müşterinin Cloudflare hesabı açıldı ve erişim verildi (müşterinin kendi hesabı, K-7.6)',
      module: null,
    },
    { title: 'papi-config.json müşteri reposuna eklendi (gizli anahtarlar hariç)', module: null },
  ];
  for (const m of mods) for (const s of m.setupSteps) items.push({ title: s, module: m.code });
  if (config?.channels.whatsapp)
    items.push({
      title:
        'WhatsApp: müşteri Meta ücretlerini onayladı ve adaptör açıldı (aksi hâlde kapalı kalır)',
      module: 'cevap-asistani',
    });
  for (const m of mods) items.push({ title: `${m.name}: TESTS.md listesi geçti`, module: m.code });
  items.push({ title: 'Müşteriyle teslim görüşmesi yapıldı', module: null });
  return items;
}

function moduleLines(mods: DeliveryModule[]): string {
  return mods
    .map(
      (m) =>
        `- ${m.name} (\`packages/modules/${m.code}\`)${m.reference ? ' — çalışan referans implementasyon var' : ' — şablon + rehber'}`,
    )
    .join('\n');
}

/** Claude Code setup prompt (Turkish, read by Timurhan and pasted into Claude Code). */
/** What the prompt needs; a full ClientConfig fits, and so does a provisional one before the form arrives. */
export type PromptInput = Pick<ClientConfig, 'channels' | 'modules'> & {
  client: Pick<ClientConfig['client'], 'name' | 'website'>;
};

export function buildClaudePrompt(config: PromptInput, packageName: string): string {
  const mods = MODULES.filter((m) => config.modules.includes(m.code));
  const channels = [
    config.channels.web ? 'web sitesi sohbet kutusu' : null,
    config.channels.instagram ? 'Instagram DM' : null,
    config.channels.whatsapp ? 'WhatsApp (adaptör kapalı gelir; müşteri onayıyla açılır)' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `# ${config.client.name} — ${packageName} kurulumu

Sen, AJNA Digital adına ${config.client.name} için teslim modüllerini **müşterinin kendi hesaplarında**
kuran bir Claude Code oturumusun (K-7.6). Papi reposundaki şablonları kullan; müşteriye özel her şey
\`papi-config.json\` dosyasında.

## Kurallar
- Hiçbir gizli anahtarı (API anahtarı, token, şifre) koda, repoya ya da bu sohbete yazma; yalnızca
  \`wrangler secret put\` ile müşterinin Cloudflare hesabına ekle.
- Müşterinin müşterilerinin mesajları kişisel veridir: yapay zeka sağlayıcısında **ücretli, eğitimde
  kullanılmayan** katman kullanılmasını müşteriye hatırlat (README'de yazılı).
- Bir adımda müşteri hesabı, ödeme ya da kart gerekirse dur ve Timurhan'a sor.

## Kurulacak modüller
${moduleLines(mods)}

Kanallar: ${channels || 'belirtilmedi'}.

## Adımlar
1. \`packages/modules/cevap-asistani/worker\` klasörünü müşteriye özel yeni bir repoya kopyala.
2. \`papi-config.json\`'u (Papi panelinden indirilen) repo köküne koy; \`pnpm test\` ile şemaya uygun olduğunu doğrula.
3. Müşterinin Cloudflare hesabıyla \`wrangler login\`; \`wrangler.toml\` içinde Worker adını
   \`${slug(config.client.name)}-asistan\` yap.
4. Secret'lar: \`LLM_API_KEY\`${config.channels.instagram ? ', `META_APP_SECRET`, `META_PAGE_TOKEN`, `META_VERIFY_TOKEN`' : ''},
   \`NOTIFY_TELEGRAM_TOKEN\` ve \`NOTIFY_TELEGRAM_CHAT\` (ya da e-posta bildirimi).
5. \`wrangler deploy\`; çıkan adresi not et.
${config.channels.web ? `6. Site sohbet kutusu: README'deki tek satırlık \`<script>\` kodunu ${config.client.website ?? 'müşterinin sitesine'} ekle.\n` : ''}${config.channels.instagram ? `7. Instagram: müşterinin Meta uygulamasında webhook adresini \`<worker>/meta/webhook\` yap, \`messages\` aboneliğini aç.\n` : ''}8. Her modülün \`TESTS.md\` listesini tek tek çalıştır ve sonucu yaz.
9. Aylık sayılar: \`papi.metrics_url\` ve token config'te; \`/metrics/push\` uç noktasının çalıştığını doğrula.

## Bitirince
Kontrol listesindeki maddeleri Papi panelinde işaretlenecek şekilde, hangi adımın tamamlandığını ve
varsa sorunları kısa bir liste olarak raporla.
`;
}

function slug(name: string): string {
  return (
    name
      .toLocaleLowerCase('tr')
      .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c] ?? c)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'musteri'
  );
}
