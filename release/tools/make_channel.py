"""Sign the manual online-update descriptor; no update is forced on launch."""
from pathlib import Path
import argparse,base64,json,re,tempfile
from urllib.parse import urlsplit
import release_crypto as crypto
from make_update import APP_ID,json_bytes,digest
MAX_IMPORT=8*1024*1024*1024

def identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}',value):raise ValueError('Invalid release ID')
    return value

def artifact(update,url):
    if not isinstance(url,str) or not url.isascii() or any(c.isspace() for c in url):raise ValueError('Expected public HTTPS update URL')
    parsed=urlsplit(url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username is not None or parsed.password is not None or '#' in url or parsed.port==0:raise ValueError('Expected HTTPS update URL without credentials or fragment')
    if ':' not in parsed.hostname and (not re.fullmatch(r'[A-Za-z0-9.-]+',parsed.hostname) or any(not label or label.startswith('-') or label.endswith('-') or len(label)>63 for label in parsed.hostname.rstrip('.').split('.'))):raise ValueError('Invalid HTTPS update hostname')
    size=Path(update).stat().st_size
    if not 0<size<=MAX_IMPORT:raise ValueError('Update package exceeds supported size')
    return {'url':url,'size':size,'sha256':digest(update)}

def descriptor(release_id,update=None,url=None,base_release_id=None,routes=()):
    """Keep primary fields readable by older apps; newer apps select exact bases."""
    identifier(release_id)
    if bool(update)!=bool(url):raise ValueError('Provide both update file and HTTPS URL, or neither for the current-release marker')
    result={'schemaVersion':1,'packageName':APP_ID,'releaseId':release_id}
    primary=artifact(update,url) if update else None
    if primary:result.update(primary)
    if base_release_id is not None:
        identifier(base_release_id)
        if primary is None or base_release_id==release_id:raise ValueError('A distinct base release requires an update artifact')
        result['baseReleaseId']=base_release_id
    if routes:
        if primary is None or base_release_id is None:raise ValueError('Routed channels require a primary update and --base-release-id for older clients')
        selected={base_release_id:{'baseReleaseId':base_release_id,**primary}}
        for base,file,address in routes:
            identifier(base)
            if base==release_id:raise ValueError('Channel route cannot target its own base release')
            row={'baseReleaseId':base,**artifact(file,address)}
            if base in selected and selected[base]!=row:raise ValueError('Conflicting channel routes for '+base)
            selected[base]=row
        if len(selected)>64:raise ValueError('Too many channel routes')
        result['routes']=[selected[k] for k in sorted(selected)]
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release-id',required=True);p.add_argument('--update',type=Path);p.add_argument('--url');p.add_argument('--base-release-id',help='Base of the primary artifact retained for older clients');p.add_argument('--route',nargs=3,action='append',default=[],metavar=('BASE','UPDATE_FILE','HTTPS_URL'),help='Additional exact-base route; may be repeated, and the primary route is included automatically');p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    value=descriptor(a.release_id,a.update,a.url,a.base_release_id,a.route)
    crypto.prepare()
    with tempfile.TemporaryDirectory(dir=crypto.RELEASE/'work') as td:
        data=Path(td)/'channel.json';sig=Path(td)/'channel.sig';data.write_bytes(json_bytes(value));crypto.sign(data,sig);crypto.verify(data,sig)
        envelope={'payload':base64.b64encode(data.read_bytes()).decode('ascii'),'signature':base64.b64encode(sig.read_bytes()).decode('ascii')}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(json_bytes(envelope));print('Signed channel '+a.release_id)
if __name__=='__main__':main()
