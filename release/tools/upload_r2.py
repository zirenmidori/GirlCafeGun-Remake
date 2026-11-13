"""Upload the already-verified data packs with the authorized official CLI.

Receipts contain public object identities only. This never reads auth tokens.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess,time,concurrent.futures
from make_update import digest
R=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--limit',type=int);p.add_argument('--jobs',type=int,default=3);a=p.parse_args()
    manifest=json.loads((R/'artifacts/data/manifest-unhosted.json').read_text(encoding='utf8'))
    receipt=R/'reports/r2-data-uploads.json';done=json.loads(receipt.read_text(encoding='utf8')) if receipt.exists() else {}
    def upload(row):
        name=row['id']+'.zip';key=manifest['releaseId']+'/'+name;local=R/'artifacts/data'/name
        if digest(local)!=row['sha256'] or local.stat().st_size!=row['size']:raise ValueError('Pack changed before upload')
        for attempt in range(3):
            args=['pwsh','-NoProfile','-File',str(R/'tools/cloudflare.ps1'),'r2','object','put','gcg-offline-releases/'+key,'--file',str(local),'--content-type','application/zip','--cache-control','public,max-age=31536000,immutable','--remote']
            result=subprocess.run(args,capture_output=True,text=True,encoding='utf8',errors='replace')
            if result.returncode==0:break
            print('Upload retry '+key+': '+result.stdout[-500:]+result.stderr[-500:],flush=True)
        else:raise RuntimeError('Upload failed: '+key)
        return key,{'sha256':row['sha256'],'size':row['size'],'uploaded':True}
    pending=[row for row in manifest['packs'] if done.get(manifest['releaseId']+'/'+row['id']+'.zip',{}).get('sha256')!=row['sha256']]
    if a.limit:pending=pending[:a.limit]
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(a.jobs,3))) as executor:
        for future in concurrent.futures.as_completed([executor.submit(upload,row) for row in pending]):
            key,result=future.result();done[key]=result;receipt.write_text(json.dumps(done,indent=2)+'\n',encoding='utf8')
            print('Uploaded '+key+' ('+str(len(done))+'/'+str(len(manifest['packs']))+')',flush=True)
if __name__=='__main__':main()
