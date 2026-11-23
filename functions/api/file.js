// Download for a file uploaded through the intake form. Only links signed by upload.js work,
// and only until they expire (see _sign.js).
import { sign } from './_sign.js';

const KEY = /^incoming\/\d{4}-\d{2}-\d{2}\/[a-z0-9]{16,40}\/[^/]{1,140}$/;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') || '';
  if (!env.PLANS || !env.DOWNLOAD_SECRET || !KEY.test(key) || !(exp > Date.now() / 1000)) {
    return new Response('This link is invalid or has expired.', { status: 403 });
  }
  if (sig !== await sign(env.DOWNLOAD_SECRET, key, exp)) {
    return new Response('This link is invalid or has expired.', { status: 403 });
  }
  const object = await env.PLANS.get(key);
  if (!object) return new Response('This file is no longer stored.', { status: 404 });
  const name = key.split('/').pop();
  return new Response(object.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(object.size),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
