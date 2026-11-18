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
  Vector3 = function(x, y, z) return { x = x, y = y, z = z } end,
  Quaternion = { LookRotation = function(v) return { fwd = v } end },
  Input = {
    GetKey = function(k) return pad.buttons[k - 330] == true end,
    GetAxisRaw = function(name)
      if name == "Horizontal" then return pad.h end
      if name == "Vertical" then return pad.v end
      local n = tonumber(name:match("^gcgpad_a(%d+)$"))
      if n == 1 and (rawAxes or rawAxes == nil) then return pad.h end   -- raw left stick (Vertical is up-positive,
      if n == 2 and (rawAxes or rawAxes == nil) then return -pad.v end  -- the raw axis down-positive)
      if n and rawAxes then return pad.axes[n] or 0 end
      local s = STOCK[name]
      if s then return (pad.axes[s[1]] or 0) * s[2] end
      axisErrors[name] = (axisErrors[name] or 0) + 1
      error("Input Axis " .. name .. " is not setup.")
    end,
    GetJoystickNames = function() return { Length = 1, [0] = "Mock Pad" } end,
  },
  Time = setmetatable({}, { __index = function(t, k) if k == "realtimeSinceStartup" then return clock end end }),
}
clock = 100
local cam = {
  -- the girls enter fire mode (private isTouchFire), unless they are still dodging (ignoreFire)
  OnFight = function(self, v) log(string.format("fire %.2f %.2f", v.x, v.y))
    if not ignoreFire then for i = 0, team.members.Count - 1 do team.members[i].playerController.isTouchFire = true end end end,
  OnFightStop = function(self) log("firestop")
    for i = 0, team.members.Count - 1 do team.members[i].playerController.isTouchFire = false end end,
  -- the mock camera looks straight down: screen x = world x, screen y = world z
  GetScreenDirection = function(self, v) return { x = v.x, y = v.z } end,
  GetRealDirection = function(self, v) if failTurn then error("no camera") end; return { x = v.x, y = 0, z = v.y } end,
}
-- the local team (girls around a center) and the enemy list of the fight
local function list(t) local r = { Count = #t }; for i = 1, #t do r[i - 1] = t[i] end; return r end  -- C# List: 0-based
function girls(...)
  local t = {}
  for _, p in ipairs({ ... }) do t[#t + 1] = { playerController = { IsDead = false, transform = { position = { x = p[1], y = 0, z = p[2] } } } } end
  team.members = list(t)
end
function enemy(x, z) return { IsMonster = true, IsAlive = true, CanAutoAim = true, IsDestructible = false, CurrPostion = { x = x, y = 0, z = z } } end
function foes(...) Game.DamageCompentList.Instance.ComList = list({ ... }) end
skillMoving = false
xlua = { private_accessible = function(t) privateOpened = t end }
CS = { SchoolPlayerController = { name = "SchoolPlayerController" } }
team = { center = { transform = { position = { x = 0, y = 0, z = 0 } } }, members = list({}),
         TeamMoveSkill = { IsCDTime = false }, IsSkillMoving = function(self) return skillMoving end }
paused = false
Game = {
  GameMode = { instance = { fightCamera = cam, isBegin = true }, IsEnd = false },
  Map = { isOnline = false }, CartoonMgr = { IsPlaying = false },
  FightJoystick = { SetMoveOffset = function(v) log(string.format("move %.2f %.2f", v.x, v.y)) end },
  UI_FightProxy = { OnUseSkillByIdx = function(i, p)
      if failSkill or (p and failDir) then error("boom") end
      log(p and string.format("skill %d %.2f %.2f", i, p.x, p.y) or "skill " .. i) end },
  Fight = { GetLocalTeam = function() return team end },
  DamageCompentList = { Instance = { ComList = { Count = 0 } } },
  UI_Fight = { Ins = { OnClickBtnAuto = function(self) log("auto") end } },
  Timer = { Add = function(d, i, fn) timers[#timers + 1] = fn; return #timers end,
            Delete = function(id) timers[id] = nil end },
  GlobalEvent = { AddLuaEvent = function() hud[#hud + 1] = 'add' end,
                  RemoveLuaEvent = function() hud[#hud + 1] = 'remove' end },
  eEventName = { OnNotifyUpdateAutoFight = 1 },
}
UI = { IsOpen = function(n)
         if failTick then error("scene not ready") end
         return n == "UI_MissionPause" and paused end,
       Open = function(n) paused = true; log("open " .. n) end,
       Close = function(n) paused = false; log("close " .. n) end,
       Register = function() registered = {}; return registered end }
key, move, skill, pause, axis, st, try, P = 1, 2, 3, 4, 5, 6, 7, 8
function frame() clock = clock + 0.01; for _, fn in pairs(timers) do fn() end end
function frames(n) for i = 1, n do frame() end end
-- each girl's fire direction (written by direct aim) and facing, as unit x,z
local function unit(d) if not d then return "-" end; local m = math.sqrt(d.x * d.x + d.z * d.z)
  return string.format("%.2f,%.2f", d.x / m, d.z / m) end
function aims() local t = {}; for i = 0, team.members.Count - 1 do t[#t + 1] = unit(team.members[i].playerController.cacheFireDir) end
  return table.concat(t, " ") end
function faces() local t = {}; for i = 0, team.members.Count - 1 do local r = team.members[i].playerController.transform.rotation
  t[#t + 1] = unit(r and r.fwd) end; return table.concat(t, " ") end
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
    ("pad.buttons[0] = true", ""),                        # A locks on (no enemy here), it does not fire
    ("pad.buttons[0] = false; pad.buttons[5] = true", "fire 0.00 0.00"),  # RB fires; no enemy: game aims
    ("", ""),
    ("pad.buttons[5] = false", "firestop"),
    ("pad.axes[12] = 0.9", "fire 0.00 0.00"),            # right trigger (12th axis, GAS on Android)
    ("pad.axes[12] = 0", "firestop"),
    ("pad.axes[3] = 0.5; pad.axes[4] = 0.8", ""),        # aim stick (3rd/4th axis) alone aims, it does not fire
    ("pad.axes[12] = 0.9", "fire 0.53 -0.85"),           # trigger fires along it (Y down = positive, unit)
    ("pad.axes[3] = 0; pad.axes[4] = 0; pad.axes[12] = 0", "firestop"),
    ("pad.buttons[2] = true", "skill 0"),
    ("", ""),                                             # edge only
    ("pad.buttons[2] = false; pad.buttons[3] = true; pad.buttons[4] = true", "skill 3|skill 1"),
    ("pad.buttons[3] = false; pad.buttons[4] = false; pad.buttons[11] = true", "auto"),
    ("pad.buttons[11] = false; pad.axes[5] = -1", "move -1.00 0.00"),   # d-pad hat (5th/6th axis)
    ("pad.axes[5] = 0; pad.axes[6] = 1", "move 0.00 -1.00"),            # hat down = positive
    ("pad.axes[6] = 0", "move 0.00 0.00"),
    ("pad.axes[13] = 1", "skill 3"),                                     # left trigger dashes too
    ("", ""),
    ("pad.axes[13] = 0", ""),
    ("clock = clock + 1; pad.buttons[5] = true", "fire 0.00 0.00"),   # the aim stick's hold is over
    ("pad.buttons[10] = true", "open UI_MissionPause|firestop"),         # pause stops fire
    ("pad.buttons[10] = false; pad.buttons[2] = true", ""),            # X pressed in the pause menu
    ("pad.buttons[10] = true", "close UI_MissionPause|fire 0.00 0.00"),  # still down after it: no skill
    ("pad.buttons[10] = false; pad.buttons[5] = false; pad.buttons[2] = false", "firestop"),
    ("failSkill = true; pad.buttons[1] = true", ""),                     # error -> disabled, no crash
    ("failSkill = false; pad.buttons[1] = false", ""),
    ("pad.buttons[1] = true", ""),                                       # stays disabled until Stop
    ("pad.buttons[1] = false; pad.h = -1", "move -1.00 0.00"),           # other actions still work
    ("failTick = true", ""),                                             # one failed tick (scene loading)
    ("failTick = false", "move -1.00 0.00"),                             # does not end the controller
    ("GamepadMenu = { owner = 'menu' }", "move 0.00 0.00"),              # a window covers the HUD: release
    ("pad.buttons[0] = true; pad.buttons[4] = true", ""),                # the menu layer has the pad (A = confirm)
    ("GamepadMenu = { owner = 'fight' }; pad.buttons[0] = false", "move -1.00 0.00"),  # LB still down: no dodge
    ("pad.buttons[4] = false", "move -1.00 0.00"),
    ("pad.buttons[4] = true", "move -1.00 0.00|skill 3 -1.00 0.00"),     # a new press dashes along the stick
    ("pad.buttons[4] = false; GamepadMenu = { owner = 'menu', off = true }", "move -1.00 0.00"),  # menu layer off: not muted
]
# The same layer when the InputManager has no gcgpad_aN entry: only stock axis names answer.
STOCK_STEPS = [
    ("", ""),
    ("pad.h = -1", "move -1.00 0.00"),                    # left stick: stock Horizontal/Vertical
    ("pad.h = 0", "move 0.00 0.00"),
    ("pad.buttons[5] = true", "fire 0.00 0.00"),          # buttons need no axis entry
    ("pad.buttons[5] = false", "firestop"),
    ("pad.axes[3] = 0.5; pad.axes[4] = 0.8", ""),         # HandleFire / RightHorizontal read the 3rd/4th axis: aim
    ("pad.buttons[5] = true", "fire 0.53 -0.85"),
    ("pad.axes[3] = 0; pad.axes[4] = 0; pad.buttons[5] = false", "firestop"),
    ("pad.axes[12] = 1", ""),                             # no stock name for the 12th axis: RT needs raw entries
    ("pad.axes[12] = 0; pad.axes[5] = -1", "move -1.00 0.00"),  # 5th axis: stock RightVertical, sign undone
    ("pad.axes[5] = 0", "move 0.00 0.00"),
    ("pad.axes[6] = 1", ""),                              # 6th axis has no stock name: ignored, no error
    ("pad.axes[6] = 0; pad.buttons[4] = true", "skill 3"),
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


def check_restart(chunk, start, stop, report):
    """Start after a lost timer, a second Start, and a tick that fails on every frame."""
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    printed = []
    lua.globals().print = lambda *a: printed.append(' '.join(str(x) for x in a))
    lua.globals().rawAxes = True
    lua.execute(chunk)
    lua.execute(start + '\n' + start + '\ntake()')
    assert lua.eval('timerCount()') == 1 and printed.count('[pad] started') == 1   # a live timer is kept
    lua.execute('failSkill = true; pad.buttons[2] = true; frame(); pad.buttons[2] = false; frame(); failSkill = false')
    assert lua.eval('take()') == '' and '[pad] skill disabled' in ''.join(printed)
    # The game clears its timers without closing the HUD; the next fight opens the HUD again.
    lua.execute('timers = {}; for i = 1, 200 do clock = clock + 0.01 end')
    lua.execute(start)
    assert lua.eval('timerCount()') == 1 and printed.count('[pad] started') == 2, printed
    lua.execute('pad.buttons[2] = true; frame(); pad.buttons[2] = false; frame()')
    assert lua.eval('take()') == 'skill 0'          # the new fight starts with every action on again
    if report: report('ok restart: a lost timer is replaced at the next Start, a live one is kept')
    # A tick that fails on every frame: logged once, then the controller turns itself off for this fight.
    lua.execute('failTick = true; for i = 1, 130 do frame() end; failTick = false; pad.h = 1; frame()')
    assert lua.eval('take()') == '' and sum('tick disabled' in p for p in printed) == 1, printed
    assert sum('[pad] tick error' in p for p in printed) == 1, printed
    lua.execute(stop + '\n' + start + '\nframe()')
    assert lua.eval('take()') == 'move 1.00 0.00'   # the next fight has the controller again
    if report: report('ok tick errors: logged once, off after 120 in a row, back at the next fight')


def check_aim_dash(chunk, start, stop, report):
    """Direct aim (360 degrees, assist, auto, lock-on) and the dash rules, with three girls and enemies."""
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    printed = []
    lua.globals().print = lambda *a: printed.append(' '.join(str(x) for x in a))
    lua.globals().rawAxes = True
    lua.execute(chunk)
    lua.execute("girls({0, 1}, {-1, 0}, {0, 0}); E1 = enemy(10, 0); foes(E1)\n" + start + '\ntake()')
    n = [0]
    ev = lua.eval

    def step(setup, want, frames=1, note='', aims=None, faces=None):
        lua.execute(setup + '\nframes(%d)' % frames)
        got = ev('take()')
        assert got == want, (n[0], setup, got, want)
        if aims is not None: assert ev('aims()') == aims, (n[0], 'aims', ev('aims()'), aims)
        if faces is not None: assert ev('faces()') == faces, (n[0], 'faces', ev('faces()'), faces)
        if report: report('ok aim  step %2d  %-58s -> %s  %s' % (n[0], setup, got[:60], note))
        n[0] += 1

    # auto aim: OnFight once, then every girl fires along her own line to the nearest enemy
    step("pad.axes[12] = 1", "fire 1.00 0.00", 2, 'auto aim: nearest enemy',
         aims="1.00,-0.10 1.00,0.00 1.00,0.00", faces="1.00,-0.10 1.00,0.00 1.00,0.00")
    assert '[pad] private fields on' in printed and '[pad] first fire: enemies=1 girls=3' in printed
    step("E1.CurrPostion = { x = 0, y = 0, z = 10 }", "", 12, 'enemy moved: no new OnFight, girls follow',
         aims="0.00,1.00 0.10,1.00 0.00,1.00")
    step("", "", 30, 'steady: no OnFight at all (a charge weapon keeps its charge)')
    # 360 degrees: 16 stick angles, no enemy near: every girl fires exactly along the stick
    lua.execute('foes(); frames(12); take()')
    import math
    for k in range(16):
        a = 2 * math.pi * k / 16
        x, y = math.cos(a), math.sin(a)
        lua.execute('pad.axes[3] = %r; pad.axes[4] = %r; frames(5)' % (x, -y))
        want = '%.2f,%.2f' % (x, y)
        want = ' '.join([want.replace('-0.00', '0.00')] * 3)
        clean = lambda v: v.replace('-0.00', '0.00')
        assert clean(ev('aims()')) == want and clean(ev('faces()')) == want, (k, ev('aims()'), want)
    assert ev('take()') == ''
    if report: report('ok aim  360: 16 stick angles, each girl fires along the stick, no extra OnFight')
    # assist: an enemy within 8 degrees of the stick takes the aim; 20 degrees off does not
    step("E2 = enemy(10, 1); foes(E2); pad.axes[3] = 1; pad.axes[4] = 0", "", 12, 'assist: enemy 6 deg off',
         aims="1.00,0.00 1.00,0.09 1.00,0.10")
    step("pad.axes[3] = 0.94; pad.axes[4] = 0.34", "", 12, 'enemy 26 deg off: pure stick',
         aims="0.94,-0.34 0.94,-0.34 0.94,-0.34")
    # stick let go: held for aimHold, then auto aim again
    step("pad.axes[3] = 0; pad.axes[4] = 0", "", 15, 'stick let go: aim held', aims="0.94,-0.34 0.94,-0.34 0.94,-0.34")
    step("", "", 20, 'hold over: auto aim', aims="1.00,0.00 1.00,0.09 1.00,0.10")
    # lock-on: A locks the nearest, A again the next, the lock is sticky, relock on death
    step("E3 = enemy(-3, 0); foes(E2, E3); pad.buttons[0] = true", "", 5, 'A: lock nearest',
         aims="-0.95,-0.32 -1.00,0.00 -1.00,0.00")
    assert printed[-1] == '[pad] lock 1/2', printed[-1]
    step("pad.buttons[0] = false", "", 5)
    step("pad.buttons[0] = true", "", 5, 'A again: next enemy', aims="1.00,0.00 1.00,0.09 1.00,0.10")
    assert printed[-1] == '[pad] lock 2/2', printed[-1]
    step("pad.buttons[0] = false; E3.CurrPostion = { x = -1, y = 0, z = 0 }", "", 20, 'lock is sticky',
         aims="1.00,0.00 1.00,0.09 1.00,0.10")
    # E3 sits on girl 1 now (-1, 0): she keeps her last direction; the others turn to E3
    step("E2.IsAlive = false", "", 12, 'locked enemy died: relock to E3')
    assert ev('aims()').split()[2] == '-1.00,0.00', ev('aims()')
    step("pad.axes[3] = 1", "", 3, 'aim stick ends the lock')
    assert sum(p == '[pad] lock off' for p in printed) == 1
    # Alex's case: walk up while firing, turn to walk down, dash: the girls face down and dash down
    lua.execute('pad.axes[3] = 0; clock = clock + 1; foes(); frames(12); take()')
    step("pad.v = 1", "move 0.00 1.00")
    step("pad.v = -1; pad.buttons[4] = true; skillMoving = true",
         "move 0.00 -1.00|firestop|skill 3 0.00 -1.00", note='dash: fire off, girls face the stick, dash dir = stick',
         faces="0.00,-1.00 0.00,-1.00 0.00,-1.00")
    step("", "move 0.00 -1.00", note='no fire during the dash')
    lua.execute("g0 = team.members[0].playerController; g0.transform.rotation = { fwd = { x = 1, y = 0, z = 0 } }; g0.isFireRotate = true")
    step("", "|".join(["move 0.00 -1.00"] * 30), 30, 'dash still running; the game turned a girl: undone',
         faces="0.00,-1.00 0.00,-1.00 0.00,-1.00")
    assert ev("g0.isFireRotate == false and g0.attackRotateToDirection.fwd.z == -1")
    step("skillMoving = false", "move 0.00 -1.00|fire 0.00 0.00", note='dash over: fire is back (no enemy: game aims)')
    # no move stick: the girls dash away from the team center (one on the center: fixed spread)
    step("pad.v = 0; pad.axes[12] = 0; pad.buttons[4] = false", "move 0.00 0.00|firestop")
    step("pad.buttons[4] = true", "skill 3", note='scatter', faces="0.00,1.00 -1.00,0.00 -0.50,-0.87")
    # dash first, fire a moment later: fire waits for the dash
    step("pad.buttons[4] = false", "", 70)
    step("skillMoving = true; pad.axes[13] = 1", "skill 3", note='left trigger: scatter dash')
    step("pad.axes[12] = 1", "", 10, 'fire pressed during the dash: held off')
    # the dash ends, but the game ignores the first fire start (a girl still dodging): sent again until it holds
    step("skillMoving = false; ignoreFire = true", "fire 0.00 0.00", 5, 'dash over (after dashMin): fire starts')
    step("", "fire 0.00 0.00|fire 0.00 0.00", 20, 'not firing yet: started again every 0.1 s')
    step("ignoreFire = false", "fire 0.00 0.00", 10, 'this one holds')
    step("", "", 30, 'firing: no more starts')
    step("pad.axes[12] = 0; pad.axes[13] = 0", "firestop")
    # cooldown: the press waits up to dashBuffer
    step("team.TeamMoveSkill.IsCDTime = true", "")
    step("pad.buttons[4] = true", "", 10, 'pressed in cooldown: buffered')
    step("team.TeamMoveSkill.IsCDTime = false", "skill 3", note='cooldown over within the buffer: dash')
    step("pad.buttons[4] = false; team.TeamMoveSkill.IsCDTime = true", "")
    step("pad.buttons[4] = true", "skill 3", 30, 'buffer runs out: plain call, the game decides')
    step("team.TeamMoveSkill.IsCDTime = false", "", 5, 'no second dash')
    # fallbacks: a failing turn or a refused direction still dashes
    step("pad.buttons[4] = false; failTurn = true; pad.h = 1", "move 1.00 0.00")
    step("pad.buttons[4] = true", "move 1.00 0.00|skill 3 1.00 0.00", note='no turn, dash with dir')
    step("pad.buttons[4] = false; failDir = true", "move 1.00 0.00")
    step("pad.buttons[4] = true", "move 1.00 0.00|skill 3", note='dir refused: plain dash')
    dis = sorted(p for p in printed if 'disabled' in p)
    assert [d.split()[1] for d in dis] == ['dashdir', 'dashturn'], dis
    assert any(p.startswith('[pad] caps members=3 enemies=1 screenDir=1.00,0.00 roundTrip=1.00,0.00 cd=false autoAim=true assist=8')
               for p in printed), printed
    # a failing enemy list falls back to the game's aim
    lua.execute("pad.h = 0; pad.buttons[4] = false; failTurn = false; frames(2); take()")
    step("Game.DamageCompentList = nil; clock = clock + 1; pad.axes[12] = 1", "fire 0.00 0.00", 2,
         'enemy list missing: the game aims')
    assert any('target disabled' in p for p in printed)
    lua.execute(stop)
    assert ev('timerCount()') == 0
    return n[0]


def check_default_mode(chunk, start, stop, report):
    """Settings > Controller Support = Default: the first release's behaviour, then a switch to Improved."""
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    printed = []
    lua.globals().print = lambda *a: printed.append(' '.join(str(x) for x in a))
    lua.globals().rawAxes = True
    lua.execute(chunk)
    lua.execute("improved = false; GamepadMode = { Improved = function() return improved end }")
    lua.execute("girls({0, 1}, {-1, 0}); E1 = enemy(10, 0); foes(E1)\n" + start + '\ntake()')
    steps = [
        ("pad.buttons[0] = true", "fire 0.00 0.00"),             # A fires (the game aims)
        ("pad.buttons[0] = false", "firestop"),
        ("pad.axes[3] = 0.5; pad.axes[4] = 0.8", "fire 0.53 -0.85"),   # the right stick fires toward it
        ("pad.axes[3] = -0.8; pad.axes[4] = 0", ""),             # turning it sends nothing: the game keeps the first
        ("pad.axes[3] = 0; pad.axes[4] = 0", "firestop"),
        ("pad.axes[12] = 1", "fire 0.00 0.00"),
        ("pad.axes[12] = 0; pad.v = -1", "move 0.00 -1.00|firestop"),
        ("pad.buttons[4] = true", "move 0.00 -1.00|skill 3"),    # LB: a plain dodge, no direction, no turn
        ("pad.buttons[4] = false; pad.axes[13] = 1", "move 0.00 -1.00"),   # LT does nothing
        ("pad.axes[13] = 0; pad.v = 0", "move 0.00 0.00"),
    ]
    for i, (setup, want) in enumerate(steps):
        lua.execute(setup + '\nframe()')
        got = lua.eval('take()')
        assert got == want, ('default', i, setup, got, want)
        if report: report('ok default step %d  %-46s -> %s' % (i, setup, got))
    assert lua.eval('aims()') == '- -'                     # Default writes nothing into the girls
    lua.execute('improved = true; frames(60); pad.buttons[0] = true; frame()')
    assert lua.eval('take()') == '' and printed[-1] == '[pad] lock 1/1', printed[-1]   # Improved: A locks on
    lua.execute('pad.buttons[0] = false; frame(); take()')
    lua.execute(stop)
    if report: report('ok default mode: first release behaviour; Improved within 0.5 s of the switch')


def check_fallback(chunk, start, stop, report):
    """No private access (xlua refuses): the layer re-aims with OnFight, at most every reaimGap."""
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    printed = []
    lua.globals().print = lambda *a: printed.append(' '.join(str(x) for x in a))
    lua.globals().rawAxes = True
    lua.execute(chunk)
    lua.execute("xlua = nil; girls({0, 1}, {-1, 0}); E1 = enemy(10, 0); foes(E1)\n" + start + '\ntake()')
    lua.execute('pad.axes[12] = 1; frames(2)')
    assert lua.eval('take()') == 'fire 1.00 0.00' and any(p.startswith('[pad] private fields off') for p in printed)
    lua.execute('E1.CurrPostion = { x = 0, y = 0, z = 10 }; frames(5)')
    assert lua.eval('take()') == ''                       # within reaimGap of the first call
    lua.execute('frames(20)')
    assert lua.eval('take()') == 'fire 0.00 1.00'
    lua.execute('pad.axes[3] = 0; pad.axes[4] = 1; frames(25)')
    assert lua.eval('take()') == 'fire 0.00 -1.00'
    assert lua.eval('aims()') == '- -'                     # nothing written without private access
    lua.execute(stop)
    if report: report('ok fallback: no private access, OnFight re-aims every reaimGap')


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
    # Each absent axis name raised once (raw names, axes without a stock name) and was then skipped.
    assert lua.eval('errorCount()')[1] == 1, lua.eval('errorCount()')
    assert not any('disabled' in p for p in printed), printed
    check_restart(chunk, start, stop, report)
    aim_steps = check_aim_dash(chunk, start, stop, report)
    check_fallback(chunk, start, stop, report)
    check_default_mode(chunk, start, stop, report)
    return {'defaultModeFirstRelease': True, 'aimDashSteps': aim_steps, 'aim360SixteenAngles': True, 'directAimNoExtraOnFight': True,
            'assistCone': True, 'fallbackWithoutPrivateAccess': True,
            'dashFollowsMoveStick': True, 'reaimWhileFiring': True,
            'lockOnCyclesAndRelocks': True, 'scatterWithoutStick': True, 'dashBuffered': True,'controllerLayerExecutedInMockRuntime': True, 'syntheticHudSource': synthetic,
            'rawAxisSteps': len(RAW_STEPS), 'stockAxisSteps': len(STOCK_STEPS),
            'eachAnchorRequiredExactlyOnce': True, 'patchIdempotent': True,
            'moduleLocalsDoNotLeakIntoHudScript': synthetic,
            'absentAxisNamesAskedOnce': True, 'failedActionDisabledAlone': True,
            'failedTickRecovers': True, 'noSkillFromButtonHeldOverAWindow': True,
            'notMutedByStoppedMenuLayer': True, 'lostTimerRestarted': True,
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
