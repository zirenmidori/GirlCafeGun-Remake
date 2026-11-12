"""Create signed, changed-resource and exact-APK delta updates.

Run --help for the data-only community workflow. Game assets are local inputs.
APK deltas reuse unchanged compressed ZIP members; no native patch engine is needed.
"""
from __future__ import annotations
import argparse, hashlib, json, mmap, re, shutil, struct, tempfile, zipfile
from pathlib import Path
import release_crypto as crypto

APP_ID = 'com.zirenmidori.gcg.offline'
MAX_EXACT = 2**53-1

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def resource(name):
    if not name or not name.isascii() or any(c in name for c in '\\:') or any(ord(c)<32 for c in name):raise ValueError('Unsafe resource path: '+name)
    if any(p in ('','.','..') for p in name.split('/')):raise ValueError('Unsafe path components: '+name)
    low=name.lower()
    if low.startswith(('.', 'gcg-server/', 'unity/', 'rendertextures/', 'updates/')) or '/.' in low or 'state.json' in low:raise ValueError('Protected resource: '+name)
    if name in ('version.data','Raw/pv_sound.txt') or name.endswith('.u') or name.startswith('Raw/') and name.endswith('.mp4') or name.startswith('AutoAudio/Android/') and name.endswith(('.bnk','.wem')):return name
    raise ValueError('Unsupported resource namespace: '+name)

def json_bytes(value):return (json.dumps(value,separators=(',',':'),ensure_ascii=True)+'\n').encode('utf8')

def member_spans(path):
    """Compressed payload spans only, excluding descriptors and signing blocks."""
    result={}
    with zipfile.ZipFile(path) as z,Path(path).open('rb') as f:
        seen=set()
        for row in z.infolist():
            if row.filename in seen:raise ValueError('Duplicate APK entry: '+row.filename)
            seen.add(row.filename)
            f.seek(row.header_offset);header=f.read(30)
            if len(header)!=30 or header[:4]!=b'PK\x03\x04':raise ValueError('Invalid APK local header')
            a,b=struct.unpack_from('<HH',header,26);offset=row.header_offset+30+a+b
            if offset+row.compress_size>z.start_dir:raise ValueError('APK member exceeds central directory')
            if row.compress_size:result[row.filename]=(offset,row.compress_size,row.compress_type,row.CRC)
    return result

def apk_delta(base,target,archive,version_code,certificate):
    """Return ops and write literal streams into the update ZIP."""
    if not re.fullmatch('[0-9a-f]{64}',certificate):raise ValueError('Expected APK certificate SHA-256')
    old,new=member_spans(base),member_spans(target);ops=[];copies=[]
    with Path(base).open('rb') as bf,Path(target).open('rb') as tf,mmap.mmap(bf.fileno(),0,access=mmap.ACCESS_READ) as bm,mmap.mmap(tf.fileno(),0,access=mmap.ACCESS_READ) as tm:
        for name,(offset,length,method,crc) in new.items():
            prior=old.get(name)
            if not prior or prior[1:]!=(length,method,crc):continue
            start=prior[0]
            if bm[start:start+length]==tm[offset:offset+length]:copies.append((offset,length,start))
        position=0;literal_index=0
        def literal(start,end):
            nonlocal literal_index
            if start==end:return
            entry='apk/%06d.bin'%literal_index;literal_index+=1
            with archive.open(entry,'w',force_zip64=True) as out:
                for i in range(start,end,1024*1024):out.write(tm[i:min(i+1024*1024,end)])
            ops.append({'kind':'literal','entry':entry,'offset':0,'length':end-start})
        for offset,length,source in sorted(copies):
            if offset<position:raise ValueError('Overlapping target APK members')
            literal(position,offset)
            if ops and ops[-1]['kind']=='copy' and ops[-1]['offset']+ops[-1]['length']==source:ops[-1]['length']+=length
            else:ops.append({'kind':'copy','offset':source,'length':length})
            position=offset+length
        literal(position,len(tm))
    if len(ops)>100000:raise ValueError('Too many APK delta operations')
    return {'sourceSha256':digest(base),'targetSha256':digest(target),'size':Path(target).stat().st_size,'versionCode':version_code,'certificateSha256':certificate,'ops':ops}

