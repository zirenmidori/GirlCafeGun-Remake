"""Run the retained full-card UI branch with stock and Neptune card metadata."""
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'translation/tools/.deps'))
from lupa.lua53 import LuaRuntime
import asset_tools
from patch_card_display import FIELDS


def run():
    with zipfile.ZipFile(ROOT / 'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.apk') as apk:
        _, raw = asset_tools.unityfs(asset_tools.transform(apk.read('assets/lua.u')))
    _, objects = asset_tools.serialized_objects(raw)
    obj = next(obj for obj in objects if obj.get('name') == 'UI_CardMainDetail.lua')
    script = raw[obj['script_start']:obj['script_start'] + obj['script_length']]
    script = script.decode('utf8').replace('\r\n', '\n')
    start = script.index('function view:OnOpen(')
    end = script.index('\nfunction ', start + 1)
    on_open = script[start:end]
    lua = LuaRuntime()
    lua.execute('''
view = {}
local function nothing() end
UI = { Open=nothing, Call=nothing, GetClass=function() return {Black=nothing} end }
CardCommon = { GetRefitCardL2d=function() return nil end }
local screenType = 0
U3D = {
    Vector2=function(x,y) return {x=x,y=y} end,
    Vector3=function(x,y,z) return {x=x,y=y,z=z} end,
    Quaternion={identity={x=0,y=0,z=0}, Euler=function(v) return v end},
    RectTransform={Axis={Horizontal=0,Vertical=1}},
    Screen={width=1920,height=1080},
}
CS = {Game={Utils={GetScreenRateType=function() return screenType end,
                  EnumToInt=function(v) return v end}}}
Game = {Utils={SetRawImage=function(target,path) target.loadedPath=path end,
               SetDontPlayL2dVoice=nothing}}
local function rectangle()
    local rect = {rect={width=1,height=1}, sizeDelta={}, localScale={}, localRotation={}}
    function rect:SetSizeWithCurrentAnchors(axis,value)
        if axis==0 then self.rect.width=value else self.rect.height=value end
    end
    rect.gameObject={GetComponent=function() return rect end}
    return rect
end
function prepare(kind,width,height)
    screenType=kind;U3D.Screen.width=width;U3D.Screen.height=height
    local rect=rectangle()
    view.imgBG=rect;view.rectTrans=rect
    view.btnPanel={};view.blackBorder={SetActive=nothing}
    view.canvasScaler={referenceResolution={x=1920,y=1080}}
    view.CleanLive2D=nothing
    view.IsSpecialCard=function() return false end
    return rect
end
''')
    lua.execute(on_open)
    for screen_type, width, height in [(0,1920,1080), (0,2340,1080), (3,1440,1080)]:
        rect = lua.globals().prepare(screen_type,width,height)
        info = lua.table_from({'TemplateInfo': lua.table_from(FIELDS)})
        lua.globals().view.OnOpen(lua.globals().view,info,None,False)
        assert rect.loadedPath == FIELDS['PicCard']
        assert (rect.rect.width,rect.rect.height) == (1920,1080)
        assert rect.localRotation.z == 0
    # Preserve and expose the old portrait path, which quarter-turns an upright
    # portrait. The original stock UI itself is not patched for this repair.
    rect = lua.globals().prepare(0,1920,1080)
    old = lua.table_from({'TemplateInfo': lua.table_from({
        'PicCard':'Npc/card_neptune_release.png','CardShowType':1,'L2dCardId':''})})
    lua.globals().view.OnOpen(lua.globals().view,old,None,False)
    assert rect.localRotation.z == 90
    return {'actualRetainedFullCardOnOpenExecuted':True,
            'neptuneLandscapeNoQuarterTurnAtThreeAspectRatios':True,
            'originalPortraitQuarterTurnReproduced':True,
            'stockUiCodeUnmodified':True}


if __name__ == '__main__':
    print(run())
