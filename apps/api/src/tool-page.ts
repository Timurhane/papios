import type { ToolReport } from '@papi/core';
import { sha256Hex } from '@papi/core';
import {
  submitToolRequest,
  toolReportByToken,
  type Repo,
  type ToolDeps,
  type ToolView,
} from '@papi/server';
import { z } from 'zod';
import { verifyTurnstile } from './demo.ts';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const STYLE = `
  *{box-sizing:border-box} body{margin:0;background:#05050a;color:#ededf5;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
  main{max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
  h1{font-size:22px;margin:8px 0 0} h2{font-size:17px;margin:10px 0 0} p{color:#b4b4c8;margin:0}
  label{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:15px}
  .check{flex-direction:row;align-items:flex-start;gap:10px;font-weight:400;font-size:14px;color:#b4b4c8}
  input[type=text],input[type=email]{font:inherit;color:#ededf5;background:#11111d;border:1px solid #1f1f33;border-radius:12px;padding:12px}
  a{color:#a78bfa} .err{color:#f43f5e;font-size:14px}
  button{height:48px;border:0;border-radius:12px;font-weight:600;font-size:16px;color:#fff;cursor:pointer;background:linear-gradient(90deg,#8b5cf6,#3b82f6)}
  .card{background:#0c0c16;border:1px solid #1f1f33;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:8px}
  .meter{height:10px;border-radius:9px;background:#1f1f33;overflow:hidden} .meter span{display:block;height:100%;background:linear-gradient(90deg,#8b5cf6,#3b82f6)}
  ul,ol{margin:0;padding-left:20px} li{margin:4px 0}
  footer{color:#6b6b85;font-size:13px;text-align:center;margin:12px 0}`;

const shell = (title: string, body: string, head = '') => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style>${head}</head>
<body><main>${body}<footer>AJNA Digital · ajnadigitalagency.com</footer></main></body></html>`;

/** GET /analiz — the public form (K-12.2). Embeddable via iframe on the AJNA site. */
export function toolFormPage(opts: {
  turnstileSiteKey: string | null;
  privacyUrl: string;
  error?: string;
  values?: { query?: string; email?: string };
}): string {
  const head = opts.turnstileSiteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  return shell(
    'Ücretsiz dijital analiz',
    `<h1>İşletmeniz için ücretsiz dijital analiz</h1>
<p>Sitenizin hızını, iletişim kanallarınızı ve müşteri cevaplama hızınızı birkaç dakikada inceleyip size 3 somut öneri hazırlayalım.</p>
${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}
<form method="post" class="card">
  <label>İşletme adı veya web sitesi
    <input type="text" name="query" required minlength="2" maxlength="200" placeholder="ornekklinik.com veya Örnek Diş Kliniği" value="${esc(opts.values?.query ?? '')}"></label>
  <label>E-posta adresiniz
    <input type="email" name="email" required maxlength="200" placeholder="ad@isletme.com" value="${esc(opts.values?.email ?? '')}"></label>
  <label class="check"><input type="checkbox" name="consent" value="yes" required>
    <span><a href="${esc(opts.privacyUrl)}" target="_blank" rel="noopener">Aydınlatma metnini</a> okudum; analiz raporunun e-posta adresime gönderilmesi ve AJNA Digital'in bu konuda benimle iletişime geçmesi için açık rıza veriyorum.</span></label>
  ${opts.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(opts.turnstileSiteKey)}"></div>` : ''}
  <button>Analizi başlat</button>
</form>
<p style="font-size:13px">Yalnızca işletmenizin herkese açık bilgilerine bakarız. İstediğiniz an tek tıkla iletişim listemizden çıkabilirsiniz.</p>`,
    head,
  );
}

/** Built-in privacy notice (template; to be reviewed by a lawyer, K-17.7). */
export function toolPrivacyPage(): string {
  return shell(
    'Aydınlatma metni',
    `<h1>Analiz aracı aydınlatma metni</h1>
<p><strong>Veri sorumlusu:</strong> AJNA Digital.</p>
<p><strong>İşlenen veriler:</strong> e-posta adresiniz, işletme adı veya web siteniz, form gönderim zamanı ve onay kaydı. IP adresiniz yalnızca kötüye kullanımı önlemek için tek yönlü özetlenerek kısa süre tutulur.</p>
<p><strong>Amaç:</strong> istediğiniz analiz raporunu hazırlamak ve size iletmek; rızanız dahilinde size dijital hizmetlerimizle ilgili bilgi vermek.</p>
<p><strong>Hukuki sebep:</strong> açık rızanız (KVKK m.5/1) ve talebinizin yerine getirilmesi.</p>
<p><strong>Aktarım:</strong> veriler hizmet aldığımız altyapı sağlayıcılarında (veritabanı, e-posta) saklanır; yapay zeka modellerine e-posta adresiniz gönderilmez, yalnızca işletmenin herkese açık bilgileri analiz edilir.</p>
<p><strong>Saklama:</strong> rapor linki 30 gün açık kalır. İşletmenizle iş birliği kurulmazsa kişisel verileriniz en geç 12 ay sonra silinir veya anonimleştirilir.</p>
<p><strong>Haklarınız:</strong> KVKK m.11 kapsamındaki haklarınız için ve verilerinizin silinmesi için bize e-postayla yazabilir veya gelen her e-postadaki çıkış linkini kullanabilirsiniz.</p>
<p style="font-size:13px">Bu metin bir şablondur; yayına almadan önce bir hukukçu tarafından kontrol edilmelidir.</p>`,
  );
}

const pageFor = (title: string, text: string, head = '') =>
  shell(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`, head);

