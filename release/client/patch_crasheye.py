"""Make Crasheye.init(Context, String, String) in classes.dex return false before it does anything.

Crasheye is a crash and session reporter (com.xsj.crasheye). The C# CrasheyeLib starts it at boot; its upload
host in code is https://crasheyerp<N>.testplus.cn, and it registers ActivityLifecycleCallbacks for app resume.
No data switch turns it off. All public init* entry points call this method; with false nothing is set up,
no session starts and the NDK handler is not installed.

The method is found through the dex tables (string, type, proto and method ids, class data), not by offset.
Its first instructions are const/4 v6, 0 and if-nez v4, +8; the second becomes return v6 and a nop. The
instructions after it stay as they are (unreachable). Then the header SHA-1 signature and Adler-32 checksum are
computed again.
"""
import hashlib,struct,zlib

DEX='classes.dex'
METHOD=('Lcom/xsj/crasheye/Crasheye;','init','(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Z')
STOCK=(0x0612,0x0439,0x0008)   # const/4 v6, 0; if-nez v4, +8
PATCH=(0x0612,0x060F,0x0000)   # const/4 v6, 0; return v6; nop

def uleb(b,at):
    value=shift=0
    while True:
        byte=b[at];at+=1;value|=(byte&0x7F)<<shift
        if byte<0x80:return value,at
        shift+=7

def method_code(dex,cls,name,signature):
    """File offset of the code_item of one method."""
    u16=lambda o:struct.unpack_from('<H',dex,o)[0];u32=lambda o:struct.unpack_from('<I',dex,o)[0]
    assert dex[:4]==b'dex\n' and u32(32)==len(dex),'not a whole dex file'
    strings,types,protos=u32(60),u32(68),u32(76);methods_n,methods,classes_n,classes=u32(88),u32(92),u32(96),u32(100)
    def string(i):
        _,at=uleb(dex,u32(strings+4*i));return dex[at:dex.index(b'\0',at)].decode('utf8')
    def type_name(i):return string(u32(types+4*i))
    def proto(i):
        at=protos+12*i;params=u32(at+8)
        args=[type_name(u16(params+4+2*k)) for k in range(u32(params))] if params else []
        return '('+''.join(args)+')'+type_name(u32(at+4))
    wanted=[m for m in range(methods_n) if type_name(u16(methods+8*m))==cls and string(u32(methods+8*m+4))==name
            and proto(u16(methods+8*m+2))==signature]
    assert len(wanted)==1,('method id',wanted)
    found=[]
    for c in range(classes_n):
        at=classes+32*c
        if type_name(u32(at))!=cls or not u32(at+24):continue
        p=u32(at+24);sizes=[]
        for _ in range(4):v,p=uleb(dex,p);sizes.append(v)
        for _ in range(2*(sizes[0]+sizes[1])):_,p=uleb(dex,p)
        for count in sizes[2:]:
            index=0
            for _ in range(count):
                diff,p=uleb(dex,p);_,p=uleb(dex,p);code,p=uleb(dex,p);index+=diff
                if index==wanted[0]:found.append(code)
    assert len(found)==1 and found[0],('code item',found)
    return found[0]

def with_header(dex):
    out=bytearray(dex);out[12:32]=hashlib.sha1(bytes(out[32:])).digest()
    out[8:12]=(zlib.adler32(bytes(out[12:]))&0xFFFFFFFF).to_bytes(4,'little');return bytes(out)

def build(source):
    """classes.dex with Crasheye.init returning false at once. Returns (classes.dex, proof)."""
    assert with_header(source)==source,'stock dex header is not valid'
    code=method_code(source,*METHOD)
    registers,ins,_,_,_,size=struct.unpack_from('<4HII',source,code)
    assert (registers,ins)==(7,3) and size>len(STOCK),(registers,ins,size)
    insns=code+16;before=struct.unpack_from('<3H',source,insns)
    assert before==STOCK,('Crasheye.init does not start as expected',[hex(x) for x in before])
    out=bytearray(source);struct.pack_into('<3H',out,insns,*PATCH);out=with_header(out)
    changed=[i for i in range(len(source)) if source[i]!=out[i]]
    assert all(i<32 or insns<=i<insns+6 for i in changed),changed
    assert struct.unpack_from('<3H',out,insns)==PATCH and method_code(out,*METHOD)==code
    return out,{'class':METHOD[0],'method':METHOD[1],'signature':METHOD[2],'codeItem':code,'insnsOffset':insns,
                'before':['const/4 v6, 0','if-nez v4, +8'],'after':['const/4 v6, 0','return v6','nop'],
                'codeUnitsBefore':[hex(x) for x in STOCK],'codeUnitsAfter':[hex(x) for x in PATCH],
                'bytesChangedOutsideHeader':sum(i>=32 for i in changed),'headerSignatureAndChecksumValid':True,
                'sourceSha256':hashlib.sha256(source).hexdigest(),'resultSha256':hashlib.sha256(out).hexdigest()}
