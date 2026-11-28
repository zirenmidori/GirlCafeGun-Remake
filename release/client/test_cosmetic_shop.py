"""Cosmetic rows of patch_cosmetic_shop against the server twin, the time rule of IBLogic:CheckTime and the
UI_GiftBoxTips hook.

Run: python test_cosmetic_shop.py <release APK>
"""
import re
import sys
import zipfile
from pathlib import Path

from lupa.lua53 import LuaRuntime

import patch_cosmetic_shop as shop
import patch_costume_shop as costume

SERVER_DATA = Path(__file__).resolve().parents[2] / 'server/src/game-data/cosmetic-shop-data.ts'
GROUPS = {'visitingCard': 76, 'headFrame': 11, 'listMark': 77, 'chatBubble': 78}
ROW = re.compile(r'\{ id: (\d+), cost: (\d+), kind: "(\w+)", cosmeticId: (\d+), group: (\d+), type: (\d), '
                 r'limitTime: (\d+), item: \[([\d, ]+)\] \}')


def server_rows():
    text = SERVER_DATA.read_text(encoding='utf8')
    rows = [{'id': int(i), 'cost': int(c), 'kind': k, 'cosmeticId': int(cid), 'group': int(g), 'type': int(t),
             'limitTime': int(lt), 'gdpl': [int(v) for v in item.split(',')]}
            for i, c, k, cid, g, t, lt, item in ROW.findall(text)]
    assert len(rows) == text.count('{ id: ') and rows, 'a server row does not match the pattern the test reads'
    return rows


def table_rows(text):
    lines = text.replace('\r\n', '\n').split('\n')
    header = lines[2].split('\t')
    return [dict(zip(header, line.split('\t'))) for line in lines[3:] if line.split('\t')[0].isdigit()]


def lua_check_time():
    return LuaRuntime().eval('''function(startTime, endTime, now)
        local function GetDate2Time(v) if not v or v == 0 then return 0 end
            local s = tostring(v); return os.time{year=tonumber(s:sub(1,4)), month=tonumber(s:sub(5,6)),
            day=tonumber(s:sub(7,8)), hour=tonumber(s:sub(9,10)), min=tonumber(s:sub(11,12))} end
        local nStart, nEnd = GetDate2Time(startTime), GetDate2Time(endTime)
        if nStart > 0 and now < nStart then return false end
        if nEnd > 0 and now > nEnd then return false end
        return true end''')


def run(text, tables, items):
    rows = shop.cosmetic_rows(tables, items)
    server = server_rows()
    expected = [{**r, 'group': GROUPS[r['kind']]} for r in rows]
    assert [{k: v for k, v in s.items()} for s in server] == [{k: v for k, v in e.items()} for e in expected], \
        'server cosmetic-shop-data.ts and the client rows differ'
    counts = {k: sum(1 for r in rows if r['kind'] == k) for k in GROUPS}
    assert all(counts.values()), counts
    patched, prices = shop.patch_text(text, rows)
    newline = '\r\n' if '\r\n' in text else '\n'
    assert patched.count(newline) == text.count(newline) + len(rows)
    _, before = text, table_rows(text)
    after = table_rows(patched)
    new_ids = {r['id'] for r in rows}
    assert min(new_ids) == shop.FIRST_ID and not new_ids & {int(r['Id']) for r in before}
    assert len(after) == len(before) + len(rows)
    # only the new ids changed: every other row is byte-for-byte the same
    assert [r for r in after if int(r['Id']) not in new_ids] == before
    assert patched.startswith(text.rstrip('\r\n').split(newline)[0])
    sold = {int(r['Id']): r for r in after if int(r['Id']) in new_ids}
    assert set(sold) == new_ids
    check = lua_check_time()
    for index, row in enumerate(rows):
        r = sold[row['id']]
        assert r['Currency'] == '-2' and r['LabelIdx'] == '102' and (r['LimitType'], r['LimitTimes']) == ('4', '1')
        assert r['StartTime'] == r['EndTime'] == r['LockTime'] == r['IsHide'] == ''
        assert r['OffFlag'] == r['OffStartTime'] == r['OffEndTime'] == r['OffCost'] == ''
        assert int(r['Cost']) == prices[row['id']] == row['cost']
        assert r['GDPL'] == '[%s,1]' % ','.join(str(v) for v in row['gdpl']), r['GDPL']
        assert int(r['Sort']) == shop.ROW_SORT == 300
        for now in (1795000000, 2100000000):
            assert check(int(r['StartTime'].strip('[]') or 0), int(r['EndTime'].strip('[]') or 0), now), r['Id']
    # the costume tab is untouched
    assert [r for r in after if r['LabelIdx'] == '101'] == [r for r in before if r['LabelIdx'] == '101']
    return {'rows': counts, 'total': len(rows), 'totalCost': sum(r['cost'] for r in rows)}



