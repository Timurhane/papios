import { verifyToken } from '@papi/core';
import { handleUnsubscribe, type Repo } from '@papi/server';

const PAGE = (title: string, body: string) => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · AJNA Digital</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#05050a;color:#ededf5;
    font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
  main{max-width:420px;width:100%;background:#0c0c16;border:1px solid #1f1f33;border-radius:16px;padding:28px}
  h1{font-size:20px;margin:0 0 8px} p{color:#a3a3bb;margin:0 0 20px}
  button{width:100%;height:44px;border:0;border-radius:12px;font-weight:600;color:#fff;cursor:pointer;
    background:linear-gradient(90deg,#8b5cf6,#3b82f6)}
  small{display:block;margin-top:16px;color:#6b6b85}
</style></head><body><main>${body}<small>AJNA Digital · ajnadigitalagency.com</small></main></body></html>`;

export function unsubscribeConfirmPage(): string {
  return PAGE(
    'E-posta listesinden çık',
    `<h1>Bir daha e-posta almak istemiyor musunuz?</h1><p>Onaylarsanız size ve işletmenize AJNA Digital'den hiçbir kanaldan mesaj gönderilmez.</p>
<form method="post"><button type="submit">Evet, listeden çıkar</button></form>`,
  );
}

export function unsubscribeDonePage(): string {
  return PAGE(
    'Listeden çıkarıldınız',
    '<h1>Listeden çıkarıldınız</h1><p>Size bir daha mesaj göndermeyeceğiz. Rahatsızlık için özür dileriz.</p>',
  );
}

export function unsubscribeInvalidPage(): string {
  return PAGE(
    'Geçersiz bağlantı',
    '<h1>Bağlantı geçersiz</h1><p>Bu bağlantı geçersiz görünüyor. Yanıt olarak "yazmayın" yazmanız da yeterlidir.</p>',
  );
}

/** K-10.13: GET shows a confirmation (link scanners must not unsubscribe people); POST (form or RFC 8058) applies it. */
export async function applyUnsubscribe(
  repo: Repo,
  secret: string,
  token: string,
): Promise<boolean> {
  const touchId = await verifyToken(secret, 'unsubscribe', token);
  if (!touchId) return false;
  const result = await handleUnsubscribe({ repo }, touchId);
  if (result)
    await repo.audit(
      'outreach.unsubscribed',
      { touch_id: touchId },
      { type: 'system', id: 'unsubscribe-link' },
    );
  return Boolean(result);
}
