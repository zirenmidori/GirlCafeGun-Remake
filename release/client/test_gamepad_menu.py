"""Run the menu controller layer, as patched into UI.lua, in a mocked UI runtime.

The mock holds a small scene graph: windows under the canvas root, rect transforms in screen pixels,
a raycaster that returns the top target under a point (masks clip, later siblings draw on top), the
Selectable registry, toggle groups, a scroll list and the client's click helpers. It checks what the
player would see: where the focus goes, what A, B, LB/RB, Start, the right stick and the cursor press.
run() patches a synthetic UI.lua that carries the anchor line; run_bundle() uses the module of a lua.u.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(ROOT / 'translation/tools/.deps')]
from lupa.lua53 import LuaRuntime
import patch_gamepad as g

NAME = 'UI.lua'
SYNTHETIC = '''-- Synthetic stand-in for the UI manager.
UI = UI or {}
function UI.Open(sClass, ...)
\topened[#opened + 1] = sClass
end
-- Names that the module uses as locals must still resolve to globals here.
function UI.Globals() return M, G, st, key, move, back, tab end
'''.replace('\n', '\r\n').encode('utf8')

MOCK = r'''
M, G, st, key, move, back, tab = 1, 2, 3, 4, 5, 6, 7
opened, calls = {}, {}
local function log(s) calls[#calls + 1] = s end
function take() local c = calls; calls = {}; return table.concat(c, "|") end
clock = 100
pad = { buttons = {}, axes = {}, h = 0, v = 0 }
touches = 0

-- ---------- types ----------
local function Type(name)
  return { name = name, IsInstanceOfType = function(self, o) return o and o.types and o.types[self] or false end }
end
T = { Selectable = Type('Selectable'), Button = Type('Button'), Toggle = Type('Toggle'), Slider = Type('Slider'),
      Scrollbar = Type('Scrollbar'), InputField = Type('InputField'), ScrollRect = Type('ScrollRect'),
      Canvas = Type('Canvas'), RectTransform = Type('RectTransform'), Image = Type('Image'),
      ETL = Type('EventTriggerListener') }
function typeof(t) return t end

-- ---------- scene ----------
local nextId, order = 0, 0
local allObjects = {}
local Tr = {}
Tr.__index = function(t, k)
  if k == 'anchoredPosition' then return { x = t.ax, y = t.ay } end
  if k == 'rect' then local r = t.r; return { xMin = r[1], yMin = r[2], xMax = r[3], yMax = r[4], width = r[3] - r[1], height = r[4] - r[2] } end
  if k == 'name' then return t.gameObject.name end
  return Tr[k]
end
Tr.__newindex = function(t, k, v)
  if k == 'anchoredPosition' then rawset(t, 'ax', v.x); rawset(t, 'ay', v.y)
  elseif k == 'anchorMin' or k == 'anchorMax' or k == 'pivot' or k == 'sizeDelta' then rawset(t, '_' .. k, v)
  else rawset(t, k, v) end
end
function Tr.world(t)
  local x, y = t.ax, t.ay
  local p = t.parent
  while p do x, y = x + p.ax, y + p.ay; p = p.parent end
  return x, y
end
function Tr.GetInstanceID(t) return t.id end
function Tr.TransformPoint(t, v) local x, y = t:world(); return { x = x + v.x, y = y + v.y, z = 0 } end
function Tr.InverseTransformPoint(t, v) local x, y = t:world(); return { x = v.x - x, y = v.y - y, z = 0 } end
function Tr.TransformVector(t, v) return v end
function Tr.InverseTransformVector(t, v) return v end
function Tr.IsChildOf(t, o) local p = t; while p do if p == o then return true end; p = p.parent end; return false end
function Tr.GetComponent(t, ty) return t.gameObject.comps[ty] end
function Tr.GetComponentInParent(t, ty) local p = t; while p do local c = p.gameObject.comps[ty]; if c then return c end; p = p.parent end end
function Tr.SetParent(t, p) rawset(t, 'parent', p) end

local Go = {}
Go.__index = function(o, k)
  if k == 'activeInHierarchy' then
    local p = o.transform
    while p do if not p.gameObject.active then return false end; p = p.parent end
    return true
  end
  return Go[k]
end
function Go.GetInstanceID(o) return o.id end
function Go.GetComponent(o, ty) return o.comps[ty] end
function Go.SetActive(o, v) o.active = v end
function Go.AddComponent(o, ty)
  local c = { gameObject = o, transform = o.transform, types = { [ty] = true } }
  o.comps[ty] = c
  if ty == T.Image then o.comps[T.RectTransform] = o.transform end
  return c
end
function Go.GetComponentsInChildren(o, ty)
  local out = { Length = 0 }
  for _, x in ipairs(allObjects) do
    local c = x.comps[ty]
    if c and x.activeInHierarchy and x.transform:IsChildOf(o.transform) then out[out.Length] = c; out.Length = out.Length + 1 end
  end
  return out
end

function newObject(name, parent, x0, y0, x1, y1)
  nextId = nextId + 1; order = order + 1
  local o = setmetatable({ name = name, id = nextId, active = true, comps = {}, order = order }, Go)
  local t = setmetatable({ id = -nextId, ax = 0, ay = 0, r = { x0 or 0, y0 or 0, x1 or 0, y1 or 0 } }, Tr)
  rawset(t, 'gameObject', o); rawset(t, 'parent', parent)
  o.transform = t
  allObjects[#allObjects + 1] = o
  return o
end

ROOT = newObject('CanvasRoot').transform
function window(name, ord)
  local w = newObject(name, ROOT, 0, 0, 1920, 1080)
  w.comps[T.Canvas] = { sortingOrder = ord, renderMode = 'camera', worldCamera = 'cam' }
  w.comps[T.Canvas].rootCanvas = w.comps[T.Canvas]
  return w
end
-- an element: raycast target; kind 'button' | 'toggle' | 'slider' | 'trigger' | 'image'
function el(parent, name, x0, y0, x1, y1, kind)
  local o = newObject(name, parent.transform or parent, x0, y0, x1, y1)
  o.raycast = true
  kind = kind or 'button'
  if kind ~= 'image' then
    local c = { gameObject = o, transform = o.transform, interactable = true, isActiveAndEnabled = true, types = {} }
    function c.IsInteractable(self) return self.interactable end
    function c.OnPointerEnter(self, d) self.inside = true end    -- a finger enters before it presses
    function c.OnPointerExit(self, d) self.inside = false end
    if kind == 'trigger' then c.types[T.ETL] = true; o.comps[T.ETL] = c
    else
      c.types[T.Selectable] = true
      if kind == 'toggle' then c.types[T.Toggle] = true; c.isOn = false end
      if kind == 'slider' then c.types[T.Slider] = true; c.minValue, c.maxValue, c.value, c.wholeNumbers = 0, 1, 0.5, false end
      o.comps[T.Selectable] = c
    end
    o.sel = c
  end
  return o
end
function group(...)
  nextId = nextId + 1
  local gr = { id = nextId, GetInstanceID = function(self) return self.id end }
  for _, o in ipairs({ ... }) do o.sel.group = gr end
  return gr
end
function scrollList(parent, name, x0, y0, x1, y1)
  local view = newObject(name, parent.transform, x0, y0, x1, y1)
  view.mask = true; view.raycast = true
  local content = newObject('Content', view.transform, 0, 0, 0, 0)
  local sr = { gameObject = view, transform = view.transform, viewport = view.transform, content = content.transform,
               vertical = true, horizontal = false, isActiveAndEnabled = true, types = { [T.ScrollRect] = true } }
  function sr.GetInstanceID() return view.id end
  function sr.StopMovement() end
  view.comps[T.ScrollRect] = sr
  return view, content, sr
end

local function inside(o, x, y)
  local t = o.transform
  local wx, wy = t:world()
  local r = t.r
  return x >= wx + r[1] and x <= wx + r[3] and y >= wy + r[2] and y <= wy + r[4]
end
local function canvasOf(o) local c = o.transform:GetComponentInParent(T.Canvas); return c and c.sortingOrder or -1 end
function raycast(x, y)
  local best, bk
  for _, o in ipairs(allObjects) do
    if o.raycast and not o.destroyed and o.activeInHierarchy and inside(o, x, y) then
      local clipped = false
      local p = o.transform.parent
      while p do if p.gameObject.mask and not inside(p.gameObject, x, y) then clipped = true end; p = p.parent end
      if not clipped then
        local k = canvasOf(o) * 100000 + o.order
        if not bk or k > bk then best, bk = o, k end
      end
    end
  end
  return best
end

local function newList()
  local l = { Count = 0 }
  function l.Clear(self) for i = 0, self.Count - 1 do self[i] = nil end; self.Count = 0 end
  return l
end
selected = nil
local es = {
  RaycastAll = function(self, ped, list)
    local o = raycast(ped.position.x, ped.position.y)
    if o then list[0] = { gameObject = o }; list.Count = 1 end
  end,
  SetSelectedGameObject = function(self, o) selected = o end,
}
setmetatable(es, { __index = function(t, k) if k == 'currentSelectedGameObject' then return selected end end })

local function allSelectables()
  local l = { Count = 0 }
  for _, o in ipairs(allObjects) do
    local s = o.comps[T.Selectable]
    if s and o.activeInHierarchy and not o.destroyed then l[l.Count] = s; l.Count = l.Count + 1 end
  end
  return l
end

U3D = {
  KeyCode = { __CastFrom = function(n) return n end },
  Vector2 = function(x, y) return { x = x, y = y } end,
  Vector3 = function(x, y, z) return { x = x, y = y, z = z or 0 } end,
  Color = function(r, g, b, a) return { r, g, b, a } end,
  RenderMode = { ScreenSpaceOverlay = 'overlay' },
  Screen = { width = 1920, height = 1080 },
  Time = {},
  Canvas = T.Canvas, RectTransform = T.RectTransform,
  RectTransformUtility = { WorldToScreenPoint = function(cam, p) return { x = p.x, y = p.y } end },
  Input = {
    GetKey = function(k) return pad.buttons[k - 330] == true end,
    GetAxisRaw = function(name)
      if name == "Horizontal" then return pad.h end
      if name == "Vertical" then return pad.v end
      local n = tonumber(name:match("^gcgpad_a(%d+)$"))
      if n == 1 and (rawAxes or rawAxes == nil) then return pad.h end   -- raw left stick (Vertical is up-positive,
      if n == 2 and (rawAxes or rawAxes == nil) then return -pad.v end  -- the raw axis down-positive)
      if n then return pad.axes[n] or 0 end
      error("Input Axis " .. name .. " is not setup.")
    end,
    GetMouseButton = function() if touchFails then error('touch') end; return touches > 0 end,
  },
  Object = {
    FindObjectsOfType = function(ty)
      local out = { Length = 0 }
      for _, o in ipairs(allObjects) do
        local c = o.comps[ty]
        if c and o.activeInHierarchy and not o.destroyed then out[out.Length] = c; out.Length = out.Length + 1 end
      end
      return out
    end,
    DontDestroyOnLoad = function() end,
  },
  GameObject = function(name) local o = newObject(name); o.overlay = true; return o end,
  UI = { Selectable = setmetatable(T.Selectable, { __index = function(t, k) if k == 'allSelectables' then return allSelectables() end end }),
         Button = T.Button, Toggle = T.Toggle, Slider = T.Slider, Scrollbar = T.Scrollbar, InputField = T.InputField,
         ScrollRect = T.ScrollRect, Image = T.Image },
  EventSystems = { EventSystem = { current = es }, RaycastResult = 'RaycastResult',
                   PointerEventData = function() return {} end },
}
setmetatable(U3D.Input, { __index = function(t, k) if k == 'touchCount' then return touches end end })
setmetatable(U3D.Time, { __index = function(t, k)
  if k == 'realtimeSinceStartup' then if clockFails then error('clock') end; return clock end end })
CS = { System = { Collections = { Generic = { List = function() return newList end } } },
       Game = { EventTriggerListener = T.ETL }, UnityEngine = { EventSystems = {} } }

timers = {}
-- the player: task values as the server keeps them (Settings > Controller Support is 32/999; 2 = Improved)
taskValues = { [32 * 65536 + 999] = 2 }
me = { GetTaskValue = function(self, g, id) return taskValues[g * 65536 + id] or 0 end,
       SetTaskValue = function(self, g, id, v) taskValues[g * 65536 + id] = v end }
cartoon = { OnTouch = function() log('advance') end }
storyPlaying = false
Game = {
  -- a Unity asset: Equals(nil) is true once it is destroyed (IsDestroyed below refuses anything but a GameObject)
  LuaUtils = { LoadSprite = function(path) spriteLoads = (spriteLoads or 0) + 1
    local function eq(self, o) return o == nil and self.destroyed == true end
    return { path = path, Equals = eq, texture = { name = 'atlas', Equals = eq } } end },
  Utils = {
    IsDestroyed = function(o)
      if o ~= nil and o.path then error('IsDestroyed takes a GameObject') end   -- as the client: a Sprite fails
      return o == nil or o.destroyed == true or (o.gameObject and o.gameObject.destroyed == true) end,
    ExecutePointerDownEvents = function(o) log('down ' .. o.name) end,
    ExecutePointerUpEvents = function(o) log('up ' .. o.name) end,
    ExecuteClickEvents = function(o)
      log('click ' .. o.name)
      if o.sel and o.sel.types[T.Toggle] then
        if o.sel.group then for _, x in ipairs(allObjects) do if x.sel and x.sel.group == o.sel.group then x.sel.isOn = false end end end
        o.sel.isOn = true
      end
      if o.onClick then o.onClick() end
    end,
  },
  Timer = { Add = function(d, i, fn, real, keep) timers[#timers + 1] = fn; timerArgs = { real, keep }; return #timers end,
            Delete = function(id) timers[id] = nil end },
  CanvasCamera = { Root = ROOT },
  CartoonMgr = setmetatable({}, { __index = function(t, k)
    if k == 'IsPlaying' then return storyPlaying end
    if k == 'Ins' then return { GetCartoonNow = function() return cartoon end } end
  end }),
}
openWindows = {}
UI.IsOpen = function(n) return openWindows[n] == true end
UI.GetClass = function(n) return nil end
UI.GetWindowGameObject = function(n) return windowObjects and windowObjects[n] end

function frame(dt) clock = clock + (dt or 0.05); for _, fn in pairs(timers) do fn() end end
function press(n) pad.buttons[n] = true; frame(); pad.buttons[n] = false; frame() end
-- the d-pad (hat axes 5/6, down = positive) steps the focus; the left stick (pad.h / pad.v) is the pointer
function dpad(x, y) pad.axes[5], pad.axes[6] = x, -y; frame(); pad.axes[5], pad.axes[6] = 0, 0; frame() end
function focusName() local f = GamepadMenu._state.focus; return f and f.go.name or 'none' end
-- the focus marker: the pointer's hand on the focused control (or the old frame, focusFrame = true)
function frameShown()
  local o = GamepadMenu.overlay
  return o ~= nil and ((o.hand ~= nil and o.hand.go.active == true) or o.bars[1].go.active == true)
end
function sprite() local o = GamepadMenu.overlay
  if o.hand.go.active then return 'hand' elseif o.arrow.go.active then return 'arrow' end; return 'none' end
'''

SCENE = r'''
-- main menu: a 3 x 2 grid, a top bar window above it with Back, and a tab bar (toggle group)
main = window('UI_Main', 10)
cells = {}
for row = 0, 1 do for col = 0, 2 do
  local x, y = 560 + col * 300, 520 - row * 220
  cells[#cells + 1] = el(main, 'Cell' .. (row * 3 + col + 1), x, y, x + 240, y + 160)
end end
tabs = { el(main, 'TabA', 600, 900, 760, 960, 'toggle'), el(main, 'TabB', 800, 900, 960, 960, 'toggle'),
         el(main, 'TabC', 1000, 900, 1160, 960, 'toggle') }
group(tabs[1], tabs[2], tabs[3]); tabs[1].sel.isOn = true
deco = el(main, 'Deco', 0, 0, 200, 200, 'image')
player = window('UI_Player', 20)
backBtn = el(player, 'BtnBack', 20, 980, 140, 1060)
'''


def lua_runtime(chunk):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute('UI = {}')
    lua.execute(MOCK)
    printed = []
    lua.globals().print = lambda *a: printed.append(' '.join(str(x) for x in a))
    lua.execute(chunk)
    return lua, printed


def check(lua, code, want, label, report):
    lua.execute(code)
    got = lua.eval('take()')
    assert got == want, (label, code, got, want)
    if report: report('ok %-28s %-62s -> %s' % (label, code.strip().replace('\n', '; ')[:62], got))


SETTINGS_MOCK = r"""
-- a minimal Operation page: Region with the header Title3 and the two-choice row Toggle (Tgl1, Tgl2)
allNodes = {}
local function node(name, parent)
  local t = { name = name, children = {}, comps = {}, parent = parent, ap = { x = 10, y = -5 } }
  table.insert(allNodes, t)
  -- as in Unity, the GameObject's name is its transform's name
  t.gameObject = setmetatable({ transform = t, active = true }, {
    __index = function(_, k) if k == 'name' then return t.name end end,
    __newindex = function(o, k, v) if k == 'name' then t.name = v else rawset(o, k, v) end end })
  rawset(t.gameObject, 'SetActive', function(self, v) self.active = v end)
  rawset(t.gameObject, 'GetComponent', function(self, ty) return t.comps[ty] end)
  rawset(t.gameObject, 'AddComponent', function(self, ty) local c = { gameObject = self }; t.comps[ty] = c; return c end)
  function t:SetParent(parent) self.parent = parent; table.insert(parent.children, self) end
  -- every script component under this node (the Text / Image tables and the client's LocalizedText)
  function t:GetComponentsInChildren(ty)
    local out = { Length = 0 }
    local function walk(n)
      for k, c in pairs(n.comps) do if k ~= T.RectTransform then out[out.Length] = c; out.Length = out.Length + 1 end end
      for _, ch in ipairs(n.children) do walk(ch) end
    end
    walk(self)
    return out
  end
  t.size, t.pivot = { 100, 40 }, { x = 0.5, y = 0.5 }
  t.comps[T.RectTransform] = setmetatable({}, {
    __index = function(_, k)
      if k == 'anchoredPosition' then return t.ap end
      if k == 'rect' then return { width = t.size[1], height = t.size[2] } end
      if k == 'pivot' then return t.pivot end
      return rawget(t, '_' .. k)
    end,
    __newindex = function(_, k, v)
      if k == 'anchoredPosition' then t.ap = v elseif k == 'pivot' then t.pivot = v else rawset(t, '_' .. k, v) end
    end })
  function t:Find(path)
    local cur = self
    for part in path:gmatch('[^/]+') do
      local nxt; for _, c in ipairs(cur.children) do if c.name == part then nxt = c end end
      if not nxt then return nil end; cur = nxt
    end
    return cur
  end
  function t:GetComponent(ty) return t.comps[ty] end
  if parent then table.insert(parent.children, t) end
  return t
end
-- a text as in the Chinese client: a Text plus the client's LocalizedText (it puts the key's text back)
local function localized() return { GetType = function() return { Name = 'LocalizedText' } end } end
local function text(parent, value)
  local n = node('Text', parent); n.comps[T.Text] = { text = value, GetType = function() return { Name = 'Text' } end }
  n.comps.loc = localized()
  function n:GetComponents() local out = { Length = 0 }
    for k, c in pairs(self.comps) do if k ~= T.RectTransform then out[out.Length] = c; out.Length = out.Length + 1 end end
    return out end
  return n
