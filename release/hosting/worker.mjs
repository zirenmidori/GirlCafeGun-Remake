// Public, read-only delivery of release files from a private R2 bucket.
// No credentials, writes, account state, cookies or origin proxying are exposed.
export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405,headers:{Allow:'GET, HEAD'}});
    const url = new URL(request.url);
    const key = url.pathname.slice(1);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\/(?:data-\d{3}\.zip|GCG-Offline-[a-zA-Z0-9._-]+\.apk|[a-zA-Z0-9._-]+\.gcgupdate|manifest\.json|manifest\.sig|checksums\.txt|publickey\.der)$/.test(key)) return new Response('Not found', {status:404});
    const meta = await env.RELEASES.head(key);
    if (!meta) return new Response('Not found', {status:404});
    const headers = new Headers({'Accept-Ranges':'bytes','ETag':meta.httpEtag,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Type':key.endsWith('.apk')?'application/vnd.android.package-archive':key.endsWith('.json')?'application/json':'application/octet-stream'});
    if (request.headers.get('If-None-Match') === meta.httpEtag) return new Response(null,{status:304,headers});
    let offset=0,length=meta.size,status=200;
    const range=request.headers.get('Range');
    const ifRange=request.headers.get('If-Range');
    if (range && (!ifRange || ifRange===meta.httpEtag)) {
      const m=/^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1]&&!m[2])) return new Response('Invalid range',{status:416,headers:{'Content-Range':`bytes */${meta.size}`}});
      if (!m[1]) {length=Math.min(Number(m[2]),meta.size);offset=meta.size-length;}
      else {offset=Number(m[1]);const end=m[2]?Math.min(Number(m[2]),meta.size-1):meta.size-1;length=end-offset+1;}
      if (!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||offset>=meta.size||length<=0) return new Response('Unsatisfiable range',{status:416,headers:{'Content-Range':`bytes */${meta.size}`}});
      status=206;headers.set('Content-Range',`bytes ${offset}-${offset+length-1}/${meta.size}`);
    }
    headers.set('Content-Length',String(length));
    if (request.method==='HEAD') return new Response(null,{status,headers});
    const file=await env.RELEASES.get(key,status===206?{range:{offset,length}}:undefined);
    if (!file || file.httpEtag!==meta.httpEtag) return new Response('Release file changed; retry',{status:503});
    return new Response(file.body,{status,headers});
  }
};
