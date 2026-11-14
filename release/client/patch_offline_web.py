"""Web windows: offline_web.lua inside Lib.lua, and three windows ask it what to load.

Ported from the GirlCafeGun-Offline phone build (MIT, GCG2-Offline contributors), tools/patch_lua_offline_web.py.
The web windows of the client load pages of the publisher, and those pages are gone. envir.json of the release
names the local server instead, with no page, and the server answers that address with "not found". The patch
gives each window a page of the local server (server/resources/web):
  UI_Notice       the Notice window of the main menu -> notice.html
  UI_User         Help and Glossary in the settings  -> web/offline/index.html
  UI_ServerError  the window that opens when the server does not answer. It shows its text from inside the
                  script, so it needs no server. A web view that cannot take a text loads
                  web/maintenance/index.html, which holds the same text.
Only an address of the local server that names no page changes. Every other address loads as before, so the
other Load calls of UI_Notice (other regions, a page that a caller names) and the two windows that load an
address from a table (UI_OtherTip, UI_RikiComic) stay stock. No prefab or other asset changes.
Patching a patched script only refreshes the module.
"""
from pathlib import Path

LUA_NAMES = {'Lib.lua', 'UI_Notice.lua', 'UI_User.lua', 'UI_ServerError.lua'}
MODULE = Path(__file__).with_name('offline_web.lua')
NAME = 'OfflineWeb'
# The module goes after this stock function of Lib.lua. Preload.lua loads Lib.lua before any window.
ANCHOR = 'function LoadLocalUrl(key)\n\treturn Game.LocalUrl.Get(key);\nend\n'
BEGIN = '-- >>> offline_web.lua (release/client/patch_offline_web.py)\n'
END = '-- <<< offline_web.lua\n'
LOAD = 'uniwebview:Load('
# name -> (stock line, patched line, Load calls in the stock script, Load calls in the patched script)
CALLS = {
    'UI_Notice.lua': (
        '\t\t\t\tself.uniwebview:Load(string.format("%s?%d", Game.ServerList.GetNoticeUrl(), os.time()))\n',
        '\t\t\t\tself.uniwebview:Load(OfflineWeb.Url(string.format("%s?%d", Game.ServerList.GetNoticeUrl(), os.time()), "notice.html"))\n',
        9, 9),
    'UI_User.lua': (
        '\tself.uniwebview:Load(url)\n',
        '\tself.uniwebview:Load(OfflineWeb.Url(url, "web/offline/index.html"))\n',
        1, 1),
    'UI_ServerError.lua': (
        '\tself.uniwebview:Load(string.format("%s?time=%d", url, os.time()))\n',
        '\tOfflineWeb.LoadError(self.uniwebview, string.format("%s?time=%d", url, os.time()))\n',
        1, 0),
}
# The pages that the calls name. The server must hold each one (server/resources/web).
PAGES = ('notice.html', 'web/offline/index.html', 'web/maintenance/index.html')


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:120]
    return text.replace(old, new)


def module_block():
    module = MODULE.read_text(encoding='utf8').replace('\r\n', '\n')
    assert not any(mark in module for mark in (BEGIN, END, ANCHOR))
    assert module.rstrip('\n').endswith('\n' + NAME + ' = P')
    # The do-block keeps the module's locals out of the scope of the stock script below it.
    return BEGIN + 'do\n' + module.rstrip('\n') + '\nend\n' + END


def lua_script(name, source):
    text = source.decode('utf8').replace('\r\n', '\n')
    if name == 'Lib.lua':
        block = module_block()
        if BEGIN in text:
            assert text.count(BEGIN) == text.count(END) == 1, BEGIN
            head, rest = text.split(BEGIN)
            _, tail = rest.split(END)
            assert head.endswith(ANCHOR)
            text = head + block + tail
        else:
            assert END not in text and NAME not in text
            text = replace_one(text, ANCHOR, ANCHOR + block)
        assert text.count(ANCHOR + block) == text.count(BEGIN) == text.count(END) == text.count(ANCHOR) == 1
        # Outside the module, the stock script does not use the module's name.
        assert text.replace(block, '').count(NAME) == 0, NAME
    elif name in CALLS:
        old, new, stock_loads, loads = CALLS[name]
        if new in text:
            assert text.count(new) == 1 and old not in text, new
        else:
            assert NAME not in text and text.count(LOAD) == stock_loads, name
            text = replace_one(text, old, new)
        assert text.count(NAME) == 1 and text.count(LOAD) == loads, name
    return text.encode('utf8')
