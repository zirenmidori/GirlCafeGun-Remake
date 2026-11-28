"""Mock test of patch_letter_remind_tap on the real PhoneMsgLogic.lua, RemindManager.lua and UI_Remind.lua.

replay(scripts, ...) loads the three scripts with stub globals (any unknown global is a callable stub), lets
PhoneMsgLogic:ServerResponseLetter push a new-letter banner for girl 7 (a new topic) or girl 9 (a girl who
speaks first on a known topic), opens UI_Remind as RemindManager does, and taps Panel/Message if the script
wired a click there. It reports the girl id the banner kept, whether the tap opened UI_Phone (and how), the
chat it selected, and whether the Private toggle was switched on.
The stock scripts keep no girl id and wire no tap (the test proves the old behavior); the patched scripts
open girl 7's or girl 9's chat. A tap during a fight, or on a non-letter banner, does nothing.
run_bundle(built) reads the three scripts from a built lua.u and checks that they hold the change.
Command: python test_letter_remind_tap.py <release APK or lua.u>
"""
from pathlib import Path
import sys

from lupa.lua53 import LuaRuntime

import patch_letter_remind_tap as g

HARNESS = r'''
local stub
stub = setmetatable({}, {
  __index = function() return stub end,
  __call = function() return stub end,
  __concat = function() return '' end,
})
setmetatable(_G, { __index = function() return stub end })
log = { opened = nil, how = nil, toggled = false, closedRemind = false, listeners = 0 }
local tapFns = {}
local phone = { TYPE_LETTER = 3, TYPE_EMAIL = 2, nShowType = 2 }
phone.TogglePanel = { Find = function(_, p)
  return { GetComponent = function() return setmetatable({}, { __newindex = function(_, k, v)
    if p == 'Toggle3' and k == 'isOn' and v then log.toggled = true; phone.nShowType = 3 end
  end }) end }
end }
phone.ShowMainPanel = function() end
local openSet = {}
UI = {
  Register = function(name) local t = { sClass = name }; UI.class = t; return t end,
  IsOpen = function(name) return openSet[name] == true end,
  GetClass = function(name) if name == 'UI_Phone' and openSet.UI_Phone then return phone end end,
  Open = function(name) if name == 'UI_Phone' then openSet.UI_Phone = true; log.opened = name; log.how = 'Open'; return phone end end,
  CloseAndOpen = function(name) openSet.UI_Phone = true; log.opened = name; log.how = 'CloseAndOpen' end,
  Close = function(v) if v == UI.class or v == 'UI_Remind' then log.closedRemind = true end end,
  tbCurrent = { sClass = 'UI_Level' },
}
Game = {
  Map = { isFight = false },
  Timer = { Add = function() return 1 end, Delete = function() end },
  Utils = { SetTextWithEllipsis = function() end, IsEditor = function() return false end },
}
setmetatable(Game, { __index = function() return stub end })
GuideManager = { IsGuiding = function() return false end }
Sprite = function() return {} end
Text = function(s) return s end
typeof = function(t) return t end
local function button()
  return { onClick = { AddListener = function(_, fn) tapFns[#tapFns + 1] = fn; log.listeners = log.listeners + 1 end } }
end
local function node(path)
  local n = { gameObject = nil, anchoredPosition = {} }
  n.gameObject = {
    SetActive = function() end,
    GetComponent = function() return nil end,
    AddComponent = function() return button() end,
  }
  n.GetComponent = function() return button() end
  return n
end
function setupRemindUI(c)
  c.GetComponent = function(_, kind, path) return { text = '', anchoredPosition = {} } end
  c.Find = function(_, path)
    if path == 'Panel/Message/BtnNext' or path == 'Panel/Message/BtnClose' then
      return { gameObject = { SetActive = function() end }, GetComponent = function() return { onClick = { AddListener = function() end } } end }
    end
    return node(path)
  end
  c.OnClick = function() end
end
function tap() for _, fn in ipairs(tapFns) do fn() end end
'''

