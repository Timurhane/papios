import { formFieldsFor, parseAnswers, type FormField } from '@papi/modules';
import { onSetupFormSubmitted, type OpsDeps } from '@papi/server';
import { verifyTurnstile } from './demo.ts';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const STYLE = `
  *{box-sizing:border-box} body{margin:0;background:#05050a;color:#ededf5;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
  main{max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
  h1{font-size:22px;margin:8px 0 0} p{color:#a3a3bb;margin:0}
  label{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:15px}
  small{font-weight:400;color:#8a8aa3}
  input,textarea,select{font:inherit;color:#ededf5;background:#11111d;border:1px solid #1f1f33;border-radius:12px;padding:10px 12px}
  textarea{min-height:96px}
  fieldset{border:1px solid #1f1f33;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
  fieldset label{flex-direction:row;align-items:center;font-weight:400}
  .err{color:#f43f5e;font-size:13px;font-weight:400}
  button{height:48px;border:0;border-radius:12px;font-weight:600;color:#fff;cursor:pointer;background:linear-gradient(90deg,#8b5cf6,#3b82f6)}
  footer{color:#6b6b85;font-size:13px;text-align:center;margin:12px 0}`;

const shell = (title: string, body: string, head = '') => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style>${head}</head>
<body><main>${body}<footer>AJNA Digital · ajnadigitalagency.com · Bilgileriniz yalnızca kurulum için kullanılır.</footer></main></body></html>`;

export const setupFormMessagePage = (title: string, text: string) =>
  shell(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`);

function fieldHtml(f: FormField, value: unknown, error: string | undefined): string {
  const name = esc(f.key);
  const req = f.required ? ' required' : '';
  const label = `${esc(f.label)}${f.required ? ' *' : ''}${f.help ? `<small>${esc(f.help)}</small>` : ''}`;
  const err = error ? `<span class="err">${esc(error)}</span>` : '';
  const str = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
  switch (f.type) {
    case 'textarea':
    case 'lines':
      return `<label>${label}<textarea name="${name}"${req} maxlength="${f.max ?? 2000}">${esc(str)}</textarea>${err}</label>`;
    case 'choice':
      return `<label>${label}<select name="${name}"${req}><option value="">Seçin</option>${(
        f.options ?? []
      )
        .map(
          (o) =>
            `<option value="${esc(o.value)}"${str === o.value ? ' selected' : ''}>${esc(o.label)}</option>`,
        )
        .join('')}</select>${err}</label>`;
    case 'multi': {
      const vals = Array.isArray(value) ? value : [];
      return `<fieldset><legend>${label}</legend>${(f.options ?? [])
        .map(
          (o) =>
            `<label><input type="checkbox" name="${name}" value="${esc(o.value)}"${vals.includes(o.value) ? ' checked' : ''}> ${esc(o.label)}</label>`,
        )
        .join('')}${err}</fieldset>`;
    }
    default: {
      const type =
        f.type === 'email'
          ? 'email'
          : f.type === 'url'
            ? 'url'
            : f.type === 'phone'
              ? 'tel'
              : 'text';
      return `<label>${label}<input type="${type}" name="${name}" value="${esc(str)}"${req} maxlength="${f.max ?? 300}">${err}</label>`;
    }
  }
}

