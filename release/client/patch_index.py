"""Update existing resource identities; route additions are in manifest_paths."""
import copy,json,struct,zlib
from version_manifest import Manifest,encode_string
ASSETS={}
def append_binary(data,paired):
    old=Manifest(data);chunks=[];at=0
    for row in old.records:
        if row.name not in paired:continue
        body=paired[row.name].read_bytes()
        chunks.extend((data[at:row.size_offset],struct.pack('<q',len(body)),encode_string(str(zlib.crc32(body)))));at=row.crc_end
    chunks.append(data[at:]);result=b''.join(chunks);new=Manifest(result)
    assert new.bundle_names==old.bundle_names and new.a2b==old.a2b and new.opaque_tail==old.opaque_tail
    assert len(new.records)==len(old.records)
    for before,after in zip(old.records,new.records):
        if before.name not in paired:assert data[before.start:before.end]==result[after.start:after.end]
        else:
            body=paired[after.name].read_bytes();assert (after.size,int(after.crc_text))==(len(body),zlib.crc32(body))
    return result,{'existingRecordsUpdated':sorted(paired),'routesAndUnrelatedRecordsExact':True}
def append_json(data,paired):
    old=json.loads(zlib.decompress(data));new=copy.deepcopy(old)
    for name,p in paired.items():
        body=p.read_bytes();new['abinfo'][name].update(size=len(body),hash=str(zlib.crc32(body)))
    result=zlib.compress(json.dumps(new,ensure_ascii=False,separators=(',',':')).encode('utf8'),9)
    assert json.loads(zlib.decompress(result))==new
    return result,{'existingRecordsUpdated':sorted(paired),'routesUnchanged':True}
