"""Run the dead-link edits, as patched, in a mocked UI runtime.

run() needs no client file: it patches synthetic scripts that hold only the anchor lines of the client, then runs
the patched functions with recording mocks. run_bundle() repeats the behavior steps on the five scripts inside a
patched lua.u (the anchors of the published client).
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(ROOT / 'translation/tools/.deps')]
from lupa.lua53 import LuaRuntime
import patch_offline_links as g

OLD_WIKI = 'https://girlcafegun.boom-app.wiki/'
NEW_WIKI = 'https://wiki.girl.cafe/'
# Settings > Other: Terms, Privacy, Support; then the bilibili pages that only the Chinese client shows.
HIDDEN = ('Content/List1/Grid/Btn1', 'Content/List1/Grid/Btn2', 'Content/List1/Grid/Btn7', 'Content/List1/Grid/Btn13',
          'Content/List1/Grid/Btn14', 'Content/Title2', 'Content/List2')
SURVEY = 'https://docs.google.com/forms/d/e/1FAIpQLSevCq76gs6OF2HooAP89RdtiaZ3gpyg0SjTWloMs00RjJESuA/viewform'
FUNCTIONS = {'EvaluateGuide.lua': 'function tbClass:CheckEvaluateTip(type,pEndCall)\n',
             'DropWay.lua': 'function DropWay:LoadTargetUI( target, tbParam )\n',
             'UI_User.lua': 'function tbClass:OnInit()\n',
             'UI_JPTip.lua': 'function tbClass:OnInit()\n'}
# Stand-ins: the anchor lines are stock text of the 0.1.3 client; everything else is a stand-in. CRLF on purpose.
SYNTHETIC = {name: text.replace('\n', '\r\n').encode('utf8') for name, text in {
    'Lib.lua': '''-- Synthetic stand-in for Lib.lua.
function LibGlobals() return P, pageKey, MOVED, CLOSED end
function Last()
\treturn 1
end''',
    'EvaluateGuide.lua': '''-- Synthetic stand-in for EvaluateGuide.lua.
EvaluateGuide = {}
local tbClass = EvaluateGuide;
function tbClass:CheckEvaluateTip(type,pEndCall)
\tif not self:CheckNeedEvaluate() then
\t\treturn
\tend
\tif self:GetIsGuideEnd() or self:CheckHasTypeEnd(type) then
\t\treturn false;
\tend
\tUI.Open('UI_Evaluate',type,pEndCall);
\tself:OnOpenGuide();
\treturn true;
end
function tbClass:CheckNeedEvaluate() return true end
function tbClass:GetIsGuideEnd() return false end
function tbClass:CheckHasTypeEnd() me:SetTaskValue(10, 2000, 1) return false end
function tbClass:OnOpenGuide() me:SetTaskValue(10, 2000, 2) end
''',
    'DropWay.lua': '''-- Synthetic stand-in for DropWay.lua.
DropWay = {}
function DropWay:LoadTargetUI( target, tbParam )
\tlocal bChangeMap = false;
\tif target == nil then return end
\tif string.find(target, "Scene_main_cafe") then
\t\tbChangeMap = true
\telseif string.find( target, "OpenUrl" ) then
\t\tlocal tb = Split( target, ";" );
\t\tGame.LuaUtils.OpenUrl(string.format(tb[2], Game.Player.me.id))
\telseif string.find(target, "Url") then
\t\tlocal tb = Split(target, ";");
\t\tif #tb > 2 then
\t\t\tUI.OpenAsChild("UI_OtherTipS", function()
\t\t\t\tGame.LuaUtils.OpenUrl( tb[2] );
\t\t\tend, function() end, Text(tb[3]), Text(tb[4]))\t
\t\telse
\t\t\tGame.LuaUtils.OpenUrl( tb[2] );
\t\tend
\tend
\treturn bChangeMap;
end
''',
    'UI_User.lua': '''-- Synthetic stand-in for the settings window script.
local tbClass = UI.Register('UI_User')
function tbClass:OnInit()
\t------------------------其他界面   Start-------------------------------------------
\t\tself:OnClickAndClear("Content/List1/Grid/Btn11", function()
\t\t\tUI.OpenAsChild("UI_OtherTipS", function()
\t\t\t\tU3D.Application.OpenURL("https://girlcafegun.boom-app.wiki/");
\t\t\tend, nil, UIText("UI_User.Btn13"), UIText("UI_OtherTips.WikiContent"))
\t\tend,self.ui.qita)
\tself.ui.qita:Find("Content/List1/Grid/Btn7").gameObject:SetActive(true)
\tself.ui.qita:Find("Content/List1/Grid/Btn13").gameObject:SetActive(true)
\tself.ui.qita:Find("Content/List1/Grid/Btn14").gameObject:SetActive(true)
\tself.ui.qita:Find("Content/Title2").gameObject:SetActive(true)
\tself.ui.qita:Find("Content/List2").gameObject:SetActive(true)
\t------------------------其他界面   End-------------------------------------------
end
''',
    'UI_JPTip.lua': '''-- Synthetic stand-in for UI_JPTip.lua.
local tbClass = UI.Register('UI_JPTip')
function tbClass:OnInit()
\tself.btnWiki.onClick:AddListener(function()
\t\tUI.Open("UI_OtherTipS", function()
\t\t\tU3D.Application.OpenURL("https://girlcafegun.boom-app.wiki/");
\t\tend, function() end, UIText("UI_User.Btn13"), UIText("UI_OtherTips.WikiContent"))
\tend)
end
''',
}.items()}

# OfflineLinks.Url: moved, closed, and kept addresses.
MOVED = [OLD_WIKI, OLD_WIKI.rstrip('/'), 'http://girlcafegun.boom-app.wiki/', 'HTTPS://GirlCafeGun.Boom-App.Wiki//']
CLOSED = [SURVEY, SURVEY + '/', SURVEY.replace('https://', 'http://')]
KEPT = ['https://wiki.girl.cafe/', 'https://girlcafegun.boom-app.wiki/page', 'https://girlcafegun.boom-app.wiki.example.org/',
        'https://docs.google.com/forms/', SURVEY + '?usp=1', 'https://gcg.xoyo.com', 'ftp://girlcafegun.boom-app.wiki/',
        'girlcafegun.boom-app.wiki/', 'https://', 'http:///', '', ' ' + OLD_WIKI]

MOCK = r'''
printed = {}
print = function(...)
  local line = {}
  for i = 1, select('#', ...) do line[i] = tostring((select(i, ...))) end
  line = table.concat(line, ' ')
  if line:sub(1, 7) == '[links]' then printed[#printed + 1] = line end
end
local function any()
  local t = {}
  return setmetatable(t, { __index = function(_, k) local v = any(); rawset(t, k, v); return v end,
    __call = function() return any() end })
end
log = {}
function record(...) local t = {...}; for i = 1, select('#', ...) do t[i] = tostring(t[i]) end; log[#log + 1] = table.concat(t, ' ') end
function reset() log, printed = {}, {} end
-- A confirm window: its OK button is pressed at once.
UI = { Open = function(name, ok, ...) record('UI.Open', name); if type(ok) == 'function' then ok() end end,
  OpenAsChild = function(name, ok, cancel, title, text) record('UI.OpenAsChild', name, title, text); ok() end }
windows = {}
UI.Register = function(name) windows[name] = {}; return windows[name] end
Game = { LuaUtils = { OpenUrl = function(url) record('OpenUrl', url) end }, Player = { me = { id = 4242 } } }
U3D = { Application = { OpenURL = function(url) record('OpenURL', url) end } }
me = { SetTaskValue = function(_, ...) record('SetTaskValue', ...) end }
U3D.PlayerPrefs = { SetString = function(...) record('PlayerPrefs.SetString', ...) end }
UIText, Text = function(k) return k end, function(k) return k end
function Split(s, sep)
  local out = {}
  for part in string.gmatch(s, '([^' .. sep .. ']+)') do out[#out + 1] = part end
  return out
end
-- A transform whose Find answers for the paths in have; SetActive calls are recorded.
function root(have)
  local r = {}
  function r:Find(path)
    if not have[path] then return nil end
    return { gameObject = { SetActive = function(_, on) record('SetActive', path, on) end } }
  end
  return r
end
-- A window function taken out of its script runs on a class of that name.
function define(name, chunk)
  tbClass = windows[name] or {}
  windows[name] = tbClass
  assert(load(chunk, name))()
  tbClass = nil
end
function joined() return table.concat(log, '|') end
'''


def rejected(name, text):
    try:
        g.lua_script(name, text.encode('utf8'))
    except AssertionError:
        return 1
    return 0


def check_injection():
    block, scripts = g.module_block(), {}
    assert set(SYNTHETIC) == g.LUA_NAMES
    for name, source in SYNTHETIC.items():
        plain = source.decode('utf8').replace('\r\n', '\n')
        once = g.lua_script(name, source)
        text = once.decode('utf8')
        assert once != plain.encode('utf8') and '\r' not in text
        # Idempotent, also on a CRLF copy of the patched script.
        assert g.lua_script(name, once) == once and g.lua_script(name, once.replace(b'\n', b'\r\n')) == once
        if name == 'Lib.lua':
            assert text.endswith(block) and text[:-len(block)].rstrip('\n') == plain.rstrip('\n')
            stale = text.replace(block, g.BEGIN + 'OfflineLinks = nil\n' + g.END)
            assert g.lua_script(name, stale.encode('utf8')) == once
            count = rejected(name, plain + '\nOfflineLinks = 1\n') + rejected(name, text.replace(g.END, ''))
            count += rejected(name, text + 'x = 1\n')  # the module must stay last
            assert count == 3, count
        else:
            edits = g.EDITS[name]
            back = text
            for old, new in edits:
                back = back.replace(new, old)
            assert back == plain, name  # nothing else changes
            count = 0
            for old, _ in edits:
                count += rejected(name, plain.replace(old, '')) + rejected(name, plain.replace(old, old + old))
            count += rejected(name, plain + 'OfflineLinks = 1\n')
            assert count == 2 * len(edits) + 1, (name, count)
        scripts[name] = once
    return scripts


def function_chunk(text, head):
    assert text.count(head) == 1, head
    start = text.index(head)
    end = text.find('\nfunction ', start)
    return text[start:end if end > 0 else len(text)]


def run(scripts=None, report=None):
    synthetic = scripts is None
    if synthetic:
        scripts = check_injection()
    texts = {}
    for name in sorted(g.LUA_NAMES):
        assert g.lua_script(name, scripts[name]) == scripts[name], name
        texts[name] = scripts[name].decode('utf8')
        LuaRuntime().execute('assert(load(...))', texts[name])
    block = g.module_block()
    assert texts['Lib.lua'].endswith(block)
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    lua.execute(block)
    url, reset, joined = lua.eval('OfflineLinks.Url'), lua.eval('reset'), lua.eval('joined')

    # 1. The choice of the address.
    for address in MOVED:
        assert url(address) == NEW_WIKI, address
    for address in CLOSED:
        assert url(address) is None, address
    for address in KEPT:
        assert url(address) == address, address
    assert url(None) is None and url(5) == 5
    assert lua.eval('#printed') == len(MOVED) + len(CLOSED)
    if report: report('ok OfflineLinks.Url: %d moved -> %s, %d closed -> nothing, %d others stay'
                      % (len(MOVED), NEW_WIKI, len(CLOSED), len(KEPT)))

    # 2. Banners and other Url targets (DropWay).
    lua.execute('DropWay = {}')
    lua.execute(function_chunk(texts['DropWay.lua'], FUNCTIONS['DropWay.lua']))
    jump = lua.eval('function(t) return DropWay:LoadTargetUI(t) end')
    cases = [
        # the wiki banner row of BannerConfig (Id 28 in the 0.1.3 table): confirm window, then the new wiki
        ('Url;%s;ui.UI_User.Btn13;ui.UI_OtherTips.WikiContent' % OLD_WIKI,
         'UI.OpenAsChild UI_OtherTipS ui.UI_User.Btn13 ui.UI_OtherTips.WikiContent|OpenUrl ' + NEW_WIKI),
        ('Url;%s' % OLD_WIKI, 'OpenUrl ' + NEW_WIKI),
        # the survey banner of the English release: no confirm window, nothing opens
        ('Url;%s' % SURVEY, ''),
        ('Url;%s;a;b' % SURVEY, ''),
        ('OpenUrl;%s' % SURVEY, ''),
        ('Url;https://example.org/', 'OpenUrl https://example.org/'),
        ('Url;https://example.org/;t;x', 'UI.OpenAsChild UI_OtherTipS t x|OpenUrl https://example.org/'),
        ('OpenUrl;https://example.org/?id=%s', 'OpenUrl https://example.org/?id=4242'),
    ]
    for target, want in cases:
        reset()
        assert jump(target) is False, target
        assert joined() == want, (target, joined(), want)
    if report: report('ok banners: wiki banner -> %s, survey banner opens nothing, other Url targets unchanged' % NEW_WIKI)

    # 3. The rate window: never opened, no task value or preference written, no end callback called twice.
    lua.execute('EvaluateGuide = {}')
    lua.globals().define('EvaluateGuide', function_chunk(texts['EvaluateGuide.lua'], FUNCTIONS['EvaluateGuide.lua']))
    lua.execute('''
      local cls = windows['EvaluateGuide']
      setmetatable(cls, { __index = function() return function() return true end end })
      EvaluateGuide = cls
      ends = 0
      function pvp() -- UI_PVPSuccess.lua:206-219
        local pEndCall = function() ends = ends + 1 end
        if not EvaluateGuide:CheckEvaluateTip(5,pEndCall) then pEndCall(); end
      end
      function gem() -- UI_Player.lua:60-67: the recharge window opens when no rate window did
        local opened = false
        if EvaluateGuide:CheckEvaluateTip(2) then return opened end
        return true
      end
    ''')
    for kind in range(1, 8):
        reset()
        assert lua.eval('EvaluateGuide:CheckEvaluateTip(%d, function() record("end") end)' % kind) is False
        assert lua.eval('EvaluateGuide:CheckEvaluateTip(%d)' % kind) is False
        assert joined() == '', joined()
    reset()
    lua.eval('pvp()')
    assert lua.eval('ends') == 1 and joined() == ''
    assert lua.eval('gem()') is True
    if report: report('ok rate window: CheckEvaluateTip is false for types 1-7, opens nothing, writes nothing; PVP end callback runs once')

    # 4. Settings > Other: Terms, Privacy and Support hidden; the wiki button opens the new wiki.
    user = texts['UI_User.lua']
    call = '\tOfflineLinks.HideButtons(self.ui.qita)\n'
    assert user.count(call) == 1 and user.index(call) < user.index(g.OTHER_END)
    for path in HIDDEN:
        # Stock code that shows the button runs before the call, never after it.
        shown = [i for i in range(len(user)) if user.startswith(path, i)]
        assert all(i < user.index(call) for i in shown), path
    hide = lua.eval('function(paths) local have = {}; for _, p in ipairs(paths) do have[p] = true end; return OfflineLinks.HideButtons(root(have)) end')
    reset()
    assert list(lua.eval('OfflineLinks.HIDDEN').values()) == list(HIDDEN)
    assert hide(lua.table(*HIDDEN, 'Content/List1/Grid/Btn5')) == len(HIDDEN)
    assert joined() == '|'.join('SetActive %s false' % path for path in HIDDEN), joined()
    reset()
    assert hide(lua.table('Content/List1/Grid/Btn7')) == 1 and joined() == 'SetActive Content/List1/Grid/Btn7 false'
    assert lua.eval('OfflineLinks.HideButtons(nil)') == 0
    for name in ('UI_User.lua', 'UI_JPTip.lua'):
        line = [l for l in texts[name].split('\n') if 'girlcafegun.boom-app.wiki' in l]
        assert len(line) == 1 and 'OfflineLinks.Url(' in line[0], (name, line)
        reset()
        lua.execute(line[0].strip())
        assert joined() == 'OpenURL ' + NEW_WIKI, (name, joined())
    if report: report('ok settings: %d buttons and rows hidden after the stock code that shows them; wiki buttons open %s'
                      % (len(HIDDEN), NEW_WIKI))

    if synthetic:
        # The module's locals do not leak into Lib.lua; OfflineLinks is a global.
        whole = LuaRuntime(unpack_returned_tuples=True)
        whole.execute(MOCK)
        whole.execute(texts['Lib.lua'])
        assert whole.eval('LibGlobals()') == (None, None, None, None) and whole.eval('type(OfflineLinks.Url)') == 'function'
        if report: report('ok whole Lib.lua: the locals of the module do not leak, OfflineLinks is a global')
    return {'syntheticSources': synthetic, 'addressesChecked': len(MOVED + CLOSED + KEPT), 'bannerTargetsChecked': len(cases),
            'rateWindowNeverOpens': True, 'settingsButtonsHidden': [path.rsplit('/', 1)[1] for path in HIDDEN], 'wikiOpens': NEW_WIKI,
            'eachAnchorRequiredExactlyOnce': synthetic, 'patchIdempotent': True, 'patchedLuaSyntaxPassed': True}


def run_bundle(source):
    import asset_tools as w
    _, raw = w.unityfs(w.transform(source))
    _, objects = w.serialized_objects(raw)
    scripts = {o['name']: raw[o['script_start']:o['script_start'] + o['script_length']]
               for o in objects if o.get('name') in g.LUA_NAMES}
    assert set(scripts) == g.LUA_NAMES, sorted(g.LUA_NAMES - set(scripts))
    return run(scripts)


if __name__ == '__main__':
    print(run(report=print))
