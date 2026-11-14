"""Run the web windows, as patched, in a mocked UI runtime.

run() needs no client file. It passes synthetic scripts through patch_lua.patch_script, so the release edits
and the web patch are applied in the order of the build. Then it opens the three windows with a recording web
view and compares every address with a second implementation of the choice in this file. Only the anchor
lines of the patch come from the client. run_bundle() repeats the behavior steps on the module and the three
window functions inside a patched lua.u.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(ROOT / 'translation/tools/.deps')]
from lupa.lua53 import LuaRuntime
import patch_offline_web as g

NOW = 1763100000
LOCAL = 'http://127.0.0.1:28080/'  # envir.json of the release: the address of every web window
# The window functions that hold the patched calls.
FUNCTIONS = {'UI_Notice.lua': 'function tbClass:WebNotice()\n', 'UI_User.lua': 'function tbClass:OpenURL(url, title)\n',
             'UI_ServerError.lua': 'function tbClass:WebNotice(url)\n'}
# The lines that patch_lua.py and patch_offline_web.py look for are stock text; everything else is a stand-in.
# CRLF is deliberate: the client stores most of its scripts that way.
SYNTHETIC = {name: text.replace('\n', '\r\n').encode('utf8') for name, text in {
    'Lib.lua': '''-- Synthetic stand-in for Lib.lua.
function LoadLocalUrl(key)
\treturn Game.LocalUrl.Get(key);
end

-- Names that the module uses as locals must still resolve to globals here.
function LibGlobals() return P, LOCAL_HOSTS end
''',
    'UI_Notice.lua': '''-- Synthetic stand-in for the Notice window script.
local tbClass = UI.Register('UI_Notice')
function tbClass:WebNotice()
\tself.uniwebview = self:GetComponent("UniWebView", "UniWebView")
\tif Game.Localization.Lang == Game.LangType.zh_TC then
\t\tself.uniwebview:Load("https://www.komoejoy.com/GirlCafeGun/notice/maintenance/h5")
\telse
\t\tif self.tbParams and self.tbParams.url then
\t\t\tself.uniwebview:Load(string.format("%s?%d", self.tbParams.url, os.time()))
\t\telse
\t\t\tif Game.EnvirPackage.Ins.cur == "seasun_jp" then
\t\t\t\tself.uniwebview:Load(string.format("%s?%d", "https://ingame-gcg.xoyo.jp/news/index.html", os.time()))
\t\t\t\tself.uniwebview:Load(string.format("%s?%d", "http://ingame-gcg.xoyo.jp/news/index.html", os.time()))
\t\t\t\tself.uniwebview:Load(string.format("?%d", os.time()))
\t\t\telseif Game.EnvirPackage.Ins.cur == "dev_seasun_jp" then
\t\t\t\tself.uniwebview:Load(string.format("%s?%d", "https://stg-ingame-gcg.xoyo.jp/news/index.html", os.time()))
\t\t\t\tself.uniwebview:Load(string.format("%s?%d", "http://stg-ingame-gcg.xoyo.jp/news/index.html", os.time()))
\t\t\t\tself.uniwebview:Load(string.format("?%d", os.time()))
\t\t\telse
\t\t\t\tself.uniwebview:Load(string.format("%s?%d", Game.ServerList.GetNoticeUrl(), os.time()))
\t\t\tend
\t\tend
\tend
\tself.uniwebview:Show()
end
function tbClass:UpdateUI(NoticeHelper)
end
''',
    'UI_User.lua': '''-- Synthetic stand-in for the settings window script.
local tbClass = UI.Register('UI_User')
function tbClass:OnInit()
\tif Game.Localization.Lang == Game.LangType.zh_CN then
\t\tself.BtnDevelopPanel.gameObject:SetActive(true)
\tend
end
function tbClass:OpenURL(url, title)
\tself.uniwebview = self:GetComponent("UniWebView", "PanelTip")
\tself.uniwebview:Load(url)
\tself.uniwebview:Show()
end

function tbClass:CloseURL()
end
''',
    'UI_ServerError.lua': '''-- Synthetic stand-in for the server-error window script.
local tbClass = UI.Register('UI_ServerError')
function tbClass:WebNotice(url)
\tself.uniwebview = self:GetComponent("Panel", "UniWebView")
\tself.uniwebview:Load(string.format("%s?time=%d", url, os.time()))
\tself.uniwebview:Show()
end

function tbClass:OnClose()
end
''',
}.items()}

# Addresses for OfflineWeb.Url. A local address without a page changes:
MAPPED = [LOCAL, 'http://127.0.0.1:28080', LOCAL + '?1763100000', 'http://127.0.0.1:28080?time=5', LOCAL + '#top',
          'http://127.0.0.1/', 'http://localhost:18080/', 'HTTP://LOCALHOST/?1', 'https://127.0.0.1:28080/',
          'http://[::1]:28080/', 'http://127.0.0.1:/']
# Every other address stays: a page is named already, the host is another one, or it is no web address.
KEPT = [LOCAL + 'notice.html?1', LOCAL + 'web/maintenance/index.html', LOCAL + 'serverlist', LOCAL + '/',
        'http://127.0.0.1:28080//?1', 'https://game.bilibili.com/', 'https://www.komoejoy.com/GirlCafeGun/notice/maintenance/h5',
        'http://127.0.0.10/', 'http://127.0.0.1.example.org/', 'http://example.org:28080/?http://127.0.0.1:28080/',
        'http://user@127.0.0.1/', 'http://localhost.example.org/', 'ftp://127.0.0.1/', 'file:///sdcard/page.html',
        '//127.0.0.1:28080/', '127.0.0.1:28080/', '?1763100000', '', ' ' + LOCAL]

MOCK = r'''
printed = {}
-- Only the lines of the module are kept; a stock window prints lines of its own.
print = function(...)
  local line = {}
  for i = 1, select('#', ...) do line[i] = tostring((select(i, ...))) end
  line = table.concat(line, ' ')
  if line:sub(1, 5) == '[web]' then printed[#printed + 1] = line end
end
os.time = function() return @NOW@ end
-- Any stock object that a window touches on its way to the web view.
local function any()
  local t = {}
  return setmetatable(t, { __index = function(_, k) local v = any(); rawset(t, k, v); return v end,
    __call = function() return any() end })
end
-- A web view that records what it is asked to load. text: 'works', 'raises' or 'absent'.
function webview(text)
  local v = { loads = {}, texts = {}, shown = 0 }
  function v:Load(url) self.loads[#self.loads + 1] = url end
  function v:Show() self.shown = self.shown + 1 end
  if text == 'works' then
    function v:LoadHTMLString(html, base, skip) self.texts[#self.texts + 1] = html; self.base, self.skip = base, skip end
  elseif text == 'raises' then
    function v:LoadHTMLString() error('LoadHTMLString is not available') end
  end
  return v
end
local world = {}
Game = { Localization = { Lang = 'zh_CN' }, LangType = { zh_CN = 'zh_CN', zh_TC = 'zh_TC', en_US = 'en_US' },
  EnvirPackage = { Ins = { cur = 'bili' } }, App = {}, ServerList = { GetNoticeUrl = function() return world.notice end } }
GameManager = {}
-- The windows get a web view that exists, so they must not make a second one.
typeof, CS = function() error('a second web view was made') end, any()
-- UI_Default: what a window script inherits.
local base = { Find = function() return any() end, OnClickAndClear = function() return any() end }
function base:GetComponent(kind, path)
  if kind == 'UniWebView' or path == 'UniWebView' then return world.view end
  return any()
end
windows = {}
UI = { Register = function(name) windows[name] = setmetatable({}, { __index = base }); return windows[name] end }
-- A window function taken out of its script: it is defined on the class of that window.
function define(name, chunk)
  tbClass = UI.Register(name)
  assert(load(chunk, name))()
  tbClass = nil
end
-- One window: the function runs on a fresh screen object.
function open(name, fn, view, notice, ...)
  world, printed = { view = view, notice = notice }, {}
  local screen = setmetatable({}, { __index = windows[name] })
  windows[name][fn](screen, ...)
  assert(screen.uniwebview == view)
  return table.concat(view.loads, '|'), #view.loads, #view.texts, view.shown, table.concat(printed, '|')
end
'''.replace('@NOW@', str(NOW))


def expected(url, page):
    """A second implementation of OfflineWeb.Url."""
    if not isinstance(url, str):
        return url
    scheme, mark, rest = url.partition('://')
    if not mark or scheme.lower() not in ('http', 'https'):
        return url
    cut = min((i for i in map(rest.find, '/?#') if i >= 0), default=len(rest))
    authority, tail = rest[:cut], rest[cut:]
    host, colon, port = authority.rpartition(':')
    if not colon or not all(c in '0123456789' for c in port):
        host = authority  # no port
    if host.lower() not in ('127.0.0.1', 'localhost', '[::1]'):
        return url
    if tail.startswith('/'):
        tail = tail[1:]
    if tail and tail[0] not in '?#':
        return url  # a page is named
    return scheme + '://' + authority + '/' + page + tail


def rejected(name, text):
    try:
        g.lua_script(name, text.encode('utf8'))
    except AssertionError:
        return 1
    return 0


def check_injection():
    import patch_lua
    block, scripts = g.module_block(), {}
    assert set(SYNTHETIC) == g.LUA_NAMES == set(g.CALLS) | {'Lib.lua'} and g.LUA_NAMES <= patch_lua.NAMES
    for name, source in SYNTHETIC.items():
        names, g.LUA_NAMES = g.LUA_NAMES, set()
        try:
            release = patch_lua.patch_script(name, source)  # the release edits without the web patch
        finally:
            g.LUA_NAMES = names
        once = patch_lua.patch_script(name, source)
        # The build order (release edits, then web) and the hook on its own give the same script.
        assert once == g.lua_script(name, release) and once != release
        # Web first and release edits second ends in the same script.
        assert patch_lua.patch_script(name, g.lua_script(name, source)) == once
        assert g.lua_script(name, once) == once and g.lua_script(name, once.replace(b'\n', b'\r\n')) == once
        text, plain = once.decode('utf8'), release.decode('utf8')
        assert '\r' not in text
        if name == 'Lib.lua':
            # Nothing else changes: without the module the script is back.
            assert text.count(g.ANCHOR + block) == 1 and text.replace(block, '') == plain
            # A stale module between the markers is replaced.
            stale = text.replace(block, g.BEGIN + 'OfflineWeb = nil\n' + g.END)
            assert g.lua_script(name, stale.encode('utf8')) == once
            count = rejected(name, plain.replace(g.ANCHOR, '')) + rejected(name, plain.replace(g.ANCHOR, g.ANCHOR * 2))
            # A stock script that already uses the module's name is not patched; neither is a half-patched one.
            count += rejected(name, plain + 'OfflineWeb = 1\n') + rejected(name, text.replace(g.END, ''))
            # The module must stay right after its anchor.
            count += rejected(name, text.replace(g.ANCHOR + block, block + g.ANCHOR))
            assert count == 5, count
        else:
            old, new, stock_loads, loads = g.CALLS[name]
            assert plain.count(old) == 1 and plain.count(g.LOAD) == stock_loads and text.count(g.LOAD) == loads
            # Nothing else changes: with the stock line the script is back.
            assert text.replace(new, old) == plain
            count = rejected(name, plain.replace(old, '')) + rejected(name, plain.replace(old, old + old))
            # Another number of Load calls is another client: the patch does not guess.
            count += rejected(name, plain + '\tself.uniwebview:Load(other)\n')
            count += rejected(name, plain + 'OfflineWeb = 1\n') + rejected(name, text + new)
            assert count == 5, (name, count)
        scripts[name] = once
    assert g.lua_script('Other.lua', SYNTHETIC['Lib.lua']) == SYNTHETIC['Lib.lua'].replace(b'\r\n', b'\n')
    return scripts


def function_chunk(text, head):
    assert text.count(head) == 1, head
    start = text.index(head)
    end = text.find('\nfunction ', start)
    return text[start:end if end > 0 else len(text)]


def runtime(*chunks):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(MOCK)
    for chunk in chunks:
        lua.execute(chunk)
    return lua


def sentences(html):
    """The text of a page, sentence by sentence, without its markup."""
    body = html[html.index('<body'):]
    return [' '.join(re.sub(r'<[^>]+>', ' ', part).split())
            for part in re.findall(r'<(?:h1|p|li)\b[^>]*>.*?</(?:h1|p|li)>', body, re.S)]


def run(scripts=None, report=None):
    synthetic = scripts is None
    if synthetic:
        scripts = check_injection()
    texts = {}
    for name in sorted(g.LUA_NAMES):
        assert g.lua_script(name, scripts[name]) == scripts[name], name
        texts[name] = scripts[name].decode('utf8')
        LuaRuntime().execute('assert(load(...))', texts[name])
    block = g.module_block()
    assert texts['Lib.lua'].count(g.ANCHOR + block) == 1
    # A complete stock script cannot run in the mock, so a script contributes the module or its window function.
    lua = runtime(block)
    for name, head in FUNCTIONS.items():
        assert g.CALLS[name][1] in function_chunk(texts[name], head), name
        lua.globals().define(name[:-len('.lua')], function_chunk(texts[name], head))
    url, opened = lua.eval('OfflineWeb.Url'), lua.globals().open
    view = lambda text='works': lua.eval("webview('%s')" % text)

    # 1. The choice of the address, against the second implementation.
    for page in g.PAGES:
        for address in MAPPED + KEPT:
            want = expected(address, page)
            assert (want != address) == (address in MAPPED), (address, want)
            assert url(address, page) == want, (address, page, url(address, page), want)
    assert url(LOCAL, 'notice.html') == LOCAL + 'notice.html' and url(LOCAL + '?5', 'a/b.html') == LOCAL + 'a/b.html?5'
    # Not a text: the value comes back as it is.
    assert url(None, 'notice.html') is None and url(5, 'notice.html') == 5 and url(LOCAL, None) == LOCAL
    # Each address that got a page left one line in the log.
    assert lua.eval('#printed') == len(MAPPED) * len(g.PAGES) + 2 and lua.eval('printed[1]') == '[web] local page: notice.html'
    if report: report('ok OfflineWeb.Url: %d local addresses get a page, %d other addresses stay, for each of %d pages'
                      % (len(MAPPED), len(KEPT), len(g.PAGES)))

    # 2. The Notice window: the address of envir.json gets the Notice page, the time stays in the query.
    got = opened('UI_Notice', 'WebNotice', view(), LOCAL)
    assert got == (LOCAL + 'notice.html?%d' % NOW, 1, 0, 1, '[web] local page: notice.html'), got
    other = 'https://example.org/notice/h5/'
    got = opened('UI_Notice', 'WebNotice', view(), other)
    assert got == (other + '?%d' % NOW, 1, 0, 1, ''), got
    if report: report('ok Notice window: %s -> %snotice.html?<time>; another host stays' % (LOCAL, LOCAL))

    # 3. Help and Glossary: the local address gets the page that says there is no copy.
    got = opened('UI_User', 'OpenURL', view(), None, LOCAL, 'Help')
    assert got == (LOCAL + 'web/offline/index.html', 1, 0, 1, '[web] local page: web/offline/index.html'), got
    got = opened('UI_User', 'OpenURL', view(), None, 'https://example.org/help/index.html', 'Help')
    assert got == ('https://example.org/help/index.html', 1, 0, 1, ''), got
    if report: report('ok settings window: %s -> %sweb/offline/index.html; another host stays' % (LOCAL, LOCAL))

    # 4. The server-error window: the text from inside the script, and no request at all.
    html = lua.eval('OfflineWeb.ErrorHtml()')
    assert html.startswith('<!DOCTYPE html>') and html.endswith('</html>') and '#' not in html and '%' not in html
    assert not re.search(r'https?://|src=|href=|url\(', html) and html.isascii()
    shown = view()
    got = opened('UI_ServerError', 'WebNotice', shown, None, LOCAL)
    assert got == ('', 0, 1, 1, '[web] server error: text shown'), got
    assert lua.eval('function(v, html) return v.texts[1] == html and v.base == "" and v.skip == false end')(shown, html)
    # A web view that cannot take a text: the page with the same text, as the stock window loads its address.
    for text in ('raises', 'absent'):
        got = opened('UI_ServerError', 'WebNotice', view(text), None, LOCAL)
        assert got[:4] == (LOCAL + 'web/maintenance/index.html?time=%d' % NOW, 1, 0, 1), (text, got)
        assert got[4].startswith('[web] server error: text not shown, the page is loaded: '), got
        assert got[4].endswith('|[web] local page: web/maintenance/index.html'), got
        got = opened('UI_ServerError', 'WebNotice', view(text), None, 'https://example.org/maintenance/')
        assert got[:4] == ('https://example.org/maintenance/?time=%d' % NOW, 1, 0, 1), (text, got)
    if report: report('ok server-error window: text shown without a request; page loaded when the web view takes no text')

    # 5. The server holds the pages that the calls name, and its page says what the text in the script says.
    pages = ROOT / 'server/resources/web'
    with_server = pages.is_dir()
    if with_server:
        for name in g.PAGES:
            assert (pages / ('notice/index.html' if name == 'notice.html' else name[len('web/'):])).is_file(), name
        page = (pages / 'maintenance/index.html').read_text(encoding='utf8')
        assert sentences(page) == sentences(html) and len(sentences(html)) == 6, (sentences(page), sentences(html))
        if report: report('ok the text in the script equals server/resources/web/maintenance/index.html: %d sentences' % len(sentences(html)))

    if synthetic:
        # The whole scripts load, the module's locals stay inside it, and the module is a global for the windows.
        whole = runtime(*[texts[name] for name in ['Lib.lua'] + sorted(FUNCTIONS)])
        whole.execute('P, LOCAL_HOSTS = 1, 2')
        assert whole.eval('LibGlobals()') == (1, 2) and whole.eval('type(OfflineWeb.Url)') == 'function'
        got = whole.globals().open('UI_Notice', 'WebNotice', whole.eval("webview('works')"), LOCAL)
        assert got[0] == LOCAL + 'notice.html?%d' % NOW, got
        if report: report('ok whole scripts: the locals of the module do not leak, OfflineWeb is a global')
    return {'webWindowsOpenedInMockRuntime': True, 'syntheticSources': synthetic,
            'addressesChecked': len(MAPPED + KEPT) * len(g.PAGES),
            'noticeWindowLoadsLocalNoticePage': True, 'settingsWindowLoadsLocalPage': True,
            'serverErrorTextShownWithoutRequest': True, 'serverErrorPageWhenWebViewTakesNoText': True,
            'otherHostsUnchanged': True, 'textInScriptEqualsServerPage': with_server,
            'eachAnchorRequiredExactlyOnce': synthetic, 'patchIdempotent': True,
            'moduleLocalsDoNotLeakIntoLib': synthetic, 'patchedLuaSyntaxPassed': True}


def run_bundle(source):
    import asset_tools as w
    _, raw = w.unityfs(w.transform(source))
    _, objects = w.serialized_objects(raw)
    scripts = {o['name']: raw[o['script_start']:o['script_start'] + o['script_length']]
               for o in objects if o.get('name') in g.LUA_NAMES}
    assert set(scripts) == g.LUA_NAMES, sorted(g.LUA_NAMES - set(scripts))
    return run(scripts)


if __name__ == '__main__':
    print(run(report=print))
