"""Exercise the patched stock banner functions, not a second implementation."""
from pathlib import Path
from lupa.lua53 import LuaRuntime


def run_bundle(source):
    import asset_tools as w
    _, raw = w.unityfs(w.transform(source))
    _, objects = w.serialized_objects(raw)
    names = {'GachaCommon.lua', 'UI_GachaHistory.lua'}
    scripts = {o['name']: raw[o['script_start']:o['script_start']+o['script_length']]
               for o in objects if o.get('name') in names}
    assert set(scripts) == names
    return run(scripts)


def run(scripts):
    lua = LuaRuntime()
    lua.execute('GachaCommon={}; Gacha=GachaCommon; WeaponForge={}; UI={};')
    lua.execute(scripts['GachaCommon.lua'].decode('utf8'))
    lua.execute('''
        local now = 2000000000
        GetTime = function() return now end
        local permanent={nId=46,nStart=0,nEnd=1,offlinePermanent=true,JudgeType=0,nSort=3}
        GachaCommon.tbConf={[46]={permanent},[99]={{nId=99,nStart=0,nEnd=1,JudgeType=0}}}
        local all=GachaCommon:GetCurPools()
        assert(#all==1 and all[1]==permanent)
        assert(GachaCommon:OfflineCardStar({1,27,1,1})==4)
        assert(GachaCommon:OfflineCardStar({1,7,1,1})==1)
        assert(GachaCommon:OfflineCardStar({1,27,1,1},4)==4)
        assert(GachaCommon:OfflineCardStar({1,1,17,5})==4)
        local base={nId=1,nStart=1,nEnd=4000000000,JudgeType=0,nSort=1}
        GachaCommon.tbConf={[1]={base},[46]={permanent}}
        WeaponForge.tbConf={[1]={base}}
        UI.Call=function() end
        local manifest={revision=now-100,startsAt=now-100,endsAt=now+100,intervalDays=7,
            character={id=850,basePoolId=1,rows={
                {id=1,gdpl={1,27,1,1},rarity=4,rate=1,isPreview=true,upFlag=0,sort=1},
                {id=2,gdpl={1,2,8,4},rarity=4,rate=1,isPreview=true,upFlag=0,sort=2},
                {id=3,gdpl={1,3,2,2},rarity=2,rate=1,isPreview=false,upFlag=0,sort=3}}},
            weapon={id=850,basePoolId=1,rows={
                {id=1,gdpl={2,2,28,1},rarity=4,rate=1,isPreview=true,upFlag=0,sort=1}}}}
        GachaCommon:ApplyOfflineRotation(manifest)
        local pool=GachaCommon.tbConf[850][1]
        assert(pool.tbStar[4]==2 and pool.tbStar[2]==1 and pool.tbStar[1]==nil)
        assert(pool.tbAll[1].nRate==0.5 and pool.tbAll[2].nRate==0.5)
        assert(WeaponForge.tbConf[850][1].tbStar[4]==1)
        assert(GachaCommon.tbConf[46][1]==permanent)
    ''')
    for name,body in scripts.items():
        lua.execute('assert(load(...))',body.decode('utf8'))
    return {'actualStockLuaExecuted': True, 'railgunSurvivesTimeAndRotationRefresh': True,
            'unrelatedExpiredBannersHidden': True, 'neptuneLegendaryRateNormalized': True,
            'weaponAndStockRarityPreserved': True, 'allLuaSyntaxPassed': True}
