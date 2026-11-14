"""Run the patched Load2DBG of the login screen in a mocked UI runtime.

run() needs no client file. It passes a synthetic UI_Login.lua through patch_lua.patch_script, so the release
login edits and the title patch are applied in the order of the build, and then plays login screens with a
seeded random source. Only the anchor lines of the two patches come from the client.
run_bundle() repeats the behavior steps on the function inside a patched lua.u.
"""
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(ROOT / 'translation/tools/.deps')]
from lupa.lua53 import LuaRuntime
import patch_title as g

NAME = 'UI_Login.lua'
SEED, CALLS = 20261114, 1000
MARKER = '-- Local server settings. Appended to the exact supplied UI_Login TextAsset.\n'
# The lines that patch_lua.py and patch_title.py look for are stock text; everything else is a stand-in.
# CRLF is deliberate: the client stores its scripts that way.
SYNTHETIC = ('''-- Synthetic stand-in for the login screen script.
local tbClass = UI.Register('UI_Login');
local bLoginWait, bVerify, bCheckUpdate = false, false, false
function tbClass:OnInit()
\tself.btnSwitch.onClick:AddListener(function()
\t\tself:OpenSelectZone()
\tend);
\tif Game.Utils.TryOpenGM() and not Game.GM.Get() then \n\t\tGM:LoadUI(); \n\t\tGM.view:Register() \n\tend
\tself:Load2DBG()
end
function tbClass:IsUS()
\treturn Game.Localization.Lang == Game.LangType.en_US;
end
function tbClass:Connect()
\tif not Game.Login.IsNetworkReachability() then
\t\treturn
\tend
end
function tbClass:Verify()
\tif self:UseSDK() then
\t\tself.sAccount = 'sdk'
\tend
\tbVerify = false;
end
function tbClass:Load2DBG()
\tif self:IsUS() then \n\t\tself.ImgLogoRect.anchoredPosition = U3D.Vector2(1, 2); \n\t\tself.PnlBGEffectParent1.gameObject:SetActive(true)
\t\tself.PnlBGEffectParent2.gameObject:SetActive(true)
\t\tself.PnlBGEffectParent3.gameObject:SetActive(true)

\t\tself:FindObject("PnlBGEffect/eftParent4"):SetActive(false);
\t\tself:FindObject("PnlBGEffect/Image1"):SetActive(true);
\t\tself:FindObject("PnlBGEffect/Image2"):SetActive(true);
\t\tself:FindObject("PnlBGEffect/Image3"):SetActive(false);
\t\treturn;
\tend

\tif Game.Localization.Lang == Game.LangType.ko_KR then return end
\t-- local obj = self:Find("Spine").gameObject;
end
''' + MARKER + '''tbClass.suppliedTail = true
''').replace('\n', '\r\n').encode('utf8')

MOCK = r'''
events = { prepared = 0, randomReads = 0 }
local function object(active)
  local o = { active = active }
  function o:SetActive(v) assert(type(v) == 'boolean'); self.active = v end
  return o
end
local function button()
  local event = {}
  function event:RemoveAllListeners() self.fn = nil end
  function event:AddListener(fn) self.fn = fn end
  return { gameObject = object(true), onClick = event }
end
local randomMode, currentRoll, clock = 'value', 0, 0
local Random = setmetatable({}, { __index = function(_, key)
  assert(key == 'value', key)
  events.randomReads = events.randomReads + 1
  if randomMode == 'error' then error('Random is not available') end
  if randomMode == 'text' then return 'n/a' end
  return currentRoll
end })
U3D = { Vector2 = function(x, y) return { x = x, y = y } end,
  AndroidJavaClass = function() return { CallStatic = function(_, method)
    if method == 'prepareAccount' then events.prepared = events.prepared + 1 end end } end }
os.time = function() return clock end
GameManager = {}
Game = { Localization = { Lang = 'en_US' }, LangType = { en_US = 'en_US', ko_KR = 'ko_KR' },
  Utils = { TryOpenGM = function() return false end } }
tbClass = {}
UI = { Register = function(name) assert(name == 'UI_Login'); return tbClass end }
-- UI_Default.FindObject returns nothing when the path is absent.
function tbClass:FindObject(path) return self.objects[path] end
function tbClass:GetComponent() return {} end
function tbClass:Find() return { gameObject = object(true) } end

-- A login screen as the prefab loads it: the sky objects are on, the hall objects are off.
local function screen(variant)
  local s = setmetatable({ ImgLogoRect = {}, objects = {
    ['PnlBGEffect/Image1'] = object(false), ['PnlBGEffect/Image2'] = object(false),
    ['PnlBGEffect/Image3'] = object(true), ['PnlBGEffect/eftParent4'] = object(true),
    Spine = object(variant ~= 'spineOff') } }, { __index = tbClass })
  if variant == 'noSpine' then s.objects.Spine = nil end
  for i = 1, 3 do s['PnlBGEffectParent' .. i] = { gameObject = object(false) } end
  s.btnSwitch, s.btnMenu = button(), button()
  s.pnlDev, s.serverObj = { gameObject = object(true) }, { gameObject = object(true) }
  return s
end
local function describe(s)
  local o = s.objects
  local image1, image2, image3 = o['PnlBGEffect/Image1'].active, o['PnlBGEffect/Image2'].active, o['PnlBGEffect/Image3'].active
  local sky4, logo, effects = o['PnlBGEffect/eftParent4'].active, s.ImgLogoRect.anchoredPosition ~= nil, 0
  for i = 1, 3 do if s['PnlBGEffectParent' .. i].gameObject.active then effects = effects + 1 end end
  local title = 'mixed'
  if image1 and image2 and not image3 and not sky4 and effects == 3 and logo then title = 'hall' end
  if not image1 and not image2 and image3 and sky4 and effects == 0 and not logo then title = 'sky' end
  return title, o.Spine == nil and 'absent' or o.Spine.active and 'on' or 'off'
end
local function set(mode, roll, time)
  randomMode, currentRoll, clock = mode, roll, time
  U3D.Random = mode ~= 'absent' and Random or nil
  -- The language must not choose the title any more.
  tbClass.IsUS = function() error('IsUS was asked') end
end
function play(variant, mode, roll, time)
  set(mode, roll, time)
  local s = screen(variant)
  local ok, err = pcall(s.Load2DBG, s)
  if not ok then return 'raised: ' .. tostring(err), '' end
  return describe(s)
end
-- The whole patched script: release OnInit, stock OnInit, Load2DBG, then the release buttons.
function open(variant, roll)
  set('value', roll, 0)
  local s = screen(variant)
  s:OnInit()
  local title, spine = describe(s)
  return title, spine, s.btnMenu.gameObject.active and not s.btnSwitch.gameObject.active
    and not s.serverObj.gameObject.active and s.btnMenu.onClick.fn ~= nil
end
'''


