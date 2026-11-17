"""Check the Crasheye.init edit of classes.dex on a synthetic dex.

run() needs no client file. It builds a small dex with the tables that patch_crasheye reads: the real
Crasheye.init signature and a decoy method with the same signature and the same first instructions. The edit
must hit only Crasheye.init, leave a valid header, and refuse a method body or a header it does not expect.

Run alone: python release/client/test_crasheye.py [--apk client.apk] (with an APK it also edits its classes.dex)
"""
from pathlib import Path
import argparse,hashlib,json,struct,sys,zipfile,zlib

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(Path(__file__).resolve().parent)]
import patch_crasheye as dex_patch

def synthetic_dex(first_units,decoy_units=dex_patch.STOCK+(0x000E,)):
    """A dex with Crasheye.init(Context, String, String) (method 1) and a decoy 'other' with the same proto
    (method 0), each with its own code item. Header signature and checksum are valid."""
    strings=['Lcom/xsj/crasheye/Crasheye;','init','Landroid/content/Context;','Ljava/lang/String;','Z','ZLLL','other']
    s_cls,s_init,s_context,s_string,s_z,s_shorty,s_other=range(len(strings))
    types=[s_cls,s_context,s_string,s_z];t_cls,t_context,t_string,t_z=range(len(types))
    header=0x70;string_ids=header;type_ids=string_ids+4*len(strings);proto_ids=type_ids+4*len(types)
    method_ids=proto_ids+12;class_defs=method_ids+16;body=bytearray(class_defs+32);string_at=[]
    for text in strings:string_at.append(len(body));body+=bytes([len(text)])+text.encode()+b'\0'
    body+=bytes(-len(body)%4);type_list=len(body);body+=struct.pack('<I3H',3,t_context,t_string,t_string)+b'\0\0'
    codes=[]
    for units in (tuple(first_units)+(0x000E,)*3,tuple(decoy_units)):
        body+=bytes(-len(body)%4);codes.append(len(body))
        body+=struct.pack('<4HII',7,3,2,0,0,len(units))+struct.pack('<%dH'%len(units),*units)
    class_data=len(body);body+=bytes([0,0,2,0])   # 2 direct methods: 0 = decoy, 1 = init
    for diff,code in ((0,codes[1]),(1,codes[0])):
        body+=bytes([diff,0x0A])
        while True:
            byte,code=code&0x7F,code>>7;body+=bytes([byte|(0x80 if code else 0)])
            if not code:break
    body+=bytes(-len(body)%4)
    for i,at in enumerate(string_at):struct.pack_into('<I',body,string_ids+4*i,at)
    for i,s in enumerate(types):struct.pack_into('<I',body,type_ids+4*i,s)
    struct.pack_into('<3I',body,proto_ids,s_shorty,t_z,type_list)
    struct.pack_into('<HHI',body,method_ids,t_cls,0,s_other);struct.pack_into('<HHI',body,method_ids+8,t_cls,0,s_init)
    struct.pack_into('<8I',body,class_defs,t_cls,1,0xFFFFFFFF,0,0xFFFFFFFF,0,class_data,0)
    body[:8]=b'dex\n035\0';struct.pack_into('<II',body,32,len(body),header);struct.pack_into('<I',body,40,0x12345678)
    for at,(n,off) in {56:(len(strings),string_ids),64:(len(types),type_ids),72:(1,proto_ids),88:(2,method_ids),96:(1,class_defs)}.items():
        struct.pack_into('<II',body,at,n,off)
    return dex_patch.with_header(bytes(body)),codes

def refused(dex):
    try:dex_patch.build(dex)
    except AssertionError:return True
    return False

def run():
    dex,codes=synthetic_dex(dex_patch.STOCK)
    assert dex_patch.method_code(dex,*dex_patch.METHOD)==codes[0]
    try:dex_patch.method_code(dex,dex_patch.METHOD[0],'init','(Landroid/content/Context;)Z');raise SystemExit('wrong signature found')
    except AssertionError:pass
    out,proof=dex_patch.build(dex);insns=codes[0]+16
    assert struct.unpack_from('<3H',out,insns)==(0x0612,0x060F,0x0000)   # const/4 v6, 0; return v6; nop
    changed={i for i in range(len(dex)) if dex[i]!=out[i]}
    assert all(i<32 or insns+2<=i<insns+6 for i in changed),sorted(changed)
    assert out[12:32]==hashlib.sha1(out[32:]).digest() and int.from_bytes(out[8:12],'little')==zlib.adler32(out[12:])&0xFFFFFFFF
    assert out[codes[1]:codes[1]+24]==dex[codes[1]:codes[1]+24]          # the decoy keeps its code
    assert proof['bytesChangedOutsideHeader']==3 and len(out)==len(dex)
    other,_=synthetic_dex((0x0612,0x0539,0x0008))
    bad_header=bytearray(dex);bad_header[8]^=1
    assert refused(out) and refused(other) and refused(bytes(bad_header))
    return {'syntheticDex':True,'methodFoundByClassNameAndSignature':True,'decoyWithSameSignatureUnchanged':True,
            'onlyTwoCodeUnitsAndHeaderChanged':True,'headerSignatureAndChecksumValid':True,
            'refusesPatchedInput':True,'refusesOtherMethodBody':True,'refusesInvalidHeader':True}

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--apk',type=Path,default=ROOT/'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.apk')
    args=ap.parse_args();print(run())
    if args.apk.exists():
        with zipfile.ZipFile(args.apk) as apk:print(json.dumps(dex_patch.build(apk.read(dex_patch.DEX))[1],indent=2))
    else:print('No client APK at',args.apk,'- only the synthetic dex checks ran')
