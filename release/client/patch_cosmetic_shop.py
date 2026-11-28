"""Dress shop, third tab: profile cosmetics for Diamonds, always on sale, one per account.

Client table Purchase/PurchaseIBShop.txt (setting.u) lists the dress shop. LabelIdx 101 is the costume
packs (patch_costume_shop.py, untouched here); LabelIdx 102 (IBLogic.LABELGIFT) is the third tab, which draws
Sprite(ItemList.IconId) of the row's GDPL, a small icon. This recipe adds one 102 row per cosmetic:

- ID-card skins (Player/Skin.txt, item class ItemVisitingCardAuto), head frames (HeadFrame.txt,
  ItemHeadFrameAuto), player-list marks (Board.txt, ItemPlayerListSkinAuto) and chat bubbles (Babble.txt,
  ItemChatBubbleAuto). A cosmetic gets a row when exactly one AutoUse item of its class has it as ExtParam1
  and its Coverage is empty or lists 1 (zh_CN). Id 0 and head frame 1 (the default frame) are left out.
- ids 3001 upward: card skins, head frames, list marks, chat bubbles, each by cosmetic id;
  Currency -2 (Diamonds), LimitType 4 / LimitTimes 1 (once per account), no start, end or lock time.

The server twin is server/src/game-data/cosmetic-shop-data.ts (same ids, costs and GDPL). UI_GiftBoxTips lists
the contents of a row as the box ItemBox:GetBoxCfg(ExtParam1); for a cosmetic item ExtParam1 is the cosmetic id,
which would show an unrelated box, so lua_script makes the list show the item itself.

[INFER] The prices are this build's own numbers: no client table holds them.
"""
import copy
import re

PATH = 'assets/_game/settinggen/purchase/purchaseibshop.txt'
TABLE_DIR = 'assets/_game/settinggen/player/'
FIRST_ID = 3001
# IBLogic:GetAllIBShop lists a larger Sort first and breaks a tie by the smaller Id, so one Sort for every
# row keeps the Id order (card skins, head frames, list marks, chat bubbles), above rows 2001-2012 (Sort 8-20).
ROW_SORT = 300
DIAMONDS = '-2'
LABEL = '102'
TEMPLATE_ID = 2001
# kind, table file, item class, price in Diamonds
KINDS = (
    ('visitingCard', 'skin.txt', 'ItemVisitingCardAuto', 120),
    ('headFrame', 'headframe.txt', 'ItemHeadFrameAuto', 60),
    ('listMark', 'board.txt', 'ItemPlayerListSkinAuto', 40),
    ('chatBubble', 'babble.txt', 'ItemChatBubbleAuto', 40),
)
COSMETIC_CLASSES = tuple(k[2] for k in KINDS)
# 0-based columns of PurchaseIBShop.txt (header row 3)
ID, NAME, GDPL, CURRENCY, COST, SORT, START, END, LIMIT_TYPE, LIMIT_TIMES, HIDE, LABEL_COL, LOCK = (
    0, 5, 8, 9, 10, 17, 18, 19, 20, 21, 24, 26, 27)
OFF = (12, 13, 14, 15)
LUA_NAMES = {'UI_GiftBoxTips.lua'}


def parse_table(text):
    """Rows of a settinggen text table (header names in line 3) as dicts."""
    lines = text.replace('\r\n', '\n').split('\n')
    header = lines[2].split('\t')
    return [dict(zip(header, line.split('\t'))) for line in lines[3:] if line.split('\t')[0].isdigit()]


def covered(coverage):
    coverage = coverage.strip()
    return coverage == '' or '1' in re.findall(r'\d+', coverage)


def item_rows(item_list):
    """ItemList native rows -> {class: {cosmetic id: [[g, d, p, l], ...]}} for the four cosmetic classes."""
    result = {cls: {} for cls in COSMETIC_CLASSES}
    for row in item_list['list']:
        if row['ClassName'] in result and row['AutoUse'] and str(row['ExtParam1']).strip().isdigit():
            gdpl = [row['Genre'], row['Detail'], row['Particular'], row['Level']]
            result[row['ClassName']].setdefault(int(row['ExtParam1']), []).append(gdpl)
    return result


def cosmetic_rows(tables, items):
    """tables {file name: text}, items from item_rows -> shop rows in id order."""
    rows, next_id = [], FIRST_ID
    for kind, file, cls, price in KINDS:
        for r in sorted(parse_table(tables[file]), key=lambda r: int(r['ID'])):
            cid = int(r['ID'])
            if cid == 0 or (kind == 'headFrame' and cid == 1) or not covered(r['Coverage']):
                continue
            found = items[cls].get(cid, [])
            if len(found) != 1:
                continue
            rows.append({'id': next_id, 'kind': kind, 'cosmeticId': cid, 'cost': price, 'gdpl': found[0],
                         'type': int(r['Type']), 'limitTime': int(r['LimitTime'] or 0)})
            next_id += 1
    return rows


