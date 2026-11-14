# Controller support in shooting stages

A Bluetooth or USB gamepad connected to the phone controls the shooting stages.
The game reads the controller itself through Unity's legacy Input; there is no
touch overlay and no key-to-touch mapper. Touch controls keep working while a
controller is connected.

The client already carries dormant controller parts: InputManager entries for
both sticks and a trigger, and a developer keyboard handler whose calls drive a
fight. `release/client/gamepad_fight.lua` makes the same calls each frame.
`release/client/patch_gamepad.py` places it in the stock `UI_Fight.lua`, starts
it when the fight HUD opens and stops it when the HUD closes. No C#, native or
server code changes.

## Default mapping

| Control | Action |
| --- | --- |
| Left stick | Move |
| D-pad | Move (see the limits) |
| A, RB, right trigger | Fire while held |
| Right stick | Aim and fire |
| X / Y / B | Skill 1 / 2 / 3 |
| LB | Dodge |
| Start | Pause menu, open and close |
| Select | Auto-fight on and off |
| L3 + R3 | Debug log on and off |

Button numbers follow the standard Android layout in Unity (A = 0, B = 1, X = 2,
Y = 3, LB = 4, RB = 5, L3 = 8, R3 = 9, Start = 10, Select = 11). To change the
mapping, edit `P.cfg` in `gamepad_fight.lua` and rebuild the client overlay.

## Axes

Legacy Input reads a joystick axis only through a named InputManager entry. The
stock table names five axes, and the layer uses them when nothing else exists:

| Joystick axis | Stock name | Used for |
| --- | --- | --- |
| 1, 2 | `Horizontal`, `Vertical` (also the arrow keys) | Move |
| 3 | `HandleFire` | Right trigger |
| 4, 5 | `RightHorizontal`, `RightVertical` | Aim |

Controllers do not agree on the axes of the right stick, the triggers and the
d-pad. An optional change to the InputManager in the base APK's `data.unity3d`
adds one raw entry per joystick axis, `gcgpad_a1` to `gcgpad_a28` (type joystick
axis, all joysticks, no dead zone, not inverted). The layer prefers these names
when they exist, and then `rStickX`, `rStickY`, `rTrigger`, `hatX` and `hatY` in
`P.cfg` can name any axis. The release overlay does not make this change.

With the debug log on, every button and axis change is written to logcat:

```sh
adb logcat -s Unity | grep "\[pad\]"
```

`[pad] started` and `[pad] stopped` mark each fight. A game call that fails is
turned off alone and reported once as `[pad] <action> disabled: ...`.

## Limits

- Menus, story scenes, results and rewards still need touch.
- Only the story and stage HUD (`UI_Fight`) is covered. `UI_BattleFight` and
  `UI_FightPvP` are not.
- Girl switching and the weapon skill have no button yet.
- Without the raw entries, a d-pad works only if the controller reports it as
  arrow keys. A d-pad on hat axes, and a right stick or trigger outside axes 3
  to 5, need the raw entries.
- `HandleFire` has a very high sensitivity in the stock table, so the right
  trigger acts as a switch.
- The right stick passes its direction to the game's fire call. Whether the game
  aims with it or keeps auto-aim was not measured.

## Validation

`python release/client/test_gamepad.py` runs the layer in a mocked fight runtime
(it needs only `lupa`): 27 steps with raw entries and 13 steps with stock axes
only, plus the placement in a synthetic `UI_Fight.lua`, a second patch pass that
changes nothing, and a Lua syntax check. `release/client/build.py` repeats the
steps on the module inside the built `lua.u`.

The same layer, with the raw entries, ran on a Galaxy S24+ with an Xbox Wireless
Controller on the English 1.0.9 client: every fight logged start and stop and no
action was disabled. The stock-axes path and this repository's pinned client
have not been tested on a device.