end
local function toggle(parent, name, label, on, group)
  local n = node(name, parent); text(n, label); node('Checkmark', n)
  local listeners = {}
  local tg = { group = group, transform = n, listeners = listeners }
  tg.onValueChanged = { AddListener = function(_, f) table.insert(listeners, f) end,
                        RemoveAllListeners = function() for i = #listeners, 1, -1 do listeners[i] = nil end end }
  setmetatable(tg, { __index = function(_, k) if k == 'isOn' then return rawget(tg, '_on') end end,
                     __newindex = function(_, k, v)
                       if k == 'isOn' then local old = rawget(tg, '_on'); rawset(tg, '_on', v)
                         if old ~= v then for _, f in ipairs(listeners) do f(v) end end
                       else rawset(tg, k, v) end end })
  tg.isOn = on
  n.comps[T.Toggle] = tg
  return tg
end
local function copy(src, parent)
  local n = node(src.name, parent)
  n.ap = { x = src.ap.x, y = src.ap.y }
  n.size, n.pivot = { src.size[1], src.size[2] }, { x = src.pivot.x, y = src.pivot.y }
  for ty, c in pairs(src.comps) do
    if ty == T.Text then n.comps[ty] = { text = c.text, GetType = c.GetType }
    elseif ty == 'loc' then n.comps[ty] = localized()
      n.GetComponents = src.GetComponents
    elseif ty ~= T.RectTransform then n.comps[ty] = c end
  end
  for _, ch in ipairs(src.children) do
    if ch.comps[T.Toggle] then
      local old = ch.comps[T.Toggle]
      local tg = toggle(n, ch.name, ch:Find('Text').comps[T.Text].text, old.isOn, old.group)
      for _, f in ipairs(old.listeners) do tg.onValueChanged:AddListener(f) end   -- Instantiate copies listeners
    else copy(ch, n) end
  end
  return n
end
U3D.Object.Instantiate = function(go, parent) return copy(go.transform, parent).gameObject end
U3D.Object.DestroyImmediate = function(c) for _, o in ipairs(allNodes) do for k, x in pairs(o.comps) do if x == c then o.comps[k] = nil end end end end
U3D.Component = { name = 'Component' }
U3D.MonoBehaviour = { name = 'MonoBehaviour' }
U3D.GameObject = function(name) return node(name).gameObject end
U3D.Quaternion = { Euler = function(x, y, z) return { z = z } end }
T.Image, T.Dropdown = { name = 'Image' }, { name = 'Dropdown' }
U3D.UI.Image, U3D.UI.Dropdown = T.Image, T.Dropdown
U3D.Color = U3D.Color or function(r, g, b, a) return { r, g, b, a } end
local function img(n) n.comps[T.Image] = { sprite = nil, color = nil }; return n end
U3D.UI.DefaultControls = {
  Resources = function() return {} end,
  CreateDropdown = function(res)
    local root = img(node('Dropdown'))
    local label = node('Label', root); label.comps[T.Text] = { text = '' }
    img(node('Arrow', root))
    local template = img(node('Template', root))
    local viewport = node('Viewport', template)
    local content = node('Content', viewport)
    local item = node('Item', content)
    img(node('Item Background', item)); img(node('Item Checkmark', item))
    local il = node('Item Label', item); il.comps[T.Text] = { text = '' }
    local dd = { options = {}, res = res }
    setmetatable(dd, { __index = function(_, k) if k == 'value' then return rawget(dd, '_v') or 0 end end,
                       __newindex = function(_, k, v) if k == 'value' then rawset(dd, '_v', v); label.comps[T.Text].text = dd.options[v + 1] or ''
                                    else rawset(dd, k, v) end end })
    function dd:ClearOptions() self.options = {} end
    function dd:AddOptions(list) for i = 0, list.Count - 1 do table.insert(self.options, list[i]) end end
    function dd:RefreshShownValue() label.comps[T.Text].text = self.options[self.value + 1] or '' end
    root.comps[T.Dropdown] = dd
    function root.gameObject.transform:SetParent(parent) self.parent = parent; table.insert(parent.children, self) end
    return root.gameObject
  end }
CS.System.String = 'String'
CS.System.Collections.Generic.List = function() return function()
  local l = { Count = 0 }; function l:Add(v) self[self.Count] = v; self.Count = self.Count + 1 end; return l end end
U3D.HorizontalWrapMode = { Overflow = 1 }
U3D.TextAnchor = { MiddleLeft = 3, MiddleCenter = 4 }
T.Text, T.Toggle = { name = 'Text' }, { name = 'Toggle' }
U3D.UI.Text, U3D.UI.Toggle = T.Text, T.Toggle
region = node('Region')
local title3 = node('Title3', region); text(title3, 'Layout Settings')   -- as in the English prefab
title3.ap, title3.size = { x = 527, y = -566 }, { 1054, 52 }
local diamond = node('Image', title3); diamond.ap = { x = -372, y = -3 }
node('Line', title3)
local btns = node('Btns', region); btns.ap, btns.size = { x = 414, y = -626 }, { 828, 69 }
local customize = node('zidingyi', btns); customize.ap, customize.size = { x = 269, y = -34 }, { 181, 54 }
local row = node('Toggle', region)
joyGroup = { name = 'joystick group' }
fixedJoy = toggle(row, 'Tgl1', 'Fixed Joystick', true, joyGroup)
freeJoy = toggle(row, 'Tgl2', 'Free Joystick', false, joyGroup)
row:Find('Tgl1').ap, row:Find('Tgl2').ap = { x = 234, y = -23 }, { x = 672, y = -23 }
for _, n in ipairs({ 'Tgl1', 'Tgl2' }) do
  img(node('Background', row:Find(n))).comps[T.Image].sprite = 'box sprite'
  row:Find(n .. '/Checkmark').comps[T.Image] = { sprite = 'check sprite' }
end
row:Find('Tgl1/Text').comps[T.Text].font, row:Find('Tgl1/Text').comps[T.Text].fontSize = 'page font', 30
joyChanges = 0
fixedJoy.onValueChanged:AddListener(function() joyChanges = joyChanges + 1 end)
page = {}
"""


def check_settings(lua, report):
    """Settings > Operation > Controller Support: built from the page's own rows, saved as task value 32/999."""
    ev = lua.eval
    lua.execute(SETTINGS_MOCK)
    lua.execute('taskValues[32 * 65536 + 999] = nil; GamepadMode.BuildSettings(page, region)')
    assert ev("region:Find('GamepadTitle/Text').comps[T.Text].text") == 'Controller Support'
    # header on the Layout Settings line, its diamond 70 units left of choice 1; no second line
    assert ev("region:Find('GamepadTitle').ap.y") == -566 and not ev("region:Find('GamepadTitle/Line').gameObject.active")
    right = 269 + 181 * 0.5                                   # Customize's right edge in the row
    x = right + 110
    dd = "region:Find('Btns/GamepadMode').comps[T.Dropdown]"
    label = "region:Find('Btns/GamepadMode/Label').comps[T.Text]"
    assert ev("region:Find('Btns/GamepadMode').ap.x") == x and ev("region:Find('Btns/GamepadMode').pivot.y") == 0.5
    diamond_x = ev("region:Find('GamepadTitle').ap.x") - 372
    assert abs(diamond_x - (x - 30)) < 1e-6, (diamond_x, x - 30)
    # the header copy loses LocalizedText (it would put 'Layout Settings' back); the page's own texts keep it
    assert ev("region:Find('GamepadTitle/Text').comps.loc") is None and ev("region:Find('Title3/Text').comps.loc") is not None
    # a dropdown with the two choices, in the page's font and with its check sprite; never set: Default
    assert list(ev(dd + '.options').values()) == ['Default', 'HealthS Claude Improved']
    assert ev(dd + '.value') == 0 and ev(label + '.text') == 'Default'
    assert ev(label + '.font') == 'page font' and ev(dd + '.res.checkmark') == 'check sprite'
    # picking in the dropdown (finger or pad) is saved at the next menu tick
    lua.execute(dd + '.value = 1; GamepadMode.Poll()')
    assert ev('taskValues[32 * 65536 + 999]') == 2
    lua.execute('GamepadMode.Poll()')
    assert ev('taskValues[32 * 65536 + 999]') == 2
    lua.execute(dd + '.value = 0; GamepadMode.Poll()')
    assert ev('taskValues[32 * 65536 + 999]') == 1
    assert ev('fixedJoy.isOn') and not ev('freeJoy.isOn') and ev('joyChanges') == 0   # the joystick row is untouched
    # the page shows the stored choice when it opens, without saving it again
    lua.execute('taskValues[32 * 65536 + 999] = 2; GamepadMode.ShowSettings(page); GamepadMode.Poll()')
    assert ev(dd + '.value') == 1 and ev(label + '.text') == 'HealthS Claude Improved'
    lua.execute('GamepadMode.BuildSettings(page, region)')            # a second build adds nothing
    assert ev("#region.children") == 4 and ev("#region:Find('Btns').children") == 2
    if report: report('ok settings: Controller Support dropdown (Default / HealthS Claude Improved), saved as task 32/999')


def scenario(chunk, report):
    lua, printed = lua_runtime(chunk)
    ev = lua.eval
    lua.execute('UI.Open("UI_Main")')
    assert ev('#timers') == 1 and '[pad] menu: started' in printed
    assert tuple(ev('timerArgs').values()) == (True, True)   # real time, kept over scene loads
    lua.execute('UI.Open("UI_Player")')
    assert ev('#timers') == 1                                # Ensure does not start a second timer

    # title screen: the whole window is the "tap to start" button, with a small Update button on top
    lua.execute('''
      login = window('UI_Login', 5)
      -- as in the client: PnlBG/BtnLogin is a full-screen Button with the title art below it
      bgp = el(login, 'PnlBG', 0, 0, 1920, 1080, 'image')
      start = el(bgp, 'BtnLogin', 0, 0, 1920, 1080)
      el(start, 'TxtTap', 760, 120, 1160, 180, 'image')
      update = el(bgp, 'BtnUpdate', 1650, 60, 1880, 160)
      UI.Open('UI_Login')
      press(0); frame(0.3)''')
    assert ev('focusName()') == 'BtnLogin', ev('focusName()')            # the main action takes the focus
    check(lua, 'dpad(1, 0)', '', 'title: right to Update', report); assert ev('focusName()') == 'BtnUpdate'
    check(lua, 'dpad(-1, 0)', '', 'title: back to start', report); assert ev('focusName()') == 'BtnLogin'
    check(lua, 'press(0)', 'down BtnLogin|up BtnLogin|click BtnLogin', 'title: A starts', report)
    lua.execute('login.active = false; frame(0.3); touches = 1; frame(); touches = 0; frame()')
    lua.execute(SCENE)

    # nothing happens before the pad is used; the first input shows the frame and is swallowed
    check(lua, 'frame(); frame()', '', 'idle', report)
    assert not ev('frameShown()')
    check(lua, 'press(0)', '', 'first press shows focus', report)
    assert ev('frameShown()') and ev('focusName()') == 'Cell2', ev('focusName()')   # nearest the centre
    # the cursor images exist now but were never placed: they must not show as squares in the corner
    assert not ev('GamepadMenu.overlay.cursor[1].go.active or GamepadMenu.overlay.cursor[2].go.active'
                  ' or GamepadMenu.overlay.cursor[3].go.active')

    # spatial moves, edges, and the beam rule
    check(lua, 'dpad(1, 0)', '', 'right', report); assert ev('focusName()') == 'Cell3'
    check(lua, 'dpad(1, 0)', '', 'right at edge', report); assert ev('focusName()') == 'Cell3'
    check(lua, 'dpad(0, -1)', '', 'down', report); assert ev('focusName()') == 'Cell6'
    check(lua, 'dpad(-1, 0)', '', 'left', report); assert ev('focusName()') == 'Cell5'
    check(lua, 'dpad(0, 1); dpad(0, 1)', '', 'up to the tab bar', report); assert ev('focusName()') == 'TabB'
    check(lua, 'dpad(-1, 0); dpad(0, 1)', '', 'up to the top bar', report); assert ev('focusName()') == 'BtnBack'
    check(lua, 'dpad(0, -1)', '', 'back down', report); assert ev('focusName()') == 'TabA'

    # A presses like a finger: down on press, up and click on release
    lua.execute('dpad(0, -1)')
    assert ev('focusName()') == 'Cell1'
    check(lua, 'pad.buttons[0] = true; frame()', 'down Cell1', 'A down', report)
    check(lua, 'frame()', '', 'A held', report)
    check(lua, 'pad.buttons[0] = false; frame()', 'up Cell1|click Cell1', 'A up', report)

    # held direction repeats after the delay
    lua.execute('dpad(0, 1)')   # back to TabA
    check(lua, 'pad.axes[5] = 1; frame(0.05); frame(0.2); frame(0.2); pad.axes[5] = 0; frame()', '', 'repeat', report)
    assert ev('focusName()') == 'TabC', ev('focusName()')

    # LB / RB: tabs of the toggle group
    check(lua, 'press(5)', 'down TabB|up TabB|click TabB', 'RB next tab', report)
    assert ev('tabs[2].sel.isOn') and not ev('tabs[1].sel.isOn')
    check(lua, 'press(4)', 'down TabA|up TabA|click TabA', 'LB previous tab', report)
    check(lua, 'press(4)', '', 'LB at first tab', report)

    # B with no popup: the Back button of the top bar
    check(lua, 'press(1)', 'down BtnBack|up BtnBack|click BtnBack', 'B back', report)

    # a popup with a dark backdrop: the focus moves into it, the menu below is out of reach
    lua.execute('''
      pop = window('UI_Popup', 30)
      mask = el(pop, 'Mask', 0, 0, 1920, 1080, 'trigger')
      box = el(pop, 'Box', 660, 340, 1260, 740, 'image')
      el(pop, 'BtnCancel', 700, 380, 900, 460); el(pop, 'BtnConfirm', 1020, 380, 1220, 460)
      el(pop, 'BtnClose', 1180, 660, 1250, 730)
      frame(0.3)''')
    assert ev('focusName()') == 'BtnConfirm', ev('focusName()')
    check(lua, 'dpad(-1, 0)', '', 'left in popup', report); assert ev('focusName()') == 'BtnCancel'
    check(lua, 'dpad(0, -1)', '', 'down: nothing below', report); assert ev('focusName()') == 'BtnCancel'
    check(lua, 'dpad(0, 1)', '', 'up: close, not the menu', report); assert ev('focusName()') == 'BtnClose'
    check(lua, 'press(1)', 'down BtnClose|up BtnClose|click BtnClose', 'B closes popup', report)
    # the popup goes away: the focus returns to the control last used in the main window
    lua.execute('pop.active = false; frame(0.3)')
    assert ev('focusName()') == 'TabA', ev('focusName()')
    # a popup with only a backdrop: B taps the backdrop
    lua.execute('''
      pop2 = window('UI_Reward', 40)
      bg = el(pop2, 'BlackBg', 0, 0, 1920, 1080)
      el(pop2, 'Icon', 900, 500, 1000, 600, 'image')
      frame(0.3)''')
    assert ev('focusName()') == 'BlackBg', ev('focusName()')   # only a backdrop to reach: it takes the focus
    check(lua, 'press(1)', 'down BlackBg|up BlackBg|click BlackBg', 'B taps backdrop', report)
    lua.execute('pop2.active = false; frame(0.3)')

    # scroll list: items beyond the viewport are reached and scrolled into view
    lua.execute('''
      main.active = false; frame(0.3)
      list = window('UI_List', 10)
      view, content, sr = scrollList(list, 'View', 600, 200, 1300, 800)
      items = {}
      for i = 1, 8 do items[i] = el(content, 'Item' .. i, 600, 800 - i * 190, 1300, 800 - i * 190 + 170) end
      UI.Open("UI_List"); frame(0.3)''')
    assert ev('focusName()') in ('Item2', 'Item3'), ev('focusName()')
    lua.execute('for i = 1, 6 do dpad(0, -1) end')
    assert ev('focusName()') == 'Item8', ev('focusName()')
    assert ev('content.transform.ay') > 0                  # content moved up to show the last item
    y0 = ev('select(2, items[8].transform:world()) + items[8].transform.r[2]')
    assert y0 >= 200, y0                                   # last item inside the viewport
    check(lua, 'press(0)', 'down Item8|up Item8|click Item8', 'A on scrolled item', report)
    before = ev('content.transform.ay')
    check(lua, 'pad.axes[4] = -1; frame(0.1); pad.axes[4] = 0; frame()', '', 'right stick scrolls up', report)
    assert ev('content.transform.ay') < before

    # right stick over a list that holds no focus: the scene is scanned for the list a few times a second,
    # not on every 10 ms tick
    lua.execute('''
      list.active = false
      gal = window('UI_Gallery', 10)
      ok = el(gal, 'BtnOk', 100, 100, 300, 160)
      gview, gcontent, gsr = scrollList(gal, 'Pics', 600, 200, 1300, 800)
      for i = 1, 8 do el(gcontent, 'Pic' .. i, 600, 800 - i * 190, 1300, 800 - i * 190 + 170, 'image') end
      UI.Open("UI_Gallery"); frame(0.3)
      scrollScans = 0
      local find = U3D.Object.FindObjectsOfType
      U3D.Object.FindObjectsOfType = function(ty)
        if ty == T.ScrollRect then scrollScans = scrollScans + 1 end
        return find(ty)
      end
      gstart = gcontent.transform.ay
      pad.axes[4] = 1
      for i = 1, 100 do frame(0.01) end''')
    assert ev('focusName()') == 'BtnOk', ev('focusName()')
    assert ev('gcontent.transform.ay') > ev('gstart')          # the list under the stick still scrolls
    scans = ev('scrollScans')
    assert 1 <= scans <= 6, scans                               # one second held: about 4 scans, was 100
    # the list goes away: the next tick looks again at once instead of moving a hidden list
    lua.execute('gview.active = false; gsr.isActiveAndEnabled = false; scrollScans = 0; frame(0.01)')
    assert ev('scrollScans') == 1, ev('scrollScans')
    lua.execute('pad.axes[4] = 0; frame(); gal.active = false; frame(0.3)')

    # slider: left / right change its value
    lua.execute('''
      list.active = false
      opt = window('UI_Option', 10)
      vol = el(opt, 'Volume', 700, 500, 1200, 560, 'slider')
      UI.Open("UI_Option"); frame(0.3)''')
    assert ev('focusName()') == 'Volume'
    lua.execute('dpad(1, 0)')
    assert abs(ev('vol.sel.value') - 0.55) < 1e-6

    # touch hides the frame; the next pad input shows it again and is swallowed
    lua.execute('touches = 1; frame(); touches = 0; frame()')
    assert not ev('frameShown()')
    check(lua, 'press(0)', '', 'press after touch', report)
    assert ev('frameShown()')

    # the EventSystem's selection is cleared, so Submit cannot press a touched button again
    lua.execute('selected = vol; frame()')
    assert ev('selected') is None

    # story scene: A advances, Start skips, choices take the focus, B gives A back to the dialogue
    lua.execute('''
      opt.active = false
      story = window('UI_Cartoon', 50)
      skip = el(story, 'BtnSkip', 1700, 980, 1880, 1060)
      openWindows.UI_Cartoon = true; storyPlaying = true
      frame(0.6)''')
    assert ev('focusName()') == 'none'
    check(lua, 'press(0)', 'advance', 'story A advances', report)
    check(lua, 'press(10)', 'down BtnSkip|up BtnSkip|click BtnSkip', 'story Start skips', report)
    check(lua, 'dpad(0, 1)', '', 'story d-pad', report); assert ev('focusName()') == 'BtnSkip'
    check(lua, 'press(1)', '', 'story B clears focus', report); assert ev('focusName()') == 'none'
    check(lua, 'press(0)', 'advance', 'story A advances again', report)
    lua.execute('''
      c1 = el(story, 'BtnChoice1', 700, 500, 1200, 580); c2 = el(story, 'BtnChoice2', 700, 380, 1200, 460)
      frame(0.6)''')
    assert ev('focusName()') == 'BtnChoice1'
    check(lua, 'dpad(0, -1); press(0)', 'down BtnChoice2|up BtnChoice2|click BtnChoice2', 'story choice', report)
    lua.execute('story.active = false; openWindows.UI_Cartoon = false; storyPlaying = false')

    # optional cursor: Select on, stick moves it, A taps under it, Select off
    lua.execute('''
      cur = window('UI_Cursor', 10)
      far = el(cur, 'Far', 1500, 100, 1700, 200)
      near = el(cur, 'Near', 860, 490, 1060, 590)
      UI.Open("UI_Cursor"); frame(0.3)''')
    check(lua, 'press(11)', '', 'cursor on', report)
    assert ev('GamepadMenu._state.cursorOn')   # the frame now marks the control under the pointer
    lua.execute('pad.h, pad.v = 1, -1; for i = 1, 12 do frame(0.05) end; pad.h, pad.v = 0, 0; frame()')
    cx, cy = ev('GamepadMenu._state.cx'), ev('GamepadMenu._state.cy')
    assert cx > 1300 and cy < 300, (cx, cy)
    lua.execute('GamepadMenu._state.cx, GamepadMenu._state.cy = 1600, 150')
    check(lua, 'press(0)', 'down Far|up Far|click Far', 'cursor A taps', report)
    lua.execute('GamepadMenu._state.cx, GamepadMenu._state.cy = 300, 900')
    check(lua, 'press(0)', '', 'cursor A on nothing', report)
    check(lua, 'press(11)', '', 'cursor off', report)
    assert not ev('GamepadMenu._state.cursorOn') and ev('frameShown()')
    assert not ev('GamepadMenu.cfg.stickPointer')
    lua.execute('pad.h = 1; frame(); pad.h = 0; frame()')
    assert not ev('GamepadMenu._state.cursorOn')            # Select-off: the left stick steps the focus again
    # pointer by default: the left stick brings it out where the focus is, Select is not needed
    lua.execute('GamepadMenu.cfg.stickPointer = true; frame()')
    fx = ev('focusName()')
    lua.execute('pad.h = 0.3; frame(0.01); pad.h = 0; frame(0.01)')
    assert ev('GamepadMenu._state.cursorOn'), 'stick did not bring the pointer'
    if report: report('ok pointer: the left stick brings it out (focus was %s)' % fx)
    # response curve: half tilt is much slower than full tilt; slower again over a control
    def travel(tilt, x0=300, y0=900):
        lua.execute('GamepadMenu._state.cx, GamepadMenu._state.cy = %d, %d; GamepadMenu._state.hover = nil' % (x0, y0))
        lua.execute('pad.h = %r; for i = 1, 4 do frame(0.05) end; pad.h = 0; frame(0.01)' % tilt)
        return ev('GamepadMenu._state.cx') - x0
    full, half = travel(1.0), travel(0.5)
    assert 300 < full < 350 and half < full * 0.25, (full, half)   # 1.5 screen heights per second
    if report: report('ok pointer: curve, full tilt %.0f px, half tilt %.0f px in 0.2 s' % (full, half))
    # hover: the control under the pointer gets the frame; the pointer slows over it; A presses it
    lua.execute('GamepadMenu._state.cx, GamepadMenu._state.cy = 1600, 150; frame(0.06); frame(0.06)')
    assert ev('GamepadMenu._state.hover and GamepadMenu._state.hover.go.name') == 'Far' and ev('frameShown()')
    over = travel(1.0, 1510, 150)
    assert over < full * 0.7, (over, full)   # first frame at full speed, then half
    lua.execute('GamepadMenu._state.cx, GamepadMenu._state.cy = 1600, 150; frame(0.06)')
    assert ev('sprite()') == 'hand' and ev('far.sel.inside') and not ev('GamepadMenu.overlay.bars[1].go.active')
    size = ev('GamepadMenu.overlay.hand.rt._sizeDelta.x')
    lua.execute('pad.buttons[0] = true; frame(0.01); frame(0.01)')
    assert ev('GamepadMenu.overlay.hand.rt._sizeDelta.x') < size * 0.9, 'no press look on the pointer'
    check(lua, 'pad.buttons[0] = false; frame(0.01)', 'down Far|up Far|click Far', 'pointer A presses the hover', report)
    assert ev('far.sel.inside')                              # the pointer still rests on it
    lua.execute('GamepadMenu._state.cx, GamepadMenu._state.cy = 300, 900; frame(0.06); frame(0.06)')
    assert ev('sprite()') == 'arrow' and not ev('far.sel.inside')   # off the control: the arrow, pointer left it
    # the game unloads the atlas with its scene: the sprite is loaded again, never drawn as a blank square
    loads = ev('spriteLoads')
    lua.execute("GamepadMenu.overlay.arrow.img.sprite.texture.destroyed = true; frame(0.06)")
    assert ev('spriteLoads') == loads + 1 and ev('sprite()') == 'arrow' and not ev('GamepadMenu.overlay.arrow.img.sprite.texture.destroyed')
    lua.execute("realLoad = Game.LuaUtils.LoadSprite; Game.LuaUtils.LoadSprite = function() return nil end; GamepadMenu.overlay.arrow.img.sprite.destroyed = true; frame(0.06)")
    assert ev('sprite()') == 'none' and ev('GamepadMenu.overlay.cursor[2].go.active')   # the white cross meanwhile
    lua.execute("Game.LuaUtils.LoadSprite = realLoad; frame(0.06); clock = clock + 1.1; frame(0.06)")
    assert ev('sprite()') == 'arrow' and not ev('GamepadMenu.overlay.cursor[2].go.active')
    if report: report('ok pointer: sprites reloaded after the atlas is unloaded; the cross until they load')
    if report: report('ok pointer: hand over a control, arrow elsewhere, smaller while A is held, enter / exit')
    lua.execute('GamepadMenu._state.cx, GamepadMenu._state.cy = 1600, 150; frame(0.06)')
    # the d-pad puts the focus back, on the control under the pointer
    lua.execute('pad.axes[5] = 1; frame(); pad.axes[5] = 0; frame()')
    assert not ev('GamepadMenu._state.cursorOn') and ev('focusName()') == 'Far' and ev('frameShown()'), ev('focusName()')
    # focus steps: the hand glides onto the focused control (no frame)
    lua.execute('for i = 1, 10 do frame(0.05) end')
    assert abs(ev('GamepadMenu._state.cx') - 1600) < 2 and abs(ev('GamepadMenu._state.cy') - 150) < 2
    assert not ev('GamepadMenu.overlay.bars[1].go.active')
    if report: report('ok pointer: d-pad returns to focus on the hovered control')
    # Default mode (task 32/999 = 1): the first release's menu: the stick steps the focus, the frame marks it
    lua.execute('taskValues[32 * 65536 + 999] = 1; frame(0.6); frame(0.05)')
    assert ev('GamepadMenu.overlay.bars[1].go.active') and not ev('GamepadMenu.overlay.hand.go.active')
    before = ev('focusName()')
    lua.execute('pad.v = 1; frame(); pad.v = 0; frame()')   # up from Far: Near
    assert not ev('GamepadMenu._state.cursorOn') and ev('focusName()') != before, ev('focusName()')
    check(lua, 'press(11)', '', 'default: Select turns the cursor on', report)
    assert ev('GamepadMenu._state.cursorOn') and ev('GamepadMenu.overlay.cursor[2].go.active')   # the white cross
    check(lua, 'press(11)', '', 'default: Select turns it off', report)
    lua.execute('taskValues[32 * 65536 + 999] = 2; frame(0.6)')
    if report: report('ok default mode: focus frame, stick steps the focus, cross cursor on Select')
    # the cursor is on when a fight starts (it is turned off below, when the HUD takes the pad)
    check(lua, 'press(11)', '', 'cursor on before a fight', report)
    lua.execute('GamepadMenu._state.cx, GamepadMenu._state.cy = 960, 540')

    # fight: while a HUD button can be tapped, the menu layer stays idle and owns nothing
    lua.execute('''
      cur.active = false
      hud = window('UI_Fight', 10)
      pause = el(hud, 'BtnPause', 1800, 1000, 1900, 1070)
      windowObjects = { UI_Fight = hud }
      openWindows.UI_Fight = true; GamepadFight = { timer = 1 }
      frame(0.3)''')
    assert ev('GamepadMenu.owner') == 'fight' and not ev('frameShown()')
    check(lua, 'press(0); press(1); dpad(1, 0)', '', 'menu idle in fight', report)
    # the pause menu opens over the HUD: the menu layer takes the pad
    lua.execute('''
      openWindows.UI_MissionPause = true
      pw = window('UI_MissionPause', 30)
      el(pw, 'PauseBg', 0, 0, 1920, 1080, 'image')
      resume = el(pw, 'BtnContinue', 860, 500, 1060, 580)
      frame(0.3)''')
    assert ev('GamepadMenu.owner') == 'menu'
    check(lua, 'press(0); press(0)', 'down BtnContinue|up BtnContinue|click BtnContinue', 'pause menu', report)

    # the fight ends with A (fire) still held: the result window under the old cursor is not tapped
    lua.execute('pw.active = false; openWindows.UI_MissionPause = false; frame(0.3)')
    assert ev('GamepadMenu.owner') == 'fight' and not ev('GamepadMenu._state.cursorOn')
    check(lua, 'pad.buttons[0] = true; frame()', '', 'A held in fight', report)
    check(lua, '''hud.active = false; openWindows.UI_Fight = false
      res = window('UI_Result', 40); el(res, 'BtnNext', 860, 490, 1060, 590)
      frame(0.3)''', '', 'HUD closes, A still held', report)
    assert ev('GamepadMenu.owner') == 'menu' and not ev('GamepadMenu._state.cursorOn')
    check(lua, 'pad.buttons[0] = false; frame()', '', 'A released', report)
    check(lua, 'press(0)', 'down BtnNext|up BtnNext|click BtnNext', 'next A presses the result', report)
    lua.execute('res.active = false; frame(0.3)')

    # a failing C# call is logged once and the layer keeps running
    lua.execute('''
      pw.active = false; openWindows.UI_MissionPause = false; hud.active = false; openWindows.UI_Fight = false
      w = window('UI_Err', 10); b1 = el(w, 'B1', 700, 500, 900, 600); b2 = el(w, 'B2', 1000, 500, 1200, 600)
      UI.Open("UI_Err"); frame(0.3)
      local real = Game.Utils.ExecutePointerDownEvents
      Game.Utils.ExecutePointerDownEvents = function() error('boom') end
      press(0); press(0)
      Game.Utils.ExecutePointerDownEvents = real''')
    assert sum('boom' in p for p in printed) == 1, printed
    check(lua, 'dpad(1, 0); press(0)', 'down B2|up B2|click B2', 'after an error', report)
    assert lua.eval('UI.Globals()') == (1, 2, 3, 4, 5, 6, 7)

    # an error in the start call never breaks UI.Open: the window still opens
    lua.execute('clockFails = true; UI.Open("UI_Late"); clockFails = false')
    assert ev('opened[#opened]') == 'UI_Late'
    assert sum(p.startswith('[pad] menu: ensure: ') for p in printed) == 1, printed
    if report: report('ok UI.Open survives a failing start call')

    # many errors in a row turn the layer off, and it then gives the pad back to the fight layer
    assert ev('GamepadMenu.owner') == 'menu'
    lua.execute('touchFails = true; for i = 1, 125 do frame() end; touchFails = false')
    assert '[pad] menu: turned off after repeated errors' in printed and ev('next(timers)') is None, printed
    assert ev('GamepadMenu.owner') is None and ev('GamepadMenu.off')
    if report: report('ok turned off after 120 errors, owner released')
    return len([p for p in printed if p.startswith('[pad] menu: focus')])


def check_geometry(report):
    lua, _ = lua_runtime('')
    lua.execute(module_only())
    G = lua.eval('GamepadMenu._geo')
    rank = G.backRank
    assert [rank(n) for n in ('BtnClose', 'btnBack', 'Return', 'BtnCancel', 'Background', 'Feedback', 'BtnOK')] == \
        [1, 2, 2, 3, None, None, None]
    assert G.isConfirm('BtnConfirm') and G.isConfirm('BtnOk') and not G.isConfirm('Book')
    assert G.arrowSide('BtnLeft') == -1 and G.arrowSide('BtnNext') == 1 and G.arrowSide('Center') is None
    # the beam rule: a control straight ahead beats a closer one off the beam
    lua.execute('''
      src = { x0 = 0, y0 = 0, x1 = 100, y1 = 100 }
      a = { r = { x0 = 400, y0 = 0, x1 = 500, y1 = 100 } }     -- straight right, far
      b = { r = { x0 = 150, y0 = 300, x1 = 250, y1 = 400 } }   -- up-right, near, off the beam
      c = { r = { x0 = -300, y0 = 0, x1 = -200, y1 = 100 } }   -- left
    ''')
    assert lua.eval('GamepadMenu._geo.best(src, {b, a, c}, "right") == a')
    assert lua.eval('GamepadMenu._geo.best(src, {b, a, c}, "up") == b')
    assert lua.eval('GamepadMenu._geo.best(src, {b, a, c}, "left") == c')
    assert lua.eval('GamepadMenu._geo.best(src, {b, a, c}, "down") == nil')
    if report: report('ok geometry: back ranks, confirm names, arrows, beam rule')


def module_only():
    text = g.lua_script(NAME, SYNTHETIC).decode('utf8')
    return text[text.index(g.MENU_BEGIN):]


def check_injection():
    once = g.lua_script(NAME, SYNTHETIC)
    text, plain = once.decode('utf8'), SYNTHETIC.decode('utf8').replace('\r\n', '\n')
    assert g.lua_script(NAME, once) == once and g.lua_script(NAME, once.replace(b'\n', b'\r\n')) == once
    assert '\r' not in text and text.count(g.MENU_BEGIN) == text.count(g.MENU_END) == 1
    assert text.count(g.ENSURE) == 1 and g.UI_OPEN + g.ENSURE in text and text.endswith(g.MENU_END)
    block = text[text.index(g.MENU_BEGIN):]
    assert text.replace(block, '').replace(g.ENSURE, '') == plain.rstrip('\n') + '\n'
    stale = text.replace(block, g.MENU_BEGIN + 'GamepadMenu = nil\n' + g.MENU_END)
    assert g.lua_script(NAME, stale.encode('utf8')) == once
    rejected = 0
    for broken in (plain.replace(g.UI_OPEN, ''), plain.replace(g.UI_OPEN, g.UI_OPEN + g.UI_OPEN)):
        try:
            g.lua_script(NAME, broken.encode('utf8'))
        except AssertionError:
            rejected += 1
    assert rejected == 2
    return once


def run(script=None, report=None):
    synthetic = script is None
    if synthetic:
        script = check_injection()
    else:
        assert g.lua_script(NAME, script) == script
    text = script.decode('utf8')
    LuaRuntime().execute('assert(load(...))', text)
    check_geometry(report)
    if synthetic:
        chunk = text
    else:
        # A complete stock UI.lua cannot run in the mock: the bundle contributes its module, with the
        # synthetic UI.Open carrying the start call.
        chunk = g.lua_script(NAME, SYNTHETIC).decode('utf8').split(g.MENU_BEGIN)[0] + text[text.index(g.MENU_BEGIN):]
    focus_logs = scenario(chunk, report)
    lua_s, _ = lua_runtime(chunk)
    check_settings(lua_s, report)
    return {'menuLayerExecutedInMockRuntime': True, 'syntheticUiSource': synthetic,
            'anchorRequiredExactlyOnce': True, 'patchIdempotent': True, 'realtimeTimer': True,
            'popupBlocksMenuBelow': True, 'scrollListReachesClippedItems': True, 'tabsAndBack': True,
            'storyAdvanceSkipChoices': True, 'optionalCursor': True, 'idleWhileFightHudOwnsPad': True,
            'errorLoggedOnceAndRecovered': True, 'cursorOffAndPressSwallowedAfterFight': True,
            'uiOpenSurvivesStartError': True, 'stopReleasesPad': True, 'debugFocusLines': focus_logs, 'patchedLuaSyntaxPassed': True}


def run_bundle(source):
    import asset_tools as w
    _, raw = w.unityfs(w.transform(source))
    _, objects = w.serialized_objects(raw)
    script, = [raw[o['script_start']:o['script_start'] + o['script_length']]
               for o in objects if o.get('name') == NAME]
    return run(script)


if __name__ == '__main__':
    print(run(report=print))
