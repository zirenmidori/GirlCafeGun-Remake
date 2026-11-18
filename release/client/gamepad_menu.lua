-- Controller (Bluetooth/USB gamepad) navigation for menus, story scenes and every window outside a fight.
--
-- The layout of the game does not change. A focus frame moves between the controls that a finger could
-- tap at that moment, and the pad presses them the way a finger does:
--   * Candidates are the game's own click targets: every interactable Selectable (Button, Toggle, Slider,
--     InputField) plus the components that the client's Lua wires by hand (EventTriggerListener,
--     EventTrigger, LongPressButton, LongPushCount, ScrollItemPushEvent, RoleCardDrag).
--   * A candidate counts only if a tap on its centre would reach it: the layer asks the EventSystem's
--     raycasters, so a popup, its dark backdrop or a tutorial mask hides what lies below, exactly as for
--     touch. Items of a scroll list that are clipped by its viewport stay reachable; the list scrolls to them.
--   * D-pad or left stick moves the focus to the nearest candidate in that direction (the beam rule of
--     Android's FocusFinder). A presses it with the client's own Game.Utils.ExecutePointerDown/Up/Click
--     events, the calls of its UI test runner, so long-press and hold-to-repeat buttons work too.
--   * B taps the window's close/back/cancel button, or a full-screen "tap to close" backdrop.
--   * LB / RB switch the tab of the top tab bar (a ToggleGroup), or press a left/right arrow button.
--   * Right stick scrolls the list that holds the focus.
--   * Story scenes: A advances the dialogue (Cartoon:OnTouch); the d-pad reaches Skip, menu and choices.
--   * Select turns an optional cursor on and off: the left stick moves it, A taps under it.
-- While the fight HUD has the controls (gamepad_fight.lua), this layer stays idle and only sets
-- GamepadMenu.owner. Every C# call is guarded: an error is logged once ([pad] menu: ...) and the layer
-- carries on; after many errors in a row it turns itself off.
-- patch_gamepad.py places this file at the end of UI.lua, in a do-block, and starts it from UI.Open.
GamepadMenu = GamepadMenu or {}
local M = GamepadMenu

local BTN = { A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, L3 = 8, R3 = 9, START = 10, SELECT = 11 }

M.cfg = M.cfg or {
	dead        = 0.5,     -- stick threshold for a focus step
	repeatDelay = 0.38,    -- hold a direction: first repeat after this many seconds
	repeatGap   = 0.11,    -- then one step per this many seconds
	press       = { BTN.A },
	back        = { BTN.B },
	tabPrev     = { BTN.LB },
	tabNext     = { BTN.RB },
	skip        = { BTN.START },   -- story scenes: the Skip button
	cursor      = { BTN.SELECT },  -- left stick: pointer <-> focus steps
	stickPointer = true,   -- the left stick moves a pointer (like a mouse); the d-pad moves the focus
	rStickX     = 3, rStickY = 4,  -- same axis numbers as gamepad_fight.lua (Unity on Android)
	hatX        = 5, hatY = 6,
	scrollSpeed = 1.6,     -- right stick: viewport heights per second at full tilt
	cursorSpeed = 1.5,     -- pointer: screen heights per second at full tilt
	cursorCurve = 2.2,     -- pointer speed = full speed * tilt ^ curve (small tilts move it precisely)
	cursorDead  = 0.15,    -- pointer: stick dead zone (radial)
	cursorSlow  = 0.5,     -- pointer: speed share over a control it can press (easier to stop on it)
	cursorSize  = 0.075,   -- pointer sprite size, share of the screen height
	focusFrame  = false,   -- true: the old pulsing frame marks the focus instead of the pointer
	hoverEvery  = 0.05,    -- s: how often the control under the pointer is looked up
	bigArea     = 0.45,    -- a target that covers this share of the screen is a backdrop
	frame       = { 1.0, 0.80, 0.25 },  -- focus frame colour
	thickness   = 0.006,   -- frame thickness, share of the screen height
	debug       = false,   -- L3 + R3: log focus and button changes
}

-- ---------- small helpers ----------
local UGUI = U3D.UI
local ES = U3D.EventSystems
local V2, V3 = U3D.Vector2, U3D.Vector3

local KC_JOY0 = 330   -- KeyCode.JoystickButton0
local kc = {}
local function key(n)
	local k = kc[n]
	if not k then k = U3D.KeyCode.__CastFrom(KC_JOY0 + n); kc[n] = k end
	return U3D.Input.GetKey(k)
end
local function anyKey(list)
	for _, n in ipairs(list) do if key(n) then return true end end
	return false
end

local absent = {}
local function named(name)
	if absent[name] then return nil end
	local ok, v = pcall(U3D.Input.GetAxisRaw, name)
	if ok then return v end
	absent[name] = true
	return nil
end
local STOCK = { [3] = { "HandleFire", 1 }, [4] = { "RightHorizontal", 1 }, [5] = { "RightVertical", -1 } }
local function axis(n)
	if not n or n <= 0 then return 0 end
	local v = named("gcgpad_a" .. n)
	if v == nil and STOCK[n] then
		v = named(STOCK[n][1])
		if v then v = v * STOCK[n][2] end
	end
	return v or 0
end

local function now() return U3D.Time.realtimeSinceStartup end

local logged = {}
-- Login.lua lowers the Unity log filter, so a plain print never reaches logcat: lift it for our own lines
local function log(msg)
	local logger, filter
	pcall(function() logger = U3D.Debug.unityLogger; filter = logger.filterLogType; logger.filterLogType = 3 end)
	print("[pad] menu: " .. msg)
	if logger and filter then pcall(function() logger.filterLogType = filter end) end
end
local function logOnce(msg)
	if logged[msg] then return end
	logged[msg] = true
	log(msg)
end


-- ---------- controller support mode (Settings > Operation > Controller Support) ----------
-- Kept in the save as task value (32, 999): group 32 is UI_User's own settings group (Left-hand Mode is
-- 32/1002), so the server stores it like the other Operation settings. 0 (never set) and 1 = Default: the
-- controller layers as first released (fire keeps its first direction, plain dash, focus frame, cross
-- cursor). 2 = HealthS Claude Improved: free aim, lock-on, dash rules, the menu pointer.
GamepadMode = GamepadMode or {}
local Mode = GamepadMode
Mode.GROUP, Mode.ID, Mode.DEFAULT, Mode.IMPROVED = 32, 999, 1, 2
function Mode.Get()
	local ok, v = pcall(function() return me:GetTaskValue(Mode.GROUP, Mode.ID) end)
	return (ok and v == Mode.IMPROVED) and Mode.IMPROVED or Mode.DEFAULT
end
function Mode.Improved() return Mode.Get() == Mode.IMPROVED end
function Mode.Set(improved)
	local v = improved and Mode.IMPROVED or Mode.DEFAULT
	local ok, err = pcall(function() me:SetTaskValue(Mode.GROUP, Mode.ID, v) end)
	log('mode ' .. (improved and 'improved' or 'default') .. (ok and '' or (' not saved: ' .. tostring(err))))
end

