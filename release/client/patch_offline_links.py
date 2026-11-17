"""Dead online links: offline_links.lua at the end of Lib.lua, and five scripts call it or stop early.

Written for the GirlCafeGun-Offline phone build (MIT, GCG2-Offline contributors). The client opens pages and
SDK windows of the publisher that are gone. What the player sees with this patch:
  EvaluateGuide   The "rate the game" window never opens. Its two buttons open a store page that is gone and
                  the publisher's help desk. CheckEvaluateTip returns false at once, which is what it returns
                  when the window is not due: every caller then goes on by itself (UI_PVPSuccess calls its
                  end callback on false), so no caller waits. Nothing is written to the player's task values.
  DropWay         Banners and other jump targets of type Url and OpenUrl ask OfflineLinks.Url first. A moved
                  page opens its new address (the Japanese fan wiki -> wiki.girl.cafe); a closed page (the
                  survey form of the English release) opens nothing, not even the confirm window before it.
                  Every other address opens as before.
  UI_User         Settings > Other: Terms, Privacy (publisher account kit) and Support (publisher help desk)
                  are hidden, and so are the bilibili rows that the Chinese client (zh_CN) adds: the SDK list,
                  account deletion and the video editor row. The call runs after the stock code that shows
                  them. The wiki button (Japanese client only) opens the new wiki.
  UI_JPTip        The wiki button of the Japanese tip window opens the new wiki.
No prefab, table or other asset changes. Patching a patched script only refreshes the module.
"""
from pathlib import Path

NAME = 'OfflineLinks'
MODULE = Path(__file__).with_name('offline_links.lua')
BEGIN = '-- >>> offline_links.lua (release/client/patch_offline_links.py)\n'
END = '-- <<< offline_links.lua\n'
WIKI = '"https://girlcafegun.boom-app.wiki/"'
GUARD = '\t\ttb[2] = OfflineLinks.Url(tb[2]);\n\t\tif not tb[2] then return bChangeMap end\n'
OPEN_URL = '\telseif string.find( target, "OpenUrl" ) then\n\t\tlocal tb = Split( target, ";" );\n'
URL = '\telseif string.find(target, "Url") then\n\t\tlocal tb = Split(target, ";");\n'
RATE = 'function tbClass:CheckEvaluateTip(type,pEndCall)\n'
RATE_STOP = ('\t-- Offline build: the window opens a store page and a help desk that are gone. false = not opened.\n'
             '\tdo return false end\n')
OTHER_END = '\t------------------------其他界面   End-------------------------------------------\n'
# name -> [(stock text, patched text)]. Each stock text must be in the script exactly once.
EDITS = {
    'EvaluateGuide.lua': [(RATE + '\tif not self:CheckNeedEvaluate() then\n',
                           RATE + RATE_STOP + '\tif not self:CheckNeedEvaluate() then\n')],
    'DropWay.lua': [(OPEN_URL, OPEN_URL + GUARD), (URL, URL + GUARD)],
    'UI_User.lua': [('\t\t\t\tU3D.Application.OpenURL(%s);\n' % WIKI, '\t\t\t\tU3D.Application.OpenURL(OfflineLinks.Url(%s));\n' % WIKI),
                    (OTHER_END, '\tOfflineLinks.HideButtons(self.ui.qita)\n' + OTHER_END)],
    'UI_JPTip.lua': [('\t\t\tU3D.Application.OpenURL(%s);\n' % WIKI, '\t\t\tU3D.Application.OpenURL(OfflineLinks.Url(%s));\n' % WIKI)],
}
LUA_NAMES = {'Lib.lua'} | set(EDITS)


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:120]
    return text.replace(old, new)


def module_block():
    module = MODULE.read_text(encoding='utf8').replace('\r\n', '\n')
    assert BEGIN not in module and END not in module
    assert module.rstrip('\n').endswith('\n' + NAME + ' = P')
    # The do-block keeps the module's locals out of the scope of Lib.lua.
    return BEGIN + 'do\n' + module.rstrip('\n') + '\nend\n' + END


def lua_script(name, source):
    text = source.decode('utf8').replace('\r\n', '\n')
    if name == 'Lib.lua':
        block = module_block()
        if BEGIN in text:
            assert text.count(BEGIN) == text.count(END) == 1, BEGIN
            head, rest = text.split(BEGIN)
            _, tail = rest.split(END)
            assert tail == '', 'the module is not at the end of Lib.lua'
            text = head + block
        else:
            assert END not in text and NAME not in text
            # The module goes last: Lib.lua is loaded before any window, and nothing in it runs after its end.
            text = text + ('' if text.endswith('\n') else '\n') + block
        assert text.endswith(block) and text.count(BEGIN) == text.count(END) == 1
        assert text[:-len(block)].count(NAME) == 0, NAME
    elif name in EDITS:
        edits = EDITS[name]
        if not any(new in text for _, new in edits):
            assert NAME not in text and 'do return false end' not in text, name
        for old, new in edits:
            if text.count(new) == 1:
                continue
            text = replace_one(text, old, new)
        assert all(text.count(new) == 1 for _, new in edits), name
        assert text.count(NAME) == sum(new.count(NAME) for _, new in edits), name
    return text.encode('utf8')
