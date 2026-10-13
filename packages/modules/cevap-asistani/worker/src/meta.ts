/** Instagram DM (and, when enabled, WhatsApp) through the client's own Meta app. */

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** X-Hub-Signature-256 check: Meta signs every webhook body with the app secret. */
export async function verifyMetaSignature(
  appSecret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith('sha256=')) return false;
  const expected = await hmacHex(appSecret, body);
  const got = header.slice(7);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export interface IncomingDm {
  channel: 'instagram' | 'whatsapp';
  senderId: string;
  text: string;
}

/** Text messages from an Instagram (object=instagram) or WhatsApp (object=whatsapp_business_account) webhook. */
export function parseMetaWebhook(payload: unknown): IncomingDm[] {
  const p = payload as {
    object?: string;
    entry?: {
      messaging?: { sender?: { id?: string }; message?: { text?: string; is_echo?: boolean } }[];
      changes?: {
        value?: { messages?: { from?: string; type?: string; text?: { body?: string } }[] };
      }[];
    }[];
  };
  const out: IncomingDm[] = [];
  for (const e of p.entry ?? []) {
    if (p.object === 'instagram')
      for (const m of e.messaging ?? [])
        if (m.sender?.id && m.message?.text && !m.message.is_echo)
          out.push({ channel: 'instagram', senderId: m.sender.id, text: m.message.text });
    if (p.object === 'whatsapp_business_account')
      for (const c of e.changes ?? [])
        for (const m of c.value?.messages ?? [])
          if (m.from && m.type === 'text' && m.text?.body)
            out.push({ channel: 'whatsapp', senderId: m.from, text: m.text.body });
  }
  return out;
}

export async function sendInstagram(
  pageToken: string,
  recipientId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
) {
  const res = await fetchImpl('https://graph.facebook.com/v21.0/me/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${pageToken}` },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  if (!res.ok) throw new Error(`instagram send ${res.status}`);
}

/** WhatsApp Business Cloud API: paid per conversation by the client; off unless explicitly enabled (K-14.5). */
export async function sendWhatsapp(
  token: string,
  phoneNumberId: string,
  to: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
) {
  const res = await fetchImpl(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    },
  );
  if (!res.ok) throw new Error(`whatsapp send ${res.status}`);
}