def release_login_only(source):
    """patch_lua.patch_script with the title hook switched off."""
    import patch_lua
    names, g.LUA_NAMES = g.LUA_NAMES, set()
    try:
        return patch_lua.patch_script(NAME, source)
    finally:
        g.LUA_NAMES = names


def rejected(text):
    try:
        g.lua_script(NAME, text.encode('utf8'))
    except AssertionError:
        return 1
    return 0


def check_injection():
    import patch_lua
    login = release_login_only(SYNTHETIC)
    once = patch_lua.patch_script(NAME, SYNTHETIC)
    # The build order (release login, then title) and the hook on its own give the same script.
    assert once == g.lua_script(NAME, login) and once != login
    # Title first and release login second ends in the same script: the hook then only refreshes its block.
    assert patch_lua.patch_script(NAME, g.lua_script(NAME, SYNTHETIC)) == once
    assert g.lua_script(NAME, once) == once and g.lua_script(NAME, once.replace(b'\n', b'\r\n')) == once
    text, plain = once.decode('utf8'), login.decode('utf8')
    block = g.block()
    assert '\r' not in text and text.count(block) == 1
    assert g.HEAD + block + g.TEST + '\t\tself.ImgLogoRect.anchoredPosition = U3D.Vector2(1, 2); \n' in text
    # Nothing else changes: without the block and with the stock test the release login script is back.
    assert text.replace(block, '').replace(g.TEST, g.STOCK_TEST) == plain
    # Both patches are in the result: the release edits, the appended release file, no supplied tail.
    release = Path(__file__).with_name('release_login.lua').read_text(encoding='utf8')
    assert text.endswith('\n' + release) and 'suppliedTail' not in text and MARKER not in text
    assert 'not self:IsReleaseLocalGateway() and not Game.Login.IsNetworkReachability()' in text
    assert text.index(g.END) < text.index(release)
    # A stale block between the markers is replaced; the test line is not edited twice.
    stale = text.replace(block, g.BEGIN + '\tlocal useHall = true\n' + g.END)
    assert g.lua_script(NAME, stale.encode('utf8')) == once
    count = 0
    for anchor in (g.HEAD + g.STOCK_TEST,) + g.HALL_LINES + (g.CALL,):
        count += rejected(plain.replace(anchor, '')) + rejected(plain.replace(anchor, anchor + anchor))
    assert count == 12, count
    # The hall lines must be inside the branch, in the stock order.
    moved = plain.replace(g.HALL_LINES[3], '') + g.HALL_LINES[3]
    swapped = plain.replace(g.HALL_LINES[1], '').replace(g.HALL_LINES[0], g.HALL_LINES[1] + g.HALL_LINES[0])
    # A stock function that already uses one of the new local names is not patched.
    shadowed = plain.replace('\t\treturn;\n', '\t\tspine = 1\n\t\treturn;\n')
    half = text.replace(g.END, '')
    assert rejected(moved) + rejected(swapped) + rejected(shadowed) + rejected(half) == 4
    assert g.lua_script('Other.lua', SYNTHETIC) == SYNTHETIC.replace(b'\r\n', b'\n')
    return once


