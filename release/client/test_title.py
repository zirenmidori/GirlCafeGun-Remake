"""Run the title screens, as patched into the login script, in a mocked UI runtime.

run() needs no client file. It passes a synthetic UI_Login.lua through patch_lua.patch_script, so the release
login edits and the title patch are applied in the order of the build. Then it opens login screens in mocked
clients that hold all, some or none of the extra art, with a seeded random source, and compares each screen
with a second implementation of the choice in this file. Only the anchor lines of the two patches come from
the client. run_bundle() repeats the behavior steps on the module and the function inside a patched lua.u.
"""
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(ROOT / 'translation/tools/.deps')]
from lupa.lua53 import LuaRuntime
import patch_title as g

NAME = 'UI_Login.lua'
SEED, SCREENS = 20261114, 400
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
function tbClass:BackgroundAdapter()
\tevents.adapted = events.adapted + 1
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
-- Names that the module uses as locals must still resolve to globals here.
function tbClass:Globals() return P, IMAGE, roll, alive, parts, scene, pick, log end
''' + MARKER + '''tbClass.suppliedTail = true
''').replace('\n', '\r\n').encode('utf8')

# The extra art of the titles, and the clients of the steps below.
ART = {'snow': ('BG/bg_login03.png', 1), 'shards': ('BG/bg_login05.png', 3)}
ALL = "textures = { ['BG/bg_login03.png'] = true, ['BG/bg_login05.png'] = true }, suits = { true, true, true }"
NO_SUIT_1 = "textures = { ['BG/bg_login03.png'] = true, ['BG/bg_login05.png'] = true }, suits = { false, true, true }"
FULL = {'hall', 'sky', 'snow', 'shards'}
CLIENTS = [
    # label, mocked client, titles it can draw
    ('all art, Spine loads on', ALL, FULL),
    ('all art, Spine loads off', ALL + ", spine = 'off'", FULL),
    ('all art, stock background call does nothing', ALL + ", helper = 'ignores'", FULL),
    ('all art, stock background call raises', ALL + ", helper = 'raises'", FULL),
    ('no snow animation: Load raises', NO_SUIT_1 + ", missing = 'raise'", FULL - {'snow'}),
    ('no snow animation: old model destroyed', NO_SUIT_1 + ", missing = 'destroy'", FULL - {'snow'}),
    ('no snow animation: old model stays', NO_SUIT_1 + ", missing = 'keep'", FULL - {'snow'}),
    ('no snow animation: model field cleared', NO_SUIT_1 + ", missing = 'clear'", FULL - {'snow'}),
    # The GirlCafeGun-Remake 0.1.3 client on a phone: Load() does nothing while a model stands.
    ('all art, Load keeps a standing model', ALL + ", guard = true", FULL),
    ('no snow animation, Load keeps a standing model', NO_SUIT_1 + ", guard = true", FULL - {'snow'}),
    ('no shards texture', "textures = { ['BG/bg_login03.png'] = true }, suits = { true, true, true }", FULL - {'shards'}),
    ('no extra art', "textures = {}, suits = { false, true, false }", {'hall', 'sky'}),
    ('texture loader raises', ALL + ", loader = 'raises'", {'hall', 'sky'}),
    ('texture loader returns a destroyed object', ALL + ", loader = 'dead'", {'hall', 'sky'}),
    ('no texture loader', ALL + ", loader = 'absent'", {'hall', 'sky'}),
    ('prefab without Spine', ALL + ", spine = 'none'", {'hall', 'sky'}),
    ('Spine without a RectTransform', ALL + ", rect = false", FULL),
    # Its picture cannot be read, so no title of the table is known to be its own: the scene joins as one more.
    ('prefab without a RawImage on Image3', ALL + ", image = false", {'hall', 'prefab'}),
    ('prefab with another picture, no sky texture', ALL + ", picture = 'bg_login02'", FULL - {'sky'} | {'prefab'}),
]

MOCK = r'''
events, world, printed = {}, {}, {}
print = function(...) printed[#printed + 1] = table.concat({ ... }, ' ') end
local function unity(name)
  local o = { name = name, destroyed = false }
  o.gameObject = o
  function o:Equals(other) return other == nil and self.destroyed end
  return o
end
local function object(active)
  local o = { activeSelf = active }
  function o:SetActive(v) assert(type(v) == 'boolean'); self.activeSelf = v end
  return o
end
local function button()
  local event = {}
  function event:RemoveAllListeners() self.fn = nil end
  function event:AddListener(fn) self.fn = fn end
  return { gameObject = object(true), onClick = event }
end
local rolls, clock, textures = {}, 0, {}
local Random = setmetatable({}, { __index = function(_, key)
  assert(key == 'value', key)
  events.randomReads = events.randomReads + 1
  if world.random == 'error' then error('Random is not available') end
  if world.random == 'text' then return 'n/a' end
  return table.remove(rolls, 1)
end })
U3D = { Vector2 = function(x, y) return { x = x, y = y } end,
  Object = { DestroyImmediate = function(o) o.destroyed = true end },
  AndroidJavaClass = function() return { CallStatic = function(_, method)
    if method == 'prepareAccount' then events.prepared = events.prepared + 1 end end } end }
os.time = function() return clock end
GameManager = {}
local function texture(path)
  local name = path:match('([^/]+)%.png$')
  textures[path] = textures[path] or unity(name)
  return textures[path]
end
local LuaUtils = { LoadTexture2D = function(path)
  events.textureLoads = events.textureLoads + 1
  if world.loader == 'raises' then error('no such asset') end
  if world.loader == 'dead' then
    local gone = unity(path)
    gone.destroyed = true
    return gone
  end
  if world.textures[path] then return texture(path) end
end }
local current
Game = { Localization = { Lang = 'en_US' }, LangType = { en_US = 'en_US', ko_KR = 'ko_KR' },
  Utils = { TryOpenGM = function() return false end,
    SetAndModifyBackground = function(root, path, asset, ratio)
      assert(root == current.pRoot and path == 'PnlBGEffect/Image3')
      events.background = { asset = asset, ratio = ratio }
      if world.helper == 'raises' then error('background call failed') end
      if world.helper ~= 'ignores' then current.raw.texture = texture(asset) end
    end } }
tbClass = {}
UI = { Register = function(name) assert(name == 'UI_Login'); return tbClass end }
-- UI_Default: Find-based lookups return nothing when the path is absent.
function tbClass:FindObject(path) return self.objects[path] end
function tbClass:GetComponent(kind, path)
  if kind == 'RawImage' then
    assert(path == 'PnlBGEffect/Image3')
    if world.image == 'raises' then error('lookup failed') end
    return world.image ~= false and self.raw or nil
  end
  return {}
end
function tbClass:Find() return { gameObject = object(true) } end
function tbClass:BackgroundAdapter() events.adapted = events.adapted + 1 end

-- ShowConcertModel: Load puts a new model object in "spine" for the suit, when the client has that suit.
local function concert()
  local m = { GirlId = 1002, SuitId = 2, Scale = 133, AutoLoad = true }
  function m:Load()
    events.modelLoads = events.modelLoads + 1
    if world.guard and self.spine and not self.spine.destroyed then return end
    if world.suits[self.SuitId] then
      if self.spine then self.spine.destroyed = true end
      self.spine = unity('girl1002_2da0' .. self.SuitId)
      self.spine.suit, self.spine.scale = self.SuitId, self.Scale
      self.playing = nil
    elseif world.missing == 'raise' then error('no model for suit ' .. self.SuitId)
    elseif world.missing == 'destroy' then if self.spine then self.spine.destroyed = true end
    elseif world.missing == 'clear' then
      if self.spine then self.spine.destroyed = true end
      self.spine = nil
    end
  end
  function m:Play(name) self.playing = name end
  return m
end
-- A login screen as the prefab loads it: the scene objects are on, the hall objects are off.
local function screen()
  local s = setmetatable({ ImgLogoRect = {}, pRoot = {}, raw = { texture = unity(world.picture or 'bg_login04') }, objects = {
    ['PnlBGEffect/Image1'] = object(false), ['PnlBGEffect/Image2'] = object(false),
    ['PnlBGEffect/Image3'] = object(true), ['PnlBGEffect/eftParent4'] = object(true) } },
    { __index = tbClass })
  if world.spine ~= 'none' then
    local spine, model, awake = object(false), concert(), false
    local rect = { anchoredPosition = U3D.Vector2(-15.5, -106.76) }
    function spine:GetComponent(kind)
      if kind == 'ShowConcertModel' then return model end
      if kind == 'RectTransform' and world.rect ~= false then return rect end
    end
    function spine:SetActive(v)
      self.activeSelf = v
      -- Awake runs once, when the object is first active, and loads the suit that is set then.
      if v and not awake then awake = true; model:Load() end
    end
    if world.spine ~= 'off' then spine:SetActive(true) end
    s.objects.Spine, s.model, s.rect = spine, model, rect
  end
  for i = 1, 3 do s['PnlBGEffectParent' .. i] = { gameObject = object(false) } end
  s.btnSwitch, s.btnMenu = button(), button()
  s.pnlDev, s.serverObj = { gameObject = object(true) }, { gameObject = object(true) }
  return s
end

local HOME = { -15.5, -106.76 }
local SCENES = { bg_login02 = { 'plaza', 2, nil, true, nil, 133, HOME }, bg_login04 = { 'sky', 2, nil, true, nil, 133, HOME },
  bg_login03 = { 'snow', 1, 'idle', false, 4 / 3, 133, { -50.5, -42.5 }, { 300, 212 } },
  bg_login05 = { 'shards', 3, 'Mgirl09_stand', false, 2, 83, { 0, 0 }, { 300, 212 } } }
-- The title on the screen, or what is wrong with the screen.
local function describe(s)
  local o, m = s.objects, s.model
  local image1, image2, image3 = o['PnlBGEffect/Image1'].activeSelf, o['PnlBGEffect/Image2'].activeSelf, o['PnlBGEffect/Image3'].activeSelf
  local petals, at, effects = o['PnlBGEffect/eftParent4'].activeSelf, s.ImgLogoRect.anchoredPosition, 0
  local logo = at ~= nil and ((at.x == 1 and at.y == 2) or (at.x == -17.85 and at.y == -36))
  for i = 1, 3 do if s['PnlBGEffectParent' .. i].gameObject.activeSelf then effects = effects + 1 end end
  local spine = o.Spine == nil and 'absent' or o.Spine.activeSelf and 'on' or 'off'
  if image1 and image2 and not image3 and not petals and effects == 3 and logo then return 'hall', spine end
  if image1 or image2 or not image3 or effects ~= 0 or logo then return 'mixed hall and scene', spine end
  local want = SCENES[s.raw.texture.name]
  if not want or s.raw.texture.destroyed then return 'unknown picture', spine end
  local title, suit, animation, particles, ratio = want[1], want[2], want[3], want[4], want[5]
  local scale, place, mark = want[6], want[7], want[8]
  if (at and at.x) ~= (mark and mark[1]) or (at and at.y) ~= (mark and mark[2]) then return title .. ' with the logo in a wrong place', spine end
  if petals ~= particles then return title .. ' with wrong particles', spine end
  if m then
    local stands = m.spine and not m.spine.destroyed
    if m.SuitId ~= suit then return title .. ' with suit ' .. m.SuitId, spine end
    if world.suits[suit] and not (stands and m.spine.suit == suit) then return title .. ' without its model', spine end
    if stands and animation and m.playing ~= animation then return title .. ' not playing ' .. animation, spine end
    if m.Scale ~= scale or (stands and m.spine.scale ~= scale) then return title .. ' with scale ' .. tostring(m.Scale), spine end
    -- Without a RectTransform to move, the animation stays where the prefab put it.
    local now = s.rect.anchoredPosition
    if world.rect == false then place = HOME end
    if now.x ~= place[1] or now.y ~= place[2] then return title .. ' with the animation in a wrong place', spine end
  end
  if ratio then
    local b = events.background
    if not b or b.asset ~= 'BG/' .. s.raw.texture.name .. '.png' or b.ratio ~= ratio then return title .. ' without the stock background call', spine end
    if events.adapted < 1 then return title .. ' without BackgroundAdapter', spine end
  end
  return title, spine
end
local function set(client, queue, time)
  world, rolls, clock, textures, printed = client, queue, time or 0, {}, {}
  world.textures, world.suits = world.textures or {}, world.suits or { false, true, false }
  events = { prepared = events.prepared or 0, randomReads = 0, textureLoads = 0, modelLoads = 0, adapted = 0, asked = 0 }
  U3D.Random = world.random ~= 'absent' and Random or nil
  Game.LuaUtils = world.loader ~= 'absent' and LuaUtils or nil
  -- The language chooses the title only after an error; the steps count how often it is asked.
  tbClass.IsUS = function() events.asked = events.asked + 1; return world.english ~= false end
end
function play(client, queue, time)
  set(client, queue, time)
  current = screen()
  local ok, err = pcall(current.Load2DBG, current)
  if not ok then return 'raised: ' .. tostring(err), '', 0, 0, '' end
  local title, spine = describe(current)
  return title, spine, events.randomReads, events.asked, table.concat(printed, '|')
end
-- The whole patched script: release OnInit, stock OnInit, Load2DBG, then the release buttons.
function open(client, queue)
  set(client, queue)
  current = screen()
  current:OnInit()
  local title, spine = describe(current)
  return title, spine, current.btnMenu.gameObject.activeSelf and not current.btnSwitch.gameObject.activeSelf
    and not current.serverObj.gameObject.activeSelf and current.btnMenu.onClick.fn ~= nil
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
    # Title first and release login second ends in the same script: the hook then only refreshes its module.
    assert patch_lua.patch_script(NAME, g.lua_script(NAME, SYNTHETIC)) == once
    assert g.lua_script(NAME, once) == once and g.lua_script(NAME, once.replace(b'\n', b'\r\n')) == once
    text, plain = once.decode('utf8'), login.decode('utf8')
    block = g.module_block()
    assert '\r' not in text and text.count(block) == 1
    assert block + g.HEAD + g.TEST + '\t\tself.ImgLogoRect.anchoredPosition = U3D.Vector2(1, 2); \n' in text
    # Nothing else changes: without the module and with the stock test the release login script is back.
    assert text.replace(block, '').replace(g.TEST, g.STOCK_TEST) == plain
    # Both patches are in the result: the release edits, the appended release file, no supplied tail.
    release = Path(__file__).with_name('release_login.lua').read_text(encoding='utf8')
    assert text.endswith('\n' + release) and 'suppliedTail' not in text and MARKER not in text
    assert 'not self:IsReleaseLocalGateway() and not Game.Login.IsNetworkReachability()' in text
    assert text.index(g.END) < text.index(release)
    # A stale module between the markers is replaced; the test line is not edited twice.
    stale = text.replace(block, g.BEGIN + 'local TitleScreens = nil\n' + g.END)
    assert g.lua_script(NAME, stale.encode('utf8')) == once
    count = 0
    for anchor in (g.HEAD + g.STOCK_TEST,) + g.HALL_LINES + (g.CALL,) + g.USES:
        count += rejected(plain.replace(anchor, '')) + rejected(plain.replace(anchor, anchor + anchor))
    assert count == 16, count
    # The hall lines must be inside the branch, in the stock order.
    moved = plain.replace(g.HALL_LINES[3], '') + g.HALL_LINES[3]
    swapped = plain.replace(g.HALL_LINES[1], '').replace(g.HALL_LINES[0], g.HALL_LINES[1] + g.HALL_LINES[0])
    # A stock script that already uses the module's name is not patched; neither is a half-patched one.
    named = plain.replace('\t\treturn;\n', '\t\tTitleScreens = 1\n\t\treturn;\n')
    half = text.replace(g.END, '')
    assert rejected(moved) + rejected(swapped) + rejected(named) + rejected(half) == 4
    assert g.lua_script('Other.lua', SYNTHETIC) == SYNTHETIC.replace(b'\r\n', b'\n')
    return once


def runtime(chunk):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    lua.execute(chunk)
    return lua


def chosen(rolls, client, weights=None):
    """A second implementation of the choice: the title the module must show, and the rolls it reads."""
    weights = dict({'hall': 1, 'sky': 1, 'snow': 1, 'shards': 1, 'prefab': 1}, **(weights or {}))
    titles, read = [t for t in ('hall', 'sky', 'snow', 'shards') if weights[t] > 0], 0
    if 'prefab' in client and titles: titles.append('prefab')
    while titles:
        at = rolls[read] * sum(weights[t] for t in titles)
        read += 1
        title = titles[-1]
        for candidate in titles:
            at -= weights[candidate]
            if at < 0:
                title = candidate
                break
        titles.remove(title)
        if title in client:
            return title, read
    return 'prefab', read


def weighted(chunk, weights):
    """The same module with other weights in its table."""
    for title, weight in weights.items():
        old = "name = '%s', weight = 1" % title
        assert chunk.count(old) == 1, old
        chunk = chunk.replace(old, "name = '%s', weight = %s" % (title, weight))
    return chunk


def run(script=None, report=None):
    synthetic = script is None
    if synthetic:
        script = check_injection()
    else:
        assert g.lua_script(NAME, script) == script
    text = script.decode('utf8')
    block = g.module_block()
    assert text.count(block + g.HEAD + g.TEST) == 1
    LuaRuntime().execute('assert(load(...))', text)
    # A complete stock script cannot run in the mock, so a bundle contributes the module and Load2DBG only.
    start = text.index(block)
    chunk = text[start:text.index('\nend\n', start + len(block)) + len('\nend\n')]
    lua = runtime(chunk)
    play = lua.globals().play
    source, counts = random.Random(SEED), {}
    for label, client, can in CLIENTS:
        counts[label], tried = dict.fromkeys(sorted(can), 0), set()
        for _ in range(SCREENS):
            rolls = [source.random() for _ in range(4)]
            want, reads = chosen(rolls, can)
            title, spine, read, asked, log = play(lua.eval('{ %s }' % client), lua.table_from(rolls))
            # "Spine" is on with a scene and off with the hall, whatever the prefab loaded.
            want_spine = 'absent' if "spine = 'none'" in client else 'off' if want == 'hall' else 'on'
            # The scene of the prefab shows the picture it loaded with.
            picture = {'prefab': 'plaza' if 'bg_login02' in client else 'sky'}.get(want, want)
            assert (title, spine, read, asked) == (picture, want_spine, reads, 0), (label, rolls, title, spine, read, asked, log)
            lines = log.split('|')
            assert lines[-1] == '[title] ' + ('scene of the prefab' if want == 'prefab' else want), (label, log)
            # Every earlier line names a title that this client cannot draw, with the reason.
            for line in lines[:-1]:
                name, _, why = line[len('[title] '):].partition(' left out: ')
                assert line.startswith('[title] ') and name in FULL - can and why, (label, log)
                tried.add(name)
            counts[label][want] += 1
        assert tried == FULL - can, (label, tried)
        assert min(counts[label].values()) > SCREENS // (2 * len(can)), (label, counts[label])
        if report: report('ok %-44s %d screens -> %s' % (label, SCREENS, counts[label]))
    # The ends of the random range, with all art: the first and the last title of the table.
    full = '{ %s }' % ALL
    assert play(lua.eval(full), lua.table_from([0.0]))[0] == 'hall'
    assert play(lua.eval(full), lua.table_from([1.0]))[0] == 'shards'
    # No usable UnityEngine.Random: the clock chooses, and the screen still opens.
    for mode in ('absent', 'error', 'text'):
        got = [play(lua.eval("{ %s, random = '%s' }" % (ALL, mode)), lua.table_from([]), t)[0]
               for t in (1763100010, 1763100030, 1763100060, 1763100099)]
        assert got == ['hall', 'sky', 'snow', 'shards'], (mode, got)
        if report: report('ok random source %-6s -> clock: %s' % (mode, ' '.join(got)))
    # An error inside the module gives the stock answer: the language chooses, as before the patch.
    for english, want in ((True, 'hall'), (False, 'sky')):
        title, spine, _, asked, log = play(lua.eval("{ %s, image = 'raises', english = %s }" % (ALL, str(english).lower())), lua.table_from([0.5]))
        assert (title, spine, asked) == (want, 'on', 1) and '[title] failed, stock title: ' in log, (title, spine, asked, log)
    # Weights: 0 removes a title, and no title at all leaves the scene of the prefab.
    for weights, can in (({'hall': 0}, FULL - {'hall'}), ({'snow': 0, 'shards': 0}, {'hall', 'sky'}),
                         ({'sky': 3}, FULL), ({'hall': 0, 'sky': 0, 'snow': 0, 'shards': 0}, set())):
        other, seen = runtime(weighted(chunk, weights)), set()
        for _ in range(SCREENS):
            rolls = [source.random() for _ in range(4)]
            want, reads = chosen(rolls, can, weights) if can else ('sky', 0)
            title, _, read, _, log = other.globals().play(other.eval(full), other.table_from(rolls))
            assert (title, read) == (want, reads), (weights, rolls, title, read, log)
            assert 'scene of the prefab' not in log or not can, log
            seen.add(title)
        assert seen == (can or {'sky'}), (weights, seen)
        if not can: assert log == '[title] scene of the prefab', log
        if report: report('ok weights %-52s -> %s' % (weights, sorted(seen)))
    opened = None
    if synthetic:
        # The whole script: the release OnInit still runs around the stock one, and the title is chosen in it.
        lua = runtime(text)
        opened = [lua.globals().open(lua.eval(full), lua.table_from([r])) for r in (0.1, 0.3, 0.6, 0.9)]
        assert opened == [('hall', 'off', True), ('sky', 'on', True), ('snow', 'on', True), ('shards', 'on', True)], opened
        assert lua.eval('events.prepared') == 4 and lua.eval('GameManager.gcgEmbeddedPlayerAccount') == 'gcg-offline-player-v1'
        lua.execute('P, IMAGE, roll, alive, parts, scene, pick, log = 1, 2, 3, 4, 5, 6, 7, 8')
        assert lua.eval('tbClass:Globals()') == (1, 2, 3, 4, 5, 6, 7, 8)
        if report: report('ok release OnInit + stock OnInit + Load2DBG: %s' % (opened,))
    return {'titlesChosenInMockRuntime': True, 'syntheticLoginSource': synthetic,
            'mockedClients': len(CLIENTS), 'screensPerClient': SCREENS, 'titlesShown': counts,
            'titleWithoutItsArtNeverShown': True, 'prefabStateRestoredAfterFailedTitle': True,
            'clockFallbackWithoutUnityRandom': True, 'stockTitleAfterModuleError': True,
            'eachAnchorRequiredExactlyOnce': True, 'patchIdempotent': True,
            'moduleLocalsDoNotLeakIntoLoginScript': synthetic, 'releaseLoginPatchAppliedFirst': synthetic,
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
