"""Give English text to the values that the English text table holds as spreadsheet errors or copied lines.

The official English table ships `#N/A` for the 36 keys of the emote feature (its guide, its
screen, the emote items, one cat-ears item) and `#VALUE!` for one anniversary tower line, so
the game prints those literals. No official English exists for them: the last official English
package that has the keys holds Chinese. The text below is translated from that Chinese, with
the names and terms the table already uses (No.7, Emote, Eksistere, Soshi, "X - Y" item names).

Two story lines hold the English of the line next to them, so the same sentence shows twice
while the Chinese of the two lines differs (COPIED_LINES). The official EN 1.0.9 table has the
same copies. Their text below is translated from the Chinese of the Remake APK's zh_CN table.

Only values change, only for the keys listed, and only when the old value is the known wrong
value: an error literal, or the copied line.
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

# key -> (the line it was copied from, the copied English, the English of its own Chinese)
COPIED_LINES = {
    # Chapter 3-4, Grainne: 那么，感谢店长的帮助，这样我也能放心追上我们的部队了。
    'main.nstory03_4117': ('main.nstory03_4116', "It's a really... special title.",
                           'Well then, thank you for your help, Manager. Now I can catch up with our unit without worry.'),
    # Chapter 9 after-story, Eksistere answers "Am I... actually dead...?": 嗯……
    'main.nstory09after036': ('main.nstory09after037', 'Ha... haha... What magnificent technology, R.o.S.E.',
                              'Yes...'),
}


def fix(key, text):
    """The value to ship for a key: the fix when the table holds the known wrong value, else the text as is."""
    if key in FIXES:
        new, wrong, what = FIXES[key], ERROR_LITERALS, 'an error literal'
    elif key in COPIED_LINES:
        _, copied, new = COPIED_LINES[key]
        wrong, what = (copied,), 'the copied line %r' % copied
    else:
        return text
    if text == new:
        return text
    if text not in wrong:
        raise ValueError('Text fix for %s: the table holds %r, not %s' % (key, text, what))
    return new


def build_language(source):
    meta, raw, encrypted, _ = w.decode(source)
    assert not encrypted
    table = w.typed_tables(raw, {'zh_CN'})['zh_CN']
    before = table['value']
    assert len(before['keys']) == len(before['values'])
    assert len(set(before['keys'])) == len(before['keys'])
    named = set(FIXES) | set(COPIED_LINES) | {neighbour for neighbour, _, _ in COPIED_LINES.values()}
    missing = sorted(named - set(before['keys']))
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
    shown = dict(zip(value['keys'], value['values']))
    same = sorted(k for k, (neighbour, _, _) in COPIED_LINES.items() if shown[k] == shown[neighbour])
    assert not same, same
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
        'errorLiteralValuesReplaced': sum(1 for k in changed_keys if k in FIXES),
        'copiedLinesReplaced': sum(1 for k in changed_keys if k in COPIED_LINES),
        'changedKeys': changed_keys,
        'errorLiteralValuesLeft': 0,
        'copiedLinesLeft': 0,
        'otherLanguageObjectsByteExact': True,
        'nativeDictionaryRoundtripExact': True,
        'source': 'error literals: translated from the Chinese of the official EN 1.0.9 package; copied lines: '
                  'translated from the zh_CN table of the release APK; no official English exists for either',
        'runtimeRenderingVerified': False,
    }
