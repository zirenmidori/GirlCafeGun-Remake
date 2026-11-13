"""Immutable rotation selection boxes using native inventory and reward screens."""
from pathlib import Path
import copy
import hashlib
import json
import struct

import asset_tools as w

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / 'server/resources/gacha/rotation-selectors.json'
LUA_NAMES = {'ItemBox.lua', 'GachaCommon.lua', 'UI_Gacha.lua', 'UI_WeaponSystemNEW.lua'}
GDPL_FIELDS = ('Genre', 'Detail', 'Particular', 'Level')


def load_catalog():
    data = json.loads(CATALOG.read_text(encoding='utf8'))
    assert data['schemaVersion'] == 1 and len(data['definitions']) == 52
    seen_items, seen_boxes = set(), set()
    for row in data['definitions']:
        assert row['version'] == 1 and row['kind'] in ('character', 'weapon')
        assert 0 <= row['cohort'] < 26 and row['choices']
        item, box = tuple(row['itemGdpl']), row['boxId']
        assert item not in seen_items and box not in seen_boxes
        seen_items.add(item); seen_boxes.add(box)
        detail, base = (10, 810000) if row['kind'] == 'character' else (5, 820000)
        assert item == (8, detail, 61001 + row['cohort'], 4)
        assert box == base + row['cohort']
        assert len({tuple(choice) for choice in row['choices']}) == len(row['choices'])
        assert all(len(choice) == 5 and choice[4] == 1 for choice in row['choices'])
    return data['definitions']


def description_key(row):
    return 'rotation_selector_%s_v1_%02d' % (row['kind'], row['cohort'] + 1)


def settings_objects(env, raw):
    definitions = load_catalog()
    table = w.typed_tables(raw, {'ItemList'})['ItemList']
    value = copy.deepcopy(table['value'])
    old_rows = copy.deepcopy(value['list'])
    existing = {tuple(row[k] for k in GDPL_FIELDS): row for row in old_rows}
    box_path = 'assets/_game/settinggen/item/itemboxinfo.txt'
    obj = env.container[box_path].deref()
    tree = obj.read_typetree()
    original = tree['m_Script']
    lines = original.splitlines()
    assert lines[2].split('\t') == ['boxId', 'GDPLN', 'broadcast', 'obtainType', 'Weight', '']
    old_boxes = {int(line.split('\t')[0]) for line in lines[3:] if line.strip()}
    added_lines = []
    for row in definitions:
        identity = tuple(row['itemGdpl'])
        assert identity not in existing and row['boxId'] not in old_boxes
        new = copy.deepcopy(existing[tuple(row['donorGdpl'])])
        assert new['ClassName'] == 'ItemBoxAuto' and new['ShowType'] == 5
        new.update(zip(GDPL_FIELDS, identity))
        new.update(DescriptionIndex=description_key(row), ExtParam1=str(row['boxId']),
                   AutoUse=False, LimitTime=0, ExpiredDelete=False, DisableDropWay=True)
        value['list'].append(new)
        for choice in row['choices']:
            # Selection ordinals must stay byte-for-byte in server catalog order.
            gdpln = '[' + '-'.join(str(v) for v in choice) + ']'
            added_lines.append('\t'.join([str(row['boxId']), gdpln, '0', 'Select', '1', '']))
    newline = '\r\n' if '\r\n' in original else '\n'
    tree['m_Script'] = original + ('' if original.endswith(('\r', '\n')) else newline)
    tree['m_Script'] += newline.join(added_lines) + newline
    assert tree['m_Script'].startswith(original)
    replacements = {
        table['object']['path_id']: w.replace_native(raw, table, value),
        obj.path_id: obj.save_typetree(tree),
    }
    assert value['list'][:len(old_rows)] == old_rows
    return replacements, {
        'catalogSha256': hashlib.sha256(CATALOG.read_bytes()).hexdigest(),
        'nativeItemCountBefore': len(old_rows), 'newNativeItems': 52,
        'newImmutableBoxes': 52, 'newChoiceRows': len(added_lines),
        'allOriginalItemRowsPreserved': True, 'originalBoxTextPreservedAsPrefix': True,
        'itemAndBoxIdentityCollisions': 0, 'serverChoiceOrderPreserved': True,
        'originalIconsReused': True, 'boxesNeverExpire': True,
        'onlyChangedObjectIds': list(replacements),
    }


def language_entries():
    result = {}
    for row in load_catalog():
        key = 'item.' + description_key(row)
        result[key] = row['name']
        kind = 'character' if row['kind'] == 'character' else 'weapon'
        result[key + '.desc'] = (
            'Choose 1 Legendary %s from the rotation lineup for which this box was earned. '
            'Its choices stay the same after the banner rotates. '
            'Duplicates may be selected for upgrades.' % kind)
    return result


