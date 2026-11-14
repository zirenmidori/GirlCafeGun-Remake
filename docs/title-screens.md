# Title screens

The stock client shows one title screen in an English client: the hall. The
client data holds art for more. With this patch the client shows one title at
each start, chosen at random among the titles whose art it can load.

**No game asset is in this repository or in the patch.** Each title uses a
picture and an animation that the client data already holds. A title whose art
does not load in a client is left out there, so a client with less data shows
fewer titles and never a broken one.

## The titles

| Title | Background | Animation | Particles |
| --- | --- | --- | --- |
| `hall` | `bg_login1`, `bg_login2` on `PnlBGEffect/Image1`, `Image2` | none | effects in `eftParent1` to `eftParent3` |
| `sky` | `bg_login04` | girl 1002, suit 2 | cherry petals in `PnlBGEffect/eftParent4` |
| `snow` | `bg_login03` | girl 1002, suit 1 | none |
| `shards` | `bg_login05` | girl 1002, suit 3 | none |

The login prefab (`ui/ui_login_prefab.u`) draws two things. The hall is the
branch of `Load2DBG` in `UI_Login.lua` that the stock script runs when the
language is English. The scene is the state the prefab loads in: a picture on
`PnlBGEffect/Image3`, the 4-girl animation on the object `Spine` (component
`ShowConcertModel` with a girl and a suit number) and particles in `eftParent4`.
The stock script shows the scene only when the language is not English, and it
never switches `Spine`.

`sky` is the scene of the current prefab. `snow` and `shards` put another
picture on `Image3` and load another suit on `Spine`. The pairs of picture and
suit follow the numbers of the assets and what the art shows; the client has no
table that names them.

## The patch

`release/client/patch_title.py` places `release/client/title_screens.lua` once in
`UI_Login.lua`, before `Load2DBG`, inside a `do ... end` block, and replaces the
language test `if self:IsUS() then` with `if TitleScreens.Choose(self) then`.
The hall branch itself is not edited.

`TitleScreens.Choose` takes titles from its table in a random order, by weight,
until one can be shown:

- `hall`: always possible. `Spine` goes off; the stock branch does the rest.
- The title that names the picture the prefab already shows: always possible.
  `Spine` goes on; nothing else changes.
- Any other title: `Game.LuaUtils.LoadTexture2D` must return its picture, and
  `ShowConcertModel:Load()` must put a new model in place for its suit. If
  either fails, the prefab's suit is loaded again and the next title is tried.
  If both work, the module makes the call that the stock `ModifyBackground`
  makes for the stock picture, with the new picture and its width to height
  ratio, sets the picture on the `RawImage`, calls the stock
  `BackgroundAdapter` and turns the petals off.

When no title of the table names the picture of the prefab, the scene of the
prefab takes part as one more title. An error inside the module gives the stock
answer back: the language chooses, as before the patch.

The choice reads `U3D.Random.value`. No stock script uses `UnityEngine.Random`,
and `math.random` is not seeded before login, so the clock is the second source:
when the read fails or does not return a number, the last two digits of
`os.time()` choose.

Every login screen writes its title to logcat, and each title it had to leave
out with the reason:

```sh
adb logcat -s Unity | grep "\[title\]"
```

To change the rotation, edit `P.cfg.titles` in `title_screens.lua` and rebuild
the client overlay. `weight = 0` removes a title. Another picture or suit that
the client data holds is one more line in the table.

## Assets by name

| Part | Asset path below `Assets/_Game/AssetBundle/` |
| --- | --- |
| Picture | `Textures/BG/bg_login03.png`, `bg_login04.png`, `bg_login05.png` |
| Animation | `2D Animation/girl1002_2da01/`, `girl1002_2da02/`, `girl1002_2da03/` (`<name>.prefab`) |

`assets/version.data` of the 0.1.3 APK has a route for each of these paths. The
pictures `bg_login1`, `bg_login2` and `bg_login04` are in `first_other.u` of that
APK; the other two pictures and the three animations are in bundles outside the
APK (`bg/bg_login03_png.u`, `bg/bg_login05_png.u`,
`2danimation/girl1002_2da0N.u`). The English 1.0.9 data has no route for suit 1,
so that client shows `hall`, `sky` and `shards`.

## Limits

- **Nobody has seen `snow` and `shards` on a device.** The mock proves the
  choice and the calls, not the picture on the screen. The position and size of
  the animation are those of `sky`; suit 3 is a wider model. `bg_login05` is 2 to
  1, the other pictures are 4 to 3.
- The stock hall branch is unchanged and still needs its four objects.
- The older city-plaza title (`bg_login02` with the scene `Login_Effect`) is not
  in the table: no live stock script loads that scene, so there is no call to
  copy.
- Clients older than English 1.0.6 test the language directly instead of calling
  `IsUS()`. The patch stops on them with an assertion.
- The button labels of the prefab are not changed.

## Validation

`python release/client/test_title.py` needs the packages of
`release/client/requirements.txt` and no client file. It passes a synthetic
`UI_Login.lua` through `patch_lua.patch_script`, so both patches run in the
order of the build, and checks the placement, a second pass, a stale module, 20
rejected sources and the Lua syntax. Then it opens 400 login screens in each of
16 mocked clients with a seeded random source and compares every screen with a
second implementation of the choice. The clients hold all, some or none of the
extra art, fail in four different ways when a suit is absent and in three when
a picture is absent, and load the prefab with `Spine` on, off or absent. A title without its art is never on the
screen, and a failed attempt leaves the prefab's own picture and suit behind.
`release/client/build.py` repeats the screens on the module inside the built
`lua.u`.

A two-title version of this edit is in the `lua.u` of the GirlCafeGun-Offline
phone build for the English 1.0.9 client. This repository's pinned client has
not been tested on a device.