-- The Operation page gets a "Controller Support" dropdown. The page does not scroll, so it goes into the
-- free right half of the Layout Settings section: a header on the Layout Settings line (a copy of Title3
-- without its line) and, in the Customize button's row (Btns), a Unity Dropdown made with the client's
-- own UnityEngine.UI.DefaultControls.CreateDropdown, dressed with the page's font, text colour and check
-- sprite. Positions follow the Customize button: the Chinese client's page differs from the English one.
-- The menu layer reads the dropdown's value every tick and saves a change (no Lua -> C# event hook needed).
Mode.LABELS = { title = 'Controller Support', default = 'Default', improved = 'HealthS Claude Improved' }
Mode.GAP, Mode.WIDTH, Mode.HEIGHT = 110, 400, 50   -- from Customize's right edge; dropdown size (page units)
-- The client puts a localized text back into a copied header (a script on the header or its text). A copy
-- keeps only the plain UI parts: every other script under it is removed (their names are logged once).
local KEEP = { Text = true, Image = true, RawImage = true, Outline = true, Shadow = true }
local function dropLocalized(tr)
	pcall(function()
		local cs = tr:GetComponentsInChildren(typeof(U3D.MonoBehaviour), true)
		local gone = {}
		for i = 0, cs.Length - 1 do
			local c = cs[i]
			local okName, n = pcall(function() return c:GetType().Name end)
			if okName and not KEEP[n] then gone[#gone + 1] = n; U3D.Object.DestroyImmediate(c) end
		end
		if #gone > 0 then logOnce('settings: header copy without ' .. table.concat(gone, ', ')) end
	end)
end
local function rt(tr) return tr:GetComponent(typeof(U3D.RectTransform)) end
function Mode.BuildSettings(page, region)
	local ok, err = pcall(function()
		if region:Find('GamepadTitle') then return end
		local btns = region:Find('Btns')
		local btn = rt(btns:Find('zidingyi'))
		-- right edge of Customize in the row's own space (its anchor is the row's left edge)
		local right = btn.anchoredPosition.x + btn.rect.width * (1 - btn.pivot.x)
		local x = right + Mode.GAP
		-- the page's look: the font and colour of a choice label, the check sprite of a joystick toggle
		local pageText = region:Find('Toggle/Tgl1/Text'):GetComponent(typeof(UGUI.Text))
		local check = region:Find('Toggle/Tgl1/Checkmark'):GetComponent(typeof(UGUI.Image))
		local function style(tx, value)
			tx.font, tx.fontSize, tx.color = pageText.font, pageText.fontSize, pageText.color
			tx.alignment = U3D.TextAnchor.MiddleLeft
			if value then tx.text = value end
		end
		-- header: Title3 moved right so that its diamond sits just left of the dropdown
		local src = region:Find('Title3')
		local title = U3D.Object.Instantiate(src.gameObject, region).transform
		title.gameObject.name = 'GamepadTitle'
		local srt, trt = rt(src), rt(title)
		local diamond = rt(src:Find('Image'))
		local brt = rt(btns)
		local rowLeft = brt.anchoredPosition.x - brt.rect.width * brt.pivot.x
		local w = srt.rect.width
		trt.anchoredPosition = V2(rowLeft + x - 30 + w * srt.pivot.x - w * 0.5 - diamond.anchoredPosition.x, srt.anchoredPosition.y)
		local line = title:Find('Line')
		if line then line.gameObject:SetActive(false) end
		dropLocalized(title)
		local titleText = title:Find('Text'):GetComponent(typeof(UGUI.Text))
		titleText.text = Mode.LABELS.title
		titleText.horizontalOverflow = U3D.HorizontalWrapMode.Overflow
		titleText.alignment = U3D.TextAnchor.MiddleLeft
		-- the dropdown
		local res = UGUI.DefaultControls.Resources()
		res.checkmark = check.sprite
		local go = UGUI.DefaultControls.CreateDropdown(res)
		go.name = 'GamepadMode'
		go.transform:SetParent(btns, false)
		local drt = rt(go.transform)
		drt.anchorMin, drt.anchorMax, drt.pivot = V2(0, 0.5), V2(0, 0.5), V2(0, 0.5)
		drt.anchoredPosition = V2(x, 0)
		drt.sizeDelta = V2(Mode.WIDTH, Mode.HEIGHT)
		local dd = go:GetComponent(typeof(UGUI.Dropdown))
		-- box: light, like the page's panels; the open list below it in the same colours
		go:GetComponent(typeof(UGUI.Image)).color = U3D.Color(1, 1, 1, 0.85)
		local template = go.transform:Find('Template')
		rt(template).sizeDelta = V2(0, Mode.HEIGHT * 2 + 12)
		template:GetComponent(typeof(UGUI.Image)).color = U3D.Color(0.97, 0.97, 0.98, 0.98)
		local item = template:Find('Viewport/Content/Item')
		rt(item).sizeDelta = V2(0, Mode.HEIGHT)
		rt(template:Find('Viewport/Content')).sizeDelta = V2(0, Mode.HEIGHT + 6)
		local itemBg = item:Find('Item Background'):GetComponent(typeof(UGUI.Image))
		itemBg.color = U3D.Color(0.55, 0.85, 1, 0.55)
		local itemCheck = item:Find('Item Checkmark')
		local icr = rt(itemCheck)
		icr.sizeDelta = V2(32, 30)
		itemCheck:GetComponent(typeof(UGUI.Image)).color = U3D.Color(1, 1, 1, 1)
		local itemLabel = item:Find('Item Label')
		local ilr = rt(itemLabel)
		ilr.offsetMin = V2(46, 1)
		style(itemLabel:GetComponent(typeof(UGUI.Text)))
		local label = go.transform:Find('Label')
		rt(label).offsetMin = V2(16, 2)
		style(label:GetComponent(typeof(UGUI.Text)))
		-- the arrow: a chevron of two thin bars in the text colour (no arrow sprite or glyph in the client)
		local arrow = go.transform:Find('Arrow')
		arrow:GetComponent(typeof(UGUI.Image)).enabled = false
		for _, bar in ipairs({ { -5, -45 }, { 5, 45 } }) do
			local b = U3D.GameObject('Chevron')
			b.transform:SetParent(arrow, false)
			local bi = b:AddComponent(typeof(UGUI.Image))
			bi.color, bi.raycastTarget = pageText.color, false
			local br = rt(b.transform)
			br.sizeDelta = V2(15, 4)
			br.anchoredPosition = V2(bar[1], 0)
			b.transform.localRotation = U3D.Quaternion.Euler(0, 0, bar[2])
		end
		local opts = CS.System.Collections.Generic.List(CS.System.String)()
		opts:Add(Mode.LABELS.default)
		opts:Add(Mode.LABELS.improved)
		dd:ClearOptions()
		dd:AddOptions(opts)
		Mode.dropdown = dd
		local function show(improved)
			Mode.shown = improved and 1 or 0
			dd.value = Mode.shown
			dd:RefreshShownValue()
		end
		page.gamepadModeShow = show
		show(Mode.Improved())
		log(string.format('settings: Controller Support dropdown built (Customize right edge %.0f, dropdown at %.0f)', right, x))
	end)
	if not ok then logOnce('settings: ' .. tostring(err)) end
end
-- called every menu tick: a value picked in the dropdown (finger, pad or pointer) is saved
function Mode.Poll()
	local dd = Mode.dropdown
	if not dd then return end
	local ok, v = pcall(function() return dd.value end)
	if not ok then Mode.dropdown = nil; return end   -- the page was destroyed
	if v ~= Mode.shown then
		Mode.shown = v
		Mode.Set(v == 1)
	end
end
-- the page shows the stored choice each time the Operation tab opens
function Mode.ShowSettings(page)
	if page.gamepadModeShow then pcall(page.gamepadModeShow, Mode.Improved()) end
end

local function alive(o)
	if o == nil then return false end
	local ok, dead = pcall(Game.Utils.IsDestroyed, o)
	return ok and not dead
end

-- ---------- pure geometry (screen pixels, y up); also run by test_gamepad.py ----------
local G = {}
M._geo = G

function G.center(r) return (r.x0 + r.x1) * 0.5, (r.y0 + r.y1) * 0.5 end

-- r lies beyond src in direction d (both edges further along d)
function G.inDir(src, r, d)
	if d == 'right' then return src.x0 < r.x0 + 0.5 and src.x1 < r.x1 - 0.5 and r.x0 > src.x0 + (src.x1 - src.x0) * 0.25
	elseif d == 'left' then return src.x1 > r.x1 - 0.5 and src.x0 > r.x0 + 0.5 and r.x1 < src.x1 - (src.x1 - src.x0) * 0.25
	elseif d == 'up' then return src.y0 < r.y0 + 0.5 and src.y1 < r.y1 - 0.5 and r.y0 > src.y0 + (src.y1 - src.y0) * 0.25
	else return src.y1 > r.y1 - 0.5 and src.y0 > r.y0 + 0.5 and r.y1 < src.y1 - (src.y1 - src.y0) * 0.25 end
