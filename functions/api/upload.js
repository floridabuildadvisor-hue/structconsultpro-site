// Plan uploads for the intake forms: the browser sends each file in parts to this Pages Function,
// which writes it to the private R2 bucket bound as PLANS. Nothing here is public; files are
// downloaded from the Cloudflare dashboard and then handled under the intake SOP.
//   GET  ?action=status                      -> {ready}
//   POST ?action=create   {submission,name,size} -> {key, uploadId}
//   PUT  ?action=part&key&uploadId&part       (raw bytes) -> {partNumber, etag}
//   POST ?action=complete {key,uploadId,parts}   -> {key, size, url?}
//   POST ?action=abort    {key,uploadId}         -> {}
// url is a signed download link for the notification email (only when DOWNLOAD_SECRET is set).
import { downloadUrl } from './_sign.js';

const MAX_FILE = 1024 * 1024 * 1024; // 1 GB per file
const MAX_PART = 25 * 1024 * 1024;   // the browser sends 10 MB parts
const MAX_PARTS = Math.ceil(MAX_FILE / (5 * 1024 * 1024));
const ALLOWED = new Set([
  'pdf', 'zip', '7z', 'rar',
  'dwg', 'dxf', 'dwf', 'dwfx', 'rvt', 'rfa', 'ifc', 'skp', 'nwd', 'nwc',
  'png', 'jpg', 'jpeg', 'tif', 'tiff', 'heic', 'webp', 'gif', 'bmp',
  'xlsx', 'xls', 'csv', 'docx', 'doc', 'txt', 'rtf',
]);
const SUBMISSION = /^[a-z0-9]{16,40}$/;
const KEY = /^incoming\/\d{4}-\d{2}-\d{2}\/[a-z0-9]{16,40}\/[^/]{1,140}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function safeName(name) {
  const cleaned = String(name).normalize('NFKD').replace(/[^\w.\- ()]+/g, '_').replace(/^[.\s]+/, '').trim();
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 ? cleaned.slice(dot) : '';
  const base = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  return (base.slice(0, 120 - ext.length) + ext) || 'file';
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const bucket = env.PLANS;

  if (action === 'status') return json({ ready: Boolean(bucket) });
  if (!bucket) return json({ error: 'Uploads are not available right now.' }, 503);

  try {
    if (action === 'create' && request.method === 'POST') {
      const { submission, name, size } = await request.json();
      const ext = String(name || '').split('.').pop().toLowerCase();
      if (!SUBMISSION.test(String(submission))) return json({ error: 'Invalid submission.' }, 400);
      if (!ALLOWED.has(ext)) return json({ error: `.${ext} files are not accepted.` }, 400);
      if (!(size > 0 && size <= MAX_FILE)) return json({ error: 'Each file must be 1 GB or smaller.' }, 400);
      const day = new Date().toISOString().slice(0, 10);
      const key = `incoming/${day}/${submission}/${safeName(name)}`;
      const upload = await bucket.createMultipartUpload(key, {
        customMetadata: { originalName: String(name).slice(0, 200), declaredSize: String(size) },
      });
      return json({ key, uploadId: upload.uploadId });
    }

    const key = url.searchParams.get('key') || '';
    if (action === 'part' && request.method === 'PUT') {
      const part = Number(url.searchParams.get('part'));
      if (!KEY.test(key) || !Number.isInteger(part) || part < 1 || part > MAX_PARTS) return json({ error: 'Invalid part.' }, 400);
      const body = await request.arrayBuffer();
      if (body.byteLength === 0 || body.byteLength > MAX_PART) return json({ error: 'Invalid part size.' }, 400);
      const upload = bucket.resumeMultipartUpload(key, url.searchParams.get('uploadId') || '');
      const uploaded = await upload.uploadPart(part, body);
      return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
    }

    if ((action === 'complete' || action === 'abort') && request.method === 'POST') {
      const body = await request.json();
      if (!KEY.test(String(body.key))) return json({ error: 'Invalid file.' }, 400);
      const upload = bucket.resumeMultipartUpload(body.key, String(body.uploadId || ''));
      if (action === 'abort') {
        await upload.abort();
        return json({});
      }
      const object = await upload.complete(body.parts || []);
      if (object.size > MAX_FILE) {
        await bucket.delete(body.key);
        return json({ error: 'Each file must be 1 GB or smaller.' }, 400);
      }
      const link = env.DOWNLOAD_SECRET ? await downloadUrl(url.origin, env.DOWNLOAD_SECRET, body.key) : undefined;
      return json({ key: body.key, size: object.size, url: link });
    }
  } catch (err) {
    return json({ error: 'Upload failed. Please try again.' }, 500);
  }
  return json({ error: 'Not found.' }, 404);
}