def build_language(source):
    meta, raw, encrypted, plain = w.decode(source)
    assert not encrypted
    table = w.typed_tables(raw, {'zh_CN'})['zh_CN']
    before = table['value']
    assert len(before['keys']) == len(before['values'])
    additions = language_entries()
    assert not set(before['keys']) & set(additions)
    value = copy.deepcopy(before)
    value['keys'] += list(additions)
    value['values'] += list(additions.values())
    # Compact the replaced locale object rather than retaining a second orphaned
    # copy of the entire language dictionary in the shipped bundle.
    data_offset, objects = w.serialized_objects(raw)
    replaced = table['object']['path_id']
    payload = w.replace_native(raw, table, value)
    changed = bytearray(raw[:data_offset])
    for obj in sorted(objects, key=lambda obj: obj['start']):
        body = payload if obj['path_id'] == replaced else raw[obj['start']:obj['start'] + obj['size']]
        changed += bytes(-len(changed) % 8)
        at = len(changed)
        changed += body
        struct.pack_into('<II', changed, obj['record'] + 8, at - data_offset, len(body))
    struct.pack_into('>I', changed, 4, len(changed))
    changed = bytes(changed)
    assert len(meta['nodes']) == 1
    _, _, flags, cab = meta['nodes'][0]
    result = w.pack({**meta, 'nodes': [(0, len(changed), flags, cab)]}, changed)
    _, checked, check_encrypted, _ = w.decode(result)
    assert not check_encrypted
    after = w.typed_tables(checked, {'zh_CN'})['zh_CN']['value']
    assert after == value
    n = len(before['keys'])
    assert after['keys'][:n] == before['keys'] and after['values'][:n] == before['values']
    _, checked_objects = w.serialized_objects(checked)
    by_id = {obj['path_id']: obj for obj in checked_objects}
    assert set(by_id) == {obj['path_id'] for obj in objects}
    for obj in objects:
        if obj['path_id'] == replaced:
            continue
        new = by_id[obj['path_id']]
        assert raw[obj['start']:obj['start'] + obj['size']] == checked[new['start']:new['start'] + new['size']]
    return result, {'newEnglishNamesAndDescriptions': len(additions),
                    'oldTranslationCount': n, 'allOldTranslationsExact': True,
                    'localeIdentityUnchanged': 'zh_CN',
                    'nativeDictionaryRoundtripExact': True,
                    'otherLanguageObjectsByteExact': True,
                    'orphanedOldDictionaryNotRetained': True}


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:150]
    return text.replace(old, new)


def lua_script(name, source):
    text = source.decode('utf8').replace('\r\n', '\n')
    if name == 'ItemBox.lua':
        anchor = 'function ItemBox:OnOpenBoxMO(tbParam)\n'
        text = replace_one(text, anchor, anchor + '''    -- A failed selector transaction is an error object, not a reward array.
    if type(tbParam) == "table" and tbParam.nError and tbParam.nError ~= 0 then
        UI.Close("UI_OpenBox")
        Game.Blocking.Hide()
        Game.MessageBox.Simple("This selection could not be opened. Your box was kept; please try again.")
        return
    end
''')
    elif name == 'GachaCommon.lua':
        text = replace_one(text, '    pool.rotationRevision = manifest.revision',
                           '    pool.rotationRevision = manifest.revision\n    pool.offlineSelector = data.selector\n    pool.offlineRotationDays = manifest.intervalDays')
        text = replace_one(text, '    pool.JudgeType, pool.freeType, pool.freeCount = 0, 0, 0', '''    local selector = pool.offlineSelector
    if type(selector) == "table" and type(selector.every) == "number"
        and selector.every > 0 and selector.every <= 100000
        and selector.every == math.floor(selector.every) then
        pool.sInfoDesc = pool.sInfoDesc .. string.format("\\nA Legendary selection box is earned every %d rotation draws. Open earned selectors in Warehouse. Saved boxes keep the lineup for which they were earned.", selector.every)
    end
    pool.JudgeType, pool.freeType, pool.freeCount = 0, 0, 0''')
        text += '''
-- Progress is authoritative task state; merely opening a banner never grants a box.
function GachaCommon:OfflineSelectorProgress(pool)
    local selector = pool and pool.offlineSelector
    if type(selector) ~= "table" or type(selector.every) ~= "number"
        or selector.every <= 0 or selector.every > 100000
        or selector.every ~= math.floor(selector.every)
        or (selector.progressTask ~= 11000 and selector.progressTask ~= 11001) then return end
    local total = tonumber(me:GetTaskValue(15, selector.progressTask)) or 0
    if total < 0 or total == math.huge or total ~= total then total = 0 end
    total = math.floor(total)
    return total % selector.every, selector.every, math.floor(total / selector.every)
end

function GachaCommon:OfflineSelectorDescription(pool)
    local progress, every, earned = self:OfflineSelectorProgress(pool)
    if progress then return string.format("Selector %d/%d; earned %d", progress, every, earned) end
    return pool.sDesc
end

function GachaCommon:OfflineSelectorTime(pool)
    local progress, every = self:OfflineSelectorProgress(pool)
    if progress then
        return string.format("%d-day lineup | Selector %d/%d", pool.offlineRotationDays or 7, progress, every)
    end
    return pool.sTimeDesc
end
'''
    elif name == 'UI_Gacha.lua':
        text = replace_one(text, '\ttxtDesc.text = self.tbCurrent.sDesc;',
                           '\ttxtDesc.text = GachaCommon:OfflineSelectorDescription(self.tbCurrent);')
        text = replace_one(text, '\t\t\tself.rewardTipsText.text = self.tbCurrent.sDesc',
                           '\t\t\tself.rewardTipsText.text = GachaCommon:OfflineSelectorDescription(self.tbCurrent)')
    elif name == 'UI_WeaponSystemNEW.lua':
        text = replace_one(text, '\t\tself.timeDesc.text = self.tbConfig.sTimeDesc',
                           '\t\tself.timeDesc.text = GachaCommon:OfflineSelectorTime(self.tbConfig)')
        text = replace_one(text,
            '\tself.tbRightPanel.ADDesc.text = self.tbConfig.rotationRevision and self.tbConfig.sDesc\n\t\tor Game.Localization.Get(self.tbConfig.sDesc);',
            '\tself.tbRightPanel.ADDesc.text = self.tbConfig.rotationRevision and GachaCommon:OfflineSelectorDescription(self.tbConfig)\n\t\tor Game.Localization.Get(self.tbConfig.sDesc);')
    return text.encode('utf8')
