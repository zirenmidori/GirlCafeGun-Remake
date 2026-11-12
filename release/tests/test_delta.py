"""Exact byte reconstruction, malformed span and signature tests."""
import copy, hashlib, json, os, sys, tempfile, unittest, zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import make_update as delta
import release_crypto as crypto

class DeltaTests(unittest.TestCase):
    def setUp(self):
        root=crypto.RELEASE/'work';root.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=root);self.root=Path(self.temp.name)
        self.base=self.root/'base.apk';self.target=self.root/'target.apk';self.patch=self.root/'test.gcgupdate'
        common=os.urandom(300000)
        for path,changed in ((self.base,b'old manifest'),(self.target,b'new manifest')):
            with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
                z.writestr('AndroidManifest.xml',changed);z.writestr('lib/arm64-v8a/libUnity.so',common)
                z.writestr('assets/setting.u',b'stock' if path==self.base else b'patched')
            with path.open('ab') as f:f.write(b'simulated exact trailing APK bytes')
        with zipfile.ZipFile(self.patch,'w',compression=zipfile.ZIP_DEFLATED) as z:
            self.spec=delta.apk_delta(self.base,self.target,z,10138,'a'*64)
    def tearDown(self):self.temp.cleanup()
    def test_exact_reconstruction_and_reuse(self):
        out=self.root/'out.apk';delta.reconstruct(self.base,self.patch,self.spec,out)
        self.assertEqual(out.read_bytes(),self.target.read_bytes())
        self.assertGreater(sum(r['length'] for r in self.spec['ops'] if r['kind']=='copy'),299000)
        self.assertLess(self.patch.stat().st_size,4000)
    def test_wrong_base_rejected(self):
        self.base.write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError,'Wrong base'):delta.reconstruct(self.base,self.patch,self.spec,self.root/'out')
    def test_out_of_bounds_and_negative_rejected(self):
        for offset in (-1,10**9):
            s=copy.deepcopy(self.spec);s['ops']=[{'kind':'copy','offset':offset,'length':100}]
            with self.assertRaises(ValueError):delta.reconstruct(self.base,self.patch,s,self.root/'out')
    def test_corrupt_literal_target_rejected(self):
        with zipfile.ZipFile(self.patch,'a') as z:z.writestr('apk/corrupt.bin',b'x')
        s=copy.deepcopy(self.spec);s['ops'][0]={'kind':'literal','entry':'apk/corrupt.bin','offset':0,'length':1}
        with self.assertRaises(ValueError):delta.reconstruct(self.base,self.patch,s,self.root/'out')
    def test_path_allowlist(self):
        for path in ('../x.u','/x.u','x//y.u','updates/a.u','gcg-server/state.json','state.json.u','x\\a.u','Raw/x.exe','AutoAudio/Android/../a.bnk'):
            with self.assertRaises(ValueError):delta.resource(path)
        for path in ('setting.u','version.data','npc/neptune.u','Raw/op.mp4','AutoAudio/Android/English(US)/Voice.bnk'):self.assertEqual(delta.resource(path),path)
    def test_release_signature_tamper(self):
        crypto.prepare();data=self.root/'manifest.json';sig=self.root/'manifest.sig'
        data.write_bytes(b'{"kind":"delta"}\n');crypto.sign(data,sig);crypto.verify(data,sig)
        data.write_bytes(b'{"kind":"full"}\n')
        with self.assertRaises(RuntimeError):crypto.verify(data,sig)

if __name__=='__main__':unittest.main()
