"""Crop genuine supplied artwork for the game's native 1080:1920 card canvas."""
from pathlib import Path
import hashlib,sys
ROOT=Path(__file__).resolve().parents[2]
import sprite_tools as icons
CARD='Assets/_Game/AssetBundle/Textures/Npc/card_neptune_release.png'
ART_SHA='0f75e74b62311cb4e6461e88193a639f5682ffd522e11b664d84776726c8ca4f'

def build(source,art):
    assert hashlib.sha256(art.read_bytes()).hexdigest()==ART_SHA
    with icons.Image.open(art) as image:
        assert image.size==(1920,1080)
        crop=image.convert('RGBA').crop((1160,0,1768,1080)).resize((540,960),icons.Image.Resampling.LANCZOS)
    meta,raw,encrypted,plain=icons.stock.decode(source);assert not encrypted
    env,asset=icons.stock.model_objects(plain);before={pid:o.get_raw_data() for pid,o in asset.objects.items()};exports={p:r.path_id for p,r in env.container.items()}
    tex=asset.objects[2700010];sprite=asset.objects[2700011]
    ids=icons.add_icon(tex,sprite,asset,2700020,CARD,crop)
    bundle=asset.objects[1];t=bundle.read_typetree();assert not t['m_Dependencies']
    start=len(t['m_PreloadTable']);t['m_PreloadTable'] += [icons.stock.ptr(pid) for pid in ids]
    t['m_Container'] += [(CARD.lower(),{'preloadIndex':start,'preloadSize':2,'asset':icons.stock.ptr(pid)}) for pid in ids]
    bundle.save_typetree(t);serial=asset.save();_,_,flags,cab=meta['nodes'][0];assert len(meta['nodes'])==1
    result=icons.stock.pack({**meta,'nodes':[(0,len(serial),flags,cab)]},serial)
    check_env,check=icons.stock.model_objects(result);assert not check.externals
    assert check.objects[2700020].read().image.convert('RGBA').tobytes()==crop.tobytes()
    assert check.objects[2700021].read().image.convert('RGBA').tobytes()==crop.tobytes()
    assert all(check.objects[pid].get_raw_data()==data for pid,data in before.items() if pid!=1)
    assert all(check_env.container[p].path_id==pid for p,pid in exports.items()), (exports,{p:r.path_id for p,r in check_env.container.items()})
    for o in check.objects.values():
        for p in icons.pointers(o.read_typetree()):assert p['m_FileID']==0 and (not p['m_PathID'] or p['m_PathID'] in check.objects)
    return result,{'canonicalAssetPath':CARD,'sourceArtSha256':ART_SHA,'sourceCrop':[1160,0,1768,1080],'textureSize':[540,960],'nativeCardCanvas':[1080,1920],'sameAspectRatio':True,'pixelReadbackExact':True,'existingIconAndWardrobeObjectsByteExact':True,'addedObjectIds':list(ids),'allLocalPPtrsResolve':True,'dependencies':[]},crop
