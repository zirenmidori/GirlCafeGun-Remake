"""Release-only Neptune rarity/card presentation and bounded lobby schedule."""
from pathlib import Path
import copy,hashlib,sys
ROOT=Path(__file__).resolve().parents[2]
import asset_tools as w
import patch_gacha
import patch_card_display
import patch_selectors
CARD='Npc/card_neptune_release.png'

def build(source):
    meta,raw,encrypted,plain=w.unity.decode(source);assert encrypted
    tables=w.typed_tables(raw,{'CharacterCard','MagicTb'})
    card=tables['CharacterCard'];value=copy.deepcopy(card['value'])
    row,=[r for r in value['list'] if [r[k] for k in ('Genre','Detail','Particular','Level')]==[1,27,1,1]]
    old=copy.deepcopy(row)
    row.update(Rarity=4,RarityColor=0,**patch_card_display.FIELDS)
    replacements={card['object']['path_id']:w.replace_native(raw,card,value)}
    env=w.unity.UnityPy.load(plain)
    gacha_replacements,gacha_proof=patch_gacha.settings_objects(env)
    assert not set(gacha_replacements)&set(replacements)
    replacements.update(gacha_replacements)
    card_replacements,card_display_proof=patch_card_display.settings_objects(env)
    assert not set(card_replacements)&set(replacements)
    replacements.update(card_replacements)
    selector_replacements,selector_proof=patch_selectors.settings_objects(env,raw)
    assert not set(selector_replacements)&set(replacements)
    replacements.update(selector_replacements)
    path='assets/_game/settinggen/live2d/sequence.txt';obj=env.container[path].deref();tree=obj.read_typetree()
    lines=tree['m_Script'].splitlines();header=lines[1].split('\t');schedule={}
    for i,line in enumerate(lines):
        fields=line.split('\t')
        if fields[0] not in {'girl27_neptune_lobby_'+m for m in ('normal','unhappy','happy')}:continue
        old_actions=fields[2:];assert old_actions[:8]==['Lgirl27_lobby_stand','Lgirl27_voice_idle_snack','Lgirl27_lobby_stand','Lgirl27_lobby_stand','Lgirl27_lobby_stand','Lgirl27_voice_idle_break','Lgirl27_lobby_stand','Lgirl27_lobby_stand']
        actions=['Lgirl27_lobby_stand','Lgirl27_voice_idle_snack','Lgirl27_lobby_stand','Lgirl27_voice_idle_break']
        fields[2:]=actions+['']*(len(fields)-2-len(actions));lines[i]='\t'.join(fields);schedule[fields[0]]=actions
    assert len(schedule)==3
    newline='\r\n' if '\r\n' in tree['m_Script'] else '\n';tree['m_Script']=newline.join(lines)+newline
    replacements[obj.path_id]=obj.save_typetree(tree)
    changed=w.unity.pipeline.repack_objects(raw,replacements)
    assert len(meta['nodes'])==1;_,_,flags,cab=meta['nodes'][0]
    packed=w.unity.pack({**meta,'nodes':[(0,len(changed),flags,cab)]},changed);encoded=w.unity.lang.transform(packed)
    _,checked,flag,checked_plain=w.unity.decode(encoded);assert flag and checked_plain==packed
    new=w.typed_tables(checked,{'CharacterCard','MagicTb'})
    assert new['CharacterCard']['value']==value and new['MagicTb']['value']==tables['MagicTb']['value']
    magic=new['MagicTb']['value'];rows=magic['SkillMagicInfo'];assert rows==sorted(rows,key=lambda x:x['flg'])
    cursor=0;counts={}
    for i,name in enumerate(magic['SkillName']):
        group=[]
        while cursor<len(rows) and rows[cursor]['flg']==i:group.append(rows[cursor]);cursor+=1
        if name.startswith('nepnote_'):counts[name]=len(group);assert group
    assert cursor==len(rows)
    before_inv=w.native.serialized_inventory(raw);after_inv=w.native.serialized_inventory(checked)
    before={o['path_id']:raw[o['start']:o['end']] for o in before_inv['objects']};after={o['path_id']:checked[o['start']:o['end']] for o in after_inv['objects']}
    assert before.keys()==after.keys() and {pid for pid in before if before[pid]!=after[pid]}==set(replacements)
    return encoded,packed,{'characterGdpl':[1,27,1,1],'rarity':4,'rarityColor':0,'changedCardFields':{k:{'before':old[k],'after':v} for k,v in row.items() if old[k]!=v},'cardDisplay':card_display_proof,'gacha':gacha_proof,'selectors':selector_proof,'lobbySchedule':schedule,'standSeconds':2.,'maximumConsecutiveLobbyStandSeconds':2.,'nativeMagicTbForwardCursorAllRowsConsumed':True,'neptuneOperatorCounts':counts,'magicTbObjectByteExact':True,'onlyChangedObjectIds':list(replacements),'otherSettingsObjectsByteExact':True}
