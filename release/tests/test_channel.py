"""Check legacy descriptors and base-specific routes without publishing anything."""
from pathlib import Path
import hashlib
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from make_channel import descriptor,artifact,MAX_IMPORT


class ChannelTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]/'work',prefix='channel-test-')
        self.root=Path(self.temporary.name)
        self.old=self.root/'old.gcgupdate';self.old.write_bytes(b'base-zero-exact-package')
        self.current=self.root/'current.gcgupdate';self.current.write_bytes(b'base-one-exact-package')
        self.old_url='https://downloads.example/0.1.2/from-0.gcgupdate'
        self.current_url='https://downloads.example/0.1.2/from-1.gcgupdate'

    def tearDown(self):self.temporary.cleanup()

    def test_routed_descriptor_retains_legacy_primary_and_exact_base_identities(self):
        value=descriptor('0.1.2',self.current,self.current_url,'0.1.1',[('0.1.0',self.old,self.old_url)])
        self.assertEqual(value['releaseId'],'0.1.2')
        self.assertEqual(value['baseReleaseId'],'0.1.1')
        self.assertEqual(value['url'],self.current_url)
        self.assertEqual(value['sha256'],hashlib.sha256(self.current.read_bytes()).hexdigest())
        routes={r['baseReleaseId']:r for r in value['routes']}
        self.assertEqual(set(routes),{'0.1.0','0.1.1'})
        self.assertEqual(routes['0.1.0']['url'],self.old_url)
        self.assertEqual(routes['0.1.0']['size'],self.old.stat().st_size)
        self.assertEqual(routes['0.1.0']['sha256'],hashlib.sha256(self.old.read_bytes()).hexdigest())
        for key in ('url','size','sha256'):self.assertEqual(routes['0.1.1'][key],value[key])

    def test_marker_and_legacy_descriptor_remain_usable(self):
        marker=descriptor('0.1.2')
        self.assertEqual(set(marker),{'schemaVersion','packageName','releaseId'})
        value=descriptor('0.1.2',self.current,self.current_url)
        self.assertNotIn('routes',value)
        self.assertNotIn('baseReleaseId',value)
        self.assertEqual(value['size'],self.current.stat().st_size)

    def test_routes_require_unambiguous_legacy_primary(self):
        with self.assertRaises(ValueError):descriptor('0.1.2',routes=[('0.1.0',self.old,self.old_url)])
        with self.assertRaises(ValueError):descriptor('0.1.2',self.current,self.current_url,routes=[('0.1.0',self.old,self.old_url)])
        with self.assertRaises(ValueError):descriptor('0.1.2',self.current,self.current_url,'0.1.1',[('0.1.1',self.old,self.old_url)])
        with self.assertRaises(ValueError):descriptor('0.1.2',self.current,self.current_url,'0.1.1',[('0.1.2',self.old,self.old_url)])
        with self.assertRaises(ValueError):descriptor('../unsafe',self.current,self.current_url)
        with self.assertRaises(ValueError):descriptor('0.1.2',self.current,self.current_url,'0.1.2')

    def test_bad_https_destinations_and_empty_packages_reject(self):
        for address in ('http://downloads.example/file','https://user:secret@downloads.example/file','https://downloads.example/file#part','https://downloads.example/file#','https://downloads.example:0/file','https://downloads.example:65536/file','https://bad host/file','https://bad^host/file'):
            with self.subTest(address=address),self.assertRaises(ValueError):artifact(self.current,address)
        empty=self.root/'empty.gcgupdate';empty.write_bytes(b'')
        with self.assertRaises(ValueError):artifact(empty,self.current_url)
        self.assertEqual(artifact(self.current,self.current_url+'?download=1')['url'],self.current_url+'?download=1')


if __name__=='__main__':unittest.main()