def run_lua(lua_u):
    """The UI_GiftBoxTips hook on the real script of lua.u."""
    cipher, unity, builder = shop_asset_parsers()
    meta, raw = unity.unityfs(cipher.transform(lua_u))
    _, objects = builder.serialized_objects(raw)
    obj, = [o for o in objects if o.get('name') == 'UI_GiftBoxTips.lua']
    source = raw[obj['script_start']:obj['script_start'] + obj['script_length']]
    patched = shop.lua_script('UI_GiftBoxTips.lua', source)
    text = patched.decode('utf8')
    lua = LuaRuntime()
    lua.execute('assert(load(...))', text)
    assert shop.GIFT_OLD not in text
    assert text.count(shop.GIFT_NEW) == 1 and text.count('ItemBox:GetBoxCfg(') == 1
    for cls in shop.COSMETIC_CLASSES:
        assert "pItem.ClassName == '%s'" % cls in text
    # run the changed block: a cosmetic lists itself, a box item still looks its box up
    block = text[text.index('    local tbBoxInfo   = nil'):text.index('    self.NormalScroll.listToFill = self.DataList\n    self.NormalScroll.totalCount')]
    probe = lua.eval('''function(block, className)
        local added, looked = {}, {}
        local self = {tbItem = {tbGDPL = {6, 21, 3, 4}}, DataList = {Add = function(_, v) added[#added + 1] = v end}}
        local pItem = {ClassName = className, ExtParam1 = '5'}
        ItemBox = {GetBoxCfg = function(_, id) looked[#looked + 1] = id; return {Fix = {{G = 1, D = 2, P = 3, L = 4, N = 5}}} end}
        local f = load('local self, pItem = ...\\n' .. block)
        f(self, pItem)
        return added, looked end''')
    added, looked = probe(block, 'ItemVisitingCardAuto')
    assert len(added) == 1 and len(looked) == 0
    assert [added[1][k] for k in 'GDPLN'] == [6, 21, 3, 4, 1]
    added, looked = probe(block, 'ItemBoxAuto')
    assert len(added) == 1 and added[1]['G'] == 1 and len(looked) == 1 and looked[1] == 5
    return {'giftBoxTipsChanged': True}


def shop_asset_parsers():
    from asset_tools import load_reviewed_parsers
    return load_reviewed_parsers()


def run_bundle(setting_u):
    import asset_tools as w
    import UnityPy
    _, raw, encrypted, plain = w.decode(setting_u)
    assert encrypted
    env = UnityPy.load(plain)
    text = env.container[shop.PATH].deref().read_typetree()['m_Script']
    tables = shop._tables(env)
    items = shop.item_rows(w.typed_tables(raw, {'ItemList'})['ItemList']['value'])
    proof = run(text, tables, items)
    # the pipeline runs the costume recipe first: same rows on top of its text
    costume_text = costume.patch_text(text)[0]
    assert run(costume_text, tables, items) == proof
    obj = env.container[shop.PATH].deref()
    costume_replacements, _ = costume.settings_objects(env)
    replacements, _ = shop.settings_objects(env, raw, costume_replacements)
    tree = obj.read_typetree()
    tree['m_Script'] = shop.patch_text(costume_text, shop.cosmetic_rows(tables, items))[0]
    assert replacements == {obj.path_id: obj.save_typetree(tree)}
    encoded, build_proof = shop.build(setting_u)
    _, _, _, plain2 = w.decode(encoded)
    patched = UnityPy.load(plain2).container[shop.PATH].deref().read_typetree()['m_Script']
    assert patched == shop.patch_text(text, shop.cosmetic_rows(tables, items))[0]
    proof['onlyChangedObjectIds'] = build_proof['onlyChangedObjectIds']
    return encoded, proof


if __name__ == '__main__':
    import asset_tools
    asset_tools.configure(sys.argv[1])
    apk = zipfile.ZipFile(sys.argv[1])
    _, proof = run_bundle(apk.read('assets/setting.u'))
    lua_proof = run_lua(apk.read('assets/lua.u'))
    print('cosmetic shop OK', proof['total'], 'rows', proof['rows'], 'cost', proof['totalCost'],
          proof['onlyChangedObjectIds'], lua_proof)
