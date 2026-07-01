/** AES-GCM helpers for CEK wrap/unwrap (Deno Web Crypto). */

const IV_LEN = 12;
const CEK_LEN = 32;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function deriveMasterKey(masterKeyMaterial: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(masterKeyMaterial);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export function randomCek(): Uint8Array {
  const buf = new Uint8Array(CEK_LEN);
  crypto.getRandomValues(buf);
  return buf;
}

export async function wrapCek(cek: Uint8Array, masterKeyMaterial: string): Promise<string> {
  const key = await deriveMasterKey(masterKeyMaterial);
  const iv = new Uint8Array(IV_LEN);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, cek);
  const payload = JSON.stringify({
    v: 1,
    alg: 'AES-GCM',
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ct)),
  });
  return payload;
}

export async function unwrapCek(wrapJson: string, masterKeyMaterial: string): Promise<Uint8Array> {
  const env = JSON.parse(wrapJson) as { iv: string; ct: string };
  const key = await deriveMasterKey(masterKeyMaterial);
  const iv = b64ToBytes(env.iv);
  const ct = b64ToBytes(env.ct);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(plain);
}

export function cekToB64(cek: Uint8Array): string {
  return bytesToB64(cek);
}

export function cekFromB64(b64: string): Uint8Array {
  return b64ToBytes(b64);
}
