import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker, { createWorker } from '../hosting/worker.mjs';
const data=new TextEncoder().encode('0123456789abcdef');
const meta={size:data.length,httpEtag:'"known"'};
const env={RELEASES:{head:async key=>key==='0.1.0/data-000.zip'?meta:null,get:async(key,opts)=>({...meta,body:opts?.range?data.slice(opts.range.offset,opts.range.offset+opts.range.length):data})}};
const request=(headers={},method='GET',path='0.1.0/data-000.zip')=>new Request('https://release.example/'+path,{method,headers});
test('full bytes and HEAD metadata',async()=>{
 const r=await worker.fetch(request(),env);assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),data);assert.equal(r.headers.get('Content-Length'),'16');
 const h=await worker.fetch(request({},'HEAD'),env);assert.equal(h.status,200);assert.equal((await h.arrayBuffer()).byteLength,0);assert.equal(h.headers.get('Accept-Ranges'),'bytes');
});
test('resume and suffix ranges are exact',async()=>{
 for(const [range,expected,cr] of [['bytes=4-',data.slice(4),'bytes 4-15/16'],['bytes=4-7',data.slice(4,8),'bytes 4-7/16'],['bytes=-4',data.slice(12),'bytes 12-15/16']]){
  const r=await worker.fetch(request({Range:range}),env);assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),cr);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),expected);
 }
});
test('malformed ranges and writes rejected',async()=>{
 for(const range of ['bytes=0-1,3-4','bytes=99-','bytes=-0','bytes=9-2','units=2-5'])assert.equal((await worker.fetch(request({Range:range}),env)).status,416);
 assert.equal((await worker.fetch(request({},'POST'),env)).status,405);
});
test('private paths missing objects and conditional requests',async()=>{
 assert.equal((await worker.fetch(request({},'GET','private/state.json'),env)).status,404);
 assert.equal((await worker.fetch(request({},'GET','0.1.0/data-999.zip'),env)).status,404);
 assert.equal((await worker.fetch(request({'If-None-Match':'"known"'}),env)).status,304);
 const stale=await worker.fetch(request({Range:'bytes=4-','If-Range':'"old"'}),env);assert.equal(stale.status,200);assert.deepEqual(new Uint8Array(await stale.arrayBuffer()),data);
});
test('static release page is readable HTML with restrictive policy and no private routes',async()=>{
 const html=new TextEncoder().encode('<!doctype html><html lang="en"><title>Girl Cafe Gun</title><a href="GCG-Offline-v0.1.0.apk">Download APK</a></html>');
 const reads=[];const htmlMeta={size:html.length,httpEtag:'"page"'};
 const e={RELEASES:{head:async key=>{reads.push(key);return key==='0.1.0/index.html'?htmlMeta:null;},get:async()=>({...htmlMeta,body:html})}};
 const r=await worker.fetch(request({},'GET','0.1.0/index.html'),e);assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'text/html; charset=utf-8');assert.equal(await r.text(),new TextDecoder().decode(html));assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.equal(r.headers.get('Content-Security-Policy'),"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
 const h=await worker.fetch(request({},'HEAD','0.1.0/index.html'),e);assert.equal(h.status,200);assert.equal(h.headers.get('Content-Length'),String(html.length));assert.equal((await h.arrayBuffer()).byteLength,0);
 const before=reads.length;for(const path of ['0.1.0/private/release.p12','0.1.0/.env','0.1.0/data/state.json','release/private/signing/release.p12'])assert.equal((await worker.fetch(request({},'GET',path),e)).status,404);assert.equal(reads.length,before);
});

