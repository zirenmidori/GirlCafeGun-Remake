# Two title screens

The login prefab (`ui/ui_login_prefab.u`) holds two title screens. The stock
script shows only one of them in an English client. With this patch the client
shows one of the two at each start.

| Title | Objects of the prefab | Textures |
| --- | --- | --- |
| Hall | `PnlBGEffect/Image1`, `PnlBGEffect/Image2`, effects in `PnlBGEffect/eftParent1` to `eftParent3`, logo moved to the center | `bg_login1`, `bg_login2` |
| Sky | `PnlBGEffect/Image3`, particles in `PnlBGEffect/eftParent4`, the 4-girl animation `Spine` | `bg_login04` |

The prefab loads in the sky state: `Image3` and `eftParent4` are on, the hall
objects are off. The stock `Load2DBG` of `UI_Login.lua` switches to the hall
title when the language is English and does nothing in any other language.

`Spine` is a separate object with the component `ShowConcertModel` (girl 1002,
animation 2). The stock script never switches it. The English 1.0.9 data and
the prefab in the 0.1.3 APK load `Spine` active, also when the script shows the
hall title. The GirlCafeGun-Offline notes report the animation drawn over the
hall title on that data. A later official build shipped the prefab with `Spine`
off, and that is the only difference between the two prefabs.

## The patch

`release/client/patch_title.py` edits `Load2DBG` in place. It replaces the
language test `if self:IsUS() then` with a choice and switches `Spine` with it:

- hall title: the stock branch runs unchanged, and `Spine` is off;
- sky title: the prefab stays as loaded, and `Spine` is on.

`HALL_CHANCE` in `patch_title.py` is the share of starts that show the hall
title (default 0.5). Use 1 for the hall title only and 0 for the sky title only.
With 1 the patch still turns `Spine` off, which removes the animation from the
hall title.

The choice reads `U3D.Random.value`. No stock script uses `UnityEngine.Random`,
and `math.random` is not seeded before login, so the patch has a second source:
when the read fails or does not return a number, the last two digits of
`os.time()` choose. A prefab without a `Spine` object is accepted.

No prefab, image or other asset changes. `patch_lua.py` applies the release
login edits to `UI_Login.lua` first and the title patch second. The title patch
needs each of these exactly once: the function header followed by the language
test, the four `FindObject(...)` lines of the hall branch in the stock order, and
the call `self:Load2DBG()`. A second pass replaces only the block between its
markers.

## Limits

- Both titles need their assets in the client data: the three textures above
  and, for the animation, the model that `ShowConcertModel` loads for girl 1002,
  animation 2 (`2danimation/girl1002_2da02.u` in the English 1.0.9 data). The
  patch does not test that they exist. If the sky assets are absent, set
  `HALL_CHANCE` to 1.
- Clients older than English 1.0.6 test the language directly instead of calling
  `IsUS()`. The patch stops on them with an assertion.
- The button labels of the prefab are not changed.

## Validation

`python release/client/test_title.py` needs the packages of
`release/client/requirements.txt` and no client file. It passes a synthetic
`UI_Login.lua` through `patch_lua.patch_script`, so both patches run in the
order of the build, and checks the placement, a second pass, a stale block, 16
rejected sources and the Lua syntax. Then it opens 3000 login screens in a mocked
UI runtime with a seeded random source: both titles occur, `Spine` is on only
with the sky title whatever the prefab loaded, a screen without `Spine` opens,
and the clock chooses when `UnityEngine.Random` is absent, fails or returns no
number. `release/client/build.py` repeats the screens on the function inside the
built `lua.u`.

The same edit, without the second random source, is in the `lua.u` of the
GirlCafeGun-Offline phone build for the English 1.0.9 client. That project has
no written device test for it, and this repository's pinned client has not been
tested on a device.
