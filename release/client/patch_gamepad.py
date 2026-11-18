"""Controller input: gamepad_fight.lua in the stock fight HUD, gamepad_menu.lua in the UI manager.

Adapted from GirlCafeGun-Offline tools/patch_lua_gamepad.py (MIT, GCG2-Offline contributors).
UI_Fight.lua receives the fight module once, after its UI.Register line, plus one call at the end of the
OnOpen event registrations and one in OnClose. UI.lua receives the menu module once, at its end, plus one
call at the start of UI.Open that starts the menu layer (and restarts it if its timer was cleared).
UI_User.lua (Settings) receives two calls on its Operation page: one builds the "Controller Support" row
(Default / HealthS Claude Improved, kept in the save as task value 32/999; see gamepad_menu.lua), one shows
the stored choice each time the page opens.
Patching a patched script only refreshes the modules.
"""
from pathlib import Path

LUA_NAMES = {'UI_Fight.lua', 'UI.lua', 'UI_User.lua'}
MODULE = Path(__file__).with_name('gamepad_fight.lua')
MENU_MODULE = Path(__file__).with_name('gamepad_menu.lua')
MENU_BEGIN = '-- >>> gamepad_menu.lua (release/client/patch_gamepad.py)\n'
MENU_END = '-- <<< gamepad_menu.lua\n'
UI_OPEN = 'function UI.Open(sClass, ...)\n'
ENSURE = '\tif GamepadMenu then GamepadMenu.Ensure(sClass) end\n'
BEGIN = '-- >>> gamepad_fight.lua (release/client/patch_gamepad.py)\n'
END = '-- <<< gamepad_fight.lua\n'
REGISTER = "local tbClass = UI.Register('UI_Fight');\n"
OPEN = 'Game.GlobalEvent.AddLuaEvent(Game.eEventName.OnNotifyUpdateAutoFight, self.OnUpdateAutoFight)\n'
CLOSE = 'Game.GlobalEvent.RemoveLuaEvent(Game.eEventName.OnNotifyUpdateAutoFight, self.OnUpdateAutoFight)\n'
START, STOP = 'GamepadFight.Start()', 'GamepadFight.Stop()'
# UI_User.lua, Operation page (anchors checked on assets/lua.u of the published 0.1.3 APK)
SETTINGS_INIT = "self.TankMode = self:Find('Toggle2/Tgl4', region):GetComponent('Toggle')\n"
SETTINGS_OPEN = 'self.TankMode.isOn = Game.GameSetting.Instance.TankMode \n'
BUILD = 'if GamepadMode then GamepadMode.BuildSettings(self, region) end'
SHOW = 'if GamepadMode then GamepadMode.ShowSettings(self) end'


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:120]
    return text.replace(old, new)


def call_after(text, anchor, call):
    """Add the call on its own line below the anchor line, with that line's indentation."""
    assert text.count(anchor) == 1, anchor[:120]
    at = text.index(anchor)
    indent = text[text.rfind('\n', 0, at) + 1:at]
    assert not indent.strip(), anchor[:120]
    return text.replace(anchor, anchor + indent + call + '\n')


def module_block(path=MODULE, begin=BEGIN, end=END):
    module = path.read_text(encoding='utf8').replace('\r\n', '\n')
    assert not any(mark in module for mark in (BEGIN, END, START, STOP, MENU_BEGIN, MENU_END, ENSURE))
    # The do-block keeps the module's locals out of the scope of the stock script around it.
    return begin + 'do\n' + module.rstrip('\n') + '\nend\n' + end


def lua_script(name, source):
    text = source.decode('utf8').replace('\r\n', '\n')
    if name == 'UI_Fight.lua':
        block = module_block()
        if BEGIN in text:
            head, rest = text.split(BEGIN)
            _, tail = rest.split(END)
            text = head + block + tail
        else:
            assert END not in text and START not in text and STOP not in text
            text = replace_one(text, REGISTER, REGISTER + block)
            text = call_after(text, OPEN, START)
            text = call_after(text, CLOSE, STOP)
        assert text.count(BEGIN) == text.count(END) == 1
        assert text.count(START) == text.count(STOP) == 1
        assert text.index(REGISTER) < text.index(BEGIN) < text.index(END)
    elif name == 'UI.lua':
        block = module_block(MENU_MODULE, MENU_BEGIN, MENU_END)
        if MENU_BEGIN in text:
            head, rest = text.split(MENU_BEGIN)
            _, tail = rest.split(MENU_END)
            text = head + block + tail
        else:
            assert MENU_END not in text and ENSURE not in text
            text = replace_one(text, UI_OPEN, UI_OPEN + ENSURE)
            text = text.rstrip('\n') + '\n' + block
        assert text.count(MENU_BEGIN) == text.count(MENU_END) == 1 and text.count(ENSURE) == 1
        assert text.index(UI_OPEN) < text.index(MENU_BEGIN) and text.endswith(MENU_END)
    elif name == 'UI_User.lua':
        if BUILD not in text:
            text = call_after(text, SETTINGS_INIT, BUILD)
            text = call_after(text, SETTINGS_OPEN, SHOW)
        assert text.count(BUILD) == text.count(SHOW) == 1
        assert text.index(SETTINGS_INIT) < text.index(BUILD) and text.index(SETTINGS_OPEN) < text.index(SHOW)
    return text.encode('utf8')
