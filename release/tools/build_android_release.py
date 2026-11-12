"""Build the clean local-only Android shell around an owned, hash-pinned input APK.

No phone operation. No download. Private signing files never enter the APK.
The source APK/data are user-supplied build inputs, not repository assets.
"""
from __future__ import annotations
import argparse,copy,hashlib,importlib.util,json,os,re,shutil,struct,subprocess,sys,tempfile,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
RELEASE=ROOT/'release'
BASE=ROOT/'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.apk'
BASE_SHA='d9da0751b540d05a535dd76704a355110b6d63bcf30d8b876d63f3cfdf7c9b78'
APP_ID='com.zirenmidori.gcg.offline'
OLD_ID='com.yricky.gcg2.offline'
CERT='b831f43412655a31d4df6938f4ac7c922fd853b724d968678c5e5428f8a20093'
JAVA=Path(os.environ.get('GCG_JAVA',r'C:\Program Files\Eclipse Adoptium\jdk-21.0.2.13-hotspot\bin\java.exe'))
SDK=Path(os.environ.get('GCG_ANDROID_SDK',r'C:\Program Files (x86)\Android\android-sdk'))
BT=SDK/'build-tools/32.0.0'
ANDROID_JAR=SDK/'platforms/android-33/android.jar'
BOOT='com.yricky.gcg2.embedded.BootActivity'
UNITY='com.unity3d.player.UnityPlayerActivity'
SERVICE='com.yricky.gcg2.embedded.GcgServerService'
UPDATE='com.zirenmidori.gcg.release.UpdateActivity'
RECEIVER='com.zirenmidori.gcg.release.InstallResultReceiver'
ANDROID='http://schemas.android.com/apk/res/android'
NO_INDEX=0xffffffff

def need(value,message):
    if not value:raise ValueError(message)
def sha(value):return hashlib.sha256(value).hexdigest()
def file_sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def run(args):
    result=subprocess.run([str(x) for x in args],capture_output=True,text=True,encoding='utf8',errors='replace')
    need(result.returncode==0,result.stdout+'\n'+result.stderr)
    return result.stdout+result.stderr
def signature(name):return re.fullmatch(r'META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))',name,re.I) is not None
def load_module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
ax=load_module(RELEASE/'tools/android_manifest.py','release_axml')

