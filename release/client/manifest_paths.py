"""Append canonical routes to an EXISTING bundle without changing old records/maps."""
import copy,json,struct,zlib
from version_manifest import Manifest

def mappings(names,existing,bundle,paths):
    target=names.index(bundle);old=dict(existing)
    assert len(old)==len(existing),'Source has duplicate asset hashes'
    assert len(paths)==len(set(paths))
    extra=[]
    for path in paths:
        assert path.startswith('Assets/_Game/AssetBundle/')
        key=zlib.crc32(path.encode('ascii'))
        if key in old:assert old[key]==target,'Asset route collides with another bundle'
        else:extra.append((key,target))
    assert len({k for k,_ in extra})==len(extra),'New canonical path hash collision'
    return extra

def binary(data,bundle,paths):
    before=Manifest(data);extra=mappings(before.bundle_names,before.a2b,bundle,paths)
    offset=before.a2b_offset-4;end=before.a2b_offset+before.a2b_count*8
    result=(data[:offset]+struct.pack('<I',before.a2b_count+len(extra))+data[before.a2b_offset:end]
            +b''.join(struct.pack('<II',*row) for row in extra)+data[end:])
    after=Manifest(result)
    assert after.bundle_names==before.bundle_names and after.a2b==before.a2b+extra
    assert after.opaque_tail==before.opaque_tail and len(after.records)==len(before.records)
    assert (after.version,after.build_version,after.pack_counter)==(before.version,before.build_version,before.pack_counter)
    for a,b in zip(before.records,after.records):assert data[a.start:a.end]==result[b.start:b.end]
    return result,{'addedAssetMappings':extra,'oldMapsAndRecordsByteExact':True}

def compressed(data,bundle,paths):
    before=json.loads(zlib.decompress(data));after=copy.deepcopy(before)
    pairs=[(int(k),v) for k,v in before['a2b'].items()]
    extra=mappings(before['bundles'],pairs,bundle,paths)
    after['a2b'].update({str(k):v for k,v in extra})
    assert {k:v for k,v in after.items() if k!='a2b'}=={k:v for k,v in before.items() if k!='a2b'}
    assert all(after['a2b'][k]==v for k,v in before['a2b'].items())
    result=zlib.compress(json.dumps(after,ensure_ascii=False,separators=(',',':')).encode(),9)
    assert json.loads(zlib.decompress(result))==after
    return result,{'addedAssetMappings':extra,'oldMapsAndOtherValuesExact':True}
