// HMAC signatures for the download links that go into the intake notification email.
// The secret lives in the Pages project as DOWNLOAD_SECRET; without it no links are made.

export const LINK_DAYS = 30;

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sign(secret, key, exp) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${key}\n${exp}`)));
}

export async function downloadUrl(origin, secret, key) {
  const exp = Math.floor(Date.now() / 1000) + LINK_DAYS * 86400;
  const sig = await sign(secret, key, exp);
  return `${origin}/api/file?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
}
