"""Permanent stock Railgun presentation and explicit custom-card rarity."""
import copy

RAILGUN_ID = 46
KUROKO = ['20213', '[1-202-1-3]', 'Kuroko Shirai', '466', '1',
          'Card/All/girl202_card01.png', '', '1', '1']


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:120]
    return text.replace(old, new)


def lua_script(name, source):
    text = source.decode('utf8').replace('\r\n', '\n')
    if name == 'GachaCommon.lua':
        old = 'local star = isWeapon and config.nRarity or math.min(config.tbGDPLN[4], 4)'
        assert text.count(old) == 2
        text = text.replace(old, 'local star = GachaCommon:OfflineCardStar(config.tbGDPLN, config.nRarity)')
        text = replace_one(text,
            'if info.rotationRevision or (now >= info.nStart and now < info.nEnd) then',
            'if info.offlinePermanent or info.rotationRevision or (now >= info.nStart and now < info.nEnd) then')
        anchor = '\t\t\tself.tbConf[tbInfo.nId] = self.tbConf[tbInfo.nId] or {};'
        text = replace_one(text, anchor, '''\t\t\tif tbInfo.nId == 46 then
                tbInfo.offlinePermanent = true
                tbInfo.nStart, tbInfo.nEnd = 0, 4102444800
                tbInfo.sName = "Railgun Collab"
                tbInfo.sTimeDesc = "Permanent"
                tbInfo.sDesc = "Mikoto, Kuroko, Misaki and Misaka Sister"
            end
''' + anchor)
        text += '''
-- Neptune's release card keeps its original GDPL identity at Legendary rarity.
function GachaCommon:OfflineCardStar(gdpl, rarity)
    if rarity then return math.min(rarity, 4) end
    if gdpl[1] == 1 and gdpl[2] == 27 and gdpl[3] == 1 and gdpl[4] == 1 then return 4 end
    return math.min(gdpl[4], 4)
end
'''
    elif name == 'UI_GachaHistory.lua':
        text = replace_one(text,
            'local star = tbData.tbGDPLN[4] >= 4 and 4 or tbData.tbGDPLN[4]',
            'local star = GachaCommon:OfflineCardStar(tbData.tbGDPLN, tbData.nRarity)')
        text = replace_one(text,
            'local star = tbCards[i].tbGdpl[4] >= 4 and 4 or tbCards[i].tbGdpl[4]',
            'local star = GachaCommon:OfflineCardStar(tbCards[i].tbGdpl)')
    return text.encode('utf8')


def patch_text(path, source):
    lines = source.splitlines()
    assert len(lines) >= 3
    header = lines[2].split('\t')
    if path.endswith('/gacha.txt'):
        found = 0
        for index, line in enumerate(lines[3:], 3):
            row = line.split('\t')
            if row[0] != '46':
                continue
            assert row[header.index('Type')] == '1'
            assert row[header.index('CostTen')] == '[9-13-1-1-1]'
            row[header.index('Time')] = '{202201260800, 209901010000}'
            lines[index] = '\t'.join(row)
            found += 1
        assert found == 1
    else:
        assert not any(line.split('\t')[0] == '20213' for line in lines[3:])
        row = KUROKO if '/card_46_zh.txt' in path else KUROKO[:4]
        assert len(row) == len(header)
        lines.append('\t'.join(row))
    newline = '\r\n' if '\r\n' in source else '\n'
    return newline.join(lines) + newline


def settings_objects(env):
    paths = ['assets/_game/settinggen/gacha/gacha.txt',
             'assets/_game/settinggen/gacha/pools/card_46_zh.txt',
             'assets/_game/settinggen/gacha/pools/hedge_card_46_zh.txt']
    replacements = {}
    proof = {}
    for path in paths:
        obj = env.container[path].deref()
        assert obj.type.name == 'TextAsset'
        tree = obj.read_typetree()
        updated = copy.deepcopy(tree)
        updated['m_Script'] = patch_text(path, tree['m_Script'])
        replacements[obj.path_id] = obj.save_typetree(updated)
        proof[path] = {'objectId': obj.path_id, 'normalTickets': True,
                       'kurokoStoryInvented': False, 'stockArtworkRetained': True}
    return replacements, proof
