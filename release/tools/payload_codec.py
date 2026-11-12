"""Deterministic bounded server ZIP construction; source-only helper."""
from pathlib import Path,PurePosixPath
import io,json,zipfile
def json_bytes(value):return (json.dumps(value,ensure_ascii=False,indent=2,sort_keys=True)+'\n').encode('utf8')
def collect(root,target,keep):return {target+'/'+p.relative_to(root).as_posix():p.read_bytes() for p in sorted(root.rglob('*')) if p.is_file() and keep(p.relative_to(root))}
def archive(members):
    if len(members)>=10000 or sum(map(len,members.values()))>=128*1024*1024:raise ValueError('Server bounds exceeded')
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,body in sorted(members.items()):
            p=PurePosixPath(name)
            if p.is_absolute() or p.as_posix()!=name or '..' in p.parts or '\\' in name:raise ValueError('Unsafe payload path')
            row=zipfile.ZipInfo(name,(1980,1,1,0,0,0));row.create_system=3;row.external_attr=0o100644<<16;z.writestr(row,body,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    body=out.getvalue()
    if len(body)>=64*1024*1024:raise ValueError('Compressed payload bounds exceeded')
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        assert all(z.read(n)==b for n,b in members.items())
    return body
def write_verified(path,body):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
    if path.read_bytes()!=body:raise ValueError('Writeback verification failed')