end

local function horizontal(d) return d == 'left' or d == 'right' end

function G.inBeam(src, r, d)
	if horizontal(d) then return r.y1 > src.y0 and r.y0 < src.y1 end
	return r.x1 > src.x0 and r.x0 < src.x1
end

function G.major(src, r, d)
	local v
	if d == 'right' then v = r.x0 - src.x1 elseif d == 'left' then v = src.x0 - r.x1
	elseif d == 'up' then v = r.y0 - src.y1 else v = src.y0 - r.y1 end
	return math.max(0, v)
end

function G.majorFar(src, r, d)
	local v
	if d == 'right' then v = r.x1 - src.x1 elseif d == 'left' then v = src.x0 - r.x0
	elseif d == 'up' then v = r.y1 - src.y1 else v = src.y0 - r.y0 end
	return math.max(1, v)
end

function G.minor(src, r, d)
	local sx, sy = G.center(src)
	local rx, ry = G.center(r)
	if horizontal(d) then return math.abs(sy - ry) end
	return math.abs(sx - rx)
end

local function beamBeats(src, a, b, d)
	local aIn, bIn = G.inBeam(src, a, d), G.inBeam(src, b, d)
	if bIn or not aIn then return false end
	if not G.inDir(src, b, d) then return true end
	if horizontal(d) then return true end
	return G.major(src, a, d) < G.majorFar(src, b, d)
end

local function score(src, r, d)
	local maj, min = G.major(src, r, d), G.minor(src, r, d)
	return 13 * maj * maj + min * min
end

-- best rect of list (each item has .r) from src in direction d, or nil
function G.best(src, list, d, skip)
	local best
	for _, c in ipairs(list) do
		local r = c.nr or c.r
		if c ~= skip and G.inDir(src, r, d) then
			local br = best and (best.nr or best.r)
			if not best then best = c
			elseif beamBeats(src, r, br, d) then best = c
			elseif not beamBeats(src, br, r, d) and score(src, r, d) < score(src, br, d) then best = c end
		end
	end
	return best
end

-- rank of a name as a "back" target: 1 close, 2 back/return, 3 cancel/no; nil otherwise
function G.backRank(name)
	local n = string.lower(name or '')
	if n:find('background', 1, true) or n:find('feedback', 1, true) or n:find('backpack', 1, true) then return nil end
	if n:find('close', 1, true) or n:find('exit', 1, true) then return 1 end
	if n:find('back', 1, true) or n:find('return', 1, true) or n:find('fanhui', 1, true) then return 2 end
	if n:find('cancel', 1, true) or n == 'btnno' or n == 'no' or n:find('btn_no', 1, true) then return 3 end
	return nil
end

-- a full-screen target whose tap is the screen's main action ("Tap Screen to Start", "tap to continue")
function G.isMainAction(name)
	local n = string.lower(name or '')
	for _, w in ipairs({ 'start', 'tap', 'continue', 'next', 'click', 'touch' }) do
		if n:find(w, 1, true) then return true end
	end
	return false
end

-- the box that stands for a main action in focus moves: a third of it, at its centre
function G.mainBox(r)
	local w, h = (r.x1 - r.x0) / 6, (r.y1 - r.y0) / 6
	local cx, cy = G.center(r)
	return { x0 = cx - w, y0 = cy - h, x1 = cx + w, y1 = cy + h }
end

-- a full-screen target that closes a popup when tapped outside it
function G.isBackdrop(name)
	local n = string.lower(name or '')
	for _, w in ipairs({ 'mask', 'bg', 'black', 'blank', 'shadow', 'empty', 'close' }) do
		if n:find(w, 1, true) then return true end
	end
	return false
end

function G.arrowSide(name)
	local n = string.lower(name or '')
	if n:find('left', 1, true) or n:find('prev', 1, true) then return -1 end
	if n:find('right', 1, true) or n:find('next', 1, true) then return 1 end
	return nil
end

function G.isConfirm(name)
	local n = string.lower(name or '')
	return n:find('confirm', 1, true) or n:find('sure', 1, true) or n:find('yes', 1, true)
		or n:match('^btn_?ok') or n == 'ok' or n:match('_ok$') or false
end

-- members of one toggle group in reading order (left to right, or top to bottom when stacked)
function G.order(list)
	local x0, x1, y0, y1 = math.huge, -math.huge, math.huge, -math.huge
	for _, c in ipairs(list) do
		local cx, cy = G.center(c.r)
		x0, x1, y0, y1 = math.min(x0, cx), math.max(x1, cx), math.min(y0, cy), math.max(y1, cy)
	end
	local byX = (x1 - x0) >= (y1 - y0)
	table.sort(list, function(a, b)
		local ax, ay = G.center(a.r)
		local bx, by = G.center(b.r)
		if byX then return ax < bx end
		return ay > by
	end)
	return list
end

-- ---------- engine access ----------
local hitList, ped, pedSystem
local function eventSystem() return ES.EventSystem.current end

local function rayHit(x, y)
	local es = eventSystem()
	if not es then return nil end
	if not hitList then hitList = CS.System.Collections.Generic.List(ES.RaycastResult)() end
	if not ped or pedSystem ~= es then ped = ES.PointerEventData(es); pedSystem = es end
	ped.position = V2(x, y)
	hitList:Clear()
	es:RaycastAll(ped, hitList)
	if hitList.Count == 0 then return nil end
	return hitList[0].gameObject
end

local overlayMode
local function isOverlay(canvas)
	if not overlayMode then overlayMode = U3D.RenderMode.ScreenSpaceOverlay end
	return canvas.renderMode == overlayMode
end

-- screen rect of a RectTransform: {x0, y0, x1, y1, order}
local function screenRect(rt)
	local canvas = rt:GetComponentInParent(typeof(U3D.Canvas))
	if not canvas then return nil end
	local root = canvas.rootCanvas
	local cam = nil
	if not isOverlay(root) then cam = root.worldCamera end
	local r = rt.rect
	local a = U3D.RectTransformUtility.WorldToScreenPoint(cam, rt:TransformPoint(V3(r.xMin, r.yMin, 0)))
	local b = U3D.RectTransformUtility.WorldToScreenPoint(cam, rt:TransformPoint(V3(r.xMax, r.yMax, 0)))
	return { x0 = math.min(a.x, b.x), y0 = math.min(a.y, b.y), x1 = math.max(a.x, b.x), y1 = math.max(a.y, b.y),
		order = root.sortingOrder }
end

local EXTRA = { 'Game.EventTriggerListener', 'UnityEngine.EventSystems.EventTrigger', 'Game.LongPressButton',
	'Game.LongPushCount', 'Game.ScrollItemPushEvent', 'Game.RoleCardDrag' }
