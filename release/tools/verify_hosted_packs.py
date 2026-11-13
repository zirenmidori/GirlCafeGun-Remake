"""Verify actual HTTPS pack bytes and ranged reads after their uploads finish."""
from pathlib import Path
import hashlib,json,time,requests,concurrent.futures
R=Path(__file__).resolve().parents[1]
def verify(row):
    url=row['url'];size=row['size'];h=hashlib.sha256();count=0
    with requests.get(url,headers={'Accept-Encoding':'identity'},stream=True,timeout=(20,60)) as response:
        response.raise_for_status()
        if response.status_code!=200:raise ValueError('Unexpected full response')
        for b in response.iter_content(1024*1024):h.update(b);count+=len(b)
    if count!=size or h.hexdigest()!=row['sha256']:raise ValueError('Hosted pack differs: '+row['id'])
    local=R/'artifacts/data'/(row['id']+'.zip');offset=size//2
    with local.open('rb') as stream:stream.seek(offset);expected=stream.read(64)
    response=requests.get(url,headers={'Range':f'bytes={offset}-{offset+63}','Accept-Encoding':'identity'},timeout=(20,30))
    if response.status_code!=206 or response.content!=expected or response.headers.get('Content-Range')!=f'bytes {offset}-{offset+63}/{size}':raise ValueError('Hosted resume differs')
    return row['id'],{'url':url,'size':count,'sha256':h.hexdigest(),'fullBytesExact':True,'rangeExact':True}
def main():
    m=json.loads((R/'android/assets/gcg-release/manifest.json').read_text(encoding='utf8'))
    report=R/'reports/r2-data-verification.json';done=json.loads(report.read_text(encoding='utf8')) if report.exists() else {}
    while len(done)<len(m['packs']):
        receipt=R/'reports/r2-data-uploads.json';uploaded=json.loads(receipt.read_text(encoding='utf8')) if receipt.exists() else {}
        ready=[p for p in m['packs'] if p['id'] not in done and m['releaseId']+'/'+p['id']+'.zip' in uploaded]
        if not ready:time.sleep(5);continue
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for future in concurrent.futures.as_completed([pool.submit(verify,p) for p in ready]):
                key,result=future.result();done[key]=result;report.write_text(json.dumps(done,indent=2)+'\n',encoding='utf8');print('Verified public bytes and resume '+key+f' ({len(done)}/{len(m["packs"])})',flush=True)
if __name__=='__main__':main()
