"""Give English text to the values that the English text table holds as spreadsheet errors.

The official English table ships `#N/A` for the 36 keys of the emote feature (its guide, its
screen, the emote items, one cat-ears item) and `#VALUE!` for one anniversary tower line, so
the game prints those literals. No official English exists for them: the last official English
package that has the keys holds Chinese. The text below is translated from that Chinese, with
the names and terms the table already uses (No.7, Emote, Eksistere, Soshi, "X - Y" item names).

Only values change, only for the keys listed, and only when the old value is an error literal.
"""
import copy
import struct

import asset_tools as w

ERROR_LITERALS = ('#N/A', '#VALUE!')
EMOTES = {
    201: 'All Units, Attack',
    202: 'We Must Win',
    203: 'Never Mind~',
    204: 'Smirk',
    205: 'Hello There~',
    206: 'Turn into a Box!',
    207: 'Goodbye',
    208: 'Thank You So Much',
    209: "Huh, That's It?",
    210: 'No Problem~',
    211: 'Clear the Small Fry First',
    212: 'Grab the Stronghold',
}
EMOTE_DESC = 'A No.7 series emote. Once you have it, you can use it in chat channels.'
FIXES = {
    # the guide of the emote screen, spoken by No.7
    'ui.guide.emoji.step1': 'Look here, Manager. This is the newest way to build a combo, straight from the forums.',
    'ui.guide.emoji.step2': 'Use them to give the other participants a friendly greeting in joint operations like "Darwin"~',
    'ui.guide.emoji.step3': 'Now you can put these emotes together into a set of your own.',
    'ui.guide.emoji.step4': 'Pick an emote and tap it to add it to the set.',
    'ui.guide.emoji.step5': "Last, tap here to finish. If you skip this step, your changes won't count, "
                            'no matter how many times you set them.',
    'ui.guide.emoji.step6': "Hm? You think these aren't enough? Staring at me won't get you more emotes. "
                            'Keep an eye on the shop instead.',
    # the emote screen: its two tabs and its messages
    'ui.UI_emoji0': 'General',
    'ui.UI_emoji1': 'No.7',
    'ui.UI_emoji.Application': 'Emotes applied.',
    'ui.UI_emoji.HaveGot': 'You already have this emote. You cannot buy it.',
    'ui.UI_emoji.Notobtained': 'You do not have this emote yet.',
    'item.cc_maoer_yikesi': 'Cat Ears- Eksistere',
    'tower.Anniversary1.LevelDesc35': '- "All right, all right. Anything else you want to say?" '
                                      '- "But I really want to touch Soshi\'s cute curly hair with its light golden streaks!"',
}
for _id, _name in EMOTES.items():
    FIXES['item.emoji%d' % _id] = 'Emote - ' + _name
    FIXES['item.emoji%d.desc' % _id] = EMOTE_DESC
assert len(FIXES) == 37


def fix(key, text):
    """The value to ship for a key: the fix when the table holds an error literal, else the text as is."""
    new = FIXES.get(key)
    if new is None or text == new:
        return text
    if text not in ERROR_LITERALS:
        raise ValueError('Text fix for %s: the table holds %r, not an error literal' % (key, text))
    return new


def build_language(source):
    meta, raw, encrypted, _ = w.decode(source)
    assert not encrypted
    table = w.typed_tables(raw, {'zh_CN'})['zh_CN']
    before = table['value']
    assert len(before['keys']) == len(before['values'])
    assert len(set(before['keys'])) == len(before['keys'])
    missing = sorted(set(FIXES) - set(before['keys']))
    if missing:
        raise ValueError('Text fixes name keys that the table lacks: ' + ', '.join(missing))
    value = copy.deepcopy(before)
    changed_keys = []
    for i, (key, old) in enumerate(zip(before['keys'], before['values'])):
        new = fix(key, old)
        if new != old:
            value['values'][i] = new
            changed_keys.append(key)
    assert value['keys'] == before['keys']
    left = sorted(k for k, v in zip(value['keys'], value['values']) if v in ERROR_LITERALS)
    assert not left, left
    # Compact the changed dictionary, retaining every other serialized object.
    offset, objects = w.serialized_objects(raw)
    target = table['object']['path_id']
    payload = w.replace_native(raw, table, value)
    output = bytearray(raw[:offset])
    for obj in sorted(objects, key=lambda obj: obj['start']):
        body = payload if obj['path_id'] == target else raw[obj['start']:obj['start'] + obj['size']]
        output += bytes(-len(output) % 8)
        at = len(output)
        output += body
        struct.pack_into('<II', output, obj['record'] + 8, at - offset, len(body))
    struct.pack_into('>I', output, 4, len(output))
    output = bytes(output)
    assert len(meta['nodes']) == 1
    _, _, flags, cab = meta['nodes'][0]
    result = w.pack({**meta, 'nodes': [(0, len(output), flags, cab)]}, output)
    _, checked, check_encrypted, _ = w.decode(result)
    assert not check_encrypted
    assert w.typed_tables(checked, {'zh_CN'})['zh_CN']['value'] == value
    _, after_objects = w.serialized_objects(checked)
    by_id = {o['path_id']: o for o in after_objects}
    assert set(by_id) == {o['path_id'] for o in objects}
    for old in objects:
        if old['path_id'] == target:
            continue
        new = by_id[old['path_id']]
        assert raw[old['start']:old['start'] + old['size']] == checked[new['start']:new['start'] + new['size']]
    return result, {
        'localeIdentityUnchanged': 'zh_CN',
        'translationKeysUnchanged': True,
        'errorLiteralValuesReplaced': len(changed_keys),
        'changedKeys': changed_keys,
        'errorLiteralValuesLeft': 0,
        'otherLanguageObjectsByteExact': True,
        'nativeDictionaryRoundtripExact': True,
        'source': 'translated from the Chinese of the official EN 1.0.9 package; no official English exists',
        'runtimeRenderingVerified': False,
    }
