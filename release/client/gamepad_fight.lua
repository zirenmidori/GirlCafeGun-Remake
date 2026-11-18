-- Controller (Bluetooth/USB gamepad) input for shooting stages.
-- Adapted from GirlCafeGun-Offline tools/lua/GamepadFight.lua (MIT, GCG2-Offline contributors).
--
-- Unity's legacy Input receives Android controller events natively. Each frame this layer reads it and
-- makes the calls of the client's own developer keyboard handler (Game.Keyboard.UpdateInput, whose body
-- is not reachable in release clients):
--   move  -> Game.FightJoystick.SetMoveOffset(dir)          fire  -> fightCamera:OnFight(v) / OnFightStop()
--   skill -> Game.UI_FightProxy.OnUseSkillByIdx(0..2, nil)   dodge -> OnUseSkillByIdx(3, dir or nil)
-- Touch keeps working: the pad sends "stop" only for an action that it started. Every C# call is
-- guarded; a failure disables that one action and is logged once (logcat tag Unity, prefix [pad]).
-- patch_gamepad.py places this file inside UI_Fight.lua, in a do-block, so no local leaks into it.
--
-- How the client aims (read from libil2cpp of the 0.1.3 client):
--   OnFight(v) -> TeamFighting.SetAttackStart -> each girl's SchoolPlayerController.SetAttackStart: it runs
--   AutoFindTarget (a wide cone around v; for 0.2 s after a search it returns the last target whatever v
--   is), then keeps cacheFireDir / cacheFireTarget. Her fire loop (ConfigPrepareFire) shoots along them and
--   turns her to attackRotateToDirection. So OnFight alone cannot give a free 360-degree aim.
--   Direct aim: with xLua's private_accessible this layer writes cacheFireDir, cacheFireTarget and
--   attackRotateToDirection of every girl a few times per frame-second while fire is held, and turns her at
--   once. Without private access it falls back to calling OnFight again when the aim turns.
--   A dash (move skill) runs along each girl's facing (MoveController.RunMove uses transform.forward), so a
--   dash stops fire, turns the girls to the move stick (or away from the team center), and fire comes back
--   when the dash ends.
GamepadFight = GamepadFight or {}
local P = GamepadFight

-- Unity joystick button numbers on Android (standard gamepad layout)
local BTN = { A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, L3 = 8, R3 = 9, START = 10, SELECT = 11 }

