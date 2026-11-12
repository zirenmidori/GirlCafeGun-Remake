"""Package a clean resource directory into bounded, independent ZIPs.

This does not upload or sign placeholder URLs. Each pack requires a verified
public HTTPS URL before the manifest can be embedded in a distributable APK.
"""
from pathlib import Path
import argparse,hashlib,json,zipfile
from make_update import resource,digest,json_bytes,APP_ID
LIMIT=180*1024*1024

def pack_rows(rows,read,out,release_id='0.1.0'):
    out.mkdir(parents=True,exist_ok=True);files=[];packs=[];zipout=None;pack_id=None;expanded=0
    def close():
        nonlocal zipout
        if zipout is not None:
            zipout.close();p=out/(pack_id+'.zip')
            if p.stat().st_size>LIMIT:raise ValueError('Pack exceeds Android limit')
            packs.append({'id':pack_id,'url':None,'size':p.stat().st_size,'sha256':digest(p)})
            with zipfile.ZipFile(p) as z:
                for row in [r for r in files if r['pack']==pack_id]:
                    h=hashlib.sha256();size=0
                    with z.open(row['path']) as f:
                        for b in iter(lambda:f.read(1024*1024),b''):h.update(b);size+=len(b)
                    if size!=row['size'] or h.hexdigest()!=row['sha256']:raise ValueError('Pack readback differs')
            print('Verified '+pack_id+' '+str(p.stat().st_size),flush=True);zipout=None
    for name,size in rows:
        resource(name)
        if size>LIMIT-1024*1024:raise ValueError('Single resource exceeds pack bound: '+name)
        # Bound by uncompressed sizes plus headers, allowing even incompressible
        # DEFLATE blocks to fit. Packs are separate ordinary ZIPs, never split ZIPs.
        if zipout is None or expanded+size+65536>LIMIT-1024*1024:
            close();pack_id='data-%03d'%len(packs);expanded=0
            p=out/(pack_id+'.zip')
            if p.exists():raise ValueError('Refuse overwriting pack '+str(p))
            zipout=zipfile.ZipFile(p,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3,allowZip64=True)
        h=hashlib.sha256();count=0
        with read(name) as src,zipout.open(name,'w',force_zip64=True) as dst:
            for b in iter(lambda:src.read(1024*1024),b''):dst.write(b);h.update(b);count+=len(b)
        if count!=size:raise ValueError('Resource changed while packaging '+name)
        files.append({'path':name,'size':size,'sha256':h.hexdigest(),'pack':pack_id});expanded+=size+len(name)*2+128
    close()
    manifest={'schemaVersion':1,'kind':'full','packageName':APP_ID,'releaseId':release_id,'baseReleaseId':None,'minApkVersionCode':10137,'files':files,'remove':[],'packs':packs,'serverPayload':None,'apk':None}
    (out/'manifest-unhosted.json').write_bytes(json_bytes(manifest));return manifest

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--resources',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--release-id',default='0.1.0');a=p.parse_args()
    rows=[]
    for f in sorted(a.resources.rglob('*')):
        if f.is_symlink():raise ValueError('Symlink input forbidden')
        if f.is_file():rows.append((resource(f.relative_to(a.resources).as_posix()),f.stat().st_size))
    manifest=pack_rows(rows,lambda n:(a.resources/n).open('rb'),a.output,a.release_id)
    print(json.dumps({'files':len(rows),'packs':len(manifest['packs']),'expandedBytes':sum(r[1] for r in rows)}))

if __name__=='__main__':main()
