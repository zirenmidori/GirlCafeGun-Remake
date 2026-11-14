"""Title screens: title_screens.lua inside the stock login script, and Load2DBG asks it which title to show.

Recreated and extended from the GirlCafeGun-Offline phone build (MIT, GCG2-Offline contributors), which
carried a two-title version of this edit only inside a patched lua.u. The stock Load2DBG shows the hall title
when the language is English. In any other language it leaves the prefab as loaded, and that state is the
scene title. The patch places the module once, before Load2DBG, and replaces the language test with one
call. The hall branch itself stays as it is. No prefab, image or other asset is added or changed: the module
uses only art that the client data already holds, and leaves out a title whose art does not load.
Patching a patched script only refreshes the module.
"""
from pathlib import Path

LUA_NAMES = {'UI_Login.lua'}
MODULE = Path(__file__).with_name('title_screens.lua')
HEAD = 'function tbClass:Load2DBG()\n'
STOCK_TEST = '\tif self:IsUS() then \n'
TEST = '\tif TitleScreens.Choose(self) then \n'
CALL = 'self:Load2DBG()'
# The module calls these stock members of the login script.
USES = ('function tbClass:IsUS()\n', 'function tbClass:BackgroundAdapter()\n')
# The branch under the test must be the hall branch this patch relies on: it hides the scene objects.
HALL_LINES = (
    '\t\tself:FindObject("PnlBGEffect/eftParent4"):SetActive(false);\n',
    '\t\tself:FindObject("PnlBGEffect/Image1"):SetActive(true);\n',
    '\t\tself:FindObject("PnlBGEffect/Image2"):SetActive(true);\n',
    '\t\tself:FindObject("PnlBGEffect/Image3"):SetActive(false);\n',
)
BEGIN = '-- >>> title_screens.lua (release/client/patch_title.py)\n'
END = '-- <<< title_screens.lua\n'
NAME = 'TitleScreens'


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:120]
    return text.replace(old, new)


def module_block():
    module = MODULE.read_text(encoding='utf8').replace('\r\n', '\n')
    assert not any(mark in module for mark in (BEGIN, END, HEAD, TEST))
    assert module.rstrip('\n').endswith('\n' + NAME + ' = P')
    # The do-block keeps the module's locals out of the scope of the stock script below it.
    return BEGIN + 'local ' + NAME + '\ndo\n' + module.rstrip('\n') + '\nend\n' + END


def lua_script(name, source):
    text = source.decode('utf8').replace('\r\n', '\n')
    if name == 'UI_Login.lua':
        block = module_block()
        if BEGIN in text:
            assert text.count(BEGIN) == text.count(END) == 1, BEGIN
            head, rest = text.split(BEGIN)
            _, tail = rest.split(END)
            assert tail.startswith(HEAD + TEST)
            text = head + block + tail
        else:
            assert END not in text and NAME not in text
            text = replace_one(text, HEAD + STOCK_TEST, block + HEAD + TEST)
        assert text.count(BEGIN) == text.count(END) == text.count(HEAD) == text.count(TEST) == 1
        at = text.index(block + HEAD + TEST) + len(block + HEAD + TEST)
        end = text.index('\nend\n', at)
        for line in HALL_LINES:
            assert text.count(line) == 1 and at <= text.find(line, at) < end, line
            at = text.index(line, at) + len(line)
        for member in USES:
            assert text.count(member) == 1, member
        # OnInit is the only caller; each new login screen makes one choice.
        assert text.count(CALL) == 1, CALL
    return text.encode('utf8')