P.cfg = P.cfg or {
	dead        = 0.2,             -- move stick dead zone (radial)
	aimDead     = 0.25,            -- aim stick dead zone (radial)
	trigger     = 0.3,             -- trigger press threshold
	fire        = { BTN.RB },      -- hold to fire (plus right trigger)
	lock        = { BTN.A },       -- lock on the nearest enemy; press again: the next nearest one
	dodge       = { BTN.LB },      -- move skill (idx 3); the left trigger dashes too
	skill1      = { BTN.X },       -- skill idx 0
	skill2      = { BTN.Y },       -- skill idx 1
	skill3      = { BTN.B },       -- skill idx 2
	pause       = { BTN.START },
	auto        = { BTN.SELECT },  -- auto-fight toggle
	stickFires  = false,           -- true: the aim stick fires as well (classic twin-stick)
	autoAim     = true,            -- fire with no aim stick and no lock: aim at the nearest enemy (pref gcgpad.autoAim)
	assistAngle = 8,               -- degrees: free aim locks to an enemy this close to the stick (0 = off; pref gcgpad.assist)
	aimHold     = 0.25,            -- s: the last aim stick direction stays this long after the stick is let go
	aimEvery    = 0.1,             -- s: how often the enemy list is read while firing
	applyEvery  = 0.033,           -- s: direct aim writes the girls' fire direction this often
	snapTurn    = true,            -- direct aim turns the girls at once (the game's own turn lags)
	reaimAngle  = 8,               -- fallback (no private access): degrees before OnFight is called again
	reaimGap    = 0.2,             -- fallback: s between those calls (the game keeps its target 0.2 s anyway)
	relock      = true,            -- the locked enemy dies: lock the nearest one left
	dashTurn    = true,            -- dash with the move stick: face that way first
	scatter     = true,            -- dash with the move stick at rest: each girl dashes away from the team center
	dashBuffer  = 0.25,            -- s: a dash pressed during its cooldown fires when the cooldown ends
	dashMin     = 0.15,            -- s: fire stays off at least this long after a dash ...
	dashPause   = 0.6,             -- s: ... and at most this long (sooner when the game says the dash ended)
	refireFor   = 1.0,             -- s after a fire start: check that the girls fire, else start again ...
	refireGap   = 0.1,             -- s: ... this often (the game ignores a start while a girl is still dodging)
	-- Joystick axis numbers (Unity "Nth axis"). Unity on Android: 1/2 left stick, 3/4 right stick (AXIS_Z /
	-- AXIS_RZ), 5/6 d-pad (HAT), 12 right trigger (GAS), 13 left trigger (BRAKE). Other pads: turn on
	-- debug (L3+R3) and read logcat. 0 = off.
	rStickX     = 3, rStickY = 4,
	rTrigger    = 12, lTrigger = 13,
	hatX        = 5, hatY = 6,
	debug       = false,           -- L3+R3 toggles: logs every button / axis change
	aimTrace    = 30,              -- s of stick use per fight logged 5 times a second ([pad] trace ...); 0 = off
}

-- Login.lua lowers the Unity log filter, so a plain print never reaches logcat: lift it for our own lines
local function log(msg)
	local logger, filter
	pcall(function() logger = U3D.Debug.unityLogger; filter = logger.filterLogType; logger.filterLogType = 3 end)
	print("[pad] " .. msg)
	if logger and filter then pcall(function() logger.filterLogType = filter end) end
end
P.log = log

-- saved choices (a later settings toggle writes the same keys)
local function prefs(cfg)
	pcall(function()
		local pp = U3D.PlayerPrefs
		if pp.HasKey("gcgpad.autoAim") then cfg.autoAim = pp.GetInt("gcgpad.autoAim") ~= 0 end
		if pp.HasKey("gcgpad.assist") then cfg.assistAngle = pp.GetInt("gcgpad.assist") end
	end)
end

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

-- Legacy Input reads a joystick axis only through a named InputManager entry, and an unknown name
-- raises an error. Our APK's InputManager adds "gcgpad_aN" for every axis N (raw, not inverted). Without
-- it the stock table still names axes 3, 4 and 5; RightVertical is stored inverted, hence the sign.
-- An absent name is asked once and then remembered.
local STOCK = { [3] = { "HandleFire", 1 }, [4] = { "RightHorizontal", 1 }, [5] = { "RightVertical", -1 } }
local absent = {}
local function named(name)
	if absent[name] then return nil end
	local ok, v = pcall(U3D.Input.GetAxisRaw, name)
	if ok then return v end
	absent[name] = true
	return nil
end
local function axis(n)
	if not n or n <= 0 then return 0 end
	local v = named("gcgpad_a" .. n)
	if v == nil and STOCK[n] then
		v = named(STOCK[n][1])
		if v then v = v * STOCK[n][2] end
	end
	return v or 0
end

-- The left stick, raw. The stock Horizontal / Vertical entries have a dead zone of 0.19 PER AXIS (seen in
-- the installed APK), which pulls directions near an axis onto it; the raw entries have none, and the
-- callers use a round dead zone. Raw axis 2 is down-positive, Vertical is up-positive.
local function leftStickRaw()
	local x, y = named("gcgpad_a1"), named("gcgpad_a2")
	if x and y then return x, -y end
	return U3D.Input.GetAxisRaw("Horizontal"), U3D.Input.GetAxisRaw("Vertical")
end

local broken = {}
-- returns true when fn ran without an error
local function try(name, fn, ...)
	if broken[name] then return false end
	local ok, err = pcall(fn, ...)
	if not ok then
		broken[name] = true
		log(name .. " disabled: " .. tostring(err))
	end
	return ok
end

local function now()
	local ok, t = pcall(function() return U3D.Time.realtimeSinceStartup end)
	return ok and t or 0
end

local function norm(x, y)
	local m = math.sqrt(x * x + y * y)
	if m < 1e-6 then return 0, 0 end
	return x / m, y / m
end

-- ---------- game actions (same calls as Game.Keyboard.UpdateInput) ----------
local function fightCamera()
	local gm = Game.GameMode.instance
	return gm and gm.fightCamera
end
local function move(x, y)
	Game.FightJoystick.SetMoveOffset(U3D.Vector2(x, y))
end
local function fireStart(x, y)
	local cam = fightCamera(); if cam then cam:OnFight(U3D.Vector2(x or 0, y or 0)) end
end
local function fireStop()
	local cam = fightCamera(); if cam then cam:OnFightStop() end
end
local function skill(idx, dir)
	Game.UI_FightProxy.OnUseSkillByIdx(idx, dir)
end
local function pause()
	if Game.Map.isOnline or Game.CartoonMgr.IsPlaying or Game.GameMode.IsEnd then return end
	local gm = Game.GameMode.instance
	if not (gm and gm.isBegin) then return end
	if UI.IsOpen("UI_MissionPause") then UI.Close("UI_MissionPause") else UI.Open("UI_MissionPause") end
end
local function autoFight()
	local ui = Game.UI_Fight.Ins
	if ui then ui:OnClickBtnAuto() end
end

-- ---------- state ----------
local st = { moving = false, firing = false, prev = {}, dbg = {}, faced = {}, girls = {}, enemies = {},
             fx = 0, fy = 0, wx = 0, wz = 0, wfx = 0, wfy = 0, cx = 0, cz = 0,
             sx = 0, sy = 0, sentAt = 0, scanAt = 0, applyAt = 0, traceLeft = 0, traceAt = 0 }

-- ---------- the team and its enemies (world x/z plane) ----------
local function localTeam()
	return Game.Fight.GetLocalTeam()
end
local function teamCenter(team)
	local p = team.center.transform.position
	return p.x, p.z
end
-- world direction on the ground -> unit direction in OnFight's (screen) space
local function screenDir(dx, dz)
	local v = fightCamera():GetScreenDirection(U3D.Vector3(dx, 0, dz))
	return norm(v.x, v.y)
end
-- stick (screen) direction -> unit world direction on the ground
local function worldDir(x, y)
	local w = fightCamera():GetRealDirection(U3D.Vector2(x, y))
	return norm(w.x, w.z)
end
local function alive(c)
	local ok, v = pcall(function() return c.IsAlive end)
	return ok and v == true
end
-- living enemies that the game itself would auto-aim at, with world positions
local function scanEnemies()
	local list, out = Game.DamageCompentList.Instance.ComList, {}
	for i = 0, list.Count - 1 do
		local c = list[i]
		if c and c.IsMonster and c.IsAlive and c.CanAutoAim and not c.IsDestructible then
			local p = c.CurrPostion
			out[#out + 1] = { c = c, x = p.x, z = p.z }
		end
	end
	return out
end
-- nearest to (cx, cz) first
local function byDistance(list, cx, cz)
	for _, e in ipairs(list) do local dx, dz = e.x - cx, e.z - cz; e.d = dx * dx + dz * dz end
	table.sort(list, function(a, b) return a.d < b.d end)
	return list
end
local function cooling()
	local ok, v = pcall(function() return localTeam().TeamMoveSkill.IsCDTime end)
	return ok and v == true
end
local function dashing()
	local ok, v = pcall(function() return localTeam():IsSkillMoving() end)
	return ok and v == true
end
-- the living girls: { pc, tr }
local function readGirls()
	local ms, out = localTeam().members, {}
	for i = 0, ms.Count - 1 do
		local pc = ms[i].playerController
		if pc and not pc.IsDead then out[#out + 1] = { pc = pc, tr = pc.transform } end
	end
	return out
end

-- ---------- private fields (direct aim and dash facing) ----------
-- nil = not asked yet, then true / false for this session
local private
local function openPrivate()
	if private ~= nil then return private end
	private = pcall(function() xlua.private_accessible(CS.SchoolPlayerController) end)
	log("private fields " .. (private and "on" or "off"))
	return private
end
local function privateOff(err)
	private = false
	log("private fields off: " .. tostring(err))
end

-- face a girl along q; with private access also the game's fire turn target
local function turn(f)
	f.tr.rotation = f.q
	f.pc.moveRotateToDirection = f.q
	if private then
		local ok, err = pcall(function() f.pc.attackRotateToDirection = f.q; f.pc.isFireRotate = false end)
		if not ok then privateOff(err) end
	end
end
-- turn every living girl: fn(dx, dz, i) gets her offset from the team center and returns a world
-- direction, or nil to leave her. The turns are kept in st.faced and applied again on every tick of the dash.
local function faceTeam(fn)
	openPrivate()
	local cx, cz = teamCenter(localTeam())
	local faced = {}
	for i, g in ipairs(readGirls()) do
		local p = g.tr.position
		local wx, wz = fn(p.x - cx, p.z - cz, i - 1)
		if wx and wx * wx + wz * wz > 1e-6 then
			local f = { pc = g.pc, tr = g.tr, q = U3D.Quaternion.LookRotation(U3D.Vector3(wx, 0, wz)) }
			faced[#faced + 1] = f
			turn(f)
		end
	end
	st.faced = faced
end
local function refaceTeam()
	for _, f in ipairs(st.faced) do turn(f) end
end

-- ---------- input state ----------
local function pressed(name, list)
	local now = anyKey(list)
	local was = st.prev[name]
	st.prev[name] = now
	return now and not was
end
local function triggerEdge(name, n, cfg)
	local now = axis(n) > cfg.trigger
	local was = st.prev[name]
	st.prev[name] = now
	return now and not was
end

-- while the pause menu or another window has the pad, keep the button states current, so a button
-- that is still down when the HUD gets the pad back is not taken as a new press (A confirms in menus)
local EDGES = { dodge = 'dodge', s1 = 'skill1', s2 = 'skill2', s3 = 'skill3', auto = 'auto', lock = 'lock' }
local function syncEdges(cfg)
	for name, key in pairs(EDGES) do st.prev[name] = anyKey(cfg[key]) end
	st.prev.lt = axis(cfg.lTrigger) > cfg.trigger
end

-- ---------- aim ----------
-- 0, 0 means "no direction": the game aims at the nearest target itself
local function changed(ax, ay, bx, by)
	local az, bz = ax == 0 and ay == 0, bx == 0 and by == 0
	if az or bz then return az ~= bz end
	return ax * bx + ay * by < math.cos(math.rad(P.cfg.reaimAngle))
end

local function lockNext()
	local cx, cz = teamCenter(localTeam())
	local list = byDistance(scanEnemies(), cx, cz)
	st.enemies, st.cx, st.cz = list, cx, cz
	if #list == 0 then
		st.lock = nil
		log("lock: no enemy")
		return
	end
	local pick = 1
	if st.lock then
		for i, e in ipairs(list) do if e.c == st.lock then pick = i % #list + 1 end end
	end
	st.lock, st.freeAt = list[pick].c, nil
	st.scanAt, st.applyAt = 0, 0
	log(string.format("lock %d/%d", pick, #list))
end

-- the enemy list, the team center and the girls, while firing
local function scan(cfg)
	local team = localTeam()
	st.cx, st.cz = teamCenter(team)
	st.enemies = byDistance(scanEnemies(), st.cx, st.cz)
	st.girls = readGirls()
	if st.lock and not alive(st.lock) then
		st.lock = nil
		if cfg.relock and st.enemies[1] then st.lock = st.enemies[1].c end
	end
end

-- the enemy nearest to the world direction (wx, wz), within assistAngle
local function assist(cfg, wx, wz)
	if cfg.assistAngle <= 0 then return nil end
	local best, bc = nil, math.cos(math.rad(cfg.assistAngle))
	for _, e in ipairs(st.enemies) do
		local dx, dz = e.x - st.cx, e.z - st.cz
		local m = math.sqrt(dx * dx + dz * dz)
		if m > 0.1 then
			local c = (dx * wx + dz * wz) / m
			if c > bc then best, bc = e.c, c end
		end
	end
	return best
end

-- what the girls aim at now: a target (enemy) or a world direction, plus the screen direction for OnFight
-- returns target, wx, wz, sx, sy   (all zero and nil: the game aims by itself)
local function aimAt(t, cfg, free)
	if free then
		if st.wfx ~= st.fx or st.wfy ~= st.fy then
			-- the camera turns slowly if at all: convert again only when the stick moved
			local ok, x, z = pcall(worldDir, st.fx, st.fy)
			if ok then st.wx, st.wz, st.wfx, st.wfy = x, z, st.fx, st.fy end
		end
		local tg = assist(cfg, st.wx, st.wz)
		return tg, st.wx, st.wz, st.fx, st.fy
	end
	local tg = st.lock or (cfg.autoAim and st.enemies[1] and st.enemies[1].c) or nil
	if not tg then return nil, 0, 0, 0, 0 end
	local ok, p = pcall(function() return tg.CurrPostion end)
	if not ok then return nil, 0, 0, 0, 0 end
	local dx, dz = p.x - st.cx, p.z - st.cz
	if dx * dx + dz * dz < 0.01 then return tg, 0, 0, 0, 0 end
	local wx, wz = norm(dx, dz)
	local ok2, sx, sy = pcall(screenDir, dx, dz)
	if not ok2 then sx, sy = 0, 0 end
	return tg, wx, wz, sx, sy
end

-- true: every living girl is in fire mode (the game's private isTouchFire); false: one is not;
-- nil: unknown (no private access, or the field cannot be read)
local function girlsFiring()
	if not private or #st.girls == 0 then return nil end
	for _, g in ipairs(st.girls) do
		local ok, v = pcall(function() return g.pc.isTouchFire end)
		if not ok then return nil end
		if v ~= true then return false end
	end
	return true
end

-- direct aim: every girl fires along her own line to the target, or along the stick direction
local function applyAim(tg, wx, wz)
	local tx, tz
	if tg then
		-- a target that died or was removed this moment: aim along the last direction instead
		local ok, p = pcall(function() return tg.CurrPostion end)
		if ok and p then tx, tz = p.x, p.z end
	end
	local snap = P.cfg.snapTurn
	for _, g in ipairs(st.girls) do
		local dx, dz = wx, wz
		if tx then
			local p = g.tr.position
			dx, dz = tx - p.x, tz - p.z
		end
		if dx * dx + dz * dz > 1e-6 then
			local d = U3D.Vector3(dx, 0, dz)
			local q = U3D.Quaternion.LookRotation(d)
			local pc = g.pc
			pc.cacheFireDir = d
			pc.cacheFireTarget = nil
			pc.lastFindTargetTrans = nil
			pc.attackRotateToDirection = q
			if snap then g.tr.rotation = q end
		end
	end
end

-- ---------- dash ----------
-- every dash holds fire off for its length, also when fire is pressed after the dash button
local function dash(cfg, t, mx, my)
	if st.firing then
		try("fire", fireStop)
		st.firing = false
	end
	st.dashAt, st.dashUntil, st.faced = t, t + cfg.dashPause, {}
	if mx then
		if cfg.dashTurn then
			try("dashturn", function()
				local wx, wz = worldDir(mx, my)
				faceTeam(function() return wx, wz end)
			end)
		end
		if try("dashdir", skill, 3, U3D.Vector2(mx, my)) then return end
	elseif cfg.scatter then
		try("scatter", faceTeam, function(dx, dz, i)
			if dx * dx + dz * dz > 0.04 then return dx, dz end
			local a = i * 2.0944        -- girl on the center: spread 120 degrees apart
			return math.cos(a), math.sin(a)
		end)
	end
	try("dodge", skill, 3, nil)
end

local function joystickNames()
	local t, n = {}, U3D.Input.GetJoystickNames()
	for i = 0, n.Length - 1 do t[#t + 1] = n[i] end
	return table.concat(t, ", ")
end

local function debugDump()
	for n = 0, 19 do
		local now = key(n)
		if now ~= (st.dbg["b" .. n] or false) then
			st.dbg["b" .. n] = now
			log(string.format("button %d %s", n, now and "down" or "up"))
		end
	end
	for n = 1, 28 do
		local v = axis(n)
		local q = math.floor(v * 4 + 0.5) / 4
		if q ~= (st.dbg[n] or 0) then
			st.dbg[n] = q
			log(string.format("axis %d = %.2f", n, v))
		end
	end
end

-- Aim trace: what the stick gives, what this layer writes and where the girls really face. Angles in
-- degrees, Unity yaw convention (0 = world +z, 90 = world +x). One line per 0.2 s of aim-stick use.
local function yaw(x, z) return math.deg(math.atan(x, z)) % 360 end
local function trace(rx, ry, lx, ly)
	local cfg = P.cfg
	local sh, sv = U3D.Input.GetAxisRaw("Horizontal"), U3D.Input.GetAxisRaw("Vertical")
	local line = string.format("trace raw=%.2f,%.2f stick=%.0f fire=%s left=%.2f,%.2f stock=%.2f,%.2f", rx, ry,
		math.deg(math.atan(st.fy, st.fx)) % 360, tostring(st.firing), lx, ly, sh, sv)
	if st.wx ~= 0 or st.wz ~= 0 then line = line .. string.format(" world=%.0f", yaw(st.wx, st.wz)) end
	for i, g in ipairs(st.girls) do
		local ok, v = pcall(function()
			local s = string.format(" g%d=%.0f", i, g.tr.eulerAngles.y)
			if private then
				local d = g.pc.cacheFireDir
				s = s .. string.format("/dir%.0f/rot%s/reload%s%s/move%.0f", yaw(d.x, d.z), tostring(g.pc.isFireRotate),
					g.pc.isChangeBullet and "1" or "0", g.pc.ChangeBulletAnimateStart and "1" or "0",
					(function() local q = g.pc.moveRotateToDirection; return q.eulerAngles.y end)())
			end
			return s
		end)
		line = line .. (ok and v or (" g" .. i .. "=?"))
		if i >= 3 then break end
	end
	log(line)
end

-- once per fight, when the team exists: which game calls this client answers (read the log after a phone run)
local function caps()
	local team = localTeam()
	if not team then return end
	P.capsDone = true
	local function probe(fn) local ok, v = pcall(fn); return ok and tostring(v) or "no" end
	log("caps members=" .. probe(function() return team.members.Count end)
		.. " enemies=" .. probe(function() return #scanEnemies() end)
		.. " screenDir=" .. probe(function() local x, y = screenDir(1, 0); return string.format("%.2f,%.2f", x, y) end)
		-- stick (1, 0) -> world -> stick must give (1, 0) again, else lock-on aims the wrong way
		.. " roundTrip=" .. probe(function()
			local wx, wz = worldDir(1, 0)
			local x, y = screenDir(wx, wz); return string.format("%.2f,%.2f", x, y) end)
		.. " cd=" .. probe(function() return team.TeamMoveSkill.IsCDTime end)
		.. " autoAim=" .. tostring(P.cfg.autoAim) .. " assist=" .. tostring(P.cfg.assistAngle))
end

local legacyFireAndDash, improvedFireAndDash
function P.Tick()
	local cfg = P.cfg
	-- L3 + R3: debug log on/off
	if pressed("dbg", { BTN.R3 }) and key(BTN.L3) then
		cfg.debug = not cfg.debug
		local ok, names = pcall(joystickNames)
		log("debug " .. tostring(cfg.debug) .. ", raw axes " ..
			(named("gcgpad_a1") and "present" or "absent (stock axes 3-5 only)") ..
			", joysticks: " .. (ok and names or "?"))
	end
	if cfg.debug then debugDump() end

	-- pause works even while the fight HUD is hidden
	if pressed("pause", cfg.pause) then try("pause", pause) end
	if UI.IsOpen("UI_MissionPause") then P.Reset(); syncEdges(cfg); return end
	-- a window covers the HUD (story, results, rewards): the menu layer (gamepad_menu.lua) has the pad
	if GamepadMenu and GamepadMenu.owner == 'menu' and not GamepadMenu.off then P.Reset(); syncEdges(cfg); return end
	if not P.capsDone then try("caps", caps) end
	local t = now()
	-- Settings > Operation > Controller Support (gamepad_menu.lua keeps it in the save): Default runs the
	-- first release's behaviour (below: legacyFireAndDash), Improved everything this file adds.
	-- Without the menu module (tests of this file alone) the layer runs Improved.
	if t >= (P.modeAt or 0) then
		P.modeAt = t + 0.5
		P.improved = not GamepadMode or GamepadMode.Improved()
	end

	-- move: stock Horizontal/Vertical (left stick = joystick axes 1/2, and the arrow keys), else the hat
	local x, y = leftStickRaw()
	if x * x + y * y < cfg.dead * cfg.dead then
		x, y = axis(cfg.hatX), -axis(cfg.hatY)
	end
	local mx, my
	if x * x + y * y >= cfg.dead * cfg.dead then
		mx, my = norm(x, y)
		try("move", move, mx, my)
		st.moving = true
	elseif st.moving then
		try("move", move, 0, 0)
		st.moving = false
	end

	-- aim stick: free aim; it also ends a lock
	local rx, ry = axis(cfg.rStickX), axis(cfg.rStickY)
	local aimed = rx * rx + ry * ry >= cfg.aimDead * cfg.aimDead
	if aimed then
		st.fx, st.fy = norm(rx, -ry)
		st.freeAt = t
		if st.lock then st.lock = nil; log("lock off") end
	end
	local free = st.freeAt ~= nil and t - st.freeAt <= cfg.aimHold
	if (aimed or st.moving) and st.traceLeft > 0 and t >= st.traceAt then
		st.traceAt, st.traceLeft = t + 0.2, st.traceLeft - 0.2
		if not st.girls[1] then pcall(function() st.girls = readGirls() end) end
		pcall(trace, rx, ry, x, y)
	end
	if not P.improved then
		legacyFireAndDash(cfg, aimed)
	else
		improvedFireAndDash(cfg, t, mx, my, aimed, free)
	end

	-- skills (edge-triggered)
	if pressed("s1", cfg.skill1) then try("skill", skill, 0, nil) end
	if pressed("s2", cfg.skill2) then try("skill", skill, 1, nil) end
	if pressed("s3", cfg.skill3) then try("skill", skill, 2, nil) end
	if pressed("auto", cfg.auto) then try("auto", autoFight) end
end

-- Default mode: the controller as first released (Remake pull request 2). A, RB or the right trigger fire
-- in the girls' own aim; the right stick fires toward its direction. The direction goes to the game once,
-- when fire starts, and the game keeps it while fire is held. LB dodges where the girls face.
local LEGACY_FIRE = { BTN.A, BTN.RB }
legacyFireAndDash = function(cfg, aimed)
	if pressed("dodge", cfg.dodge) then try("dodge", skill, 3, nil) end
	local wantFire = aimed or anyKey(LEGACY_FIRE) or axis(cfg.rTrigger) > cfg.trigger
	if wantFire and not st.firing then
		local ax, ay = 0, 0
		if aimed then ax, ay = st.fx, st.fy end
		try("fire", fireStart, ax, ay)
		st.firing = true
	elseif not wantFire and st.firing then
		try("fire", fireStop)
		st.firing = false
	end
end

improvedFireAndDash = function(cfg, t, mx, my, aimed, free)
	if pressed("lock", cfg.lock) then try("lock", lockNext) end

	-- dash: LB or the left trigger (a press during its cooldown waits up to dashBuffer)
	if pressed("dodge", cfg.dodge) or triggerEdge("lt", cfg.lTrigger, cfg) then st.dashBuf = t + cfg.dashBuffer end
	if st.dashBuf then
		if not cooling() then
			st.dashBuf = nil
			dash(cfg, t, mx, my)
		elseif t > st.dashBuf then
			-- still "cooling" after the buffer: leave the decision to the game, as before this layer had a buffer
			st.dashBuf = nil
			try("dodge", skill, 3, nil)
		end
	end

	-- fire: buttons, right trigger (and the aim stick if stickFires); off for the length of a dash
	local wantFire = anyKey(cfg.fire) or axis(cfg.rTrigger) > cfg.trigger or (cfg.stickFires and aimed)
	if st.dashUntil then
		if t >= st.dashUntil or (t - st.dashAt >= cfg.dashMin and not dashing()) then
			st.dashUntil, st.faced = nil, {}
		else
			try("reface", refaceTeam)   -- the game may turn the girls back (fire loop, skill cast)
		end
	end
	if st.dashUntil then
		-- fire was stopped for the dash; it starts again below once the dash is over
	elseif wantFire then
		if t >= st.scanAt then
			st.scanAt = t + cfg.aimEvery
			if not try("target", scan, cfg) then st.enemies, st.girls = {}, {} end
		end
		local tg, wx, wz, sx, sy = aimAt(t, cfg, free)
		if not st.firing then
			if not P.fireCapsDone then
				P.fireCapsDone = true
				log("first fire: enemies=" .. #st.enemies .. " girls=" .. #st.girls)
			end
			try("fire", fireStart, sx, sy)
			st.firing, st.sx, st.sy, st.sentAt, st.applyAt = true, sx, sy, t, 0
			-- the game ignores a fire start while a girl is still in her dodge: check, and send it again
			st.refireUntil, st.refireAt = t + cfg.refireFor, t + cfg.refireGap
		elseif st.refireUntil and t >= st.refireAt then
			st.refireAt = t + cfg.refireGap
			local on = girlsFiring()
			if on == true or t > st.refireUntil then
				st.refireUntil = nil
			elseif on == false or t - st.sentAt >= 0.25 then
				-- not firing (or, without private access, unknown): start again along the current aim
				try("fire", fireStart, sx, sy)
				st.sx, st.sy, st.sentAt = sx, sy, t
			end
		end
		local direct = openPrivate() and (tg or wx ~= 0 or wz ~= 0)
		if direct and t >= st.applyAt then
			st.applyAt = t + cfg.applyEvery
			local ok, err = pcall(applyAim, tg, wx, wz)
			if not ok then privateOff(err) end
		elseif not private and t - st.sentAt >= cfg.reaimGap and changed(sx, sy, st.sx, st.sy) then
			try("aim", fireStart, sx, sy)
			st.sx, st.sy, st.sentAt = sx, sy, t
		end
	elseif st.firing then
		try("fire", fireStop)
		st.firing = false
	end
end

-- A failed tick (for example while the scene loads) is skipped and logged once. After this many
-- failures in a row the controller turns itself off until the next fight.
local MAX_ERRORS = 120
local errors, errLogged = 0, {}
local function tick()
	P.lastTick = now()
	if broken.tick then return end
	local ok, err = pcall(P.Tick)
	if ok then errors = 0; return end
	errors = errors + 1
	local msg = tostring(err)
	if not errLogged[msg] then errLogged[msg] = true; log("tick error: " .. msg) end
	if errors >= MAX_ERRORS then
		broken.tick = true
		P.Reset()
		log("tick disabled after " .. errors .. " errors in a row")
	end
end

function P.Start()
	if P.timer then
		-- the timer runs every 10 ms: one that has not run for a second was cleared without OnClose
		if now() - (P.lastTick or 0) < 1 then return end
		pcall(Game.Timer.Delete, P.timer); P.timer = nil
		broken, errors, errLogged = {}, 0, {}
		log("the old timer stopped: restarting")
	end
	P.Reset()
	P.capsDone, P.fireCapsDone = false, false
	prefs(P.cfg)
	st.traceLeft, st.traceAt = P.cfg.aimTrace or 0, 0
	-- never break the fight HUD: a failure here only turns the controller off
	-- real time: the pause menu sets the game's timer scale to 0, and Start must still close it
	local ok, t = pcall(Game.Timer.Add, 0.01, 0.01, tick, true, false)
	if ok then P.timer = t; P.lastTick = now(); log("started") else log("start failed: " .. tostring(t)) end
end

-- release what the pad holds and forget aim, lock and dash (pause menu, a window over the HUD, end of fight)
function P.Reset()
	if st.moving then try("move", move, 0, 0) end
	if st.firing then try("fire", fireStop) end
	st.moving, st.firing = false, false
	st.lock, st.freeAt, st.dashBuf, st.dashUntil, st.faced, st.refireUntil = nil, nil, nil, nil, {}, nil
	st.sx, st.sy, st.scanAt, st.applyAt = 0, 0, 0, 0
	st.enemies, st.girls = {}, {}
end

function P.Stop()
	if P.timer then pcall(Game.Timer.Delete, P.timer); P.timer = nil end
	P.Reset()
	broken, errors, errLogged = {}, 0, {}
	log("stopped")
end
