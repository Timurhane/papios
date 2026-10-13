const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Unguessable, signed token for public links (unsubscribe, demo): `<id>.<signature>` (K-17.4). */
export async function signToken(secret: string, purpose: string, id: string): Promise<string> {
  if (secret.length < 32) throw new Error('token secret must be at least 32 characters');
  return `${id}.${(await hmac(secret, `${purpose}:${id}`)).slice(0, 32)}`;
}

/** Returns the id when the signature is valid, otherwise null (constant-time compare). */
export async function verifyToken(
  secret: string,
  purpose: string,
  token: string,
): Promise<string | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const expected = (await signToken(secret, purpose, id)).slice(dot + 1);
  const got = token.slice(dot + 1);
  if (expected.length !== got.length) return null;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0 ? id : null;
}
