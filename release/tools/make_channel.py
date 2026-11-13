"""Sign the manual online-update descriptor; no update is forced on launch."""
from pathlib import Path
import argparse,base64,json,tempfile
import release_crypto as crypto
from make_update import APP_ID,json_bytes,digest
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release-id',required=True);p.add_argument('--update',type=Path);p.add_argument('--url');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if bool(a.update)!=bool(a.url):raise ValueError('Provide both update file and HTTPS URL, or neither for the current-release marker')
    descriptor={'schemaVersion':1,'packageName':APP_ID,'releaseId':a.release_id}
    if a.update:
        if not a.url.startswith('https://'):raise ValueError('Expected public HTTPS update URL')
        descriptor.update(url=a.url,size=a.update.stat().st_size,sha256=digest(a.update))
    crypto.prepare()
    with tempfile.TemporaryDirectory(dir=crypto.RELEASE/'work') as td:
        data=Path(td)/'channel.json';sig=Path(td)/'channel.sig';data.write_bytes(json_bytes(descriptor));crypto.sign(data,sig);crypto.verify(data,sig)
        envelope={'payload':base64.b64encode(data.read_bytes()).decode('ascii'),'signature':base64.b64encode(sig.read_bytes()).decode('ascii')}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(json_bytes(envelope));print('Signed channel '+a.release_id)
if __name__=='__main__':main()