function meter(label: string, v: number | null): string {
  return `<div><p>${esc(label)}: <strong>${v === null ? '—' : `${v}/100`}</strong></p>${v === null ? '' : `<div class="meter"><span style="width:${Math.max(3, v)}%"></span></div>`}</div>`;
}

export function toolReportPage(view: ToolView): { status: 200 | 404 | 410; html: string } {
  switch (view.state) {
    case 'not_found':
      return { status: 404, html: pageFor('Rapor bulunamadı', 'Bağlantıyı kontrol edin.') };
    case 'expired':
      return {
        status: 410,
        html: pageFor(
          'Raporun süresi doldu',
          'Bu rapor bağlantısı artık açık değil. Yeni bir analiz isteyebilirsiniz.',
        ),
      };
    case 'pending':
      return {
        status: 200,
        html: pageFor(
          'Analiziniz hazırlanıyor…',
          'Siteniz inceleniyor; bu genellikle birkaç dakika sürer. Bu sayfa kendini yenileyecek.',
          '<meta http-equiv="refresh" content="15">',
        ),
      };
    case 'failed':
      return {
        status: 200,
        html: pageFor(
          'Analiz tamamlanamadı',
          'Sitenize şu an ulaşamadık. Ekibimiz raporu elle hazırlayıp size e-postayla iletecek.',
        ),
      };
    case 'ready':
      return { status: 200, html: readyPage(view.report) };
  }
}

function readyPage(r: ToolReport): string {
  return shell(
    `${r.business} · Dijital analiz`,
    `<h1>${esc(r.business)} · Dijital analiz raporu</h1>
${r.website ? `<p>${esc(r.website)}</p>` : ''}
${r.strongest ? `<div class="card"><strong>En önemli bulgu</strong><p>${esc(r.strongest)}</p></div>` : ''}
<div class="card"><h2>Hız ve mobil</h2>${meter('Mobil', r.speed.mobile)}${meter('Masaüstü', r.speed.desktop)}<p>${esc(r.speed.verdict)}</p></div>
<div class="card"><h2>İletişim kanalları</h2><ul>${r.channels.map((c) => `<li>${c.present ? '✅' : '❌'} ${esc(c.label)}</li>`).join('')}</ul></div>
<div class="card"><h2>Yorum yönetimi</h2><p>${esc(r.reviews)}</p></div>
<div class="card"><h2>Üç somut öneri</h2><ol>${r.suggestions.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
<div class="card"><p>Bu adımların çoğunu sizin için kurabiliriz: gece gelen mesajlara anında cevap, randevu ve takip hatırlatmaları, yorum toplama. İsterseniz 15 dakikalık bir görüşmede birlikte bakalım.</p>
<p><a href="https://ajnadigitalagency.com">ajnadigitalagency.com</a></p></div>`,
    '<meta name="robots" content="noindex">',
  );
}

const formSchema = z.object({
  query: z.string().trim().min(2).max(200),
  email: z.email().max(200),
  consent: z.literal('yes'),
  'cf-turnstile-response': z.string().max(4096).default(''),
});

export interface ToolPageDeps {
  tool: ToolDeps;
  repo: Repo;
  turnstileSecret: string | null;
  requireTurnstile: boolean;
  fetchImpl?: typeof fetch;
}

/** POST /analiz → redirect to the report page, or the form again with an error. */
export async function handleToolSubmit(
  deps: ToolPageDeps,
  form: Record<string, string>,
  ip: string | null,
): Promise<{ redirect: string } | { status: 400 | 403 | 429; error: string }> {
  const parsed = formSchema.safeParse(form);
  if (!parsed.success)
    return {
      status: 400,
      error: 'İşletme adı/sitesi ve geçerli bir e-posta girip aydınlatma onayını işaretleyin.',
    };
  if (deps.requireTurnstile) {
    if (
      !deps.turnstileSecret ||
      !(await verifyTurnstile(
        deps.turnstileSecret,
        parsed.data['cf-turnstile-response'],
        ip,
        deps.fetchImpl,
      ))
    )
      return { status: 403, error: 'Doğrulama başarısız; sayfayı yenileyip tekrar deneyin.' };
  }
  const settings = await deps.repo.getSettings();
  // per-IP limit, IP hashed (never stored raw)
  if (
    !(await deps.repo.hitRateLimit(
      `tool:${await sha256Hex(ip ?? 'unknown')}`,
      3600,
      settings.analysis_tool.per_ip_per_hour,
    ))
  )
    return {
      status: 429,
      error: 'Kısa sürede çok fazla istek geldi; bir saat sonra tekrar deneyin.',
    };
  const r = await submitToolRequest(deps.tool, {
    query: parsed.data.query,
    email: parsed.data.email,
  });
  if (!r.ok)
    return r.reason === 'daily_limit'
      ? { status: 429, error: 'Bugünkü analiz kapasitemiz doldu; yarın tekrar deneyin.' }
      : { status: 400, error: 'İşletme adını veya sitesini kontrol edin.' };
  return { redirect: `/analiz/r/${r.token}` };
}

export { toolReportByToken };
