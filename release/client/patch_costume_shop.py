"""Dress shop: every costume pack for Diamonds, always on sale, one per account.

Client table Purchase/PurchaseIBShop.txt (setting.u) lists the dress shop
(LabelIdx 101, UI_ShopEntry Skin -> UI_ShopNew). Rows 1001-1035 sell the gift
boxes 13-x-1-6000..6034 for Hairpins (Currency 62/63) in windows that ended in
2021-2022. Boxes 6035-6040 (the nurse costumes) have no row. This recipe:

- rows 1001-1035: Currency -2 (Diamonds, money 3 in IBLogic:DoBuyBox), the old
  Hairpin number as the Diamond cost, StartTime kept, EndTime, LockTime and the
  discount (OffFlag..OffCost) cleared, so IBLogic:CheckTime always passes;
- adds rows 1036-1041 for boxes 6035-6040, 138 Diamonds each.

LimitType 4 / LimitTimes 1 (once per account) and LabelIdx 101 stay. The server
twin is server/src/game-data/costume-shop-data.ts (same ids and costs); the
server sells them on DoRecharge Type 1. The seven oath costumes 19-2-18..24 are
oath rewards and stay out of the shop.
"""
import copy

PATH = 'assets/_game/settinggen/purchase/purchaseibshop.txt'
EXISTING = range(1001, 1036)
NEW = {1036: (6035, '医护·奈乐'), 1037: (6036, '医护·艾琳'), 1038: (6037, '医护·阿尼娅'),
       1039: (6038, '医护·奈乐(动态)'), 1040: (6039, '医护·艾琳(动态)'), 1041: (6040, '医护·阿尼娅(动态)')}
NEW_COST = 138
NEW_SORT = 190
DIAMONDS = '-2'
# 0-based columns of the table (header row 3)
ID, NAME, GDPL, CURRENCY, COST, OFF = 0, 5, 8, 9, 10, (12, 13, 14, 15)
SORT, START, END, LIMIT_TYPE, LIMIT_TIMES, HIDE, LABEL, LOCK, SMALL_ICON = 17, 18, 19, 20, 21, 24, 26, 27, 29


def patch_text(text):
    """-> (new text, {id: diamond cost})"""
    newline = '\r\n' if '\r\n' in text else '\n'
    lines = text.split(newline)
    header = lines[2].split('\t')
    assert [header[i] for i in (ID, GDPL, CURRENCY, COST, START, END, LIMIT_TYPE, LIMIT_TIMES, HIDE, LABEL, LOCK)] == [
        'Id', 'GDPL', 'Currency', 'Cost', 'StartTime', 'EndTime', 'LimitType', 'LimitTimes', 'IsHide', 'LabelIdx',
        'LockTime'], header
    width = len(header)
    seen, prices, last = set(), {}, None
    for i, line in enumerate(lines):
        f = line.split('\t')
        if i < 3 or not f[0].isdigit():
            continue
        rid = int(f[0])
        assert rid not in NEW, 'row %d exists already' % rid
        if rid not in EXISTING:
            continue
        f += [''] * (width - len(f))
        box = 6000 + rid - 1001
        assert f[GDPL] in ('[13,1,1,%d,1]' % box, '[13,2,1,%d,1]' % box), (rid, f[GDPL])
        assert f[CURRENCY] in ('62', '63') and f[LABEL] == '101' and f[HIDE] == '', (rid, f)
        assert (f[LIMIT_TYPE], f[LIMIT_TIMES]) == ('4', '1'), (rid, f)
        f[CURRENCY] = DIAMONDS
        for c in OFF + (END, LOCK):
            f[c] = ''
        prices[rid] = int(f[COST])
        lines[i] = '\t'.join(f)
        seen.add(rid)
        last = i
    assert seen == set(EXISTING), sorted(set(EXISTING) - seen)
    template = lines[last].split('\t')
    added = []
    for rid, (box, name) in sorted(NEW.items()):
        f = copy.copy(template)
        f[ID], f[NAME], f[GDPL] = str(rid), name, '[13,2,1,%d,1]' % box
        f[COST], f[SORT], f[SMALL_ICON] = str(NEW_COST), str(NEW_SORT), ''
        prices[rid] = NEW_COST
        added.append('\t'.join(f))
    lines[last + 1:last + 1] = added
    return newline.join(lines), prices


def settings_objects(env):
    """Replacement for the PurchaseIBShop text asset of a loaded setting.u -> (replacements, proof)."""
    obj = env.container[PATH].deref()
    assert obj.type.name == 'TextAsset'
    tree = obj.read_typetree()
    updated = copy.deepcopy(tree)
    updated['m_Script'], prices = patch_text(tree['m_Script'])
    return {obj.path_id: obj.save_typetree(updated)}, {PATH: {'objectId': obj.path_id, 'diamondPrices': prices}}


def build(source):
    """Patch a released setting.u (encrypted bundle bytes) -> (encrypted bytes, proof). Only this text asset changes."""
    import asset_tools as w
    meta, raw, encrypted, plain = w.unity.decode(source)
    assert encrypted
    env = w.unity.UnityPy.load(plain)
    replacements, proof = settings_objects(env)
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
