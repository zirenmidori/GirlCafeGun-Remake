import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../hosting/worker.mjs';
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