export function setupFormPage(opts: {
  businessName: string;
  packageCode: string;
  values?: Record<string, unknown>;
  errors?: Record<string, string>;
  turnstileSiteKey: string | null;
}): string {
  const fields = formFieldsFor(opts.packageCode);
  const head = opts.turnstileSiteKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  return shell(
    `${opts.businessName} · Kurulum formu`,
    `<h1>${esc(opts.businessName)} · Kurulum formu</h1>
<p>Asistanınızı işletmenize göre kurabilmemiz için birkaç bilgiye ihtiyacımız var. Yaklaşık 5 dakika sürer.</p>
${opts.errors && Object.keys(opts.errors).length ? '<p class="err">Lütfen işaretli alanları düzeltin.</p>' : ''}
<form method="post">
${fields.map((f) => fieldHtml(f, opts.values?.[f.key], opts.errors?.[f.key])).join('\n')}
${opts.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(opts.turnstileSiteKey)}"></div>` : ''}
<button type="submit">Gönder</button>
</form>`,
    head,
  );
}

/** Form POST body → plain object (checkbox groups become arrays). */
export function formToObject(form: FormData, packageCode: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of formFieldsFor(packageCode)) {
    if (f.type === 'multi')
      out[f.key] = form.getAll(f.key).filter((v): v is string => typeof v === 'string');
    else {
      const v = form.get(f.key);
      if (typeof v === 'string') out[f.key] = v;
    }
  }
  return out;
}

export interface SetupFormDeps {
  ops: OpsDeps;
  turnstileSecret: string | null;
  turnstileSiteKey: string | null;
  requireTurnstile: boolean;
  fetchImpl?: typeof fetch;
}

/** GET /kurulum/:token */
export async function renderSetupForm(
  d: SetupFormDeps,
  token: string,
): Promise<{ status: number; html: string }> {
  const f = await d.ops.repo.setupFormByToken(token);
  if (f.result === 'not_found')
    return {
      status: 404,
      html: setupFormMessagePage('Form bulunamadı', 'Bağlantıyı kontrol edin.'),
    };
  if (f.result === 'expired')
    return {
      status: 410,
      html: setupFormMessagePage(
        'Formun süresi doldu',
        'Yeni bir bağlantı için AJNA Digital’e yazabilirsiniz.',
      ),
    };
  if (f.result === 'submitted')
    return {
      status: 200,
      html: setupFormMessagePage(
        'Form alındı',
        'Bilgileriniz bize ulaştı, teşekkürler. Kurulum için sizinle iletişime geçeceğiz.',
      ),
    };
  return {
    status: 200,
    html: setupFormPage({
      businessName: f.businessName ?? 'İşletmeniz',
      packageCode: f.packageCode ?? 'refleks',
      turnstileSiteKey: d.turnstileSiteKey,
    }),
  };
}

/** POST /kurulum/:token — validated, stored once, then Operatör builds the outputs (K-14.4). */
export async function submitSetupForm(
  d: SetupFormDeps,
  token: string,
  form: FormData,
  ip: string | null,
): Promise<{ status: number; html: string }> {
  const f = await d.ops.repo.setupFormByToken(token);
  if (f.result !== 'ok' || !f.projectId || !f.packageCode) return renderSetupForm(d, token);
  if (d.requireTurnstile) {
    const t = form.get('cf-turnstile-response');
    if (
      !d.turnstileSecret ||
      !(await verifyTurnstile(d.turnstileSecret, typeof t === 'string' ? t : '', ip, d.fetchImpl))
    )
      return {
        status: 403,
        html: setupFormMessagePage('Doğrulama başarısız', 'Sayfayı yenileyip tekrar deneyin.'),
      };
  }
  const raw = formToObject(form, f.packageCode);
  const parsed = parseAnswers(f.packageCode, raw);
  if (!parsed.ok)
    return {
      status: 400,
      html: setupFormPage({
        businessName: f.businessName ?? 'İşletmeniz',
        packageCode: f.packageCode,
        values: raw,
        errors: parsed.errors,
        turnstileSiteKey: d.turnstileSiteKey,
      }),
    };
  if (!(await d.ops.repo.submitSetupForm(token, parsed.answers))) return renderSetupForm(d, token);
  await onSetupFormSubmitted(d.ops, f.projectId);
  return {
    status: 200,
    html: setupFormMessagePage(
      'Teşekkürler',
      'Bilgileriniz bize ulaştı. Kurulum için sizinle iletişime geçeceğiz.',
    ),
  };
}