const apkPath='0.1.0/GCG-Offline-v0.1.0.apk';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function apkFixture({missing=-1,wrongSize=-1,getMissing=-1,getChanged=-1,truncate=-1,storageError=false}={}){
 const parts=[data.slice(0,8),data.slice(8)];
 const hash=sha(data);
 const spec={size:data.length,sha256:hash,parts:parts.map((bytes,i)=>({key:`_apk/0.1.0/${hash}/part-${String(i).padStart(3,'0')}.bin`,size:bytes.length,sha256:sha(bytes)}))};
 const gets=[],heads=[];
 const locate=key=>spec.parts.findIndex(p=>p.key===key);
 const environment={RELEASES:{
  async head(key){heads.push(key);if(storageError)throw new Error('R2 unavailable');const i=locate(key);return i<0||i===missing?null:{size:parts[i].length+(i===wrongSize?1:0),httpEtag:`"part-${i}"`};},
  async get(key,opts){const i=locate(key);gets.push({key,range:opts?.range});if(i<0||i===getMissing)return null;const range=opts.range;let bytes=parts[i].slice(range.offset,range.offset+range.length);if(i===truncate)bytes=bytes.slice(0,-1);return {size:parts[i].length,httpEtag:i===getChanged?'"changed"':`"part-${i}"`,body:new Response(bytes).body};},
 }};
 return {app:createWorker({schemaVersion:1,apks:{[apkPath]:spec}}),env:environment,spec,gets,heads,etag:`"sha256-${hash}"`};
}
test('composed APK streams exact full bytes with stable metadata and no public chunk URLs',async()=>{
 const f=apkFixture();const r=await f.app.fetch(request({},'GET',apkPath),f.env);
 assert.equal(r.status,200);assert.equal(r.headers.get('Content-Length'),'16');assert.equal(r.headers.get('ETag'),f.etag);assert.equal(r.headers.get('Content-Type'),'application/vnd.android.package-archive');
 assert.deepEqual(new Uint8Array(await r.arrayBuffer()),data);assert.deepEqual(f.gets.map(v=>v.range),[{offset:0,length:8},{offset:0,length:8}]);
 const before=f.heads.length;
 for(const path of [f.spec.parts[0].key,'0.1.0/part-000.bin','apk-index.json','0.1.0/apk-index.json'])assert.equal((await f.app.fetch(request({},'GET',path),f.env)).status,404);
 assert.equal(f.heads.length,before,'private paths never reach R2');
});
test('composed APK ranges across the boundary and suffix/open resumes read only needed bytes',async()=>{
 for(const [range,expected,contentRange,expectedReads] of [
  ['bytes=6-11',data.slice(6,12),'bytes 6-11/16',[{offset:6,length:2},{offset:0,length:4}]],
  ['bytes=10-',data.slice(10),'bytes 10-15/16',[{offset:2,length:6}]],
  ['bytes=-5',data.slice(11),'bytes 11-15/16',[{offset:3,length:5}]],
  ['bytes=-12',data.slice(4),'bytes 4-15/16',[{offset:4,length:4},{offset:0,length:8}]],
  ['bytes=0-99',data,'bytes 0-15/16',[{offset:0,length:8},{offset:0,length:8}]],
 ]){
  const f=apkFixture();const r=await f.app.fetch(request({Range:range},'GET',apkPath),f.env);assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),contentRange);assert.equal(r.headers.get('Content-Length'),String(expected.length));assert.deepEqual(new Uint8Array(await r.arrayBuffer()),expected);assert.deepEqual(f.gets.map(v=>v.range),expectedReads);
 }
});
test('composed APK HEAD and conditionals never open chunk bodies',async()=>{
 const f=apkFixture();const head=await f.app.fetch(request({},'HEAD',apkPath),f.env);assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'16');assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(f.gets.length,0);
 const ranged=await f.app.fetch(request({Range:'bytes=6-11'},'HEAD',apkPath),f.env);assert.equal(ranged.status,206);assert.equal(ranged.headers.get('Content-Range'),'bytes 6-11/16');assert.equal(f.gets.length,0);
 assert.equal((await f.app.fetch(request({'If-None-Match':f.etag},'GET',apkPath),f.env)).status,304);assert.equal(f.gets.length,0);
 const stale=await f.app.fetch(request({Range:'bytes=6-11','If-Range':'"old"'},'GET',apkPath),f.env);assert.equal(stale.status,200);assert.deepEqual(new Uint8Array(await stale.arrayBuffer()),data);
});
test('composed APK rejects unavailable/changed chunks and storage errors before successful headers',async()=>{
 for(const options of [{missing:1},{wrongSize:0},{getMissing:0},{getChanged:0},{storageError:true}]){
  const f=apkFixture(options);const r=await f.app.fetch(request({},'GET',apkPath),f.env);assert.equal(r.status,503);
 }
 const f=apkFixture({missing:1});assert.equal((await f.app.fetch(request({},'HEAD',apkPath),f.env)).status,503);assert.equal(f.gets.length,0);
});
test('composed APK terminates incomplete streams instead of completing truncated APKs',async()=>{
 for(const options of [{getMissing:1},{getChanged:1},{truncate:0},{truncate:1}]){
  const f=apkFixture(options);const r=await f.app.fetch(request({},'GET',apkPath),f.env);assert.equal(r.status,200);await assert.rejects(r.arrayBuffer());
 }
});
test('composed APK rejects malformed ranges and invalid deployment metadata',async()=>{
 const f=apkFixture();for(const range of ['bytes=0-1,3-4','bytes=99-','bytes=-0','bytes=9-2','units=2-5'])assert.equal((await f.app.fetch(request({Range:range},'GET',apkPath),f.env)).status,416);assert.equal(f.gets.length,0);
 for(const mutate of [s=>s.size++,s=>s.parts[0].key='private/state.json',s=>s.parts[0].size=0,s=>s.parts[0].sha256='bad']){const spec=structuredClone(f.spec);mutate(spec);assert.throws(()=>createWorker({schemaVersion:1,apks:{[apkPath]:spec}}));}
});
