"""Dress shop rows of patch_costume_shop against the server twin and the time rule of IBLogic:CheckTime.

Run: python test_costume_shop.py <release APK>
"""
import re
import sys
import zipfile
from pathlib import Path

from lupa.lua53 import LuaRuntime

import patch_costume_shop as shop

SERVER_DATA = Path(__file__).resolve().parents[2] / 'server/src/game-data/costume-shop-data.ts'


def server_packs():
    text = SERVER_DATA.read_text(encoding='utf8')
    rows = re.findall(r'\{ id: (\d+), cost: (\d+), girlId: \d+, modelId: \d+, suit: \[[\d, ]+\], contents: (\[\[.*?\]\]) \}', text)
    return {int(i): (int(c), contents) for i, c, contents in rows}


def table_rows(text):
    lines = text.replace('\r\n', '\n').split('\n')
    header = lines[2].split('\t')
    return header, [dict(zip(header, line.split('\t'))) for line in lines[3:] if line.split('\t')[0].isdigit()]


def run(text):
    patched, prices = shop.patch_text(text)
    assert patched.count('\r\n') == text.count('\r\n') + len(shop.NEW) * ('\r\n' in text)
    header, rows = table_rows(patched)
    _, before = table_rows(text)
    assert len(rows) == len(before) + len(shop.NEW)
    dress = {int(r['Id']): r for r in rows if r['LabelIdx'] == '101'}
    assert sorted(dress) == list(range(1001, 1042)), sorted(dress)
    server = server_packs()
    assert sorted(server) == sorted(dress), 'server costume-shop-data.ts and the client rows differ'
    for rid, r in dress.items():
        assert r['Currency'] == '-2' and r['EndTime'] == '' and r['LockTime'] == '' and r['IsHide'] == ''
        assert (r['LimitType'], r['LimitTimes']) == ('4', '1')
        assert r['OffFlag'] == r['OffStartTime'] == r['OffEndTime'] == r['OffCost'] == ''
        assert int(r['Cost']) == prices[rid] == server[rid][0], (rid, r['Cost'], server[rid][0])
        box = int(r['GDPL'].strip('[]').split(',')[3])
        assert box == 6000 + rid - 1001 and ('[19, 1, ' in server[rid][1]), (rid, box)
    # rows outside the dress shop are byte-for-byte the same
    assert [r for r in rows if r['LabelIdx'] != '101'] == [r for r in before if r['LabelIdx'] != '101']
    # IBLogic:CheckTime with the patched times: every dress row is on sale now and in ten years
    lua = LuaRuntime()
    check = lua.eval('''function(startTime, endTime, now)
        local function GetDate2Time(v) if not v or v == 0 then return 0 end
            local s = tostring(v); return os.time{year=tonumber(s:sub(1,4)), month=tonumber(s:sub(5,6)),
            day=tonumber(s:sub(7,8)), hour=tonumber(s:sub(9,10)), min=tonumber(s:sub(11,12))} end
        local nStart, nEnd = GetDate2Time(startTime), GetDate2Time(endTime)
        if nStart > 0 and now < nStart then return false end
        if nEnd > 0 and now > nEnd then return false end
        return true end''')
    for now in (1795000000, 2100000000):
        for r in dress.values():
            start = int(r['StartTime'].strip('[]') or 0)
            end = int(r['EndTime'].strip('[]') or 0)
            assert check(start, end, now), r['Id']
    return {'dressRows': len(dress), 'diamondPrices': prices}


def run_bundle(setting_u):
    import asset_tools as w
    import UnityPy
    _, _, encrypted, plain = w.decode(setting_u)
    assert encrypted
    env = UnityPy.load(plain)
    text = env.container[shop.PATH].deref().read_typetree()['m_Script']
    proof = run(text)
    encoded, build_proof = shop.build(setting_u)
    _, _, _, plain2 = w.decode(encoded)
    patched = UnityPy.load(plain2).container[shop.PATH].deref().read_typetree()['m_Script']
    assert patched == shop.patch_text(text)[0]
    proof['onlyChangedObjectIds'] = build_proof['onlyChangedObjectIds']
    return encoded, proof


if __name__ == '__main__':
    data = zipfile.ZipFile(sys.argv[1]).read('assets/setting.u')
    _, proof = run_bundle(data)
    print('costume shop OK', proof['dressRows'], 'rows', proof['onlyChangedObjectIds'])
