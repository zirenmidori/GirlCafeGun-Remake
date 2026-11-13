"""Separate the stock-size card thumbnail from the original full landscape art."""
from pathlib import Path
import hashlib,sys
ROOT=Path(__file__).resolve().parents[2]
import sprite_tools as icons
from UnityPy.enums import TextureFormat
from UnityPy.export.Texture2DConverter import image_to_texture2d
CARD='Assets/_Game/AssetBundle/Textures/Npc/card_neptune_release.png'
FULL_CARD='Assets/_Game/AssetBundle/Textures/Npc/card_neptune_full_release.png'
ASSET_PATHS=[CARD,FULL_CARD]
ART_SHA='0f75e74b62311cb4e6461e88193a639f5682ffd522e11b664d84776726c8ca4f'

def build(source,art):
    assert hashlib.sha256(art.read_bytes()).hexdigest()==ART_SHA
    with icons.Image.open(art) as image:
        assert image.size==(1920,1080)
        full=image.convert('RGBA')
        crop=full.crop((1102,0,1920,1080)).resize((203,268),icons.Image.Resampling.LANCZOS)
    meta,raw,encrypted,plain=icons.stock.decode(source);assert not encrypted
    env,asset=icons.stock.model_objects(plain);before={pid:o.get_raw_data() for pid,o in asset.objects.items()};exports={p:r.path_id for p,r in env.container.items()}
    tex=asset.objects[2700010];sprite=asset.objects[2700011]
    ids=icons.add_icon(tex,sprite,asset,2700020,CARD,crop)
    full_tex=icons.clone(tex,asset,2700030)
    tree=full_tex.read_typetree()
    encoded,fmt=image_to_texture2d(full,TextureFormat.ETC2_RGB)
    assert fmt==TextureFormat.ETC2_RGB and len(encoded)==1920*1080//2
    tree.update(m_Name=Path(FULL_CARD).stem,m_Width=1920,m_Height=1080,
                m_CompleteImageSize=len(encoded),m_TextureFormat=int(fmt),m_MipCount=1,
                m_IsReadable=False,m_StreamingMipmaps=False,
                m_StreamData={'offset':0,'size':0,'path':''})
    tree['image data']=encoded
    full_tex.save_typetree(tree)
    bundle=asset.objects[1];t=bundle.read_typetree();assert not t['m_Dependencies']
    start=len(t['m_PreloadTable']);t['m_PreloadTable'] += [icons.stock.ptr(pid) for pid in ids]
    t['m_Container'] += [(CARD.lower(),{'preloadIndex':start,'preloadSize':2,'asset':icons.stock.ptr(pid)}) for pid in ids]
    start=len(t['m_PreloadTable']);t['m_PreloadTable'].append(icons.stock.ptr(full_tex.path_id))
    t['m_Container'].append((FULL_CARD.lower(),{'preloadIndex':start,'preloadSize':1,'asset':icons.stock.ptr(full_tex.path_id)}))
    bundle.save_typetree(t);serial=asset.save();_,_,flags,cab=meta['nodes'][0];assert len(meta['nodes'])==1
    result=icons.stock.pack({**meta,'nodes':[(0,len(serial),flags,cab)]},serial)
    check_env,check=icons.stock.model_objects(result);assert not check.externals
    assert check.objects[2700020].read().image.convert('RGBA').tobytes()==crop.tobytes()
    assert check.objects[2700021].read().image.convert('RGBA').tobytes()==crop.tobytes()
    decoded=check.objects[2700030].read().image.convert('RGB')
    from PIL import ImageChops,ImageStat
    import math
    error=ImageStat.Stat(ImageChops.difference(decoded,full.convert('RGB')))
    mse=sum(value*value for value in error.rms)/3
    psnr=10*math.log10(255*255/mse) if mse else 100.
    assert decoded.size==(1920,1080) and psnr>34.,psnr
    assert all(check.objects[pid].get_raw_data()==data for pid,data in before.items() if pid!=1)
    assert all(check_env.container[p].path_id==pid for p,pid in exports.items()), (exports,{p:r.path_id for p,r in check_env.container.items()})
    for o in check.objects.values():
        for p in icons.pointers(o.read_typetree()):assert p['m_FileID']==0 and (not p['m_PathID'] or p['m_PathID'] in check.objects)
    return result,{'canonicalAssetPath':CARD,'fullAssetPath':FULL_CARD,
        'assetPaths':ASSET_PATHS,'sourceArtSha256':ART_SHA,'sourceCrop':[1102,0,1920,1080],
        'textureSize':[203,268],'stockThumbnailSpriteRect':[203,268],
        'fullTextureSize':[1920,1080],'nativeFullCardCanvas':[1920,1080],
        'fullSourceUncropped':True,'thumbnailPixelReadbackExact':True,
        'fullTextureFormat':int(fmt),'stockFullTextureFormat':45,
        'fullGpuTextureBytes':len(encoded),'fullReconstructionPsnrDb':psnr,
        'existingIconAndWardrobeObjectsByteExact':True,'addedObjectIds':list(ids)+[2700030],
        'allLocalPPtrsResolve':True,'dependencies':[]},crop
