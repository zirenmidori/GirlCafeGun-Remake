"""Execute the retained box/config UI and selector progress with native Lua."""
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'translation/tools/.deps'))
from lupa.lua53 import LuaRuntime
import asset_tools as w
import patch_lua
import patch_selectors


def function(source, start, following):
    at = source.index(start)
    return source[at:source.index(following, at + 1)]


def run():
    with zipfile.ZipFile(ROOT / 'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.apk') as apk:
        _, raw = w.unityfs(w.transform(apk.read('assets/lua.u')))
    _, objects = w.serialized_objects(raw)
    names = patch_selectors.LUA_NAMES | {'UI_ItemBox2.lua'}
    scripts = {}
    for obj in objects:
        if obj.get('name') not in names:
            continue
        body = raw[obj['script_start']:obj['script_start'] + obj['script_length']]
        scripts[obj['name']] = patch_lua.patch_script(obj['name'], body).decode('utf8')
    assert scripts.keys() == names
    lua = LuaRuntime()
    lua.execute('''
events = {closed=0, hidden=0, errors=0, rewards=0, cardAnimations=0, taskWrites=0}
ItemBox = {ItemBoxCfgPATH="Item/ItemBoxInfo.txt"}
GachaCommon = {OFFLINE_ROTATION_ID=850, GetStory=function() return nil end}
local function nothing() end
Game = {Map={isFight=false}, Blocking={Hide=function() events.hidden=events.hidden+1 end},
    MessageBox={Simple=function() events.errors=events.errors+1 end},
    ItemMgr={CreateItem=function(g,d,p,l) return {G=g,D=d,P=p,L=l} end},
    LuaUtils={CreateListObject=function()
        local list={Count=0}
        function list:Add(value) self[self.Count]=value;self.Count=self.Count+1 end
        return list
    end}}
UI = {IsOpen=function() return false end, Call=nothing,
    Close=function(name) if name=="UI_OpenBox" then events.closed=events.closed+1 end end,
    GetTopWindowClass=function() return {pRoot={SetActive=nothing}} end,
    OpenAsChild=function(name,awards)
        assert(name=="UI_RewardNormal" and #awards>0)
        events.rewards=events.rewards+1
    end,
    Open=function(name,_,data,done)
        if name=="UI_GachaGet" then
            events.cardAnimations=events.cardAnimations+1
            assert(data.rItem.D==27);done()
        end
    end}
function Parse2Item(text)
    local result={}
    for n in text:gmatch("%d+") do result[#result+1]=tonumber(n) end
    return result
end
local taskValues={}
me={GetTaskValue=function(_,group,task) assert(group==15);return taskValues[task] or 0 end}
function setTotal(task,total) taskValues[task]=total end
function SendCmd() events.taskWrites=events.taskWrites+1 end
function LoadTabFile() return boxRows end
tbClass={}
''')
    item = scripts['ItemBox.lua']
    lua.execute(function(item, 'function ItemBox:OnOpenBoxMO(', '\n--得到道具属性'))
    lua.globals().ItemBox.OnOpenBoxMO(lua.globals().ItemBox, lua.table_from({'nError':1}))
    events = lua.globals().events
    assert (events.closed,events.hidden,events.errors,events.rewards)==(1,1,1,0)
    lua.globals().ItemBox.OnOpenBoxMO(lua.globals().ItemBox,
        lua.table_from([lua.table_from([2,2,28,1,1])]))
    assert events.rewards == 1
    lua.globals().ItemBox.OnOpenBoxMO(lua.globals().ItemBox,
        lua.table_from([lua.table_from([1,27,1,1,1,False,False,False])]))
    assert events.cardAnimations == 1 and events.rewards == 2

    rows = []
    definitions = patch_selectors.load_catalog()
    for box in definitions:
        for gdpln in box['choices']:
            rows.append(lua.table_from({'boxId':str(box['boxId']),
                'GDPLN':'['+'-'.join(map(str,gdpln))+']','broadcast':'0',
                'obtainType':'Select','Weight':'1'}))
    lua.globals().boxRows = lua.table_from(rows)
    lua.execute(function(item,'function ItemBox:LoadTabsConfig()', '\nfunction ItemBox:GetBoxCfg('))
    lua.globals().ItemBox.LoadTabsConfig(lua.globals().ItemBox)
    ui_box = scripts['UI_ItemBox2.lua']
    lua.execute(function(ui_box,'function tbClass:_OnOpen2ScrollRc()', '\nfunction tbClass:ShowItemOfRc('))
    lua.execute('''
tbClass.RightReward2={gameObject={SetActive=function() end}}
tbClass.ScrollRc1={RefillCells=function() end}
tbClass._ShowRandom=function() end
''')
    for box in definitions:
        lua.globals().tbClass.boxInfo = lua.globals().ItemBox.tbBoxCfgList[box['boxId']]
        lua.globals().tbClass._OnOpen2ScrollRc(lua.globals().tbClass)
        choices = lua.globals().tbClass.tbSelect
        for i, expected in enumerate(box['choices'],1):
            choice = choices[i]
            assert [choice.G,choice.D,choice.P,choice.L,choice.N] == expected
            assert choice.idx == i

    common = scripts['GachaCommon.lua']
    lua.execute(common[common.index('-- Progress is authoritative task state;'):])
    at = common.index('function GachaCommon:OfflineCardStar(')
    lua.execute(common[at:common.index('\nend',at)+4])
    factory = lua.execute(function(common, 'local function BuildOfflinePool(',
        '\nfunction GachaCommon:ApplyOfflineRotation(') + '\nreturn BuildOfflinePool')
    catalog = lua.table_from({'tbConf':lua.table_from({1:lua.table_from([
        lua.table_from({'nStart':0,'sInfoDesc':'Original rates.'})])})})
    row = lua.table_from({'id':1,'gdpl':lua.table_from([1,1,1,4]),'rarity':4,
                         'rate':1,'isPreview':True,'upFlag':0,'sort':1})
    for every in (0,50,100):
        selector = lua.table_from({'every':every,'progressTask':11000})
        data = lua.table_from({'id':850,'basePoolId':1,'rows':lua.table_from([row]),
                               'selector':selector})
        manifest = lua.table_from({'revision':1,'startsAt':0,'endsAt':9999999999,
                                    'intervalDays':14})
        pool = factory(catalog,data,manifest,'Tactical Rotation',False)
        assert pool.offlineSelector.every == every
        if every:
            assert ('every %d rotation draws' % every) in pool.sInfoDesc
            assert lua.globals().GachaCommon.OfflineSelectorTime(lua.globals().GachaCommon,pool).startswith('14-day lineup')
        else:
            assert pool.sInfoDesc == 'Original rates.'
    for task in (11000,11001):
        for every in (50,100):
            selector = lua.table_from({'every':every,'progressTask':task})
            pool = lua.table_from({'offlineSelector':selector,'offlineRotationDays':7,
                                  'sDesc':'stock description','sTimeDesc':'stock time'})
            for total in (0,49,50,99,100,199,200,350):
                lua.globals().setTotal(task,total)
                result = lua.globals().GachaCommon.OfflineSelectorProgress(lua.globals().GachaCommon,pool)
                assert result == (total%every,every,total//every)
                desc = lua.globals().GachaCommon.OfflineSelectorDescription(lua.globals().GachaCommon,pool)
                assert desc == 'Selector %d/%d; earned %d' % (total%every,every,total//every)
            selector.every=0
            assert lua.globals().GachaCommon.OfflineSelectorProgress(lua.globals().GachaCommon,pool) is None
            assert lua.globals().GachaCommon.OfflineSelectorDescription(lua.globals().GachaCommon,pool)=='stock description'
    assert events.taskWrites == 0
    return {'actualRetainedBoxCallbackExecuted':True,'structuredErrorNeverOpensRewardScreen':True,
            'stockWeaponAndCharacterRewardFlowsRetained':True,
            'nativeSelectorUiPreservesAll52BoxChoiceOrdinals':True,
            'progressUsesSyncedTaskGroup15ForBothCategories':True,
            'configurable50And100MilestonesAndZeroDisableVerified':True,
            'openingUiDoesNotGrantOrWriteProgress':True}


if __name__ == '__main__':
    print(run())