def reconstruct(base,update,spec,output):
    """Reference verifier, also used by meaningful binary identity tests."""
    if digest(base)!=spec['sourceSha256']:raise ValueError('Wrong base APK')
    total=0
    with Path(base).open('rb') as old,Path(output).open('wb') as out,zipfile.ZipFile(update) as z:
        for op in spec['ops']:
            offset,length=op['offset'],op['length']
            if type(offset)!=int or type(length)!=int or offset<0 or length<0:raise ValueError('Invalid span')
            if op['kind']=='copy':
                if offset+length>Path(base).stat().st_size:raise ValueError('Copy exceeds base')
                old.seek(offset);source=old
            elif op['kind']=='literal':
                name=op['entry']
                if not re.fullmatch(r'apk/[A-Za-z0-9._-]+',name):raise ValueError('Unsafe literal')
                source=z.open(name)
                if offset+length>z.getinfo(name).file_size:raise ValueError('Literal exceeds member')
                if offset:source.read(offset)
            else:raise ValueError('Unknown operation')
            left=length
            while left:
                chunk=source.read(min(left,1024*1024))
                if not chunk:raise ValueError('Truncated delta')
                out.write(chunk);left-=len(chunk)
            if source is not old:source.close()
            total+=length
            if total>spec['size']:raise ValueError('Excess output')
    if total!=spec['size'] or digest(output)!=spec['targetSha256']:raise ValueError('Target hash mismatch')

def build(args):
    baseline=json.loads(args.base_manifest.read_text(encoding='utf8'))
    if baseline['packageName']!=APP_ID:raise ValueError('Wrong base package')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}',args.release_id):raise ValueError('Invalid release ID')
    if args.release_id==baseline['releaseId']:raise ValueError('Release ID must change')
    before={r['path']:r for r in baseline['files']};files=[]
    if args.changes:
        for p in sorted(args.changes.rglob('*')):
            if p.is_symlink():raise ValueError('Symlink input forbidden')
            if not p.is_file():continue
            name=resource(p.relative_to(args.changes).as_posix());h=digest(p)
            if before.get(name,{}).get('sha256')==h:continue
            files.append({'path':name,'size':p.stat().st_size,'sha256':h})
    removed=sorted(set(resource(p) for p in args.remove))
    if set(removed)&{r['path'] for r in files}:raise ValueError('Resource both changed and removed')
    if any(n not in before for n in removed):raise ValueError('Removal not present in base manifest')
    manifest={'schemaVersion':1,'kind':'delta','packageName':APP_ID,'releaseId':args.release_id,'baseReleaseId':baseline['releaseId'],'minApkVersionCode':args.version_code if args.target_apk else baseline['minApkVersionCode'],'files':files,'remove':removed,'packs':[],'serverPayload':None,'apk':None}
    crypto.prepare();args.output.parent.mkdir(parents=True,exist_ok=True)
    temporary=args.output.with_suffix(args.output.suffix+'.part')
    try:
        with tempfile.TemporaryDirectory(prefix='delta-',dir=crypto.RELEASE/'work') as td,zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
            for row in files:z.write(args.changes/row['path'],'files/'+row['path'])
            if args.server_payload:
                with zipfile.ZipFile(args.server_payload) as server:
                    entries=server.infolist()
                    if any(r.filename.lower().startswith(('data/','logs/')) or 'state.json' in r.filename.lower() for r in entries):raise ValueError('Server payload contains private state')
                    expanded=sum(r.file_size for r in entries)
                manifest['serverPayload']={'entry':'server/payload.zip','size':args.server_payload.stat().st_size,'sha256':digest(args.server_payload),'expandedSize':expanded,'entries':len(entries)}
                z.write(args.server_payload,'server/payload.zip')
            if args.target_apk:
                if not args.base_apk or not args.certificate or not args.version_code:raise ValueError('APK delta requires base APK, target version and signer digest')
                manifest['apk']=apk_delta(args.base_apk,args.target_apk,z,args.version_code,args.certificate)
            if not files and not removed and not manifest['serverPayload'] and not manifest['apk']:raise ValueError('No changes found')
            data=Path(td)/'manifest.json';sig=Path(td)/'manifest.sig';data.write_bytes(json_bytes(manifest));crypto.sign(data,sig);crypto.verify(data,sig)
            z.write(data,'manifest.json');z.write(sig,'manifest.sig');z.write(crypto.PUBLIC,'publisher.der')
        temporary.replace(args.output)
        result={'file':str(args.output),'size':args.output.stat().st_size,'sha256':digest(args.output),'changedResources':len(files),'removedResources':len(removed),'apkCopiedBytes':sum(r['length'] for r in (manifest['apk'] or {}).get('ops',[]) if r['kind']=='copy')}
        print(json.dumps(result,indent=2));return manifest
    finally:
        if temporary.exists():temporary.unlink()

def parser():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base-manifest',type=Path,required=True,help='Committed full manifest for the installed release')
    p.add_argument('--changes',type=Path,help='Directory of changed/new game resources, with their normal relative paths')
    p.add_argument('--release-id',required=True);p.add_argument('--remove',action='append',default=[])
    p.add_argument('--server-payload',type=Path);p.add_argument('--base-apk',type=Path);p.add_argument('--target-apk',type=Path)
    p.add_argument('--version-code',type=int);p.add_argument('--certificate',help='SHA-256 of the APK signing certificate')
    p.add_argument('--output',type=Path,required=True);return p

if __name__=='__main__':build(parser().parse_args())
