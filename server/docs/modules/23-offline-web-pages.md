# Local pages for the web windows

## Cause and client contract

Three windows of the client show a web page in a `UniWebView`. The publisher's pages
are gone. `envir.json` of the release therefore names the local server, with no page,
for every one of them (`notice`, `help`, `word`, `errUrlServerlist`, `errUrlGate`,
`errUrlServer` = `http://127.0.0.1:28080/`), and the server answered that address with
`404` JSON.

| Window                                | Script                  | Stock address                                          |
| ------------------------------------- | ----------------------- | ------------------------------------------------------ |
| Notice (main menu)                    | `UI_Notice.lua:193`     | `Game.ServerList.GetNoticeUrl()` + `?<time>`           |
| Help, Glossary (settings)             | `UI_User.lua:976`       | `GetHelpUrl()`, `GetWordUrl()`                         |
| Server error (login, lost connection) | `UI_ServerError.lua:54` | `GetUrlErrorServerlist/Gate/Server()` + `?time=<time>` |

Line numbers are those of `assets/lua.u` in the published 0.1.3 APK.

All six addresses are equal, so the server cannot tell the windows apart. The client
recipe `release/client/patch_offline_web.py` gives each window its page:

| Window         | Loads                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notice         | `/notice.html?<time>`                                                                                                                                    |
| Help, Glossary | `/web/offline/index.html`                                                                                                                                |
| Server error   | its text from inside the script (`UniWebView.LoadHTMLString`), no request. If the web view cannot take a text: `/web/maintenance/index.html?time=<time>` |

The server-error window opens exactly when this server does not answer, so its text
must not come from this server. `web/maintenance/index.html` holds the same text;
`release/client/test_offline_web.py` compares the two.

The recipe changes only an address of the local server that names no page. An address
of another host loads as before.

## Routes

| Path               | Answer                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /notice.html` | `resources/web/notice/index.html`                                                                                              |
| `GET /web/<path>`  | the file `resources/web/<path>`; a folder gives its `index.html`, with or without the last `/`; the path is not case-sensitive |
| `GET /notice.txt`  | the notice lists as JSON (see below)                                                                                           |

Pages use the content type of their file name, `no-store` and `Connection: close`,
like the other routes. A path that names no file gets the `404` JSON of the server.
The files are read once, when the HTTP server is created (`src/servers/web-pages.ts`),
into a table keyed by the path below `resources/web`. A request can only name a key
of that table, so no request reaches a file outside the folder.

If `resources/web` is absent, the server starts, logs `http.web_pages_missing`, and the
page routes answer `404`.

## Notice data

`resources/web/notice.txt` is the one place for notice text. Its form is the document
that the client's own notice reader (`NoticeHelper`) takes: `bannerLoopTime`, `banners`
and four lists (`notices`, `activity`, `news`, `LoginNotice`) of
`{ID, forceShow, priority, date, title, content, startTime, endTime}`. The server checks
it at start. A file that is absent or not valid gives a document with empty lists and
the log line `http.notice_unusable`.

The Notice page reads `/notice.txt`, shows the three lists under the tabs All / Notices
/ Events / News, sorts by `priority`, and leaves out an item outside its
`startTime`..`endTime`. It keeps the Unity rich-text tags `<b>`, `<i>` and `<color>`.
The page is plain ES5 with no external file, for old Android WebViews.

Keep `LoginNotice` empty unless a window at every login is wanted.

## Not done

- The client's own notice reader does not ask this server. On the 0.1.3 phone build it
  asks `http://l3-prod-patch-sssj.bilibiligame.net/bili/10136/debug/notice.txt`
  (logcat line `NoticeCommon's Url is ...`, 2026-11-14), because
  `Game.Dir.GetBaseUpdateUrl()` is not the local server. Nothing in the game shows its
  lists: `UI_Notice` always opens the web view for a normal notice. Pointing it at
  `/notice.txt` would turn on client behaviour (login notice, red dot) that is not
  tested, so the recipe leaves `NoticeCommon.lua` as it is.
- `UI_OtherTip` and `UI_RikiComic` load an address from a table, and the other `Load`
  calls of `UI_Notice` are for other regions or for a page that the caller names. They
  stay stock.
- The original notice texts are lost. The shipped `notice.txt` holds one notice about
  the offline build.

## Packaging

`release/tools/build-server-payload.py` puts every file of `resources/web` into the
server payload. The Lua recipe runs in `patch_lua.patch_script` after the release
edits; `release/client/build.py` runs its bundle test.

## Verification

`test/web-pages.test.ts` covers the file table (paths, folders, content types, paths
outside the folder, notice file with a byte order mark, with unknown fields, absent,
not valid) and the shipped files. `test/http-server.test.ts` asks a listening server
for each route, for missing pages, for encoded `..` paths, and starts a server without
the folder and with a notice file that is not valid.

`release/client/test_offline_web.py` runs the patched window functions in a mocked UI
runtime: 30 addresses against a second implementation of the address rule, the three
windows with a web view that records its calls, and a web view that cannot take a text.
`run_bundle()` repeats this on the scripts inside a patched `lua.u`.

Not verified on a device: the three windows on screen, and `LoadHTMLString` in the
client's `UniWebView`.

## Origin

Ported from the C# server of GCG2-Offline (`WebAssets.cs`, the notice routes of
`BootstrapHttpServer.cs`, `Web/notice`, `Web/maintenance`, `tools/patch_lua_offline_web.py`;
MIT, GCG2-Offline contributors), which is built on SssjServer (MIT, copyright 2025
luoxiadesu; `LICENSES/SssjServer-MIT.txt`).
