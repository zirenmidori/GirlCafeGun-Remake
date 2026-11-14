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
table that names them. On a phone the pairs fit: winter clothes on the snow
picture, falling girls on the broken sky.

A title can also give the animation its own size and place and move the logo.
The values were set by eye on a phone:

| Title | `scale` | `position` of `Spine` | `logo` |
| --- | --- | --- | --- |
| `sky` | prefab (133) | prefab (-15.5, -106.76) | prefab (top left) |
| `snow` | prefab | (-50.5, -42.5), the place an older prefab has for suit 1 | (300, 212), top right |
| `shards` | 83; at 133 the model is far too large | (0, 0) | (300, 212), top right |

With the logo in its stock place it covers a face in `snow` and `shards`.

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
  `Load()` of this repository's client does nothing while a model stands, so
  when the model of the suit before is still there after `Load()`, the module
  takes that model away and calls `Load()` once more.
  If both work, the module makes the call that the stock `ModifyBackground`
  makes for the stock picture, with the new picture and its width to height
  ratio, sets the picture on the `RawImage`, calls the stock
  `BackgroundAdapter`, turns the petals off and moves the logo. The size and
  place of the animation are set before `Load()` and go back to those of the
  prefab when the title fails.

When no title of the table names the picture of the prefab, the scene of the
prefab takes part as one more title. An error inside the module gives the stock
answer back: the language chooses, as before the patch.

The choice reads `U3D.Random.value`. No stock script uses `UnityEngine.Random`,
and `math.random` is not seeded before login, so the clock is the second source:
when the read fails or does not return a number, the last two digits of
`os.time()` choose.

Every login screen writes its title to logcat, and each title it had to leave
out with the reason. `Login.lua` of the release client lets only exceptions
through to the Unity log before the login screen opens; the module lifts that
filter for its own lines and puts it back:

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

- The four titles were seen on one phone only: a Galaxy S24+ (2340 x 1080), with
  the English 1.0.9 client and the GirlCafeGun-Offline data, and with the
  0.1.3 release of this repository. The sizes and places were set for that
  screen. A 16 to 9 screen was not seen.
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
19 mocked clients with a seeded random source and compares every screen with a
second implementation of the choice. The clients hold all, some or none of the
extra art, fail in four different ways when a suit is absent and in three when
a picture is absent, load the prefab with `Spine` on, off or absent, and in two
of them `Load()` keeps a model that stands, as this repository's client does. A title without its art is never on the
screen, and a failed attempt leaves the prefab's own picture and suit behind.
`release/client/build.py` repeats the screens on the module inside the built
`lua.u`.

The same module, placed by the GirlCafeGun-Offline tool, ran on a Galaxy S24+
with the English 1.0.9 client on 2026-11-14. Each title was opened alone and
looked at. With all four in the table, six starts in a row logged `sky`, `hall`,
`snow`, `sky`, `shards`, `sky`, so `U3D.Random.value` answers on that client.

The 0.1.3 release of this repository ran the module on the same phone on
2026-11-14, placed in the released `lua.u` and installed as a locally signed
data update. The first version of the module showed only `hall` and `sky`
there: the log gave `snow left out: no animation suit 1` and `shards left out:
no animation suit 3`, and after `Load()` the component still held
`girl1002_2da02(Clone)`, also one second later. With the old model taken away
first, `Load()` put `girl1002_2da01(Clone)` and `girl1002_2da03(Clone)` in
place, and eight starts in a row logged `hall`, `snow`, `shards`, `hall`,
`hall`, `hall`, `snow`, `shards`. The build of this repository with its pinned
client input has not been run.
