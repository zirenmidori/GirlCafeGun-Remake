"""Mock test of patch_gacha_skip on the real UI_GachaGet.lua.

run_script(stock) replays two card screens in Lua, on the stock script and on the patched one: a new card that
plays its cartoon story, then a card the player already owns. The patched script must show Skip-all after the
cartoon and when the next screen opens; the stock script must not (the test proves the bug and the fix).
run_bundle(built) reads UI_GachaGet.lua from a built lua.u and checks that it holds the fix.
Command: python test_gacha_skip.py <release APK or lua.u>
"""
from pathlib import Path
import sys

from lupa.lua53 import LuaRuntime

import patch_gacha_skip as g

HARNESS = r'''
active = { skipAll = true }
shown = 0
function go(key) return { SetActive = function(_, v) active[key] = v end } end
UI = {
  Register = function() local t = {}; UI.class = t; return t end,
  IsOpen = function() return false end, Close = function() end,
  Open = function(name, story, done) if name == 'UI_Cartoon' then cartoonDone = done end end,
}
CS = { emItemType = { CharacterCard = 1 } }
Game = { GachaCamera = {}, Map = { type = 'Gacha' }, Timer = { Add = function(_, f) f() end } }
GirlCommon = { CardValue = function() return 1 end }
GachaCommon = { GetStory = function() return 'Gacha/Gacha_girl0220.txt' end }
GameManager = { PlayTL = function() end }
'''

SCENARIO = r'''
local c = UI.class
local function panel() return { gameObject = go('panel') } end
c.pnlLive2D, c.pnlWeapon, c.pnlCard, c.pnlHCard = panel(), panel(), panel(), panel()
c.TipsText = {}
c.btnSkipAll = { gameObject = go('skipAll'),
  onClick = { RemoveAllListeners = function() end, AddListener = function() end } }
c.ModifyBackground = function() end
c.ShowCard = function() shown = shown + 1 end
local function card(owned)
  return { rItem = { D = 2, P = 20, L = 3, GetItemType = function() return 1 end }, bHasCard = owned }
end
c:OnOpen(1, card(false))
local duringCartoon = active.skipAll
cartoonDone()
local afterCartoon = active.skipAll
active.skipAll = false   -- the stock state after a cartoon, carried into the next screen
c:OnOpen(1, card(true))
return duringCartoon, afterCartoon, active.skipAll, shown
'''


def replay(script):
    lua = LuaRuntime()
    lua.execute(HARNESS)
    lua.execute(script.decode('utf8') if isinstance(script, bytes) else script)
    return tuple(lua.execute(SCENARIO))


def run_script(stock):
    stock_result = replay(stock)
    during, after, next_open, shown = replay(g.lua_script('UI_GachaGet.lua', stock))
    assert during is False, 'the cartoon itself must still hide Skip'
    assert after is True and next_open is True and shown == 2, (during, after, next_open, shown)
    assert stock_result[1] is False and stock_result[2] is False, stock_result
    return {'stockSkipAfterCartoon': stock_result[1], 'stockSkipOnNextOpen': stock_result[2],
            'patchedSkipAfterCartoon': after, 'patchedSkipOnNextOpen': next_open}


def script_from_bundle(bundle):
    import asset_tools
    _, raw = asset_tools.unityfs(asset_tools.transform(bundle))
    _, objects = asset_tools.serialized_objects(raw)
    obj = next(o for o in objects if o.get('name') == 'UI_GachaGet.lua')
    return raw[obj['script_start']:obj['script_start'] + obj['script_length']]


def run_bundle(built):
    script = script_from_bundle(built).decode('utf8')
    assert g.OPEN_NEW in script and g.CARTOON_NEW in script, 'UI_GachaGet.lua lacks the Skip fix'
    during, after, next_open, shown = replay(script)
    assert during is False and after is True and next_open is True and shown == 2
    return True


if __name__ == '__main__':
    import zipfile
    path = sys.argv[1]
    source = zipfile.ZipFile(path).read('assets/lua.u') if path.endswith('.apk') else Path(path).read_bytes()
    print(run_script(script_from_bundle(source)))
