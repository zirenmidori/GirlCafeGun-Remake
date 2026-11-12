"""JDK-backed release signatures; no third-party Python crypto dependency."""
from pathlib import Path
import hashlib,json,os,secrets,subprocess,shutil

ROOT=Path(__file__).resolve().parents[2]
RELEASE=Path(__file__).resolve().parents[1]
_local_java=Path(r'C:\Program Files\Eclipse Adoptium\jdk-21.0.2.13-hotspot\bin\java.exe')
JAVA=Path(os.environ.get('GCG_JAVA') or shutil.which('java') or str(_local_java))
PRIVATE=RELEASE/'private/signing'
KEYSTORE=PRIVATE/'release.p12'
PASSWORD=PRIVATE/'password.txt'
PUBLIC=RELEASE/'android/assets/gcg-release/publickey.der'
CLASSES=RELEASE/'work/signing-classes'
ALIAS='gcg-release'

def run(args):
    out=subprocess.run([str(x) for x in args],capture_output=True,text=True,encoding='utf8',errors='replace')
    if out.returncode:raise RuntimeError(out.stdout+'\n'+out.stderr)
    return out.stdout.strip()

def java_tool(name):
    candidate=JAVA.with_name(name+('.exe' if JAVA.suffix.lower()=='.exe' else ''))
    if candidate.is_file():return candidate
    found=shutil.which(name)
    if not found:raise RuntimeError('A JDK is required; set GCG_JAVA to its Java executable')
    return Path(found)

def compile_helper():
    source=Path(__file__).parent/'java/ReleaseSign.java'
    CLASSES.mkdir(parents=True,exist_ok=True)
    marker=CLASSES/'source.sha256'
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    if not marker.exists() or marker.read_text()!=digest:
        run([java_tool('javac'),'-encoding','UTF-8','-d',CLASSES,source])
        marker.write_text(digest)

def prepare():
    PRIVATE.mkdir(parents=True,exist_ok=True);PUBLIC.parent.mkdir(parents=True,exist_ok=True)
    if KEYSTORE.exists()!=PASSWORD.exists():raise ValueError('Incomplete private signing identity; preserve and inspect it')
    if not KEYSTORE.exists():
        PASSWORD.write_text(secrets.token_urlsafe(40)+'\n',encoding='ascii')
        run([java_tool('keytool'),'-genkeypair','-alias',ALIAS,'-keyalg','RSA','-keysize','3072',
             '-sigalg','SHA256withRSA','-validity','36500','-storetype','PKCS12','-keystore',KEYSTORE,
             '-storepass:file',PASSWORD,'-keypass:file',PASSWORD,'-dname','CN=GCG Offline Release, O=zirenmidori','-noprompt'])
    compile_helper()
    output=run([JAVA,'-cp',CLASSES,'ReleaseSign','public',KEYSTORE,PASSWORD,ALIAS,PUBLIC])
    identity=dict(line.split('=',1) for line in output.splitlines())
    identity.update(algorithm='SHA256withRSA',alias=ALIAS,publicKey='android/assets/gcg-release/publickey.der')
    (RELEASE/'reports/signing-public.json').write_text(json.dumps(identity,indent=2)+'\n',encoding='utf8')
    return identity

def sign(data,output,keystore=KEYSTORE,password=PASSWORD,alias=ALIAS):
    compile_helper();run([JAVA,'-cp',CLASSES,'ReleaseSign','sign',keystore,password,alias,output,data])

def verify(data,signature,public=PUBLIC):
    compile_helper();run([JAVA,'-cp',CLASSES,'ReleaseSign','verify',public,data,signature])

if __name__=='__main__':print(json.dumps(prepare()))