# Load order: RemindManager, PhoneMsgLogic, UI_Remind.
SCENARIO = r'''
local girl, newTopic, fight, kind, current = ...
UI.tbCurrent.sClass = current
RemindManager.Clear = function() end
-- PhoneMsgLogic helpers: the table data the real ones read is not loaded here
PhoneMsgLogic.MakeLetterAll = function() end
PhoneMsgLogic.MakeNewLetterInfo = function() end
PhoneMsgLogic.MakeNewLetterReplyInfo = function() end
PhoneMsgLogic.RefreshUI = function() end
PhoneMsgLogic.GetLetterInfo = function() return { Index = 1 } end
PhoneMsgLogic.GetFirstLetterInfo = function() return 'Why did you attack against orders?' end
PhoneMsgLogic.GetNpcHead = function(_, id) return 'Npc/icon_' .. id .. '.png' end
PhoneMsgLogic.GetNpcNickName = function(_, id) return 'Girl ' .. id end
if newTopic then
  PhoneMsgLogic:ServerResponseLetter(girl, 100, 0, { Initiator = girl, TopicId = { [0] = 100 } })
else
  PhoneMsgLogic:ServerResponseLetter(girl, 200, 0, nil)
end
local kept = RemindManager.UnreadRemind.Letter.npcId
if kind == 'mission' then
  RemindManager.UnreadRemind.Letter.show = false
  RemindManager.UnreadRemind.Mission.show = true
  RemindManager.UnreadRemind.Mission.desc = 'done'
end
local c = UI.class
setupRemindUI(c)
c:OnInit()
c:OnOpen()
Game.Map.isFight = fight
tap()
return kept, log.opened, log.how, PhoneMsgLogic.SelectLetter, log.toggled, log.closedRemind, log.listeners
'''


def replay(scripts, girl=7, new_topic=True, fight=False, kind='letter', current='UI_Level'):
    lua = LuaRuntime()
    lua.execute(HARNESS)
    for name in ('RemindManager.lua', 'PhoneMsgLogic.lua', 'UI_Remind.lua'):
        source = scripts[name]
        lua.execute(source.decode('utf8') if isinstance(source, bytes) else source)
    return tuple(lua.execute(SCENARIO, girl, new_topic, fight, kind, current))


def patched(stock):
    return {name: g.lua_script(name, stock[name]) for name in g.LUA_NAMES}


def run_script(stock):
    old = replay(stock)
    assert old == (None, None, None, None, False, False, 0), old
    new = patched(stock)
    first = replay(new, girl=7, new_topic=True)
    assert first == (7, 'UI_Phone', 'Open', 7, True, True, 1), first
    reply = replay(new, girl=9, new_topic=False)
    assert reply == (9, 'UI_Phone', 'Open', 9, True, True, 1), reply
    from_main = replay(new, girl=7, current='UI_Main')
    assert from_main == (7, 'UI_Phone', 'CloseAndOpen', 7, True, True, 1), from_main
    in_fight = replay(new, girl=7, fight=True)
    assert in_fight[1] is None and in_fight[5] is False, in_fight
    other = replay(new, girl=7, kind='mission')
    assert other[1] is None and other[5] is False, other
    return {'stockKeepsGirl': old[0], 'stockTapOpens': old[1], 'newTopicOpens': first[3],
            'replyOpens': reply[3], 'privateTab': first[4], 'fightTapIgnored': True, 'otherBannerIgnored': True}


def scripts_from_bundle(bundle):
    import asset_tools
    _, raw = asset_tools.unityfs(asset_tools.transform(bundle))
    _, objects = asset_tools.serialized_objects(raw)
    out = {}
    for o in objects:
        if o.get('name') in g.LUA_NAMES:
            out[o['name']] = raw[o['script_start']:o['script_start'] + o['script_length']]
    assert set(out) == g.LUA_NAMES, sorted(out)
    return out


def run_bundle(built):
    scripts = scripts_from_bundle(built)
    text = {k: v.decode('utf8') for k, v in scripts.items()}
    assert g.PHONE_NEW_NEW in text['PhoneMsgLogic.lua'] and g.PHONE_REPLY_NEW in text['PhoneMsgLogic.lua']
    assert g.REMIND_NEW in text['RemindManager.lua']
    assert g.INIT_NEW in text['UI_Remind.lua'] and 'function tbClass:OnTapLetter()' in text['UI_Remind.lua']
    assert replay(scripts)[3] == 7
    return True


if __name__ == '__main__':
    import zipfile
    path = sys.argv[1]
    source = zipfile.ZipFile(path).read('assets/lua.u') if path.endswith('.apk') else Path(path).read_bytes()
    print(run_script(scripts_from_bundle(source)))
