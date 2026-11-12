"""Run production Java updater transactions on isolated D: files, without Android/device.

Uses Android7's Apache-licensed JSON implementation fetched into private work by
the development setup. It is a host-test dependency, not shipped in the APK.
"""
from pathlib import Path
import argparse,base64,hashlib,json,os,subprocess,tempfile,urllib.request
ROOT=Path(__file__).resolve().parents[2]
RELEASE=ROOT/'release'
JAVA=Path(os.environ.get('GCG_JAVA',r'C:\Program Files\Eclipse Adoptium\jdk-21.0.2.13-hotspot\bin\java.exe'))
DEPENDENCIES={
 'JSON.java':'a2cc5e4bf64bfe3edd73c6a14409f3200640454051d9947ee79f16a2396a19b1',
 'JSONArray.java':'dd2e3db3deb9cd2b6b2b2d8e945c84a71ae9e353b9da1d3047bf1ea0dca9ea54',
 'JSONException.java':'2c3ef7315003a16886ec43588534c0bac2371e052a30574065afb01579de1faf',
 'JSONObject.java':'1013ed9d17031b30a3a3362d5a0fd43af6d125258f1bbd74733509d12e7b370d',
 'JSONStringer.java':'c3e7c8cf9195e01a6851fb9b9fdf1c6c57801778e20400f858def1ac65ebff77',
 'JSONTokener.java':'ea70c92288cf8810b3077a68449ebbffdcafbcc28fc5fe20421e5dd3fd956ef7'}
def run(args):
    p=subprocess.run([str(x) for x in args],capture_output=True,text=True,encoding='utf8',errors='replace')
    if p.returncode:raise RuntimeError(p.stdout+'\n'+p.stderr)
    return p.stdout
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--fetch-test-deps',action='store_true',help='Fetch six hash-pinned Apache-licensed AOSP JSON sources for host tests only');args=parser.parse_args()
    deps=RELEASE/'work/test-deps/aosp-json'
    if args.fetch_test_deps:
        deps.mkdir(parents=True,exist_ok=True)
        for name,digest in DEPENDENCIES.items():
            path=deps/name
            if path.exists():continue
            url='https://android.googlesource.com/platform/libcore/+/android-7.0.0_r1/json/src/main/java/org/json/'+name+'?format=TEXT'
            with urllib.request.urlopen(url,timeout=30) as response:raw=base64.b64decode(response.read(1024*1024))
            if hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('AOSP test dependency hash mismatch: '+name)
            path.write_bytes(raw)
    if {p.name for p in deps.glob('*.java')}!=set(DEPENDENCIES):raise RuntimeError('Run this test with --fetch-test-deps once to obtain the six hash-pinned AOSP JSON sources')
    for name,digest in DEPENDENCIES.items():
        if hashlib.sha256((deps/name).read_bytes()).hexdigest()!=digest:raise RuntimeError('AOSP host test dependency changed: '+name)
    prod=RELEASE/'android/src/main/java/com/zirenmidori/gcg/release'
    names=['ReleaseIO','ReleaseManifest','ReleaseStore','ReleaseDownload','ReleaseEngine','ApkDeltaBytes']
    sources=[*(prod/(n+'.java') for n in names),*sorted(deps.glob('*.java')),*sorted((RELEASE/'tests/java').rglob('*.java'))]
    with tempfile.TemporaryDirectory(prefix='android-updater-test-',dir=RELEASE/'work') as directory:
        work=Path(directory);classes=work/'classes';classes.mkdir()
        run([JAVA.with_name('javac.exe'),'-encoding','UTF-8','--release','8','-d',classes,*sources])
        out=run([JAVA,'-cp',classes,'UpdaterHostTest',work/'sandbox']);print(out,end='')
        result=json.loads(out.splitlines()[-1]);result.update(aospJsonSource='https://android.googlesource.com/platform/libcore/+/android-7.0.0_r1/json/src/main/java/org/json/',sourceSha256={str(p.relative_to(RELEASE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},directoryFsync='host boundary stub; real file data fsync and atomic replace executed')
        (RELEASE/'reports/android-updater-tests.json').write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':main()