def patch_manifest(data,version_code=10137,version_name='1.1.36'):
    chunks=ax.split_chunks(data);pool=ax.StringPool(chunks[0][1],chunks[1][1])
    # Keep indices/resource IDs stable while replacing only the application-ID namespace.
    pool.values=[APP_ID+v[len(OLD_ID):] if v==OLD_ID or v.startswith(OLD_ID+'.') else v for v in pool.values]
    pool.data=bytearray();pool.offsets=[]
    for value in pool.values:
        b=value.encode('utf-16-le');pool.offsets.append(len(pool.data));pool.data+=struct.pack('<H',len(b)//2)+b+b'\0\0'
    android=pool.index(ANDROID)
    def string(name,rid,value):
        key=pool.index(name,rid);v=pool.index(value);return struct.pack('<3IHBBI',android,key,v,8,0,3,v)
    def scalar(name,rid,kind,value):
        return struct.pack('<3IHBBI',android,pool.index(name,rid),NO_INDEX,8,0,kind,value)
    def attrs(raw):
        start,size,count=struct.unpack_from('<HHH',raw,24);need(start==size==20,'Unsupported AXML attribute format')
        return [raw[36+i*20:56+i*20] for i in range(count)]
    def attr_value(rows,name):
        for a in rows:
            ns,key,rawvalue,_,_,kind,value=struct.unpack('<3IHBBI',a)
            if pool.values[key]==name:return pool.values[value] if kind==3 else value
        return None
    def set_attrs(raw,changes):
        rows=attrs(raw);keys={name for name,_ in changes};out=[a for a in rows if pool.values[struct.unpack_from('<I',a,4)[0]] not in keys]+[v for _,v in changes]
        result=bytearray(raw[:36]+b''.join(out));struct.pack_into('<I',result,4,len(result));struct.pack_into('<H',result,28,len(out));return bytes(result)
    def element(name,rows):
        index=pool.index(name);start=struct.pack('<4I6H',0,NO_INDEX,NO_INDEX,index,20,20,len(rows),0,0,0);end=struct.pack('<4I',0,NO_INDEX,NO_INDEX,index)
        return ax.make_chunk(ax.START,16,start+b''.join(rows)),ax.make_chunk(ax.END,16,end)
    nodes=[];skip=0;in_app=False;found=set();install_permission=False
    for kind,raw in chunks[2:]:
        name=pool.values[struct.unpack_from('<I',raw,20)[0]] if kind in {ax.START,ax.END} else None
        if skip:
            if kind==ax.START:skip+=1
            elif kind==ax.END:skip-=1
            continue
        if kind==ax.START:
            rows=attrs(raw)
            if name=='uses-permission' and attr_value(rows,'name')=='android.permission.REQUEST_INSTALL_PACKAGES':install_permission=True
            if name=='uses-permission' and attr_value(rows,'name') in {'android.permission.READ_EXTERNAL_STORAGE','android.permission.WRITE_EXTERNAL_STORAGE'}:skip=1;continue
            if name in {'activity','receiver'} and attr_value(rows,'name') in {UPDATE,RECEIVER}:skip=1;continue
            if name=='manifest':raw=set_attrs(raw,[('versionCode',scalar('versionCode',0x0101021b,0x10,version_code)),('versionName',string('versionName',0x0101021c,version_name))])
            elif name=='uses-sdk':raw=set_attrs(raw,[('minSdkVersion',scalar('minSdkVersion',0x0101020c,0x10,24))])
            elif name=='application':
                if not install_permission:
                    permit=element('uses-permission',[string('name',0x01010003,'android.permission.REQUEST_INSTALL_PACKAGES')]);nodes.extend(permit)
                raw=set_attrs(raw,[('label',string('label',0x01010001,'GCG Offline')),('debuggable',scalar('debuggable',0x0101000f,0x12,0)),('allowBackup',scalar('allowBackup',0x01010280,0x12,0))]);in_app=True
            elif name=='activity':
                component=attr_value(rows,'name')
                if component==UNITY:raw=set_attrs(raw,[('exported',scalar('exported',0x01010010,0x12,0))]);found.add('unity')
                if component==BOOT:found.add('boot')
            elif name=='service' and attr_value(rows,'name')==SERVICE:found.add('service')
        elif kind==ax.END and name=='application':
            activity=element('activity',[string('name',0x01010003,UPDATE),scalar('exported',0x01010010,0x12,0),string('process',0x01010011,':releaseupdater'),scalar('launchMode',0x0101001d,0x10,1),scalar('screenOrientation',0x0101001e,0x10,0)])
            receiver=element('receiver',[string('name',0x01010003,RECEIVER),scalar('exported',0x01010010,0x12,0),string('process',0x01010011,':releaseupdater')]);nodes.extend([*activity,*receiver]);in_app=False
        nodes.append(raw)
    need(found=={'unity','boot','service'} and not in_app,'Missing existing reviewed launcher/service')
    result=ax.make_chunk(3,8,b''.join([*pool.chunks(),*nodes]));ax.split_chunks(result);return result

def patch_resource_package(data):
    out=bytearray(data);kind,header,size=struct.unpack_from('<HHI',data);need(kind==2 and size==len(data),'Invalid Android resource table')
    pos=header;found=0
    while pos<len(data):
        typ,hs,n=struct.unpack_from('<HHI',data,pos);need(n>=hs>=8 and pos+n<=len(data),'Invalid resource chunk')
        if typ==0x0200:
            need(hs>=284,'Unsupported resource package header');pid=struct.unpack_from('<I',data,pos+8)[0];name=data[pos+12:pos+268].decode('utf-16-le').split('\0',1)[0]
            need(pid==0x7f and name in {OLD_ID,APP_ID},'Unexpected resource package')
            out[pos+12:pos+268]=APP_ID.encode('utf-16-le').ljust(256,b'\0');found+=1
        pos+=n
    need(pos==len(data) and found==1,'Expected one unchanged-ID resource package');return bytes(out)

def compile_dex(stage):
    sources=sorted((RELEASE/'android/src/main/java').rglob('*.java'));need(sources and ANDROID_JAR.is_file(),'Android Java inputs/SDK missing')
    classes=stage/'classes';classes.mkdir()
    run([JAVA.with_name('javac.exe'),'-encoding','UTF-8','--release','8','-classpath',ANDROID_JAR,'-d',classes,*sources])
    run([JAVA,'-cp',BT/'lib/d8.jar','com.android.tools.r8.D8','--min-api','24','--lib',ANDROID_JAR,'--output',stage,*sorted(classes.rglob('*.class'))])
    data=(stage/'classes.dex').read_bytes();need(data[:4]==b'dex\n','Compiler did not produce DEX')
    for cls in [BOOT,SERVICE,UPDATE,RECEIVER,'com.zirenmidori.gcg.release.ReleaseBridge']:need(('L'+cls.replace('.','/')+';').encode() in data,'DEX component missing: '+cls)
    return data,{str(p.relative_to(RELEASE)):file_sha(p) for p in sources}

def raw_member(source,target,info):
    """Retain original compressed streams so APK copy/literal deltas stay small."""
    clone=copy.copy(info);clone.header_offset=target.fp.tell();source.fp.seek(info.header_offset);header=source.fp.read(30)
    need(header[:4]==b'PK\x03\x04','Invalid local ZIP member');nl,xl=struct.unpack_from('<HH',header,26);length=30+nl+xl+info.compress_size
    if info.flag_bits&8:
        source.fp.seek(info.header_offset+length);tag=source.fp.read(4);length+=16 if tag==b'PK\x07\x08' else 12
    source.fp.seek(info.header_offset)
    left=length
    while left:
        block=source.fp.read(min(left,1024*1024));need(block,'Truncated original compressed member');target.fp.write(block);left-=len(block)
    target.filelist.append(clone);target.NameToInfo[clone.filename]=clone;target.start_dir=target.fp.tell();target._didModify=True

def validate_shell(apk,version_code):
    xml=run([BT/'aapt.exe','dump','xmltree',apk,'AndroidManifest.xml']);badging=run([BT/'aapt.exe','dump','badging',apk]);resources=run([BT/'aapt.exe','dump','resources',apk])
    need(f"package: name='{APP_ID}' versionCode='{version_code}'" in badging and "sdkVersion:'24'" in badging and "targetSdkVersion:'29'" in badging,'Release Android identity/API differs')
    need("launchable-activity: name='"+BOOT+"'" in badging,'Release bootstrap is not the launcher')
    for name in [BOOT,SERVICE,UNITY,UPDATE,RECEIVER,':releaseupdater',':gcgserver']:need(name in xml,'Missing manifest component '+name)
    need('android.permission.REQUEST_INSTALL_PACKAGES' in xml and 'android.permission.WRITE_EXTERNAL_STORAGE' not in xml and 'android.permission.READ_EXTERNAL_STORAGE' not in xml,'Release permission scope differs')
    for key in ['debuggable','allowBackup']:need(re.search(r'android:'+key+r'[^\n]*0x0\b',xml),'Unsafe application attribute '+key)
    need(APP_ID in resources and OLD_ID not in resources,'Resource package name differs')
    return {'package':APP_ID,'versionCode':version_code,'minApi':24,'targetApi':29,'abis':['arm64-v8a','armeabi-v7a'],'appDebuggable':False,'androidAutoBackup':False,'broadStoragePermission':False,'userApprovedApkUpdates':True,'resourcePackageId':127}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,default=BASE);p.add_argument('--input-sha256',default=BASE_SHA);p.add_argument('--client-overlay',type=Path,default=RELEASE/'work/client/apk-overlay.json');p.add_argument('--server-payload',type=Path);p.add_argument('--manifest',type=Path,default=RELEASE/'android/assets/gcg-release/manifest.json');p.add_argument('--manifest-signature',type=Path,default=RELEASE/'android/assets/gcg-release/manifest.sig');p.add_argument('--output',type=Path,default=RELEASE/'artifacts/GCG-Offline-v0.1.0.apk');p.add_argument('--version-code',type=int,default=10137);p.add_argument('--version-name',default='1.1.36');p.add_argument('--validate-shell',action='store_true');args=p.parse_args()
    need(file_sha(args.input)==args.input_sha256,'Owned input APK SHA-256 differs')
    input_badging=run([BT/'aapt.exe','dump','badging',args.input]);old_version=re.search(r"versionCode='(\d+)'",input_badging)
    need(old_version is not None and args.version_code>int(old_version[1]),'Release versionCode must increase over the owned input APK')
    work=RELEASE/'work';work.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='android-build-',dir=work) as temp:
        stage=Path(temp);dex,sources=compile_dex(stage)
        with zipfile.ZipFile(args.input) as original:
            env=json.loads(original.read('assets/envir.json'))
            selected=env['mapEnvir']['bili']
            for key in list(selected):
                if key=='serverlist':selected[key]=['http://127.0.0.1:28080']
                elif key=='updateUrl':selected[key]='http://127.0.0.1:28080/'
                elif isinstance(selected[key],str) and selected[key].startswith(('http://','https://')):selected[key]='http://127.0.0.1:28080/'
            env['mapEnvir']={'bili':selected};env['cur']='bili'
            replacements={'AndroidManifest.xml':patch_manifest(original.read('AndroidManifest.xml'),args.version_code,args.version_name),'resources.arsc':patch_resource_package(original.read('resources.arsc')),'classes2.dex':dex,'assets/envir.json':json.dumps(env,separators=(',',':')).encode('utf8')}
            if args.validate_shell:
                test=stage/'shell.apk'
                with zipfile.ZipFile(test,'w') as z:
                    for name in ['AndroidManifest.xml','resources.arsc']:z.writestr(name,replacements[name])
                    for name in original.namelist():
                        if name.startswith('lib/') and name.endswith('.so'):z.writestr(name,b'')
                proof=validate_shell(test,args.version_code);proof.update(javaSources=sources,sourceApkSha256=args.input_sha256,mode='offline-shell-validation',phoneContacted=False)
                (RELEASE/'reports/android-shell-validation.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof));return
            need(args.server_payload and args.server_payload.is_file(),'--server-payload is required for a release build')
            overlay=json.loads(args.client_overlay.read_text(encoding='utf-8-sig'));need(overlay['sourceApkSha256']==args.input_sha256,'Client overlay baseline differs')
            for name,row in overlay['apkReplacements'].items():
                need(name not in replacements and name in original.namelist(),'Unsupported/duplicate client replacement '+name)
                need(not name.endswith('.dex') and (not name.startswith('lib/') or name in {'lib/arm64-v8a/libil2cpp.so','lib/armeabi-v7a/libil2cpp.so'}),'Unsupported executable replacement '+name)
                file=Path(row['file']);file=file if file.is_absolute() else ROOT/file;data=file.read_bytes();need(sha(data)==row['sha256'],'Client replacement digest differs '+name);replacements[name]=data
            crypto=load_module(RELEASE/'tools/release_crypto.py','android_release_crypto');crypto.verify(args.manifest,args.manifest_signature)
            manifest=json.loads(args.manifest.read_text());need(manifest['schemaVersion']==1 and manifest['kind']=='full' and manifest['packageName']==APP_ID and manifest['minApkVersionCode']==args.version_code,'Signed bootstrap identity differs')
            for name,path in {'assets/gcg-release/manifest.json':args.manifest,'assets/gcg-release/manifest.sig':args.manifest_signature,'assets/gcg-release/publickey.der':crypto.PUBLIC,'assets/gcg-server/payload.zip':args.server_payload}.items():replacements[name]=path.read_bytes()
            replacements['assets/gcg-server/payload.sha256']=(sha(replacements['assets/gcg-server/payload.zip'])+'\n').encode('ascii')
            unsigned,aligned,signed=(stage/n for n in ['unsigned.apk','aligned.apk','signed.apk'])
            with zipfile.ZipFile(unsigned,'w',allowZip64=False) as target:
                for info in original.infolist():
                    if signature(info.filename):continue
                    if info.filename in replacements:target.writestr(copy.copy(info),replacements[info.filename])
                    else:raw_member(original,target,info)
                for name in sorted(set(replacements)-set(original.namelist())):target.writestr(name,replacements[name],compress_type=zipfile.ZIP_DEFLATED)
        run([BT/'zipalign.exe','-f','-p','4',unsigned,aligned]);run([JAVA,'-jar',BT/'lib/apksigner.jar','sign','--ks',crypto.KEYSTORE,'--ks-key-alias',crypto.ALIAS,'--ks-pass','file:'+str(crypto.PASSWORD),'--v1-signing-enabled','true','--v2-signing-enabled','true','--v3-signing-enabled','true','--v4-signing-enabled','false','--out',signed,aligned])
        verification=run([JAVA,'-jar',BT/'lib/apksigner.jar','verify','--verbose','--print-certs',signed]);need(re.findall(r'Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f]+)',verification)==[CERT],'Release signing certificate differs')
        for scheme in ['v1','v2','v3']:need(re.search('Verified using '+scheme+r' scheme[^\n]*:\s*true',verification),'APK signing scheme missing '+scheme)
        run([BT/'zipalign.exe','-c','-p','4',signed]);proof=validate_shell(signed,args.version_code)
        with zipfile.ZipFile(args.input) as before,zipfile.ZipFile(signed) as after:
            left={n for n in before.namelist() if not signature(n)};right={n for n in after.namelist() if not signature(n)}
            need(not left-right and right-left==set(replacements)-left,'Unexpected APK member set');need(len(after.namelist())==len(set(after.namelist())),'Duplicate APK member')
            unchanged=0
            for name in right:
                if name in replacements:need(after.read(name)==replacements[name],'Packaged replacement differs '+name)
                else:need(sha(before.read(name))==sha(after.read(name)),'Unrelated APK content changed '+name);unchanged+=1
            libs={n for n in left if n.startswith('lib/') and n.endswith('.so')};need(libs=={n for n in right if n.startswith('lib/') and n.endswith('.so')} and len(libs)==31,'Native ABI/library set changed')
        need(not args.output.exists() and not args.output.with_suffix('.report.json').exists(),'Release output already exists; choose a new path')
        args.output.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(signed,args.output)
        proof.update(apk=str(args.output),sha256=file_sha(args.output),bytes=args.output.stat().st_size,sourceApk=str(args.input),sourceApkSha256=args.input_sha256,certificateSha256=CERT,manifestSha256=file_sha(args.manifest),javaSources=sources,clientOverlaySha256=file_sha(args.client_overlay),serverPayloadSha256=file_sha(args.server_payload),replacements={n:sha(b) for n,b in replacements.items()},unrelatedMembersByteExact=unchanged,includesPersonalData=False,phoneContacted=False)
        args.output.with_suffix('.report.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof))
if __name__=='__main__':main()
