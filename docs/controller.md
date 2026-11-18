# Controller support

A Bluetooth or USB gamepad connected to the phone controls the shooting stages
and every menu, story scene and popup. The game reads the controller itself
through Unity's legacy Input; there is no touch overlay and no key-to-touch
mapper, and no screen layout changes. Touch controls keep working while a
controller is connected.

Two Lua layers do the work, and only one of them has the pad at a time:

- `release/client/gamepad_fight.lua` (shooting stages). The client already
  carries dormant controller parts: InputManager entries for both sticks and a
  trigger, and a developer keyboard handler whose calls drive a fight. The layer
  makes the same calls each frame. `release/client/patch_gamepad.py` places it in
  the stock `UI_Fight.lua`, starts it when the fight HUD opens and stops it when
  the HUD closes.
- `release/client/gamepad_menu.lua` (everything else). `patch_gamepad.py` places
  it at the end of the stock `UI.lua` and starts it from `UI.Open`. While a
  button of the fight HUD can be tapped, it stays idle; when a window covers the
  HUD (the pause menu, a story scene, results, rewards), it takes the pad and the
  fight layer lets go.

Both layers run on a real-time timer: the pause menu sets the game's timer scale
to 0, and the pad must still work there. No C#, native or server code changes.

## Menus: focus navigation

The menu layer does not move a pointer. A focus frame sits on one of the
controls that a finger could tap at that moment, and the pad moves it and presses
it:

- **Candidates** are the game's own click targets: every interactable Selectable
  (Button, Toggle, Slider, InputField) plus the components the client's Lua wires
  by hand (`EventTriggerListener`, `EventTrigger`, `LongPressButton`,
  `LongPushCount`, `ScrollItemPushEvent`, `RoleCardDrag`).
- **Reach**: a candidate counts only if a tap on its centre would reach it. The
  layer asks the EventSystem's raycasters, so a popup, its dark backdrop or a
  tutorial mask hides what lies below, exactly as for touch. A large target with
  pictures on its centre is tried at four more points. Items of a scroll list
  that its viewport clips stay reachable while the list itself can be touched.
- **Moves** go to the nearest candidate in the pressed direction, with the beam
  rule of Android's FocusFinder: a control straight ahead beats a closer one off
  to the side. At the end of a scroll list the list scrolls by one item and the
  move tries again. A slider takes left and right as value steps.
