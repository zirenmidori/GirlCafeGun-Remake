"""Run the controller layer, as patched into the fight HUD, in a mocked fight runtime.

Adapted from GirlCafeGun-Offline tools/lua/test_gamepad.py (MIT, GCG2-Offline contributors).
run() needs no client file: it patches a synthetic UI_Fight.lua that carries the three anchor lines.
run_bundle() repeats the behavior steps on the module inside a patched lua.u.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(ROOT / 'translation/tools/.deps')]
from lupa.lua53 import LuaRuntime
import patch_gamepad as g

NAME = 'UI_Fight.lua'
# Only the three anchor lines come from the client. Mixed indentation and CRLF are deliberate.
SYNTHETIC = '''-- Synthetic stand-in for the fight HUD script.
local tbClass = UI.Register('UI_Fight');
function tbClass:OnOpen(tbParam)
    hud[#hud + 1] = 'open'
\t    Game.GlobalEvent.AddLuaEvent(Game.eEventName.OnNotifyUpdateAutoFight, self.OnUpdateAutoFight)
    hud[#hud + 1] = 'opened'
end
function tbClass:OnClose()
    Game.GlobalEvent.RemoveLuaEvent(Game.eEventName.OnNotifyUpdateAutoFight, self.OnUpdateAutoFight)
    hud[#hud + 1] = 'closed'
end
function tbClass:OnUpdateAutoFight() end
-- Names that the module uses as locals must still resolve to globals here.
function tbClass:Globals() return key, move, skill, pause, axis, st, try, P end
'''.replace('\n', '\r\n').encode('utf8')

MOCK = r'''
calls, hud, timers, axisErrors = {}, {}, {}, {}
local function log(s) calls[#calls + 1] = s end
pad = { buttons = {}, axes = {}, h = 0, v = 0 }
-- stock InputManager names: joystick axis number and stored sign
local STOCK = { HandleFire = { 3, 1 }, RightHorizontal = { 4, 1 }, RightVertical = { 5, -1 } }
U3D = {
  KeyCode = { __CastFrom = function(n) return n end },
  Vector2 = function(x, y) return { x = x, y = y } end,
  Input = {
    GetKey = function(k) return pad.buttons[k - 330] == true end,
    GetAxisRaw = function(name)
      if name == "Horizontal" then return pad.h end
      if name == "Vertical" then return pad.v end
      local n = tonumber(name:match("^gcgpad_a(%d+)$"))
      if n and rawAxes then return pad.axes[n] or 0 end
      local s = STOCK[name]
      if s then return (pad.axes[s[1]] or 0) * s[2] end
      axisErrors[name] = (axisErrors[name] or 0) + 1
      error("Input Axis " .. name .. " is not setup.")
    end,
    GetJoystickNames = function() return { Length = 1, [0] = "Mock Pad" } end,
  },
}
local cam = {
  OnFight = function(self, v) log(string.format("fire %.2f %.2f", v.x, v.y)) end,
  OnFightStop = function(self) log("firestop") end,
}
paused = false
Game = {
  GameMode = { instance = { fightCamera = cam, isBegin = true }, IsEnd = false },
  Map = { isOnline = false }, CartoonMgr = { IsPlaying = false },
  FightJoystick = { SetMoveOffset = function(v) log(string.format("move %.2f %.2f", v.x, v.y)) end },
  UI_FightProxy = { OnUseSkillByIdx = function(i, p)
      if failSkill then error("boom") end
      log("skill " .. i) end },
  UI_Fight = { Ins = { OnClickBtnAuto = function(self) log("auto") end } },
  Timer = { Add = function(d, i, fn) timers[#timers + 1] = fn; return #timers end,
            Delete = function(id) timers[id] = nil end },
  GlobalEvent = { AddLuaEvent = function() hud[#hud + 1] = 'add' end,
                  RemoveLuaEvent = function() hud[#hud + 1] = 'remove' end },
  eEventName = { OnNotifyUpdateAutoFight = 1 },
}
UI = { IsOpen = function(n) return n == "UI_MissionPause" and paused end,
       Open = function(n) paused = true; log("open " .. n) end,
       Close = function(n) paused = false; log("close " .. n) end,
       Register = function() registered = {}; return registered end }
key, move, skill, pause, axis, st, try, P = 1, 2, 3, 4, 5, 6, 7, 8
function frame() for _, fn in pairs(timers) do fn() end end
function take() local c = calls; calls = {}; return table.concat(c, "|") end
function timerCount() local n = 0; for _ in pairs(timers) do n = n + 1 end; return n end
function errorCount() local n, most = 0, 0
  for _, c in pairs(axisErrors) do n = n + 1; most = math.max(most, c) end
  return n, most
end
'''

# (controller state, expected game calls after one frame)
RAW_STEPS = [
    ("", ""),
    ("pad.h = 1; pad.v = 0.1", "move 1.00 0.10"),        # normalized
    ("", "move 1.00 0.10"),                               # held: sent every frame (absolute direction)
    ("pad.h = 0.1; pad.v = 0", "move 0.00 0.00"),        # inside dead zone -> one stop
    ("", ""),                                             # no repeated stop (touch keeps control)
    ("pad.buttons[0] = true", "fire 0.00 0.00"),
    ("", ""),
    ("pad.buttons[0] = false", "firestop"),
    ("pad.axes[3] = 0.9", "fire 0.00 0.00"),             # right trigger (3rd axis)
    ("pad.axes[3] = 0", "firestop"),
    ("pad.axes[4] = 0.5; pad.axes[5] = 0.8", "fire 0.50 -0.80"),  # twin-stick (4th/5th axis, Y inverted)
    ("pad.axes[4] = 0; pad.axes[5] = 0", "firestop"),
    ("pad.buttons[2] = true", "skill 0"),
    ("", ""),                                             # edge only
    ("pad.buttons[2] = false; pad.buttons[3] = true; pad.buttons[4] = true", "skill 3|skill 1"),
    ("pad.buttons[3] = false; pad.buttons[4] = false; pad.buttons[11] = true", "auto"),
    ("pad.buttons[11] = false; pad.axes[6] = -1", "move -1.00 0.00"),   # d-pad hat
    ("pad.axes[6] = 0", "move 0.00 0.00"),
    ("pad.buttons[0] = true", "fire 0.00 0.00"),
    ("pad.buttons[10] = true", "open UI_MissionPause|firestop"),         # pause stops fire
    ("pad.buttons[10] = false", ""),
    ("pad.buttons[10] = true", "close UI_MissionPause|fire 0.00 0.00"),
    ("pad.buttons[10] = false; pad.buttons[0] = false", "firestop"),
    ("failSkill = true; pad.buttons[1] = true", ""),                     # error -> disabled, no crash
    ("failSkill = false; pad.buttons[1] = false", ""),
    ("pad.buttons[1] = true", ""),                                       # stays disabled until Stop
    ("pad.buttons[1] = false; pad.h = -1", "move -1.00 0.00"),           # other actions still work
]
# The same layer when the InputManager has no gcgpad_aN entry: only stock axis names answer.
STOCK_STEPS = [
    ("", ""),
    ("pad.h = -1", "move -1.00 0.00"),                    # left stick: stock Horizontal/Vertical
    ("pad.h = 0", "move 0.00 0.00"),
    ("pad.buttons[5] = true", "fire 0.00 0.00"),          # buttons need no axis entry
    ("pad.buttons[5] = false", "firestop"),
    ("pad.axes[4] = 0.5; pad.axes[5] = 0.8", "fire 0.50 -0.80"),  # RightHorizontal/RightVertical, same sign as raw
    ("pad.axes[4] = 0; pad.axes[5] = 0", "firestop"),
    ("pad.axes[3] = 1", "fire 0.00 0.00"),                # HandleFire
    ("pad.axes[3] = 0", "firestop"),
    ("pad.axes[6] = -1; pad.axes[7] = 1", ""),            # hat axes have no stock name: ignored, no error
    ("pad.axes[6] = 0; pad.axes[7] = 0; pad.buttons[4] = true", "skill 3"),
    ("pad.buttons[4] = false; pad.buttons[2] = true", "skill 0"),
    ("pad.buttons[2] = false", ""),
]


def check_injection():
    once = g.lua_script(NAME, SYNTHETIC)
    assert g.lua_script(NAME, once) == once and g.lua_script(NAME, once.replace(b'\n', b'\r\n')) == once
    text, plain = once.decode('utf8'), SYNTHETIC.decode('utf8').replace('\r\n', '\n')
    assert '\r' not in text and text.count(g.BEGIN) == text.count(g.END) == 1
    block = text[text.index(g.BEGIN):text.index(g.END) + len(g.END)]
    assert text.startswith(plain[:plain.index(g.REGISTER)] + g.REGISTER + block)
    assert '\t    ' + g.OPEN + '\t    ' + g.START + "\n    hud[#hud + 1] = 'opened'" in text
    assert '    ' + g.CLOSE + '    ' + g.STOP + "\n    hud[#hud + 1] = 'closed'" in text
    # Nothing else changes: without the block and the two calls the stock text is back.
    rest = text.replace(block, '').replace('\t    ' + g.START + '\n', '').replace('    ' + g.STOP + '\n', '')
    assert rest == plain
    # A stale module between the markers is replaced; the two calls are not added again.
    stale = text.replace(block, g.BEGIN + 'GamepadFight = nil\n' + g.END)
    assert g.lua_script(NAME, stale.encode('utf8')) == once
    rejected = 0
    for anchor in (g.REGISTER, g.OPEN, g.CLOSE):
        for broken in (plain.replace(anchor, ''), plain.replace(anchor, anchor + anchor)):
            try:
                g.lua_script(NAME, broken.encode('utf8'))
            except AssertionError:
                rejected += 1
    assert rejected == 6
    assert g.lua_script('Other.lua', SYNTHETIC) == plain.encode('utf8')
    return once


def play(chunk, start, stop, raw_axes, steps, report):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    printed = []
    lua.globals().print = lambda *a: printed.append(' '.join(str(x) for x in a))
    lua.globals().rawAxes = raw_axes
    lua.execute(chunk)
    lua.execute(start + '\ntake()')
    assert lua.eval('timerCount()') == 1 and '[pad] started' in printed
    for i, (setup, want) in enumerate(steps):
        lua.execute(setup + '\nframe()')
        got = lua.eval('take()')
        assert got == want, (raw_axes, i, setup, got, want)
        if report: report('ok %s step %2d  %-72s -> %s' % ('raw  ' if raw_axes else 'stock', i, setup, got))
    lua.execute('pad.buttons[8] = true; pad.buttons[9] = true; frame()')
    assert any(p.startswith('[pad] debug true, raw axes ' + ('present' if raw_axes else 'absent'))
               and p.endswith('joysticks: Mock Pad') for p in printed), printed
    lua.execute('pad.buttons[8] = false; pad.buttons[9] = false; frame(); take()')
    lua.execute(stop)
    assert lua.eval('timerCount()') == 0 and '[pad] stopped' in printed
    return lua, printed


def run(script=None, report=None):
    synthetic = script is None
    if synthetic:
        script = check_injection()
        start, stop = 'registered:OnOpen({})', 'registered:OnClose()'
    else:
        assert g.lua_script(NAME, script) == script
        start, stop = g.START, g.STOP
    text = script.decode('utf8')
    assert text.count(g.OPEN) == text.count(g.CLOSE) == 1
    assert text.index(g.OPEN) < text.index(g.START) and text.index(g.CLOSE) < text.index(g.STOP)
    LuaRuntime().execute('assert(load(...))', text)
    # A complete stock script cannot run in the mock, so a bundle contributes its module only.
    chunk = text if synthetic else text[text.index(g.BEGIN):text.index(g.END)]

    lua, printed = play(chunk, start, stop, True, RAW_STEPS, report)
    assert lua.eval('take()') == 'move 0.00 0.00'      # Stop releases the held direction
    assert lua.eval('errorCount()') == (0, 0)
    assert sum('disabled' in p for p in printed) == 1 and '[pad] skill disabled' in ''.join(printed)
    if synthetic:
        assert list(lua.globals().hud.values()) == ['open', 'add', 'opened', 'remove', 'closed']
        assert lua.eval('registered:Globals()') == (1, 2, 3, 4, 5, 6, 7, 8)

    lua, printed = play(chunk, start, stop, False, STOCK_STEPS, report)
    assert lua.eval('take()') == ''
    # Each absent axis name raised once (two hat axes, three roles, one debug probe) and was then skipped.
    assert lua.eval('errorCount()') == (28, 1), lua.eval('errorCount()')
    assert not any('disabled' in p for p in printed), printed
    return {'controllerLayerExecutedInMockRuntime': True, 'syntheticHudSource': synthetic,
            'rawAxisSteps': len(RAW_STEPS), 'stockAxisSteps': len(STOCK_STEPS),
            'eachAnchorRequiredExactlyOnce': True, 'patchIdempotent': True,
            'moduleLocalsDoNotLeakIntoHudScript': synthetic,
            'absentAxisNamesAskedOnce': True, 'failedActionDisabledAlone': True,
            'patchedLuaSyntaxPassed': True}


def run_bundle(source):
    import asset_tools as w
    _, raw = w.unityfs(w.transform(source))
    _, objects = w.serialized_objects(raw)
    script, = [raw[o['script_start']:o['script_start'] + o['script_length']]
               for o in objects if o.get('name') == NAME]
    return run(script)


if __name__ == '__main__':
    print(run(report=print))