def check_chance(stock):
    """HALL_CHANCE 0 and 1 give one title only, also at the ends of the random range."""
    saved = g.HALL_CHANCE
    try:
        for chance, title in ((0, 'sky'), (1, 'hall')):
            g.HALL_CHANCE = chance
            lua = runtime(g.function_text(g.lua_script(NAME, stock).decode('utf8')))
            for roll in (0.0, 0.25, 0.75, 1.0):
                assert lua.globals().play('', 'value', roll, 0)[0] == title, (chance, roll)
        for bad in (2, -0.5, '0.5', None):
            g.HALL_CHANCE = bad
            try:
                g.block()
            except AssertionError:
                continue
            raise AssertionError(bad)
    finally:
        g.HALL_CHANCE = saved


def runtime(chunk):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    lua.execute(chunk)
    return lua


def run(script=None, report=None):
    synthetic = script is None
    if synthetic:
        script = check_injection()
        check_chance(release_login_only(SYNTHETIC))
    else:
        assert g.lua_script(NAME, script) == script
    text = script.decode('utf8')
    assert text.count(g.block()) == 1
    LuaRuntime().execute('assert(load(...))', text)
    # A complete stock script cannot run in the mock, so a bundle contributes its function only.
    function = g.function_text(text)
    lua = runtime(function)
    play = lua.globals().play
    source, counts = random.Random(SEED), {}
    for variant in ('', 'spineOff', 'noSpine'):
        counts[variant] = {'hall': 0, 'sky': 0}
        for _ in range(CALLS):
            roll = source.random()
            title, spine = play(variant, 'value', roll, 0)
            want = 'hall' if roll < g.HALL_CHANCE else 'sky'
            # "Spine" is on with the sky title and off with the hall title, whatever the prefab loaded.
            want_spine = 'absent' if variant == 'noSpine' else 'on' if want == 'sky' else 'off'
            assert (title, spine) == (want, want_spine), (variant, roll, title, spine)
            counts[variant][title] += 1
        assert min(counts[variant].values()) > CALLS // 4, counts
        if report: report('ok %-8s %d screens -> hall %d, sky %d' % (
            variant or 'spineOn', CALLS, counts[variant]['hall'], counts[variant]['sky']))
    assert lua.eval('events.randomReads') == 3 * CALLS
    # The ends of the range and the middle.
    assert [play('', 'value', r, 0)[0] for r in (0.0, 0.4999, 0.5, 1.0)] == ['hall', 'hall', 'sky', 'sky']
    # No usable UnityEngine.Random: the clock chooses, and the screen still opens.
    for mode in ('absent', 'error', 'text'):
        got = [play('', mode, 0.0, t) for t in (1763100010, 1763100049, 1763100050, 1763100099)]
        assert got == [('hall', 'off'), ('hall', 'off'), ('sky', 'on'), ('sky', 'on')], (mode, got)
        if report: report('ok random source %-6s -> clock fallback: %s' % (mode, ' '.join(t for t, _ in got)))
    opened = None
    if synthetic:
        # The whole script: the release OnInit still runs around the stock one, and the title is chosen in it.
        lua = runtime(text)
        opened = [lua.globals().open('', r) for r in (0.1, 0.9)]
        assert opened == [('hall', 'off', True), ('sky', 'on', True)], opened
        assert lua.eval('events.prepared') == 2 and lua.eval('GameManager.gcgEmbeddedPlayerAccount') == 'gcg-offline-player-v1'
        if report: report('ok release OnInit + stock OnInit + Load2DBG: %s' % (opened,))
    return {'titleChosenInMockRuntime': True, 'syntheticLoginSource': synthetic, 'screensPerPrefabState': CALLS,
            'hallAndSkyBothShown': {k or 'spineOn': v for k, v in counts.items()},
            'spineOnlyWithSkyTitle': True, 'screenWithoutSpineOpens': True,
            'clockFallbackWithoutUnityRandom': True, 'eachAnchorRequiredExactlyOnce': True,
            'patchIdempotent': True, 'releaseLoginPatchAppliedFirst': synthetic,
            'releaseInitRunsAroundTitle': bool(opened), 'patchedLuaSyntaxPassed': True}


def run_bundle(source):
    import asset_tools as w
    _, raw = w.unityfs(w.transform(source))
    _, objects = w.serialized_objects(raw)
    script, = [raw[o['script_start']:o['script_start'] + o['script_length']]
               for o in objects if o.get('name') == NAME]
    return run(script)


if __name__ == '__main__':
    print(run(report=print))
