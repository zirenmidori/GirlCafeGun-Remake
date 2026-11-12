"""Return before developer creation, TCP startup, and native command execution.

Addresses are resolved from IL2CPP metadata method indexes and the registered
method-pointer array for each ABI; no ARM64-to-ARM32 offset assumption is used.
"""
from pathlib import Path
import hashlib, struct, sys
ROOT=Path(__file__).resolve().parents[2]
import asset_tools as n

TABLES={'arm64-v8a':(0x4da4c60,95137),'armeabi-v7a':(0x4177ac0,95137)}
VOID={
 'DebugEditor': {'Create','Start','BeginAccept','AcceptSocketCB','FixedUpdate','ReceiveMessage','SendResult','SendCmdToGame','SendCmdToRelay','SendCmdToPvp','SendCmdToPvpMgr','DebugCastSkill','DebugRemoveSkill','GM_AddSkillState'},
 'GM':{'Initialize','Create','CreateUWA','SetActive','Awake','Update'},
}
FALSE={'Utils':{'IsEnableGM','TryOpenGM'},'GM':{'Get'}}

def segments(d):
    ptr=8 if d[4]==2 else 4
    if ptr==8: off=struct.unpack_from('<Q',d,32)[0];size,count=struct.unpack_from('<HH',d,54)
    else: off=struct.unpack_from('<I',d,28)[0];size,count=struct.unpack_from('<HH',d,42)
    result=[]
    for i in range(count):
        r=struct.unpack_from('<IIQQQQQQ' if ptr==8 else '<IIIIIIII',d,off+i*size)
        if r[0]==1:result.append((r[3] if ptr==8 else r[2],r[2] if ptr==8 else r[1],r[5] if ptr==8 else r[4]))
    return ptr,result

def build(source,abi):
    ptr,segs=segments(source)
    def fileoff(va):
        for start,off,size in segs:
            if start<=va<start+size:return off+va-start
        raise ValueError(hex(va))
    # ARM64 RELA addends provide the on-disk addresses; the recovered library's
    # writable pointer words also contain capture-time relocation values.
    relocated={}
    if ptr==8:
        off=struct.unpack_from('<Q',source,40)[0];size,count=struct.unpack_from('<HH',source,58)
        for i in range(count):
            r=struct.unpack_from('<IIQQQQIIQQ',source,off+i*size)
            if r[1]==4:
                for at in range(r[4],r[4]+r[5],24):
                    target,info,addend=struct.unpack_from('<QQQ',source,at)
                    if info==0x403:relocated[target]=addend
    table,count=TABLES[abi]
    code=lambda index: relocated[table+index*8] if ptr==8 else struct.unpack_from('<I',source,fileoff(table)+index*4)[0]
    assert code(46683)==(0x18c0688 if ptr==8 else 0xf33790)
    methods=[]
    for at in range(n.HEADER[12],sum(n.HEADER[12:14]),52):
        row=struct.unpack_from('<13I',n.META,at);t=n.TYPES[row[1]]
        if n.name(t[1])!='Game':continue
        cls,name=n.name(t[0]),n.name(row[0])
        kind='void' if name in VOID.get(cls,set()) else 'zero' if name in FALSE.get(cls,set()) else None
        if not kind:continue
        assert row[5]<count
        ret=n.type_info(row[2])[1]
        assert ret==1 if kind=='void' else ret in (2,18), (cls,name,ret)
        methods.append((cls,name,row[5],code(row[5]),kind))
    expected=sum(map(len,VOID.values()))+sum(map(len,FALSE.values()))
    assert len(methods)==expected,(len(methods),expected)
    result=bytearray(source);proof=[]
    sys.path.insert(0,str(ROOT/'tools/unity-fix/native'))
    from capstone import Cs,CS_ARCH_ARM64,CS_ARCH_ARM,CS_MODE_ARM,CS_MODE_THUMB
    for cls,name,index,address,kind in methods:
        is_thumb=ptr==4 and address&1;va=address&~1;off=fileoff(va)
        if ptr==8: patch=bytes.fromhex('c0035fd6' if kind=='void' else '00008052c0035fd6')
        elif is_thumb:patch=bytes.fromhex('7047' if kind=='void' else '00207047')
        else:patch=bytes.fromhex('1eff2fe1' if kind=='void' else '0000a0e31eff2fe1')
        dis=Cs(CS_ARCH_ARM64 if ptr==8 else CS_ARCH_ARM,0 if ptr==8 else CS_MODE_THUMB if is_thumb else CS_MODE_ARM)
        before=source[off:off+len(patch)]
        assert any(before) and before!=patch
        oldasm=[i.mnemonic+' '+i.op_str for i in dis.disasm(source[off:off+16],va)]
        newasm=[i.mnemonic+' '+i.op_str for i in dis.disasm(patch,va)]
        assert newasm[-1].startswith('ret') if ptr==8 else newasm[-1]=='bx lr'
        result[off:off+len(patch)]=patch
        proof.append({'class':'Game.'+cls,'method':name,'methodIndex':index,'rva':hex(va),'fileOffset':off,'before':before.hex(),'after':patch.hex(),'beforeDisassembly':oldasm,'afterDisassembly':newasm})
    allowed={i for r in proof for i in range(r['fileOffset'],r['fileOffset']+len(bytes.fromhex(r['after'])))}
    assert all(a==b or i in allowed for i,(a,b) in enumerate(zip(source,result)))
    return bytes(result),{'methodPointerArrayRva':hex(table),'methodPointerCount':count,'changedEntryPoints':proof,'unchangedLength':len(source),'patchBeforeIlFixDispatch':True}
