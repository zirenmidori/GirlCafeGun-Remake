"""Build a hash-pinned release client overlay without modifying an APK or device.

Python3.10 is required by the reviewed UnityPy dependencies. Inputs may be
overridden; the baseline identity is deliberately pinned to prevent regression.
"""
from pathlib import Path
import argparse,hashlib,json,sys,zipfile,zlib
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/unity-fix/native/testdeps')]
import patch_lua,patch_native,patch_model,patch_settings,patch_card
import patch_index as indexes
import asset_tools
import manifest_paths
from runtime_asset_guard import validate_assetfile
import test_login

SOURCE_SHA='d9da0751b540d05a535dd76704a355110b6d63bcf30d8b876d63f3cfdf7c9b78'
CACHE_SHA='a2012a54d479ef5eed6232374a543b9f31b038146202e27705a19199cacf3f5e'
sha=lambda b:hashlib.sha256(b).hexdigest()

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-apk',type=Path,default=ROOT/'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.apk')
    ap.add_argument('--source-cache',type=Path,default=ROOT/'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.cache.zip')
    ap.add_argument('--art',type=Path,default=ROOT/'release/work/card-art/neptune-card-source.jpg')
    ap.add_argument('--output-dir',type=Path,default=ROOT/'release/work/client')
    args=ap.parse_args();out=args.output_dir.resolve()
    assert not (out/'apk-overlay.json').exists() and not (out/'files').exists(),'Refuse overwriting frozen client output'
    assert sha(args.source_apk.read_bytes())==SOURCE_SHA
    assert sha(args.source_cache.read_bytes())==CACHE_SHA
    asset_tools.configure(args.source_apk)
    out.mkdir(parents=True,exist_ok=True);files=out/'files';files.mkdir()
    def write(name,data):
        p=files/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);assert p.read_bytes()==data;return p
    replacements={};changed={};proofs={}
    with zipfile.ZipFile(args.source_apk) as apk,zipfile.ZipFile(args.source_cache) as cache:
        old_external={n:cache.read(n) for n in cache.namelist()}
        assert len(old_external)==15
        for n,b in old_external.items():
            if n!='version.data':assert apk.read('assets/'+n)==b
        changed['lua.u'],proofs['lua']=patch_lua.build(apk.read('assets/lua.u'))
        proofs['loginBehavior']=test_login.run()
        print('Verified release login and removed developer Lua',flush=True)
        changed['setting.u'],plain,proofs['settings']=patch_settings.build(apk.read('assets/setting.u'))
        replacements['assets/setting_decrypted.u']=write('assets/setting_decrypted.u',plain)
        print('Verified rarity, card layout, lobby schedule, native MagicTb loader',flush=True)
        changed['npc/neptune_roster.u'],proofs['card'],crop=patch_card.build(apk.read('assets/npc/neptune_roster.u'),args.art)
        crop.save(out/'neptune-card-preview.png')
        for name in ('l2d/girl27/l2d01.u','l2d/girl27/l2d9103.u'):
            changed[name],proofs[name]=patch_model.build(apk.read('assets/'+name))
            print('Verified model parameter-only cap: '+name,flush=True)
        for abi in ('arm64-v8a','armeabi-v7a'):
            name='lib/'+abi+'/libil2cpp.so';body,p=patch_native.build(apk.read(name),abi)
            replacements[name]=write(name,body);proofs[name]=p
            print('Verified native developer removal: '+abi,flush=True)
        vfx=apk.read('assets/p_skill/neptune_note.u');assert sha(vfx)=='292efa63f877ae354768a974a9191b3387e547855acbe198fc1eec93f1feef8f'
        _,vfx_asset=patch_model.stage.stock.model_objects(vfx)
        proofs['runtimeVfxGuard']=validate_assetfile(vfx_asset)
        paired={name:write('assets/'+name,body) for name,body in changed.items()}
        replacements.update({'assets/'+n:p for n,p in paired.items()})
        indexes.ASSETS={}
        bin_index,proofs['apkBinaryIndex']=indexes.append_binary(apk.read('assets/version.data'),paired)
        json_index,proofs['apkJsonIndex']=indexes.append_json(apk.read('assets/version.zip'),paired)
        external_index,proofs['externalBinaryIndex']=indexes.append_binary(old_external['version.data'],paired)
        bin_index,proofs['apkCardRoute']=manifest_paths.binary(bin_index,'npc/neptune_roster.u',[patch_card.CARD])
        json_index,proofs['apkCardJsonRoute']=manifest_paths.compressed(json_index,'npc/neptune_roster.u',[patch_card.CARD])
        external_index,proofs['externalCardRoute']=manifest_paths.binary(external_index,'npc/neptune_roster.u',[patch_card.CARD])
        assert all(len(proofs[k]['addedAssetMappings'])==1 for k in ('apkCardRoute','apkCardJsonRoute','externalCardRoute'))
        replacements['assets/version.data']=write('assets/version.data',bin_index)
        replacements['assets/version.zip']=write('assets/version.zip',json_index)
        external_paths={**paired,'version.data':write('external/version.data',external_index)}
        # Changed cache members must be an explicit small subset of the current
        # paired cache; the data builder merges these into the complete stock set.
        assert set(changed)<=set(old_external)
        proofs['preservedBaselineResources']={n:sha(b) for n,b in old_external.items() if n not in set(changed)|{'version.data'}}
        proofs['cubismLibrariesExact']={abi:sha(apk.read('lib/'+abi+'/libLive2DCubismCore.so')) for abi in ('arm64-v8a','armeabi-v7a')}
    def record(p):
        body=p.read_bytes();return {'file':str(p.resolve()),'sha256':sha(body),'bytes':len(body),'crc32':zlib.crc32(body)}
    report={'schemaVersion':1,'sourceApkSha256':SOURCE_SHA,'sourceCacheSha256':CACHE_SHA,
        'account':'gcg-offline-player-v1','httpEndpoint':'http://127.0.0.1:28080','tcpGameplayGateway':31400,
        'apkReplacements':{n:record(p) for n,p in replacements.items()},
        'externalFiles':{n:record(p) for n,p in external_paths.items()},'proofs':proofs,
        'phonePlaytest':'pending','runtimeUnityRenderingClaimed':False}
    (out/'apk-overlay.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'overlay':str(out/'apk-overlay.json'),'sha256':sha((out/'apk-overlay.json').read_bytes()),'apkReplacements':len(replacements),'externalFiles':len(external_paths)}),flush=True)

if __name__=='__main__':main()
