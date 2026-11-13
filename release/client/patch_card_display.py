"""Native landscape card framing and its complete post-combat/codex layouts."""
import copy
import struct

THUMB = 'Npc/card_neptune_release.png'
FULL = 'Npc/card_neptune_full_release.png'
FIELDS = {
    'ImgCard': THUMB, 'PicCard': FULL, 'CardShowType': 2, 'CardRotationZ': 180,
    # CardMain's mask and still-image child both rotate 180 degrees. A positive
    # local X therefore moves this right-composed illustration left on screen.
    'ShowX': 300., 'ShowY': 0., 'ScaleNum': .58,
    'FixShowX': 315., 'FixShowY': 0., 'FixScaleNum': .62,
    'ShowXAlbum': -245., 'ShowYAlbum': -40., 'ScaleNumAlbum': .48,
    'ShowXShop': -245., 'ShowYShop': -40., 'ScaleNumShop': .48,
}
FIELDS = {name: struct.unpack('<f', struct.pack('<f', value))[0]
          if isinstance(value, float) else value for name, value in FIELDS.items()}
MISSION_STYLE = [-245, -40, 0, 0, 2, .48]
RIKI_ID = 12701


def append_text_row(env, path, row, key_column, key):
    obj = env.container[path].deref()
    tree = obj.read_typetree()
    old = tree['m_Script']
    lines = old.splitlines()
    columns = lines[1 if 'uimissionsuccess' in path else 2].split('\t')
    assert len(row) == len(columns)
    assert not any(line.split('\t')[key_column] == key for line in lines[3:]
                   if len(line.split('\t')) > key_column), 'Duplicate card display row'
    newline = '\r\n' if '\r\n' in old else '\n'
    tree['m_Script'] = old + ('' if old.endswith(('\r', '\n')) else newline)
    tree['m_Script'] += '\t'.join(str(value) for value in row) + newline
    assert tree['m_Script'].startswith(old)
    return obj.path_id, obj.save_typetree(tree), {
        'path': path, 'oldTextPreservedAsPrefix': True,
        'appendedRow': row, 'columns': columns,
    }


def settings_objects(env):
    replacements = {}
    proof = {}
    row = [FULL] + MISSION_STYLE * 3
    pid, body, proof['missionSuccess'] = append_text_row(
        env, 'assets/_game/settinggen/feature/uimissionsuccess.txt', row, 0, FULL)
    replacements[pid] = body
    # Follow the existing static landscape codex convention. This table owns
    # its thumbnail rectangle independently from CharacterCard.ShowX/ShowY.
    row = [1, RIKI_ID, 'Neptune', '', 1, 27, 1, 1, '', '',
           '-230,0,1,850,480', '', '', '', '', '']
    pid, body, proof['codex'] = append_text_row(
        env, 'assets/_game/settinggen/guide/riki.txt', row, 1, str(RIKI_ID))
    replacements[pid] = body
    proof['characterCardFields'] = copy.deepcopy(FIELDS)
    proof['allThreePostCombatSlotsHaveCompleteStyles'] = True
    proof['fullViewUsesNativeLandscapeBranchWithoutPortraitQuarterTurn'] = True
    return replacements, proof