- **Press**: A sends pointer-down when pressed and pointer-up plus click when
  released, through `Game.Utils.ExecutePointerDownEvents`, `...UpEvents` and
  `ExecuteClickEvents` (the calls of the client's own UI test runner). Hold A on
  a hold-to-repeat button and it repeats, as under a finger.
- **Main action**: a full-screen Button that is not named like a backdrop (mask,
  bg, black, blank, shadow, empty, close) is the screen's main action, such as
  the title's "Tap Screen to Start" (`UI_Login` `PnlBG/BtnLogin`). A full-screen
  hand-wired trigger, often a drag area, counts only when it is a whole window or
  is named start, tap, continue, next, click or touch. The frame of a main action
  runs along the screen edges, and the d-pad reaches it through a box at its
  centre. Other full-screen targets stay out of focus moves; B taps a backdrop.
- **First focus** of a new page or popup: the tutorial's target when a tutorial
  step is open, else the control last used in that window, else the window's
  main action, else a confirm/OK button, else the control nearest the screen
  centre. The resource bar
  (`UI_Player`) sorts above every page, so it gets the first focus only when it
  is alone.
- The stock EventSystem sends Submit (joystick button 0) to its selected object.
  The layer keeps nothing selected (except a text field), so a button that a
  finger touched earlier is not pressed a second time by A.
- A touch hides the frame. The next pad input shows it again and does nothing
  else, so the first press after touch never presses blind.

## Controller Support setting

Settings > Operation has a **Controller Support** dropdown, next to the Customize button, with two choices:

| Choice | What the pad does |
| --- | --- |
| Default | The controller layers as first released: A, RB or RT fire; the right stick aims and fires, and the direction goes to the game once, when fire starts; LB dodges where the girls face; in menus the left stick and d-pad step a focus frame, Select turns a white-cross cursor on. |
| HealthS Claude Improved | Everything below that is marked as part of it: free 360-degree aim, aim assist, A lock-on, LB / LT dash along the move stick (or a scatter), fire that resumes after a dash; in menus a mouse-like pointer (the tutorial's arrow and hand) on the left stick and focus steps on the d-pad. |

The choice is kept in the save as task value (32, 999): group 32 is the Settings page's own group (its
Left-hand Mode is 32/1002), which the client may write. 0 (never set) and 1 mean Default, 2 means
Improved. `GamepadMode` in `gamepad_menu.lua` reads and writes it; both layers check it twice a second.
The page does not scroll, so the dropdown sits in the free right half of the Layout Settings section: a
header "Controller Support" on the Layout Settings line (a copy of the page's `Title3` without its line and
without the client's localization script, which would put the old text back) and, in the Customize row
(`Btns`), a Unity Dropdown made with the client's own `DefaultControls.CreateDropdown`, in the page's font,
text colour and check sprite. Positions follow the Customize button, because the Chinese client's page is laid
out differently from the English one. The menu layer reads the dropdown's value on every tick and saves a
change, so a finger, the pad or the pointer can pick; `patch_gamepad.py` adds the two calls to `UI_User.lua`.
Raw axis numbers and the visible `[pad]` log apply to both choices.

## Default mapping

Button numbers follow the standard Android layout in Unity (A = 0, B = 1, X = 2,
Y = 3, LB = 4, RB = 5, L3 = 8, R3 = 9, Start = 10, Select = 11).

Shooting stages (`P.cfg` in `gamepad_fight.lua`):

| Control | Action |
| --- | --- |
| Left stick | Move |
| D-pad | Move (see the limits) |
| Right trigger, RB | Fire while held |
| Right stick | Aim (free aim; fire with the trigger) |
| A | Lock on the nearest enemy; press again for the next nearest |
| X / Y / B | Skill 1 / 2 / 3 |
| LB, left trigger | Dash: along the left stick, or with the stick at rest each girl away from the team center |
| Start | Pause menu, open and close |
| Select | Auto-fight on and off |
| L3 + R3 | Debug log on and off |

Menus, popups and story scenes (`M.cfg` in `gamepad_menu.lua`):

| Control | Action |
| --- | --- |
| Left stick | Pointer, like a mouse: speed curve, slower over a control it can press |
| D-pad | Move the focus (hold to repeat): the pointer glides onto the focused control |
| A | Press the control under the pointer, or the focused one (hold for long-press buttons) |
| B | Back: the window's close, back or cancel button, else a full-screen "tap to close" backdrop |
| LB / RB | Previous / next tab of the top tab bar (a ToggleGroup), else a left / right arrow button |
| Right stick | Scroll the list under the pointer or with the focus (else the largest list on screen) |
| Start | Story scene: Skip |
| Select | Left stick: pointer, or focus steps like the d-pad (below) |
| L3 + R3 | Debug log on and off |

Story scenes (`UI_Cartoon`): A advances the dialogue (`Cartoon:OnTouch`, the
call a tap makes) while nothing has the focus. The d-pad puts the focus on Skip,
the menu or the choices; B takes it away again, so A advances once more. When
choices appear, the first one takes the focus.

## Aim, lock-on and dash (shooting stages)

What the client does (read from `libil2cpp.so` of the 0.1.3 client):
`fightCamera:OnFight(v)` reaches `TeamFighting.SetAttackStart`, and each girl's
`SchoolPlayerController.SetAttackStart` runs `AutoFindTarget`: a wide cone
around `v` (the nearest enemy when `|v| < 0.5`), and for 0.2 s after a search
it returns the last target whatever `v` is. She keeps `cacheFireDir` /
`cacheFireTarget` until the next `OnFight`; her fire loop (`ConfigPrepareFire`)
shoots along them and turns her toward `attackRotateToDirection`. Offline, every
`OnFight` call is applied at once. A dash (move skill) runs along
each girl's facing (`MoveController.RunMove` moves along `transform.forward`).
So without help, fire stays on the first direction, and a dash while firing
goes the fire way, not the stick way.

What the layer does:

- **Direct aim (360 degrees).** `OnFight` starts fire once. Then, while fire is
  held, the layer writes every girl's `cacheFireDir`, `attackRotateToDirection`
  (and clears `cacheFireTarget`, `lastFindTargetTrans`) every `applyEvery`
  (0.033 s), and turns her at once (`snapTurn`). This needs xLua's
  `private_accessible` on `SchoolPlayerController` (logged once:
  `[pad] private fields on|off`). No further `OnFight` call, so a charge weapon
  keeps its charge. Without private access the layer falls back to calling
  `OnFight` again when the aim turns by more than `reaimAngle` (8 degrees), at
  most every `reaimGap` (0.2 s, the game's own target memory).
- **Aim source, first match wins:** the right stick (radial dead zone
  `aimDead`, 0.25; its last direction stays `aimHold`, 0.25 s, after the stick is
  let go), with aim assist: an enemy within `assistAngle` (8 degrees) of the
  stick takes the aim; a lock-on target; else, with `autoAim`, the nearest
  enemy. With a target, each girl fires along her own line to it. The enemy list
  is read every `aimEvery` (0.1 s). With no enemy found, the game aims by itself.
  `autoAim` and `assistAngle` can be saved as PlayerPrefs `gcgpad.autoAim` (0/1)
  and `gcgpad.assist` (degrees, 0 = off), read at each fight start.
- **Lock-on (A):** locks the enemy nearest to the team center. A again takes the
  next one by distance (round robin). The lock stays on its enemy even when
  another one comes closer. When it dies, the nearest enemy left is locked
  (`relock`). The right stick ends the lock. Enemies are the living,
  auto-aimable, non-destructible monsters of `Game.DamageCompentList`.
- **Dash (LB):** a dash stops fire. With the left stick (or d-pad) held, every
  girl faces the stick direction and `OnUseSkillByIdx(3, dir)` gets the stick
  direction. With the stick at rest, each girl faces away from the team center
  (a girl on the center gets a fixed 120-degree spread) and the dash runs
  outward. Fire comes back when `TeamFighting:IsSkillMoving()` says the dash is
  over (at least `dashMin`, 0.15 s, at most `dashPause`, 0.6 s); a fire press
  during that time waits for it. The game's fire loop (`ConfigPrepareFire`)
  clears its fire-facing flag `isFireRotate` only at its next step, and a skill
  cast can turn a girl too, so the layer applies its turn again on every tick of
  the dash. With xLua's `private_accessible` it also clears `isFireRotate` and
  sets `attackRotateToDirection` (logged once: `[pad] private fields on|off`).
- **Dash cooldown:** a press during the cooldown (`TeamMoveSkill.IsCDTime`)
  waits up to `dashBuffer` (0.25 s). If the cooldown flag is still set then, the
  layer sends the plain `OnUseSkillByIdx(3, nil)` and the game decides, as
  before.
- `stickFires = true` makes the right stick fire as well (classic twin-stick).

Each new game call has its own guard: `target`, `aim`, `lock`, `dashturn`,
`dashdir`, `scatter`, `reface`. A failure turns off only that part and falls back to the
old behaviour (game aim, or a plain `OnUseSkillByIdx(3, nil)`). At the first tick
with a team the layer logs which calls answer, for one phone run to check:
`[pad] caps members=3 enemies=N screenDir=x,y roundTrip=1.00,0.00 cd=false`
(`roundTrip`: stick (1, 0) to world and back; anything else means lock-on and
auto aim point the wrong way). Enemies spawn later, so the first fire of a
fight logs `[pad] first fire: enemies=N`. Lock changes log `[pad] lock i/n` and
`[pad] lock off`. For the first `aimTrace` (20) seconds of aim-stick use in a
fight, five lines a second show `[pad] trace raw=x,y stick=deg fire=bool
world=deg g1=yaw/dirdeg/rotbool ...`: the raw stick, the written world
direction (Unity yaw: 0 = +z, 90 = +x) and, per girl, her real facing, her fire
direction and `isFireRotate`.

Practices applied: radial dead zones; aim hold after the stick is let go; a
small aim-assist cone; one button that locks and retargets, with a sticky lock;
dash direction from the move stick; a dash pressed during its cooldown is
buffered.

## Menu pointer

The left stick moves a pointer, as a mouse would (the way Steam Input's
"joystick mouse" works): speed = `cursorSpeed` (1.5 screen heights per second)
times the tilt past `cursorDead` raised to `cursorCurve` (2.2), so a small tilt
places it precisely and a full tilt crosses the screen fast. The pointer is the
tutorial's own sprites (`UI/UI_Guide/common_guide_hand.png`, the arrow, and
`common_guide_hand2.png`, the pointing hand), loaded with
`Game.LuaUtils.LoadSprite`; without them a white cross stays the pointer. Over a
control it can press, the pointer becomes the hand and slows to `cursorSlow`
(half). No frame is drawn (`focusFrame = true` brings the old pulsing frame
back); in focus steps the hand glides onto the focused control. A press sends
what a finger sends: pointer-enter (a Selectable shows its pressed look only
when the pointer is inside it), then pointer-down, up and click; the hand
shrinks a little while A is held. Like a mouse, the pointer enters and leaves
the controls it passes. The right stick scrolls the list under the pointer. The d-pad
switches back to focus steps, starting on the control under the pointer; the
left stick brings the pointer back. Select switches the left stick between the
pointer and focus steps (`stickPointer`). When the fight HUD takes the pad, the
pointer turns off. After the fight the first pad input only shows the focus
frame or the pointer, so A still held from firing does not press the result
window.

## Axes

Legacy Input reads a joystick axis only through a named InputManager entry. The
stock table names five axes, and the layers use them when nothing else exists:

| Joystick axis | Stock name | Used for |
| --- | --- | --- |
| 1, 2 | `Horizontal`, `Vertical` (also the arrow keys) | Move, pointer |
| 3 | `HandleFire` | Aim X, scroll X (on Android the 3rd axis is the right stick X) |
| 4 | `RightHorizontal` | Aim Y, scroll Y (the right stick Y) |
| 5 | `RightVertical` (stored inverted; the layers undo the sign) | D-pad X |

Unity on Android numbers the axes of a standard (Xbox layout) pad as: 1/2 left
stick, 3/4 right stick (`AXIS_Z` / `AXIS_RZ`), 5/6 d-pad (`AXIS_HAT_X` /
`AXIS_HAT_Y`), 12 right trigger (`AXIS_GAS`), 13 left trigger (`AXIS_BRAKE`).
These are the defaults since 2026-11-18 (a Flydigi Vader 5 in Xbox mode reports
exactly these Android axes in `adb shell dumpsys input`). Before, the layers read
4/5 as the right stick and 3 as the trigger: aim followed the stick's up/down
only and a right push fired. Without the raw entries below, the triggers (12, 13)
and the d-pad Y (6) cannot be read.

Controllers do not agree on the axes of the right stick, the triggers and the
d-pad. An optional change to the InputManager in the base APK's `data.unity3d`
adds one raw entry per joystick axis, `gcgpad_a1` to `gcgpad_a28` (type joystick
axis, all joysticks, no dead zone, not inverted). The layers prefer these names
when they exist, and then `rStickX`, `rStickY`, `rTrigger`, `hatX` and `hatY` in
the two configurations can name any axis. The release overlay does not make this
change.

With the debug log on, button and axis changes (fight) and focus, back and tab
choices (menus) are written to logcat:

```sh
adb logcat -s Unity | grep "\[pad\]"
```

`[pad] started` and `[pad] stopped` mark each fight; `[pad] menu: started` marks
the start of the menu layer. A fight call that fails is turned off alone and
reported once as `[pad] <action> disabled: ...`. Any other fight error is
reported once as `[pad] tick error: ...` and the layer carries on; after 120
errors in a row it turns itself off until the next fight (`[pad] tick
disabled ...`). A fight timer that the game cleared without closing the HUD is
replaced at the next fight. A menu error is reported once as `[pad] menu:
<error>` and the layer carries on; after 120 errors in a row it turns itself off
and gives the pad to the fight layer. An error while the menu layer starts is
reported as `[pad] menu: ensure: ...` and never stops a window from opening.
Buttons pressed while the pause menu or another window has the pad do not fire a
skill when the HUD gets the pad back.

## Limits

- Only the story and stage HUD (`UI_Fight`) has fight controls. `UI_BattleFight`
  and `UI_FightPvP` are not covered; in them the menu layer runs.
- Girl switching and the weapon skill have no button yet.
- The cafe and other 3D scenes take taps on 3D objects (girls, cats, food). They
  are not UI controls; the cursor does not reach them either.
- The raycast needs `CS.System.Collections.Generic.List(RaycastResult)` from
  xLua. If the client refuses it, the layer logs the error once and does nothing.
- Without the raw entries, a d-pad works only if the controller reports it as
  arrow keys. A d-pad on hat axes, and a right stick or trigger outside axes 3
  to 5, need the raw entries.
- `HandleFire` has a very high sensitivity in the stock table, so the right
  trigger acts as a switch.
- Aim, lock-on and dash are tested in the mock runtime only (state on
  2026-11-17). The game calls they use outside the generated xLua wrappers
  (`TeamMember`, `SchoolPlayerController`, `DamageCompentList`) are the ones the
  client's own Lua reads (`team.members[i].playerController`,
  `Game.DamageCompentList.Instance`). The `caps` log line settles them on a phone.
- No on-screen marker shows the locked enemy; the girls' fire shows it.
- Each re-aim calls `OnFight` again, which restarts the charge timer of a
  charge weapon (`SchoolWeaponBase.StartFireTime`, read by `UseAmmo`). A steady
  aim sends no new call; a turning aim does, at most every 12 degrees.

## Validation

`python release/client/test_gamepad.py` runs the fight layer in a mocked fight
runtime (it needs only `lupa`): 37 steps with raw entries and 14 steps with stock
axes only, a restart after a lost timer, a tick that fails on every frame, 38
aim, lock-on and dash steps with three girls and enemies (among them: walk up
while firing, turn down, dash: the dash goes down), plus the placement in a synthetic `UI_Fight.lua`, a second patch pass
that changes nothing, and a Lua syntax check.

`python release/client/test_gamepad_menu.py` runs the menu layer in a mocked UI
runtime: a scene graph with windows, a raycaster with masks and draw order, the
Selectable registry, a toggle group, a scroll list and the client's click
helpers. It walks a menu grid, a popup with a backdrop, a backdrop-only reward
popup, a scroll list past its viewport, a slider, touch and pad changes, a story
scene with choices, the cursor, the hand-over to and from the fight HUD and the
pause menu, the end of a fight with A held and the cursor on, one failing C#
call, a failing start inside `UI.Open`, and the layer turning itself off. It also checks the placement in a synthetic
`UI.lua` and the geometry rules alone.

`release/client/build.py` repeats both on the modules inside the built `lua.u`.

The fight layer, with the raw entries, ran on a Galaxy S24+ with an Xbox Wireless
Controller on the English 1.0.9 client: every fight logged start and stop and no
action was disabled. The menu layer, the stock-axes path and this repository's
pinned client have not been tested on a device.
