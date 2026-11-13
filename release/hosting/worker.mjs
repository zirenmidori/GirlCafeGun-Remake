// Read-only R2 delivery. Large APKs stream from private immutable parts while
// retaining one ordinary public APK URL; no writes or credentials are exposed.
import apkIndex from './apk-index.json' with { type: 'json' };

const PUBLIC_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\/(?:data-\d{3}\.zip|GCG-Offline-[a-zA-Z0-9._-]+\.apk|[a-zA-Z0-9._-]+\.gcgupdate|manifest\.json|manifest\.sig|checksums\.txt|publickey\.der|index\.html)$/;
const APK_KEY = /^([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})\/GCG-Offline-[a-zA-Z0-9._-]+\.apk$/;
const DIGEST = /^[0-9a-f]{64}$/;

function validateIndex(index) {
  if (index.schemaVersion !== 1 || !index.apks || typeof index.apks !== 'object') throw new Error('Invalid APK index');
  for (const [key, apk] of Object.entries(index.apks)) {
    const match = APK_KEY.exec(key);
    if (!match || !Number.isSafeInteger(apk.size) || apk.size <= 0 || !DIGEST.test(apk.sha256) || !Array.isArray(apk.parts) || !apk.parts.length || apk.parts.length > 32) throw new Error('Invalid APK metadata');
    let total = 0;
    for (const [i, part] of apk.parts.entries()) {
      if (part.key !== `_apk/${match[1]}/${apk.sha256}/part-${String(i).padStart(3, '0')}.bin` || !Number.isSafeInteger(part.size) || part.size <= 0 || part.size > 250 * 1048576 || !DIGEST.test(part.sha256)) throw new Error('Invalid private APK part');
      total += part.size;
    }
    if (total !== apk.size) throw new Error('APK part sizes differ');
  }
}

function selection(request, size, etag) {
  let offset = 0, length = size, status = 200;
  const range = request.headers.get('Range'), ifRange = request.headers.get('If-Range');
  if (range && (!ifRange || ifRange === etag)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2])) return null;
    if (!m[1]) { length = Math.min(Number(m[2]), size); offset = size - length; }
    else { offset = Number(m[1]); const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; length = end - offset + 1; }
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || offset >= size || length <= 0) return null;
    status = 206;
  }
  return { offset, length, status };
}

function fixedStream(length) {
  // Workers requires FixedLengthStream to preserve composed Content-Length.
  // Node host tests use the equivalent bounded transform below.
  if (typeof globalThis.FixedLengthStream === 'function') return new globalThis.FixedLengthStream(length);
  let remaining = length;
  return new TransformStream({
    transform(chunk, controller) {
      remaining -= chunk.byteLength;
      if (remaining < 0) throw new Error('APK stream exceeds declared length');
      controller.enqueue(chunk);
    },
    flush() { if (remaining !== 0) throw new Error('APK stream is incomplete'); },
  });
}

async function partBody(bucket, segment) {
  const file = await bucket.get(segment.part.key, { range: { offset: segment.offset, length: segment.length } });
  if (!file || file.size !== segment.part.size || file.httpEtag !== segment.meta.httpEtag || !file.body) throw new Error('APK part changed or is unavailable');
  return file.body;
}

async function composedApk(request, bucket, apk, headers, chosen, context) {
  const metadata = await Promise.all(apk.parts.map(part => bucket.head(part.key)));
  if (metadata.some((meta, i) => !meta || meta.size !== apk.parts[i].size || !meta.httpEtag)) return new Response('APK parts are unavailable; retry', { status: 503 });
  if (request.method === 'HEAD') return new Response(null, { status: chosen.status, headers });
  const segments = [];
  let start = 0;
  for (const [i, part] of apk.parts.entries()) {
    const low = Math.max(chosen.offset, start), high = Math.min(chosen.offset + chosen.length, start + part.size);
    if (high > low) segments.push({ part, meta: metadata[i], offset: low - start, length: high - low });
    start += part.size;
  }
  let first;
  try { first = await partBody(bucket, segments[0]); }
  catch { return new Response('APK parts are unavailable; retry', { status: 503 }); }
  const stream = fixedStream(chosen.length);
  const pumping = (async () => {
    try {
      for (let i = 0; i < segments.length; i++) {
        const body = i === 0 ? first : await partBody(bucket, segments[i]);
        await body.pipeTo(stream.writable, { preventClose: true });
      }
      await stream.writable.close();
    } catch (error) {
      // A failure after headers terminates the response instead of completing
      // truncated APK bytes. Clients can resume the same public URL.
      await stream.writable.abort(error).catch(() => {});
    }
  })();
  if (context) context.waitUntil(pumping);
  return new Response(stream.readable, { status: chosen.status, headers });
}

export function createWorker(index = apkIndex) {
  validateIndex(index);
  return {
    async fetch(request, env, context) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const key = new URL(request.url).pathname.slice(1);
      if (!PUBLIC_KEY.test(key)) return new Response('Not found', { status: 404 });
      try {
        const apk = index.apks[key];
        const meta = apk ? { size: apk.size, httpEtag: `"sha256-${apk.sha256}"` } : await env.RELEASES.head(key);
        if (!meta) return new Response('Not found', { status: 404 });
        const headers = new Headers({ 'Accept-Ranges': 'bytes', ETag: meta.httpEtag, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Type': key.endsWith('.html') ? 'text/html; charset=utf-8' : key.endsWith('.apk') ? 'application/vnd.android.package-archive' : key.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
        if (key.endsWith('.html')) {
          headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
          headers.set('Referrer-Policy', 'no-referrer');
        }
        if (request.headers.get('If-None-Match') === meta.httpEtag) return new Response(null, { status: 304, headers });
        const chosen = selection(request, meta.size, meta.httpEtag);
        if (!chosen) return new Response('Unsatisfiable range', { status: 416, headers: { 'Content-Range': `bytes */${meta.size}` } });
        if (chosen.status === 206) headers.set('Content-Range', `bytes ${chosen.offset}-${chosen.offset + chosen.length - 1}/${meta.size}`);
        headers.set('Content-Length', String(chosen.length));
        if (apk) return await composedApk(request, env.RELEASES, apk, headers, chosen, context);
        if (request.method === 'HEAD') return new Response(null, { status: chosen.status, headers });
        const file = await env.RELEASES.get(key, chosen.status === 206 ? { range: { offset: chosen.offset, length: chosen.length } } : undefined);
        if (!file || file.httpEtag !== meta.httpEtag) return new Response('Release file changed; retry', { status: 503 });
        return new Response(file.body, { status: chosen.status, headers });
      } catch {
        return new Response('Release storage is temporarily unavailable', { status: 503 });
      }
    },
  };
}

export default createWorker();
