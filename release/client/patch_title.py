"""Two title screens: Load2DBG of UI_Login.lua shows the hall or the sky title, one of them at each start.

Recreated from the GirlCafeGun-Offline phone build (MIT, GCG2-Offline contributors), which carried this edit
only inside a patched lua.u. The stock function shows the hall title when the language is English. In any
other language it leaves the prefab as loaded, and that state is the sky title. The 4-girl animation of the
sky title is a separate object, "Spine", that the stock script never switches.
The patch replaces the language test with a choice and switches "Spine" with it. The hall branch itself stays
as it is. No prefab, image or other asset changes. Patching a patched script only refreshes the block.
"""
import re

LUA_NAMES = {'UI_Login.lua'}
# Share of starts that show the hall title: 0 is always the sky title, 1 is always the hall title.
HALL_CHANCE = 0.5
HEAD = 'function tbClass:Load2DBG()\n'
STOCK_TEST = '\tif self:IsUS() then \n'
TEST = '\tif useHall then \n'
CALL = 'self:Load2DBG()'
# The branch under the test must be the hall branch this patch relies on: it hides the sky objects.
HALL_LINES = (
    '\t\tself:FindObject("PnlBGEffect/eftParent4"):SetActive(false);\n',
    '\t\tself:FindObject("PnlBGEffect/Image1"):SetActive(true);\n',
    '\t\tself:FindObject("PnlBGEffect/Image2"):SetActive(true);\n',
    '\t\tself:FindObject("PnlBGEffect/Image3"):SetActive(false);\n',
)
BEGIN = '\t-- >>> title screens (release/client/patch_title.py)\n'
END = '\t-- <<< title screens\n'
LOCALS = ('hallChance', 'rolled', 'roll', 'useHall', 'spine')
BODY = '''\t-- One of two titles at each start. The hall title is the branch below; the sky title is the
\t-- state the prefab loads in. "Spine" is the 4-girl animation and belongs to the sky title only.
\tlocal hallChance = %s
\tlocal rolled, roll = pcall(function() return U3D.Random.value end)
\tif not rolled or type(roll) ~= 'number' then roll = (os.time() %% 100) / 100 end
\tlocal useHall = hallChance >= 1 or roll < hallChance
\tlocal spine = self:FindObject("Spine")
\tif spine then spine:SetActive(not useHall) end
'''


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:120]
    return text.replace(old, new)


def block():
    assert isinstance(HALL_CHANCE, (int, float)) and 0 <= HALL_CHANCE <= 1, HALL_CHANCE
    return BEGIN + BODY % repr(float(HALL_CHANCE)) + END


def function_text(text):
    """The Load2DBG function, from its header to the end keyword in the first column."""
    assert text.count(HEAD) == 1, HEAD
    start = text.index(HEAD)
    end = re.compile(r'\nend[ \t]*(\n|$)').search(text, start)
    assert end, HEAD
    return text[start:end.end()]


def lua_script(name, source):
    text = source.decode('utf8').replace('\r\n', '\n')
    if name == 'UI_Login.lua':
        if BEGIN in text:
            assert text.count(BEGIN) == text.count(END) == 1, BEGIN
            head, rest = text.split(BEGIN)
            _, tail = rest.split(END)
            assert head.endswith(HEAD) and tail.startswith(TEST)
            text = head + block() + tail
        else:
            assert END not in text and TEST not in text
            # The new locals must not capture a name that the stock function already uses.
            code = re.sub(r'--[^\n]*', '', function_text(text))
            assert not re.search(r'\b(%s)\b' % '|'.join(LOCALS), code), code[:200]
            text = replace_one(text, HEAD + STOCK_TEST, HEAD + block() + TEST)
        function = function_text(text)
        assert function.startswith(HEAD + block() + TEST)
        assert text.count(BEGIN) == text.count(END) == text.count(TEST) == 1
        at = len(HEAD + block() + TEST)
        for line in HALL_LINES:
            assert text.count(line) == 1 and function.find(line, at) >= at, line
            at = function.index(line, at) + len(line)
        # OnInit is the only caller; each new login screen makes one choice.
        assert text.count(CALL) == 1, CALL
    return text.encode('utf8')
