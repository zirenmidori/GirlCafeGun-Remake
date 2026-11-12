"""Cap the jacket's drag range by changing one MOC parameter maximum float."""
from pathlib import Path
import hashlib,struct,sys
ROOT=Path(__file__).resolve().parents[2]
from types import SimpleNamespace
import asset_tools
stage=SimpleNamespace(stock=asset_tools)
sys.path[:0]=[str(Path(__file__).parent/'vendor/py-moc3'),str(ROOT/'tools/unity-fix/native')]
from moc3_core import Moc3
from core_qa import AndroidCore,pose_snapshot
CAP=.8

def build(source):
    meta,raw,encrypted,plain=stage.stock.decode(source);assert not encrypted
    env,asset=stage.stock.model_objects(plain)
    before={pid:o.get_raw_data() for pid,o in asset.objects.items()}
    moc_obj,= [r.deref() for p,r in env.container.items() if p.endswith('_moc.asset')]
    body=moc_obj.get_raw_data();length=struct.unpack_from('<I',body,28)[0]
    at=32+(length+3)//4*4;size=struct.unpack_from('<I',body,at)[0];start=at+4
    moc=body[start:start+size];assert moc[:4]==b'MOC3'
    parsed=Moc3.from_bytes(moc);index=parsed.parameter_ids.index('ParamHemLift')
    slot=next(i+2 for i,e in enumerate(parsed._layout) if e.name=='parameter.max_values')
    offset=parsed._sot_offsets[slot]+index*4
    assert struct.unpack_from('<f',moc,offset)[0]==1.0
    capped=bytearray(moc);struct.pack_into('<f',capped,offset,CAP);capped=bytes(capped)
    assert all(a==b or offset<=i<offset+4 for i,(a,b) in enumerate(zip(moc,capped)))
    core_proof={}
    for abi in ('arm64-v8a','armeabi-v7a'):
        library=asset_tools.CORE_LIBRARIES[abi]
        core=AndroidCore(library,abi);original,_=core.load(moc);candidate,_=core.load(capped)
        a=pose_snapshot(core,original,{});b=pose_snapshot(core,candidate,{})
        assert a['drawables']==b['drawables'] and a['parts']==b['parts']
        ap,bp=a['parameters'],b['parameters'];assert len(ap)==len(bp)
        for i,(left,right) in enumerate(zip(ap,bp)):
            if i==index:
                assert dict(left,max=right['max'])==right and abs(right['max']-CAP)<1e-6
            else:assert left==right
        old_cap=pose_snapshot(core,original,{'ParamHemLift':CAP});new_cap=pose_snapshot(core,candidate,{'ParamHemLift':CAP})
        assert old_cap['drawables']==new_cap['drawables']
        core_proof[abi]={'coreSha256':hashlib.sha256(library).hexdigest(),'neutralGeometryExact':True,'capPoseGeometryMatchesOriginalAt08':True,'parametersUnchangedExceptOneMaximum':True}
    moc_obj.set_raw_data(body[:start]+capped+body[start+size:])
    serial=asset.save();assert len(meta['nodes'])==2
    _,_,flags,cab=meta['nodes'][0];offset2,len2,f2,n2=meta['nodes'][1];resource=raw[offset2:offset2+len2]
    result=stage.stock.pack({**meta,'nodes':[(0,len(serial),flags,cab),(len(serial),len(resource),f2,n2)]},serial+resource)
    checked_env,checked=stage.stock.model_objects(result)
    assert {p:r.path_id for p,r in env.container.items()}=={p:r.path_id for p,r in checked_env.container.items()}
    changed={pid for pid,o in checked.objects.items() if o.get_raw_data()!=before[pid]}
    assert changed=={moc_obj.path_id}
    assert [x.path for x in asset.externals]==[x.path for x in checked.externals]
    return result,{'changedObjectId':moc_obj.path_id,'mocFloatOffset':offset,'maximumBefore':1.,'maximumAfter':CAP,'nativeDragReadsMaximumValue':True,'nativeDragClampRva':'0x2275f5c','allOtherMocBytesExact':True,'allTextureMeshMotionControllerAndOtherObjectsExact':True,'nativeCore':core_proof}