def patch_text(text, rows):
    """-> (new text, {id: diamond cost}). Adds the rows; every other line stays as it is."""
    newline = '\r\n' if '\r\n' in text else '\n'
    lines = text.split(newline)
    header = lines[2].split('\t')
    assert [header[i] for i in (ID, GDPL, CURRENCY, COST, SORT, START, END, LIMIT_TYPE, LIMIT_TIMES, HIDE, LABEL_COL,
                                LOCK)] == ['Id', 'GDPL', 'Currency', 'Cost', 'Sort', 'StartTime', 'EndTime', 'LimitType',
                                           'LimitTimes', 'IsHide', 'LabelIdx', 'LockTime'], header
    width = len(header)
    template, last = None, None
    existing = set()
    for i, line in enumerate(lines):
        f = line.split('\t')
        if i < 3 or not f[0].isdigit():
            continue
        existing.add(int(f[0]))
        last = i
        if int(f[0]) == TEMPLATE_ID:
            template = f + [''] * (width - len(f))
    assert template is not None and template[LABEL_COL] == LABEL and template[HIDE] == '', template
    assert template[CURRENCY] == '62', template
    prices, added = {}, []
    for index, row in enumerate(rows):
        assert row['id'] not in existing, 'row %d exists already' % row['id']
        f = copy.copy(template)
        f[ID], f[NAME] = str(row['id']), '%s %d' % (row['kind'], row['cosmeticId'])
        f[GDPL] = '[%s,1]' % ','.join(str(v) for v in row['gdpl'])
        f[CURRENCY], f[COST], f[SORT] = DIAMONDS, str(row['cost']), str(ROW_SORT)
        f[LIMIT_TYPE], f[LIMIT_TIMES] = '4', '1'
        for c in OFF + (START, END, LOCK, HIDE):
            f[c] = ''
        prices[row['id']] = row['cost']
        added.append('\t'.join(f))
    lines[last + 1:last + 1] = added
    return newline.join(lines), prices


def _tables(env):
    return {file: env.container[TABLE_DIR + file].deref().read_typetree()['m_Script']
            for _, file, _, _ in KINDS}


def settings_objects(env, raw, replacements=None):
    """Replacement for the PurchaseIBShop text asset of a loaded setting.u -> (replacements, proof).

    raw is the serialized bytes of the bundle (ItemList is a native table). When `replacements` already holds
    this asset (patch_costume_shop ran first), the costume rows are applied here again to the original text,
    which gives the same result, and the returned replacement carries both."""
    import asset_tools as w
    obj = env.container[PATH].deref()
    assert obj.type.name == 'TextAsset'
    tree = obj.read_typetree()
    text = tree['m_Script']
    if replacements and obj.path_id in replacements:
        import patch_costume_shop
        text = patch_costume_shop.patch_text(text)[0]
    rows = cosmetic_rows(_tables(env), item_rows(w.typed_tables(raw, {'ItemList'})['ItemList']['value']))
    updated = copy.deepcopy(tree)
    updated['m_Script'], prices = patch_text(text, rows)
    counts = {kind: sum(1 for r in rows if r['kind'] == kind) for kind, _, _, _ in KINDS}
    return {obj.path_id: obj.save_typetree(updated)}, {PATH: {
        'objectId': obj.path_id, 'rows': counts, 'diamondPrices': prices}}


def build(source):
    """Patch a released setting.u (encrypted bundle bytes) -> (encrypted bytes, proof). Only this text asset changes."""
    import asset_tools as w
    meta, raw, encrypted, plain = w.unity.decode(source)
    assert encrypted
    env = w.unity.UnityPy.load(plain)
    replacements, proof = settings_objects(env, raw)
    changed = w.unity.pipeline.repack_objects(raw, replacements)
    assert len(meta['nodes']) == 1
    _, _, flags, cab = meta['nodes'][0]
    packed = w.unity.pack({**meta, 'nodes': [(0, len(changed), flags, cab)]}, changed)
    encoded = w.unity.lang.transform(packed)
    _, checked, flag, checked_plain = w.unity.decode(encoded)
    assert flag and checked_plain == packed
    before_inv = w.native.serialized_inventory(raw)
    after_inv = w.native.serialized_inventory(checked)
    before = {o['path_id']: raw[o['start']:o['end']] for o in before_inv['objects']}
    after = {o['path_id']: checked[o['start']:o['end']] for o in after_inv['objects']}
    assert before.keys() == after.keys() and {p for p in before if before[p] != after[p]} == set(replacements)
    proof['onlyChangedObjectIds'] = list(replacements)
    return encoded, proof


GIFT_OLD = '    local tbBoxInfo   = ItemBox:GetBoxCfg(tonumber(pItem.ExtParam1))\n'
GIFT_NEW = (
    '    local tbBoxInfo   = nil\n'
    "    if pItem.ClassName == 'ItemHeadFrameAuto' or pItem.ClassName == 'ItemVisitingCardAuto'"
    " or pItem.ClassName == 'ItemPlayerListSkinAuto' or pItem.ClassName == 'ItemChatBubbleAuto' then\n"
    '        self.DataList:Add({G = self.tbItem.tbGDPL[1], D = self.tbItem.tbGDPL[2], '
    'P = self.tbItem.tbGDPL[3], L = self.tbItem.tbGDPL[4], N = 1})\n'
    '    else\n'
    '        tbBoxInfo = ItemBox:GetBoxCfg(tonumber(pItem.ExtParam1))\n'
    '    end\n')


def lua_script(name, data):
    """UI_GiftBoxTips.lua: a cosmetic row lists the item itself, not the box that its ExtParam1 would name."""
    assert name in LUA_NAMES, name
    text = data.decode('utf8').replace('\r\n', '\n')
    assert text.count(GIFT_OLD) == 1, GIFT_OLD
    return text.replace(GIFT_OLD, GIFT_NEW).encode('utf8')