local extraTypes
local function typesOf()
	if extraTypes then return extraTypes end
	extraTypes = {}
	for _, path in ipairs(EXTRA) do
		local t = CS
		for part in path:gmatch('[^.]+') do
			local ok, v = pcall(function() return t[part] end)
			t = ok and v or nil
			if not t then break end
		end
		if t then
			local ok, ty = pcall(typeof, t)
			if ok and ty then extraTypes[#extraTypes + 1] = ty end
		end
	end
	return extraTypes
end

local scrollTypes
local function scrollTypesOf()
	if scrollTypes then return scrollTypes end
	scrollTypes = { typeof(UGUI.ScrollRect) }
	local ok, t = pcall(function() return typeof(UGUI.LoopScrollRect) end)
	if ok and t then scrollTypes[2] = t end
	return scrollTypes
end

local function scrollOf(tr, cache)
	local t = tr.parent
	local walked = {}
	local found = false
	while t do
		local id = t:GetInstanceID()
		local c = cache[id]
		if c ~= nil then found = c; break end
		walked[#walked + 1] = id
		for _, ty in ipairs(scrollTypesOf()) do
			local s = t:GetComponent(ty)
			if s and s.isActiveAndEnabled then found = s; break end
		end
		if found then break end
		t = t.parent
	end
	for _, id in ipairs(walked) do cache[id] = found end
	return found or nil
end

local function viewportOf(sr)
	local ok, vp = pcall(function() return sr.viewport end)
	if ok and vp then return vp end
	return sr.transform
end

local windowRoot
local function windowName(tr)
	if not windowRoot then
		local ok, r = pcall(function() return Game.CanvasCamera.Root end)
		windowRoot = ok and r or false
	end
	local t, last = tr, tr
	while t do
		local p = t.parent
		if p == nil or (windowRoot and p == windowRoot) then return t.name end
		last = t
		t = p
	end
	return last.name
end

local typeCache = {}
local function kindOf(sel)
	local function is(name)
		local ty = typeCache[name]
		if ty == nil then
			local ok, t = pcall(function() return typeof(UGUI[name]) end)
			ty = ok and t or false
			typeCache[name] = ty
		end
		return ty and ty:IsInstanceOfType(sel)
	end
	if is('Scrollbar') then return nil end
	if is('Slider') then return 'slider' end
	if is('Toggle') then return 'toggle' end
	if is('InputField') then return 'input' end
	return 'button'
end

-- ---------- candidates ----------
local st = {
	focus = nil, list = {}, byId = {}, nav = {}, memory = {},
	shown = false, cursorOn = false, cx = 0, cy = 0,
	prev = {}, dirHeld = nil, dirNext = 0, pending = nil,
	pressed = nil, lastCheck = 0, lastTick = 0, errors = 0,
	owner = 'menu', hudCheck = 0, hover = nil, hoverAt = 0, collectAt = 0,
	improved = false, stickPointer = false, modeAt = 0,
}

local function owner(go, byId)
	local t = go and go.transform
	while t do
		local c = byId[t.gameObject:GetInstanceID()]
		if c then return c end
		t = t.parent
	end
	return nil
end

local function collect()
	local list, byId = {}, {}
	local sw, sh = U3D.Screen.width, U3D.Screen.height
	local function add(comp, kind)
		local go = comp.gameObject
		local id = go:GetInstanceID()
		if byId[id] then return end
		local c = { go = go, rt = go.transform, id = id, kind = kind, comp = comp }
		byId[id] = c
		list[#list + 1] = c
	end
	local sels = UGUI.Selectable.allSelectables
	for i = 0, sels.Count - 1 do
		local s = sels[i]
		if s and s:IsInteractable() then
			local kind = kindOf(s)
			if kind then add(s, kind) end
		end
	end
	for _, ty in ipairs(typesOf()) do
		local arr = U3D.Object.FindObjectsOfType(ty)
		for i = 0, arr.Length - 1 do
			local c = arr[i]
			if c and c.isActiveAndEnabled then add(c, 'trigger') end
		end
	end

	-- keep what a tap would reach
	local result, scrolls, vpHit, vpRect = {}, {}, {}, {}
	for _, c in ipairs(list) do
		local ok, r = pcall(screenRect, c.rt)
		if ok and r and (r.x1 - r.x0) >= 4 and (r.y1 - r.y0) >= 4 then
			c.r = r
			local cx, cy = G.center(r)
			local onScreen = cx >= 0 and cx <= sw and cy >= 0 and cy <= sh
			local hit = onScreen and rayHit(cx, cy) or nil
			if hit and owner(hit, byId) == c then
				c.reach = true
			elseif onScreen and (r.x1 - r.x0) * (r.y1 - r.y0) >= 0.04 * sw * sh then
				-- a large target (a backdrop, a banner) may carry pictures on its centre: try four more points
				for _, q in ipairs({ { 0.25, 0.25 }, { 0.75, 0.25 }, { 0.25, 0.75 }, { 0.75, 0.75 } }) do
					local h = rayHit(r.x0 + (r.x1 - r.x0) * q[1], r.y0 + (r.y1 - r.y0) * q[2])
					if h and owner(h, byId) == c then c.reach = true; c.probe = q; break end
				end
			end
			local sr = scrollOf(c.rt, scrolls)
			if sr then
				c.scroll = sr
				if not c.reach then
					-- clipped by its list: reachable when the list itself can be touched
					local key = sr:GetInstanceID()
					local open = vpHit[key]
					if open == nil then
						open = false
						local vr = screenRect(viewportOf(sr))
						if vr then
							local vx, vy = G.center(vr)
							local h = rayHit(vx, vy)
							open = h ~= nil and h.transform:IsChildOf(sr.transform)
							vpRect[key] = vr
						end
						vpHit[key] = open
					end
					if open then
						local vr = vpRect[key]
						local inside = vr and cx >= vr.x0 and cx <= vr.x1 and cy >= vr.y0 and cy <= vr.y1
						if not inside then c.reach = true; c.clipped = true end
					end
				end
			end
			if c.reach then
				c.big = (r.x1 - r.x0) * (r.y1 - r.y0) >= M.cfg.bigArea * sw * sh
				c.win = windowName(c.rt)
				result[#result + 1] = c
			end
		end
	end
	local nav = {}
	for _, c in ipairs(result) do
		-- a full-screen button (the title's BtnLogin, "Tap Screen to Start") is that screen's main action,
		-- unless its name says backdrop; a full-screen hand-wired trigger (often a drag area) only when it is
		-- a whole window or says so by name. A main action stays in the focus moves, through a box at its centre
		if c.big and not G.isBackdrop(c.go.name)
			and (c.kind ~= 'trigger' or c.go.name == c.win or G.isMainAction(c.go.name)) then
			c.main = true
			c.nr = G.mainBox(c.r)
		end
		if not c.big or c.main then nav[#nav + 1] = c end
	end
	if #nav == 0 then for _, c in ipairs(result) do nav[#nav + 1] = c end end
	local reach = {}
	for _, c in ipairs(result) do reach[c.id] = c end
	st.list, st.byId, st.nav, st.all = result, reach, nav, byId
	return result
end

local function inNav(c)
	for _, n in ipairs(st.nav) do if n == c then return true end end
	return false
end

-- ---------- story scenes ----------
local function storyCartoon()
	if not UI.IsOpen('UI_Cartoon') then return nil end
	local ok, playing = pcall(function() return Game.CartoonMgr.IsPlaying end)
	if not (ok and playing) then return nil end
	local ok2, cartoon = pcall(function() return Game.CartoonMgr.Ins:GetCartoonNow() end)
	return ok2 and cartoon or nil
end

local function choices()
	local out = {}
	for _, c in ipairs(st.nav) do
		if string.find(c.go.name, 'BtnChoice', 1, true) then out[#out + 1] = c end
	end
	return out
end

-- ---------- focus ----------
local function scrollIntoView(c)
	local sr = c.scroll
	if not sr then return end
	local vp = viewportOf(sr)
	local content = sr.content
	if not (vp and content) then return end
	local r = c.rt.rect
	local a = vp:InverseTransformPoint(c.rt:TransformPoint(V3(r.xMin, r.yMin, 0)))
	local b = vp:InverseTransformPoint(c.rt:TransformPoint(V3(r.xMax, r.yMax, 0)))
	local vr = vp.rect
	local pad = 8
	local dx, dy = 0, 0
	if sr.vertical then
		if b.y > vr.yMax then dy = vr.yMax - b.y - pad
		elseif a.y < vr.yMin then dy = vr.yMin - a.y + pad end
	end
	if sr.horizontal then
		if a.x < vr.xMin then dx = vr.xMin - a.x + pad
		elseif b.x > vr.xMax then dx = vr.xMax - b.x - pad end
	end
	if dx == 0 and dy == 0 then return end
	local world = vp:TransformVector(V3(dx, dy, 0))
	local d = content.parent:InverseTransformVector(world)
	local p = content.anchoredPosition
	content.anchoredPosition = V2(p.x + d.x, p.y + d.y)
	pcall(function() sr:StopMovement() end)
end

local function describe(c)
	if not c then return 'none' end
	return (c.win or '?') .. '/' .. c.go.name .. ' (' .. c.kind .. ')'
end

local function setFocus(c)
	if c == st.focus then return end
	st.focus = c
	if c then
		st.memory[c.win] = c.go
		if c.clipped or c.scroll then pcall(scrollIntoView, c) end
	end
	if M.cfg.debug then log('focus ' .. describe(c)) end
end

local SIDE_WINDOWS = { UI_Player = true }

local function topOrder(list)
	local best = -math.huge
	for _, c in ipairs(list) do if c.r.order > best then best = c.r.order end end
	return best
end

local function guideTarget()
	if not UI.IsOpen('UI_Guide') then return nil end
	local g = UI.GetClass('UI_Guide')
	local obj = g and g.obj
	if not alive(obj) then return nil end
	local ok, go = pcall(function() return obj.gameObject end)
	if not ok then return nil end
	local c = owner(go, st.byId)
	return c
end

local function pickInitial(anyway)
	local nav = st.nav
	if #nav == 0 then return nil end
	local g = guideTarget()
	if g then return g end
	if not anyway and storyCartoon() then
		local ch = choices()
		return ch[1]
	end
	-- the page or popup on top; the resource bar sorts above every page, so it wins only when alone
	local pool = {}
	for _, c in ipairs(nav) do if not SIDE_WINDOWS[c.win] then pool[#pool + 1] = c end end
	if #pool == 0 then pool = nav end
	local top = topOrder(pool)
	local inTop = {}
	for _, c in ipairs(pool) do if c.r.order == top then inTop[#inTop + 1] = c end end
	-- the control last used in this window
	for _, c in ipairs(inTop) do
		local m = st.memory[c.win]
		if m and m == c.go then return c end
	end
	for _, c in ipairs(inTop) do
		if c.main then return c end
	end
	for _, c in ipairs(inTop) do
		if G.isConfirm(c.go.name) then return c end
	end
	local sw, sh = U3D.Screen.width * 0.5, U3D.Screen.height * 0.5
	local best, bd
	for _, c in ipairs(inTop) do
		local x, y = G.center(c.r)
		local d = (x - sw) ^ 2 + (y - sh) ^ 2
		if not bd or d < bd then best, bd = c, d end
	end
	return best
end

-- is the focused control still where a tap would reach it?
local function focusValid()
	local c = st.focus
	if not c or not alive(c.go) or not c.go.activeInHierarchy then return false end
	if c.comp and c.kind ~= 'trigger' then
		local ok, on = pcall(function() return c.comp:IsInteractable() end)
		if ok and not on then return false end
	end
	local ok, r = pcall(screenRect, c.rt)
	if not ok or not r then return false end
	c.r = r
	if c.clipped then return true end
	local x, y = G.center(r)
	if c.probe then x, y = r.x0 + (r.x1 - r.x0) * c.probe[1], r.y0 + (r.y1 - r.y0) * c.probe[2] end
	local hit = rayHit(x, y)
	return hit ~= nil and owner(hit, st.all or st.byId) == c
end

local function refresh(keep)
	collect()
	if keep and st.focus and st.byId[st.focus.id] then
		st.focus = st.byId[st.focus.id]
		return
	end
	local story = storyCartoon()
	if story and not st.focus and #choices() == 0 and not guideTarget() then return end
	setFocus(pickInitial())
end

-- ---------- scrolling ----------
local function canScroll(sr, d)
	local vp = viewportOf(sr)
	local vr, cr = screenRect(vp), screenRect(sr.content)
	if not (vr and cr) then return false end
	if d == 'down' then return sr.vertical and cr.y0 < vr.y0 - 2
	elseif d == 'up' then return sr.vertical and cr.y1 > vr.y1 + 2
	elseif d == 'left' then return sr.horizontal and cr.x0 < vr.x0 - 2
	else return sr.horizontal and cr.x1 > vr.x1 + 2 end
end

-- move the list content by (dx, dy) viewport units; positive dy shows what lies below
local function shiftContent(sr, dx, dy)
	local vp = viewportOf(sr)
	local content = sr.content
	local world = vp:TransformVector(V3(-dx, dy, 0))
	local d = content.parent:InverseTransformVector(world)
	local p = content.anchoredPosition
	content.anchoredPosition = V2(p.x + d.x, p.y + d.y)
	pcall(function() sr:StopMovement() end)
end

local function nudge(c, d)
	local sr = c and c.scroll
	if not sr or not canScroll(sr, d) then return false end
	local r = c.rt.rect
	local step = (horizontal(d) and r.width or r.height) * 1.05
	if d == 'down' then shiftContent(sr, 0, step)
	elseif d == 'up' then shiftContent(sr, 0, -step)
	elseif d == 'right' then shiftContent(sr, step, 0)
	else shiftContent(sr, -step, 0) end
	return true
end

-- ---------- actions ----------
-- A finger sends pointer-enter before pointer-down; a Selectable shows its pressed look only when the
-- pointer is inside it. Down / up / click come from the client's own helpers (as before).
local function pointerInside(go, inside)
	if not alive(go) then return end   -- its window closed meanwhile
	local sel = go:GetComponent(typeof(UGUI.Selectable))
	if not sel then return end
	local es = eventSystem()
	if not es then return end
	if not ped or pedSystem ~= es then ped = ES.PointerEventData(es); pedSystem = es end
	ped.position = V2(st.cx, st.cy)
	pcall(function() if inside then sel:OnPointerEnter(ped) else sel:OnPointerExit(ped) end end)
end

local function pressDown(go)
	st.pressed = go
	if st.improved then pointerInside(go, true) end
	Game.Utils.ExecutePointerDownEvents(go)
end

local function pressUp(click)
	local go = st.pressed
	st.pressed = nil
	if not alive(go) then return end
	Game.Utils.ExecutePointerUpEvents(go)
	if click then Game.Utils.ExecuteClickEvents(go) end
	-- the pointer still rests on it: it stays "entered", as under a mouse
	if not (st.cursorOn and st.hover and st.hover.go == go) then pointerInside(go, false) end
end

local function move(d)
	if not focusValid() then refresh(false) else refresh(true) end
	local f = st.focus
	if not f then
		setFocus(pickInitial(true))
		return
	end
	if f.kind == 'slider' and horizontal(d) then
		local s = f.comp
		local step = (s.maxValue - s.minValue) / (s.wholeNumbers and math.max(1, s.maxValue - s.minValue) or 20)
		s.value = s.value + (d == 'right' and step or -step)
		return
	end
	local b = G.best(f.nr or f.r, st.nav, d, f)
	if b then setFocus(b); return end
	if nudge(f, d) then st.pending = { d = d, at = now() + 0.08, tries = 2 } end
end

local function back()
	refresh(true)
	local best, br
	for _, c in ipairs(st.list) do
		local rank = G.backRank(c.go.name)
		if not rank and c.big and G.isBackdrop(c.go.name) then rank = 4 end
		if rank then
			-- higher window first, then the lower rank, then the one nearest the top right corner
			local x, y = G.center(c.r)
			local key = { -c.r.order, rank, -(x + y) }
			if not br or key[1] < br[1] or (key[1] == br[1] and (key[2] < br[2] or (key[2] == br[2] and key[3] < br[3]))) then
				best, br = c, key
			end
		end
	end
	if M.cfg.debug then log('back ' .. describe(best)) end
	if best then
		pressDown(best.go)
		pressUp(true)
	end
end

local function tab(side)
	refresh(true)
	-- toggle groups among the reachable toggles
	local groups, order = {}, {}
	for _, c in ipairs(st.list) do
		if c.kind == 'toggle' then
			local ok, g = pcall(function() return c.comp.group end)
			if ok and g then
				local id = g:GetInstanceID()
				if not groups[id] then groups[id] = {}; order[#order + 1] = id end
				table.insert(groups[id], c)
			end
		end
	end
	local pick, py
	for _, id in ipairs(order) do
		local g = groups[id]
		if #g >= 2 then
			local top = -math.huge
			for _, c in ipairs(g) do top = math.max(top, c.r.y1) end
			-- the tab bar nearest the top of the screen, in the highest window
			local key = g[1].r.order * 100000 + top
			if not py or key > py then pick, py = g, key end
		end
	end
	if pick then
		G.order(pick)
		local cur = 1
		for i, c in ipairs(pick) do if c.comp.isOn then cur = i end end
		local nxt = pick[cur + side]
		if nxt then
			if M.cfg.debug then log('tab ' .. describe(nxt)) end
			pressDown(nxt.go); pressUp(true)
			if st.focus and st.focus.kind == 'toggle' then setFocus(nxt) end
		end
		return
	end
	-- arrow buttons (previous / next girl, page, chapter)
	local best, bo
	for _, c in ipairs(st.nav) do
		if G.arrowSide(c.go.name) == side and (not bo or c.r.order > bo) then best, bo = c, c.r.order end
	end
	if best then pressDown(best.go); pressUp(true) end
end

local function skipStory()
	refresh(true)
	for _, c in ipairs(st.nav) do
		if string.find(string.lower(c.go.name), 'skip', 1, true) then
			pressDown(c.go); pressUp(true)
			return
		end
	end
end

-- The list the right stick moves when the focus is in none. The scene scan is costly, so its result
-- (also "no list") is kept for SCROLL_RESCAN seconds while the stick stays tilted.
local SCROLL_RESCAN = 0.25
local function largestScroll()
	local t = now()
	local cached = st.scrollPick
	if cached and t - cached.at < SCROLL_RESCAN
		and (cached.sr == nil or (alive(cached.sr) and cached.sr.isActiveAndEnabled)) then
		return cached.sr
	end
	-- the largest reachable list
	local best, ba
	for _, ty in ipairs(scrollTypesOf()) do
		local arr = U3D.Object.FindObjectsOfType(ty)
		for i = 0, arr.Length - 1 do
			local s = arr[i]
			local vr = s.isActiveAndEnabled and screenRect(viewportOf(s))
			if vr then
				local x, y = G.center(vr)
				local h = rayHit(x, y)
				if h and h.transform:IsChildOf(s.transform) then
					local a = (vr.x1 - vr.x0) * (vr.y1 - vr.y0)
					if not ba or a > ba then best, ba = s, a end
				end
			end
		end
	end
	st.scrollPick = { sr = best, at = t }
	return best
end

local function scrollBy(rx, ry, dt)
	-- pointer: the list under it; else the list that holds the focus
	local c = st.cursorOn and st.hover or st.focus
	local sr = c and c.scroll
	if not sr then sr = largestScroll() end
	if not sr then return end
	local vr = viewportOf(sr).rect
	local k = M.cfg.scrollSpeed * dt
	-- raw stick axes: right and down are positive, so they map straight to "show what lies right / below"
	shiftContent(sr, sr.horizontal and rx * vr.width * k or 0, sr.vertical and ry * vr.height * k or 0)
end

-- ---------- overlay: pointer (and the optional focus frame) ----------
-- sprite path in the client (UI_Guide atlas) and the tip point as a share of the sprite (121 x 118 px)
local CURSOR_SPRITES = {
	{ key = 'arrow', path = 'UI/UI_Guide/common_guide_hand.png', tip = { 0.25, 0.75 } },
	{ key = 'hand', path = 'UI/UI_Guide/common_guide_hand2.png', tip = { 0.13, 0.87 } },
}
local function makeImage(parent, name, color)
	local go = U3D.GameObject(name)
	-- hidden until placed: a new Image is a 100 x 100 white square at the bottom-left anchor
	go:SetActive(false)
	go.transform:SetParent(parent, false)
	local img = go:AddComponent(typeof(UGUI.Image))
	img.raycastTarget = false
	img.color = color
	local rt = go:GetComponent(typeof(U3D.RectTransform))
	rt.anchorMin = V2(0, 0); rt.anchorMax = V2(0, 0); rt.pivot = V2(0, 0)
	return { go = go, rt = rt, img = img }
end

local function overlay()
	local o = M.overlay
	if o and alive(o.root) then return o end
	local root = U3D.GameObject('GamepadMenuOverlay')
	U3D.Object.DontDestroyOnLoad(root)
	local canvas = root:AddComponent(typeof(U3D.Canvas))
	canvas.renderMode = U3D.RenderMode.ScreenSpaceOverlay
	canvas.sortingOrder = 32000
	local f = M.cfg.frame
	o = { root = root, bars = {}, cursor = {} }
	for i = 1, 4 do o.bars[i] = makeImage(root.transform, 'Frame' .. i, U3D.Color(f[1], f[2], f[3], 1)) end
	o.cursor[1] = makeImage(root.transform, 'CursorShadow', U3D.Color(0, 0, 0, 0.6))
	o.cursor[2] = makeImage(root.transform, 'CursorH', U3D.Color(1, 1, 1, 1))
	o.cursor[3] = makeImage(root.transform, 'CursorV', U3D.Color(1, 1, 1, 1))
	-- the tutorial's own pointer sprites: the arrow, and the hand over a control that can be pressed.
	-- Without them (a client that lacks the atlas) the white cross above stays the pointer.
	for _, s in ipairs(CURSOR_SPRITES) do
		local item = makeImage(root.transform, 'Cursor_' .. s.key, U3D.Color(1, 1, 1, 1))
		item.img.preserveAspect = true
		item.rt.pivot = V2(s.tip[1], s.tip[2])   -- the tip of the arrow / finger sits on the pointer
		item.path = s.path
		o[s.key] = item
	end
	M.overlay = o
	return o
end

local function place(item, x, y, w, h)
	item.rt.anchoredPosition = V2(x, y)
	item.rt.sizeDelta = V2(w, h)
end

local function showFrame(r)
	local o = overlay()
	local t = math.max(3, U3D.Screen.height * M.cfg.thickness)
	local pulse = 0.65 + 0.35 * math.abs(math.sin(now() * 3.2))
	local g = 3   -- gap between the control and the frame
	local x0, y0, x1, y1 = r.x0 - g - t, r.y0 - g - t, r.x1 + g, r.y1 + g
	-- a full-screen target (the title's tap area) gets its frame on the screen edges
	local sw, sh = U3D.Screen.width, U3D.Screen.height
	x0, y0 = math.max(0, x0), math.max(0, y0)
	x1, y1 = math.min(sw - t, x1), math.min(sh - t, y1)
	local w, h = x1 - x0 + t, y1 - y0 + t
	place(o.bars[1], x0, y0, w, t)          -- bottom
	place(o.bars[2], x0, y1, w, t)          -- top
	place(o.bars[3], x0, y0, t, h)          -- left
	place(o.bars[4], x1, y0, t, h)          -- right
	local f = M.cfg.frame
	local color = U3D.Color(f[1], f[2], f[3], pulse)
	for i = 1, 4 do
		o.bars[i].img.color = color
		o.bars[i].go:SetActive(true)
	end
end

local function hideFrame()
	local o = M.overlay
	if not (o and alive(o.root)) then return end
	for i = 1, 4 do o.bars[i].go:SetActive(false) end
end

-- the pointer at (st.cx, st.cy): the hand over a control that can be pressed (and in focus steps), else
-- the arrow; a little smaller while A is held, like a finger pressing
-- The game unloads the tutorial atlas with its scene, and an Image whose sprite is gone draws a plain
-- square. So the sprites are checked before each draw and loaded again when they are gone; until both
-- load, the white cross is the pointer. A failed load is tried again after a second.
-- Game.Utils.IsDestroyed takes only a GameObject; a destroyed asset (Sprite, Texture) equals nil in Unity
local function assetAlive(o)
	if o == nil then return false end
	local ok, gone = pcall(function() return o:Equals(nil) end)
	return ok and not gone
end
local function spriteOk(sp)
	if not assetAlive(sp) then return false end
	local ok, tex = pcall(function() return sp.texture end)   -- an unloaded atlas leaves no texture behind
	return ok and assetAlive(tex)
end
local function spritesReady(o)
	local ready = true
	for _, key in ipairs({ 'arrow', 'hand' }) do
		local item = o[key]
		if not spriteOk(item.img.sprite) then
			item.img.sprite = nil
			if now() >= (item.retryAt or 0) then
				local ok, sp = pcall(function() return Game.LuaUtils.LoadSprite(item.path) end)
				if ok and spriteOk(sp) then
					item.img.sprite = sp
				else
					item.retryAt = now() + 1
					logOnce('cursor sprite missing: ' .. item.path)
				end
			end
		end
		if not spriteOk(item.img.sprite) then ready = false end
	end
	return ready
end

local function showCursor(on, hand)
	local o = on and overlay() or M.overlay
	if not (o and alive(o.root)) then return end
	if not on then o.arrow.go:SetActive(false); o.hand.go:SetActive(false) end
	-- Default mode keeps the first release's white cross
	if not on or (st.improved and spritesReady(o)) then
		for i = 1, 3 do o.cursor[i].go:SetActive(false) end
		o.arrow.go:SetActive(on and not hand)
		o.hand.go:SetActive(on and hand == true)
		if not on then return end
		local item = hand and o.hand or o.arrow
		local s = math.max(36, U3D.Screen.height * M.cfg.cursorSize) * (st.pressed and 0.82 or 1)
		place(item, st.cx, st.cy, s, s)
		return
	end
	o.arrow.go:SetActive(false); o.hand.go:SetActive(false)
	for i = 1, 3 do o.cursor[i].go:SetActive(on) end
	if not on then return end
	local s = math.max(14, U3D.Screen.height * 0.035)
	local t = math.max(3, s * 0.18)
	place(o.cursor[1], st.cx - s * 0.5 - 2, st.cy - s * 0.5 - 2, s + 4, s + 4)
	place(o.cursor[2], st.cx - s * 0.5, st.cy - t * 0.5, s, t)
	place(o.cursor[3], st.cx - t * 0.5, st.cy - s * 0.5, t, s)
end

-- focus steps show the pointer (the hand) gliding to the focused control; focusFrame = true brings back the
-- old frame instead
local function showFocus(r, dt)
	if M.cfg.focusFrame or not st.improved then
		if not st.cursorOn and st.pointerShown then showCursor(false); st.pointerShown = false end
		showFrame(r)
		return
	end
	local tx, ty = G.center(r)
	if not st.pointerShown then
		st.cx, st.cy = tx, ty
	else
		local k = math.min(1, (dt or 0.05) * 18)
		st.cx, st.cy = st.cx + (tx - st.cx) * k, st.cy + (ty - st.cy) * k
	end
	st.pointerShown = true
	showCursor(true, true)
end
local function hideFocus()
	hideFrame()
	if not st.cursorOn then showCursor(false); st.pointerShown = false end
end

-- ---------- input ----------
local function edge(name, list)
	local nowDown = anyKey(list)
	local was = st.prev[name]
	st.prev[name] = nowDown
	if nowDown and not was then return 'down' end
	if was and not nowDown then return 'up' end
	return nil
end

-- raw axes 1/2 (no per-axis dead zone, see gamepad_fight.lua); the stock entries without them
local function leftStick()
	local x, y = named('gcgpad_a1'), named('gcgpad_a2')
	if x and y then return x, -y end
	return U3D.Input.GetAxisRaw('Horizontal'), U3D.Input.GetAxisRaw('Vertical')
end
local function dpad()
	return axis(M.cfg.hatX), -axis(M.cfg.hatY)
end
-- the input that moves the focus: the d-pad only while the left stick drives the pointer
local function stick()
	if st.stickPointer then return dpad() end
	local x, y = leftStick()
	if x * x + y * y < 0.04 then x, y = dpad() end
	return x, y
end
local function stickMoved()
	local x, y = leftStick()
	local d = M.cfg.cursorDead
	return x * x + y * y > d * d
end

local function direction(x, y)
	local dead = M.cfg.dead
	if math.abs(x) < dead and math.abs(y) < dead then return nil end
	if math.abs(x) >= math.abs(y) then return x > 0 and 'right' or 'left' end
	return y > 0 and 'up' or 'down'
end

local function anyPadInput()
	for n = 0, 11 do if key(n) then return true end end
	local x, y = stick()
	if x * x + y * y > 0.25 then return true end
	if stickMoved() then return true end
	local rx, ry = axis(M.cfg.rStickX), axis(M.cfg.rStickY)
	return rx * rx + ry * ry > 0.25
end

-- the fight HUD has the controls while one of its buttons can be tapped
local function hudOwns()
	if not (GamepadFight and GamepadFight.timer and UI.IsOpen('UI_Fight')) then return false end
	if UI.IsOpen('UI_MissionPause') then return false end
	if now() < st.hudCheck then return st.hudOwns end
	st.hudCheck = now() + 0.25
	local root = UI.GetWindowGameObject('UI_Fight')
	local owns = false
	if alive(root) then
		local sels = root:GetComponentsInChildren(typeof(UGUI.Selectable))
		for i = 0, math.min(sels.Length, 12) - 1 do
			local r = screenRect(sels[i].transform)
			if r then
				local x, y = G.center(r)
				local hit = rayHit(x, y)
				if hit and hit.transform:IsChildOf(root.transform) then owns = true; break end
			end
		end
	end
	st.hudOwns = owns
	return owns
end

-- the stock EventSystem sends Submit (button 0) to its selected object: keep nothing selected, so a
-- button that a finger touched earlier is not pressed a second time by A
local function clearSelection()
	local es = eventSystem()
	if not es then return end
	local sel = es.currentSelectedGameObject
	if sel and not sel:GetComponent(typeof(UGUI.InputField)) then es:SetSelectedGameObject(nil) end
end

local function debugToggle()
	if edge('dbgR3', { BTN.R3 }) == 'down' and key(BTN.L3) then
		M.cfg.debug = not M.cfg.debug
		log('debug ' .. tostring(M.cfg.debug))
	end
end

-- ---------- pointer (the left stick as a mouse) ----------
-- keepPlace: start where the pointer was, else on the focused control, else mid-screen
local function pointerOn(keepPlace)
	local sw, sh = U3D.Screen.width, U3D.Screen.height
	-- in focus steps the pointer already sits on the focused control: it goes on from there
	if not st.pointerShown then
		if st.focus and st.focus.r and st.shown then st.cx, st.cy = G.center(st.focus.r)
		elseif not (keepPlace and st.cx > 0 and st.cy > 0) then st.cx, st.cy = sw * 0.5, sh * 0.5 end
	end
	st.cursorOn, st.hover, st.hoverAt = true, nil, 0
	hideFrame()
end
-- back to focus steps: the control under the pointer takes the focus
local function pointerOff()
	st.cursorOn = false
	if st.hover then pointerInside(st.hover.go, false) end
	if st.hover and st.hover.r then setFocus(st.hover) end
	st.hover = nil
	st.shown = true
	if not focusValid() then refresh(false) end
end
-- the control under the pointer; the full control scan runs at most twice a second. Like a mouse, the
-- pointer enters and leaves it (the control's own hover look, if it has one).
local function hoverUpdate(t)
	if t >= (st.collectAt or 0) + 0.5 then collect(); st.collectAt = t end
	local c = owner(rayHit(st.cx, st.cy), st.all or st.byId)
	if c and not c.r then c.r = screenRect(c.rt) end
	local old = st.hover
	if (old and old.go) ~= (c and c.go) then
		if st.improved and old and old.go ~= st.pressed then pointerInside(old.go, false) end
		if st.improved and c then pointerInside(c.go, true) end
	end
	st.hover = c
end

function M.Tick()
	local t = now()
	local dt = math.min(0.1, t - (st.lastTick > 0 and st.lastTick or t))
	st.lastTick = t
	clearSelection()
	pcall(Mode.Poll)
	if t >= st.modeAt then
		st.modeAt = t + 0.5
		st.improved = Mode.Improved()
	end
	st.stickPointer = st.improved and M.cfg.stickPointer

	if hudOwns() then
		if M.owner ~= 'fight' then
			if st.shown or st.cursorOn then hideFrame(); showCursor(false) end
			-- start from scratch when the HUD gives the pad back: no cursor, and the first pad input only
			-- shows the frame, so A still held from firing does not press the window that opens
			st.shown, st.cursorOn, st.dirHeld, st.prev, st.pending = false, false, nil, {}, nil
			st.focus, st.pressed, st.hover, st.pointerShown = nil, nil, nil, false
		end
		M.owner = 'fight'
		return
	end
	M.owner = 'menu'
	debugToggle()

	-- touch hides the frame; the next pad input brings it back
	if U3D.Input.touchCount > 0 or U3D.Input.GetMouseButton(0) then
		if st.shown or st.cursorOn or st.pointerShown then hideFrame(); showCursor(false) end
		st.shown, st.cursorOn, st.pointerShown = false, false, false
		return
	end
	if not st.shown and not st.cursorOn then
		if not anyPadInput() then return end
		-- first pad input after touch: show the frame (or the pointer, for the left stick), swallow this press
		for name, list in pairs({ press = M.cfg.press, back = M.cfg.back, prev = M.cfg.tabPrev, next = M.cfg.tabNext,
			skip = M.cfg.skip, cursor = M.cfg.cursor }) do st.prev[name] = anyKey(list) end
		st.dirHeld, st.dirNext = direction(stick()), t + M.cfg.repeatDelay
		if not focusValid() then refresh(false) end
		if st.stickPointer and stickMoved() then pointerOn(false) else st.shown = true end
		return
	end

	-- Select: the left stick drives the pointer, or (pressed again) steps the focus like the d-pad
	if edge('cursor', M.cfg.cursor) == 'down' then
		if st.cursorOn then
			if st.improved then M.cfg.stickPointer = false end
			pointerOff()
		else
			if st.improved then M.cfg.stickPointer = true end
			pointerOn(true)
		end
		st.stickPointer = st.improved and M.cfg.stickPointer
		log('pointer ' .. tostring(st.cursorOn))
	end
	-- the left stick takes the pointer out; the d-pad puts the focus back
	if not st.cursorOn and st.stickPointer and stickMoved() then pointerOn(true) end
	if st.cursorOn and direction(dpad()) then
		pointerOff()
		st.dirHeld, st.dirNext = direction(dpad()), t + M.cfg.repeatDelay   -- this press only shows the focus
	end

	local story = storyCartoon()
	local p = edge('press', M.cfg.press)

	if st.cursorOn then
		local x, y = leftStick()
		local m = math.sqrt(x * x + y * y)
		local dz = M.cfg.cursorDead
		if m > dz then
			-- response curve: fine control near the centre, full speed at full tilt; slower over a control
			local k = math.min(1, (m - dz) / (1 - dz)) ^ M.cfg.cursorCurve
			if st.hover then k = k * M.cfg.cursorSlow end
			if not st.improved then k = m * 0.75 end   -- Default: the first release's linear speed (1.1 screens/s)
			local v = M.cfg.cursorSpeed * U3D.Screen.height * dt * k
			st.cx = math.max(0, math.min(U3D.Screen.width, st.cx + x / m * v))
			st.cy = math.max(0, math.min(U3D.Screen.height, st.cy + y / m * v))
		end
		if t >= st.hoverAt then
			st.hoverAt = t + M.cfg.hoverEvery
			hoverUpdate(t)
		end
		st.pointerShown = true
		showCursor(true, st.hover ~= nil)   -- arrow, or the hand over a control it can press
		hideFrame()
		if p == 'down' then
			collect(); st.collectAt = t
			local c = owner(rayHit(st.cx, st.cy), st.all)
			if c then pressDown(c.go)
			elseif story then pcall(function() story:OnTouch() end) end
		elseif p == 'up' then
			pressUp(true)
		end
	else
		-- focus checks: four times a second, or at once when the focus is gone
		if st.dirty and t >= st.dirty then
			st.dirty = nil
			st.focus = nil
			refresh(false)
			st.lastCheck = t + 0.25
		elseif t >= st.lastCheck then
			-- without a focus (story scenes) look less often: a full scan costs more
			st.lastCheck = t + (st.focus and 0.25 or 0.5)
			if not focusValid() then
				st.focus = nil
				refresh(false)
			end
		end

		-- directions with repeat
		local d = direction(stick())
		if d ~= st.dirHeld then
			st.dirHeld = d
			if d then move(d); st.dirNext = t + M.cfg.repeatDelay end
		elseif d and t >= st.dirNext then
			move(d); st.dirNext = t + M.cfg.repeatGap
		end
		if st.pending and t >= st.pending.at then
			local pd = st.pending
			st.pending = nil
			collect()
			local f = st.focus and st.byId[st.focus.id]
			if f then
				st.focus = f
				local b = G.best(f.nr or f.r, st.nav, pd.d, f)
				if b then setFocus(b)
				elseif pd.tries > 1 then st.pending = { d = pd.d, at = t + 0.08, tries = pd.tries - 1 } end
			end
		end

		if p == 'down' then
			if st.focus and focusValid() then pressDown(st.focus.go)
			elseif story then pcall(function() story:OnTouch() end)
			else refresh(false); if st.focus then pressDown(st.focus.go) end end
		elseif p == 'up' then
			pressUp(true)
		end

		if st.focus and st.focus.r and st.shown then showFocus(st.focus.r, dt) else hideFocus() end
	end

	local b = edge('back', M.cfg.back)
	if b == 'down' then
		if story and st.focus and not st.cursorOn then setFocus(nil) else back() end
	end
	if edge('prev', M.cfg.tabPrev) == 'down' then tab(-1) end
	if edge('next', M.cfg.tabNext) == 'down' then tab(1) end
	if edge('skip', M.cfg.skip) == 'down' and story then skipStory() end

	local rx, ry = axis(M.cfg.rStickX), axis(M.cfg.rStickY)
	if rx * rx + ry * ry > 0.09 then scrollBy(rx, ry, dt) end
end

local function safeTick()
	local ok, err = pcall(M.Tick)
	if ok then
		st.errors = 0
		return
	end
	st.errors = st.errors + 1
	logOnce(tostring(err))
	st.pressed = nil
	if st.errors >= 120 then
		log('turned off after repeated errors')
		M.Stop()
	end
end

-- Called by UI.Open. Start once, and again when the timer has stopped (for example after the timers were
-- cleared). A page or popup that opens takes the focus a moment later, when its controls are in place.
-- UI.Open calls it for every window, so an error is caught here and never stops the window opening.
local function ensure(sClass)
	if type(sClass) == 'string' and not SIDE_WINDOWS[sClass] then st.dirty = now() + 0.15 end
	if M.timer and now() - (st.lastTick or 0) < 1 then return end
	if M.timer then pcall(Game.Timer.Delete, M.timer); M.timer = nil end
	-- real time: the pause menu sets the game's timer scale to 0
	local ok, t = pcall(Game.Timer.Add, 0.01, 0.01, safeTick, true, true)
	if ok then
		M.timer = t
		st.lastTick = now()
		log('started')
	else
		logOnce('start failed: ' .. tostring(t))
	end
end

function M.Ensure(sClass)
	if M.off then return end
	local ok, err = pcall(ensure, sClass)
	if not ok then pcall(logOnce, 'ensure: ' .. tostring(err)) end
end

-- After Stop the layer owns nothing, so the fight layer is never muted by a layer that no longer runs.
function M.Stop()
	M.off = true
	M.owner = nil
	if M.timer then pcall(Game.Timer.Delete, M.timer); M.timer = nil end
	pcall(hideFrame)
	pcall(showCursor, false)
end

M._state = st
