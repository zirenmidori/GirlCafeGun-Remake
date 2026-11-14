"""Controller input for shooting stages: gamepad_fight.lua inside the stock fight HUD.

Adapted from GirlCafeGun-Offline tools/patch_lua_gamepad.py (MIT, GCG2-Offline contributors).
UI_Fight.lua receives the module once, after its UI.Register line, plus one call at the end of the
OnOpen event registrations and one in OnClose. Patching a patched script only refreshes the module.
"""
from pathlib import Path

LUA_NAMES = {'UI_Fight.lua'}
MODULE = Path(__file__).with_name('gamepad_fight.lua')
BEGIN = '-- >>> gamepad_fight.lua (release/client/patch_gamepad.py)\n'
END = '-- <<< gamepad_fight.lua\n'
REGISTER = "local tbClass = UI.Register('UI_Fight');\n"
OPEN = 'Game.GlobalEvent.AddLuaEvent(Game.eEventName.OnNotifyUpdateAutoFight, self.OnUpdateAutoFight)\n'
CLOSE = 'Game.GlobalEvent.RemoveLuaEvent(Game.eEventName.OnNotifyUpdateAutoFight, self.OnUpdateAutoFight)\n'
START, STOP = 'GamepadFight.Start()', 'GamepadFight.Stop()'


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


def module_block():
    module = MODULE.read_text(encoding='utf8').replace('\r\n', '\n')
    assert not any(mark in module for mark in (BEGIN, END, START, STOP))
    # The do-block keeps the module's locals out of the scope of the stock script below it.
    return BEGIN + 'do\n' + module.rstrip('\n') + '\nend\n' + END


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
    return text.encode('utf8')
