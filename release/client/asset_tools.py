"""Portable Unity2018/IL2CPP data codecs; no extracted assets are embedded.

The metadata/native type graph is read from the caller-supplied pinned APK.
"""
from pathlib import Path
from functools import cache
from types import SimpleNamespace
import collections,copy,hashlib,io,json,struct,sys,zipfile
ROOT=Path(__file__).resolve().parents[2]
try:
 import UnityPy
except ImportError:
 sys.path.insert(0,str(ROOT/'translation/tools/.deps'))
 import UnityPy
import lz4.block
from UnityPy.helpers import TypeTreeHelper
TypeTreeHelper.read_typetree_boost=False
assert UnityPy.__version__=='1.25.2'
native=sys.modules[__name__]
unity=native
lang=native
BASE=0x7056027000
SEED=0x166920ED

def configure(apk):
 global META,ELF,HEADER,STRINGS,TYPE_START,TYPE_BYTES,FIELD_START,TYPES,TYPE_TABLE,TYPE_COUNT,CORE_LIBRARIES
 with zipfile.ZipFile(apk) as source:
  META=source.read('assets/bin/Data/Managed/Metadata/global-metadata.dat')
  ELF=source.read('lib/arm64-v8a/libil2cpp.so')
  CORE_LIBRARIES={abi:source.read('lib/'+abi+'/libLive2DCubismCore.so') for abi in ('arm64-v8a','armeabi-v7a')}
 HEADER=struct.unpack_from('<68I',META)
 STRINGS=HEADER[6];TYPE_START,TYPE_BYTES=HEADER[40:42];FIELD_START=HEADER[24]
 assert TYPE_BYTES%100==0
 TYPES=[struct.unpack_from('<25I',META,off) for off in range(TYPE_START,TYPE_START+TYPE_BYTES,100)]
 TYPE_TABLE=struct.unpack_from('<Q',ELF,0x4f53d20+56)[0]
 TYPE_COUNT=struct.unpack_from('<Q',ELF,0x4f53d20+48)[0]
 class_info.cache_clear();generic_list_member.cache_clear()


def transform(data: bytes, seed: int = SEED) -> bytes:
    result = bytearray(data)
    for index in range(1, len(result) - 1, 4):
        if seed % index < index // 3:
            result[index], result[index + 1] = result[index + 1], result[index]
    return bytes(result)

def lz4_raw(src, expected):
    src = memoryview(src)
    out = bytearray()
    i = 0
    while i < len(src):
        token = src[i]
        i += 1
        literal = token >> 4
        if literal == 15:
            while True:
                v = src[i]; i += 1; literal += v
                if v != 255: break
        out.extend(src[i:i+literal]); i += literal
        if i >= len(src): break
        offset = src[i] | (src[i+1] << 8); i += 2
        if not offset or offset > len(out): raise ValueError('invalid LZ4 offset')
        length = (token & 15) + 4
        if token & 15 == 15:
            while True:
                v = src[i]; i += 1; length += v
                if v != 255: break
        for _ in range(length): out.append(out[-offset])
    if len(out) != expected: raise ValueError((len(out), expected))
    return bytes(out)

def decode_block(src, flags, expected):
    kind = flags & 63
    if kind == 0: return src
    if kind in (2, 3): return lz4_raw(src, expected)
    raise ValueError(('unsupported compression', kind))

def cstr(s):
    b = bytearray()
    while True:
        c = s.read(1)
        if not c or c == b'\0': return b.decode('utf-8', 'replace')
        b.extend(c)

def unpack(fmt, s): return struct.unpack(fmt, s.read(struct.calcsize(fmt)))

def unityfs(raw):
    s = io.BytesIO(raw)
    sig = cstr(s)
    version, = unpack('>I', s)
    engine = cstr(s); revision = cstr(s)
    total, compressed, uncompressed, flags = unpack('>QIII', s)
    if version >= 7: s.seek((s.tell()+15)//16*16)
    header_end = s.tell()
    if flags & 128: s.seek(len(raw)-compressed)
    info = io.BytesIO(decode_block(s.read(compressed), flags, uncompressed))
    info.read(16)
    count, = unpack('>I', info)
    blocks = [unpack('>IIH', info) for _ in range(count)]
    count, = unpack('>I', info)
    nodes = []
    for _ in range(count):
        offset, size, nflags = unpack('>QQI', info)
        nodes.append((offset, size, nflags, cstr(info)))
    s.seek(header_end if flags & 128 else header_end+compressed)
    if flags & 512: s.seek((s.tell()+15)//16*16)
    data = b''.join(decode_block(s.read(cs), f, us) for us, cs, f in blocks)
    return {'signature':sig, 'format':version, 'engine':engine, 'revision':revision, 'flags':flags, 'nodes':nodes}, data

def pack(meta,data):
 blocks=[];compressed=[]
 for offset in range(0,len(data),65536):
  raw=data[offset:offset+65536];body=lz4.block.compress(raw,store_size=False,mode='high_compression',compression=9)
  blocks.append((len(raw),len(body),2));compressed.append(body)
 table=hashlib.md5(data).digest()+struct.pack('>I',len(blocks))+b''.join(struct.pack('>IIH',*x) for x in blocks)+struct.pack('>I',len(meta['nodes']))
 for offset,size,flags,name in meta['nodes']:table+=struct.pack('>QQI',offset,size,flags)+name.encode()+b'\0'
 info=lz4.block.compress(table,store_size=False)
 head=b'UnityFS\0'+struct.pack('>I',6)+meta['engine'].encode()+b'\0'+meta['revision'].encode()+b'\0'
 result=head+struct.pack('>QIII',len(head)+20+len(info)+sum(map(len,compressed)),len(info),len(table),0x42)+info+b''.join(compressed)
 check,rr=unityfs(result);assert rr==data and check['nodes']==meta['nodes']
 return result

def pointers(value):
 if isinstance(value,dict):
  if set(value)=={'m_FileID','m_PathID'}:yield value
  else:
   for v in value.values():yield from pointers(v)
 elif isinstance(value,(list,tuple)):
  for v in value:yield from pointers(v)


def decode(data):
 for encrypted,plain in ((False,data),(True,transform(data))):
  try:
   meta,raw=unityfs(plain)
   return meta,raw,encrypted,plain
  except Exception: pass
 raise ValueError('Invalid Unity2018 bundle')
def sha(data):return hashlib.sha256(data).hexdigest()
def ptr(path_id=0,file_id=0):return {'m_FileID':file_id,'m_PathID':path_id}
def model_objects(data):
 env=UnityPy.load(data);asset,=env.assets;return env,asset


def name(index):
    return META[STRINGS+index:META.index(0,STRINGS+index)].decode('utf8')

def file_offset(address):
    if address>=BASE:address-=BASE
    if address<0x4b5e9b8+0x98:return address
    if 0x4b6f000<=address<0x523a568:return address-0x10000
    if address>=0x5520000:return address-0x300000
    raise ValueError(hex(address))

def u64(address):return struct.unpack_from('<Q',ELF,file_offset(address))[0]

def type_info(index):
    assert 0<=index<TYPE_COUNT
    ptr=u64(TYPE_TABLE+index*8)
    data,bits=struct.unpack_from('<QI',ELF,file_offset(ptr))
    return data,(bits>>16)&255,bits&65535

def pointer_type_info(ptr):
    data,bits=struct.unpack_from('<QI',ELF,file_offset(ptr))
    return data,(bits>>16)&255,bits&65535

class BaseReader:
    def __init__(self,raw,start,end):self.raw=raw;self.at=start;self.end=end
    def unpack(self,fmt):
        size=struct.calcsize(fmt);assert self.at+size<=self.end
        value=struct.unpack_from(fmt,self.raw,self.at);self.at+=size
        return value[0] if len(value)==1 else value
    def align(self):self.at=(self.at+3)//4*4;assert self.at<=self.end
    def string(self):
        size=self.unpack('<I');assert size<=self.end-self.at
        value=self.raw[self.at:self.at+size].decode('utf8');self.at+=size;self.align();return value
    def read_type(self,index):return self.read_info(type_info(index))
    def read_info(self,info):
        data,kind,attrs=info
        formats={2:'<?',3:'<H',4:'<b',5:'<B',6:'<h',7:'<H',8:'<i',9:'<I',10:'<q',11:'<Q',12:'<f',13:'<d'}
        if kind in formats:
            value=self.unpack(formats[kind])
            if struct.calcsize(formats[kind])<4:self.align()
            return value
        if kind==14:return self.string()
        if kind==29:
            count=self.unpack('<I');assert count<1000000
            elem=pointer_type_info(data)
            values=[self.read_info(elem) for _ in range(count)]
            self.align();return values
        if kind in (17,18):return self.read_class(data)
        raise ValueError(('unsupported type',hex(kind),hex(data),self.at))
    def read_class(self,index):
        assert index<len(TYPES)
        record=TYPES[index];type_name=name(record[0]);ns=name(record[1])
        if (type_name in ('Object','ValueType','Enum') and ns=='System') or (type_name in ('Object','ScriptableObject','MonoBehaviour','Behaviour','Component') and ns=='UnityEngine'):return {}
        # An enum serializes only its underlying value, not static labels.
        enum=bool(record[23]&2)
        if enum:
            start=record[11]
            _,type_index,_=struct.unpack_from('<III',META,FIELD_START+start*12)
            return self.read_type(type_index)
        result={}
        if record[5]!=0xffffffff:
            parent=type_info(record[5])
            if parent[1] in (17,18):result.update(self.read_class(parent[0]))
        for i in range(record[11],record[11]+(record[20]&65535)):
            ni,ti,token=struct.unpack_from('<III',META,FIELD_START+i*12)
            attrs=type_info(ti)[2]
            if attrs&(0x10|0x40|0x80):continue
            if (attrs&7)!=6:
                raise ValueError(('non-public field requires SerializeField check',type_name,name(ni),hex(attrs)))
            result[name(ni)]=self.read_type(ti)
        return result

def serialized_inventory(raw):
    s=io.BytesIO(raw)
    meta,total,version,data_offset=struct.unpack_from('>4I',raw)
    assert version==17 and total==len(raw)
    s.seek(20)
    engine=cstr(s)
    platform,tree,type_count=unpack('<i?i',s)
    assert not tree
    types=[]
    for _ in range(type_count):
        cid,stripped,scriptidx=unpack('<i?h',s)
        script_hash=s.read(16) if cid==114 else b''
        old_hash=s.read(16)
        types.append({'class_id':cid,'stripped':stripped,'scriptidx':scriptidx,'script_hash':script_hash.hex(),'type_hash':old_hash.hex()})
    object_count,=unpack('<i',s)
    objects=[]
    for _ in range(object_count):
        s.seek((s.tell()+3)//4*4)
        pid,start,size,tid=unpack('<qIIi',s);start+=data_offset
        assert data_offset<=start<=start+size<=len(raw)
        objects.append({'path_id':pid,'start':start,'end':start+size,'class_id':types[tid]['class_id'],'type_id':tid})
    paths={};scripts={}
    for obj in objects:
        q=Reader(raw,obj['start'],obj['end'])
        if obj['class_id']==115:scripts[obj['path_id']]=q.string()
        elif obj['class_id']==142:
            q.string();preload=q.unpack('<I');q.at+=preload*12
            for _ in range(q.unpack('<I')):
                asset=q.string();_,_,fid,pid=q.unpack('<iiiq')
                if fid==0:paths.setdefault(pid,[]).append(asset)
    return {'engine':engine,'platform':platform,'serializedVersion':version,'types':types,'objects':objects,'asset_paths':paths,'scripts':scripts}

class BaseWriter:
    """Inverse of the reviewed native-schema Reader; writes only new array rows."""
    def __init__(self):self.raw=bytearray()
    def pack(self,fmt,value):self.raw+=struct.pack(fmt,value)
    def align(self):self.raw+=bytes((-len(self.raw))%4)
    def string(self,value):
        data=value.encode('utf-8');self.pack('<I',len(data));self.raw+=data;self.align()
    def write_type(self,index,value):self.write_info(native.type_info(index),value)
    def write_info(self,info,value):
        data,kind,attrs=info
        formats={2:'<?',3:'<H',4:'<b',5:'<B',6:'<h',7:'<H',8:'<i',9:'<I',10:'<q',11:'<Q',12:'<f',13:'<d'}
        if kind in formats:
            self.pack(formats[kind],value)
            if struct.calcsize(formats[kind])<4:self.align()
        elif kind==14:self.string(value)
        elif kind==29:
            self.pack('<I',len(value));elem=native.pointer_type_info(data)
            for row in value:self.write_info(elem,row)
            self.align()
        elif kind in (17,18):self.write_class(data,value)
        else:raise ValueError(('unsupported native type',kind,hex(data)))
    def write_class(self,index,value):
        record=native.TYPES[index];name=native.name(record[0]);ns=native.name(record[1])
        if ((name in ('Object','ValueType','Enum') and ns=='System') or
            (name in ('Object','ScriptableObject','MonoBehaviour','Behaviour','Component') and ns=='UnityEngine')):return
        if record[23]&2:
            _,ti,_=struct.unpack_from('<III',native.META,native.FIELD_START+record[11]*12)
            self.write_type(ti,value);return
        if record[5]!=0xffffffff:
            parent=native.type_info(record[5])
            if parent[1] in(17,18):self.write_class(parent[0],value)
        for fi in range(record[11],record[11]+(record[20]&65535)):
            ni,ti,_=struct.unpack_from('<III',native.META,native.FIELD_START+fi*12)
            attrs=native.type_info(ti)[2]
            if attrs&(0x10|0x40|0x80):continue
            if attrs&7!=6:raise ValueError(('unreviewed nonpublic field',name,native.name(ni)))
            self.write_type(ti,value[native.name(ni)])

def class_index(name):
    matches=[i for i,t in enumerate(native.TYPES) if native.name(t[0])==name]
    if len(matches)!=1:raise ValueError('Ambiguous native class '+name)
    return matches[0]

SKIP_RUNTIME={("BulletBaseInfo","_effInfo"),("FightSkillBaseInfo","<bombingBase>k__BackingField"),("FightSkillBaseInfo","_stateEffectInf")}


def type_members(index):
    record = native.TYPES[index]
    class_name = native.name(record[0])
    if record[5] != 0xffffffff:
        parent, kind, _ = native.type_info(record[5])
        if kind in (17, 18):
            parent_kind, parent_values = class_info(parent)
            if parent_kind == "class":
                yield from parent_values
    for fi in range(record[11], record[11] + (record[20] & 65535)):
        n, t, _ = struct.unpack_from("<III", native.META, native.FIELD_START + fi * 12)
        field, info = native.name(n), native.type_info(t)
        attrs = info[2]
        if attrs & (0x10 | 0x40 | 0x80):
            continue
        if attrs & 7 != 6:
            assert (class_name, field) in SKIP_RUNTIME, (class_name, field)
            continue
        yield field, info

@cache
def class_info(index):
    record = native.TYPES[index]
    name, namespace = native.name(record[0]), native.name(record[1])
    if ((namespace == "System" and name in {"Object", "ValueType", "Enum"}) or
            (namespace == "UnityEngine" and name in {"Object", "ScriptableObject", "MonoBehaviour",
                                                      "Behaviour", "Component"})):
        return "empty", None
    if record[23] & 2:
        _, type_index, _ = struct.unpack_from("<III", native.META, native.FIELD_START + record[11] * 12)
        return "enum", native.type_info(type_index)
    return "class", tuple(type_members(index))

@cache
def generic_list_member(pointer):
    definition, instance = struct.unpack_from("<QQ", native.ELF, native.file_offset(pointer))
    row = native.TYPES[definition]
    assert native.name(row[0]) == "List`1" and native.name(row[1]) == "System.Collections.Generic"
    count, arguments = struct.unpack_from("<QQ", native.ELF, native.file_offset(instance))
    assert count == 1
    return native.pointer_type_info(native.u64(arguments))

class Reader(BaseReader):
    def read_info(self, info):
        pointer, kind, _ = info
        if kind != 21:
            return super().read_info(info)
        element = generic_list_member(pointer)
        count = self.unpack("<I")
        assert count < 1000000
        result = [self.read_info(element) for _ in range(count)]
        self.align()
        return result

    def read_class(self, index):
        kind, values = class_info(index)
        if kind == "empty":
            return {}
        if kind == "enum":
            return self.read_info(values)
        return {field: self.read_info(info) for field, info in values}

class Writer(BaseWriter):
    def write_info(self, info, value):
        pointer, kind, _ = info
        if kind != 21:
            return super().write_info(info, value)
        self.pack("<I", len(value))
        element = generic_list_member(pointer)
        for row in value:
            self.write_info(element, row)
        self.align()

    def write_class(self, index, value):
        kind, values = class_info(index)
        if kind == "empty":
            return
        if kind == "enum":
            self.write_info(values, value)
            return
        assert set(value) == {field for field, _ in values}
        for field, info in values:
            self.write_info(info, value[field])

def serialize(index, value):
    writer = Writer()
    writer.write_class(index, value)
    return bytes(writer.raw)

def typed_tables(raw, names):
    inv = native.serialized_inventory(raw)
    result = {}
    for obj in inv["objects"]:
        if obj["class_id"] != 114:
            continue
        reader = Reader(raw, obj["start"] + 28, obj["end"])
        name = reader.string()
        if name not in names:
            continue
        assert name not in result
        file_id, pid = struct.unpack_from("<iq", raw, obj["start"] + 16)
        assert file_id == 0
        index = class_index(inv["scripts"][pid])
        start = reader.at
        value = reader.read_class(index)
        assert reader.at == obj["end"]
        assert serialize(index, value) == raw[start:obj["end"]], name
        result[name] = {"object": obj, "classIndex": index, "bodyStart": start, "value": value}
    assert set(result) == names
    return result

def replace_native(raw, table, updated):
    obj = table["object"]
    before = raw[obj["start"]:table["bodyStart"]]
    body = serialize(table["classIndex"], updated)
    rebuilt = before + body
    reader = Reader(rebuilt, len(before), len(rebuilt))
    assert reader.read_class(table["classIndex"]) == updated and reader.at == len(rebuilt)
    return rebuilt

def serialized_objects(raw):
    import io
    _,total,version,data=struct.unpack_from('>4I',raw)
    if version!=17 or total!=len(raw):raise ValueError('Unsupported/non-exact SerializedFile')
    stream=io.BytesIO(raw);stream.seek(20)
    while stream.read(1)!=b'\0':pass
    _,tree,count=struct.unpack('<i?i',stream.read(9));types=[]
    for _ in range(count):
        cid,_,_=struct.unpack('<i?h',stream.read(7))
        if cid==114:stream.read(16)
        stream.read(16)
        if tree:
            nodes,chars=struct.unpack('<ii',stream.read(8));stream.seek(stream.tell()+nodes*24+chars)
        types.append(cid)
    count=struct.unpack('<i',stream.read(4))[0];objects=[]
    for _ in range(count):
        stream.seek((stream.tell()+3)//4*4);record=stream.tell();pid,start,size,tid=struct.unpack('<qIIi',stream.read(20))
        if not 0<=start<=start+size<=len(raw)-data:raise ValueError('Object range invalid')
        objects.append({'record':record,'path_id':pid,'start':data+start,'size':size,'class_id':types[tid]})
    return data,objects

def repack_objects(raw, replacements):
    """Replace complete SerializedFile v17 object payloads by path ID.

    All metadata bytes other than fileSize and replaced object start/size stay
    identical. Unmodified object payloads remain byte-exact at original offsets.
    Replacement payloads are appended, so unknown metadata/data is preserved.
    Empty or byte-identical replacement sets return the exact original bytes.
    """
    raw=bytes(raw);data_offset,obs=serialized_objects(raw)
    byid={o['path_id']:o for o in obs}
    if len(byid)!=len(obs):raise ValueError('Duplicate object path ID')
    replacements={int(k):bytes(v) for k,v in replacements.items()}
    unknown=set(replacements)-set(byid)
    if unknown:raise ValueError('Unknown replacement path IDs: '+str(sorted(unknown)))
    replacements={pid:payload for pid,payload in replacements.items() if payload!=raw[byid[pid]['start']:byid[pid]['start']+byid[pid]['size']]}
    if not replacements:return raw
    rebuilt=bytearray(raw)
    for pid,payload in replacements.items():
        ob=byid[pid];rebuilt+=bytes((-len(rebuilt))%4);start=len(rebuilt)
        if start-data_offset>0xffffffff or len(payload)>0xffffffff:raise ValueError('SerializedFile v17 uint32 size overflow')
        rebuilt+=payload;struct.pack_into('<II',rebuilt,ob['record']+8,start-data_offset,len(payload))
    if len(rebuilt)>0xffffffff:raise ValueError('SerializedFile v17 file size overflow')
    struct.pack_into('>I',rebuilt,4,len(rebuilt));result=bytes(rebuilt)
    _,after=serialized_objects(result)
    if [(o['path_id'],o['class_id']) for o in obs]!=[(o['path_id'],o['class_id']) for o in after]:raise ValueError('Object identities changed')
    metadata=bytearray(result[:data_offset]);original=bytearray(raw[:data_offset])
    metadata[4:8]=original[4:8]
    for pid in replacements:
        record=byid[pid]['record'];metadata[record+8:record+16]=original[record+8:record+16]
    if metadata!=original:raise ValueError('Unrelated metadata changed')
    for ob in after:
        pid=ob['path_id'];expected=replacements.get(pid,raw[byid[pid]['start']:byid[pid]['start']+byid[pid]['size']])
        if result[ob['start']:ob['start']+ob['size']]!=expected:raise ValueError('Object verification failed')
    return result


_serialized_objects=serialized_objects
def serialized_objects(raw):
 data,objects=_serialized_objects(raw)
 for obj in objects:
  if obj['class_id']!=49:continue
  at=obj['start'];length=struct.unpack_from('<I',raw,at)[0];at+=4
  obj['name']=raw[at:at+length].decode('utf8');at=(at+length+3)//4*4
  obj['script_length_at']=at;obj['script_length']=struct.unpack_from('<I',raw,at)[0];obj['script_start']=at+4
 return data,objects
pipeline=SimpleNamespace(repack_objects=repack_objects)
def load_reviewed_parsers():
 return SimpleNamespace(transform=transform),SimpleNamespace(unityfs=unityfs),SimpleNamespace(serialized_objects=serialized_objects)


def container_paths(raw, objects):
    bundles = [o for o in objects if o['class_id'] == 142]
    assert len(bundles) == 1
    obj = bundles[0]; stream = io.BytesIO(raw[obj['start']:obj['start'] + obj['size']])
    def readstr():
        length, = struct.unpack('<I', stream.read(4)); assert length < 1000000
        result = stream.read(length); assert len(result) == length
        stream.seek((stream.tell() + 3) // 4 * 4)
        return result.decode('utf-8')
    readstr()
    preload_count, = struct.unpack('<I', stream.read(4)); assert preload_count < 100000
    stream.seek(stream.tell() + preload_count * 12)
    count, = struct.unpack('<I', stream.read(4)); assert count < 100000
    result = {}
    for _ in range(count):
        path = readstr()
        preload_index, preload_size, file_id, path_id = struct.unpack('<iiiq', stream.read(20))
        assert file_id == 0 and path_id not in result
        result[path_id] = path
    return result

def validate_ranges(raw, objects):
    data_offset = struct.unpack_from('>I', raw, 12)[0]
    assert struct.unpack_from('>I', raw, 4)[0] == len(raw)
    assert len({o['path_id'] for o in objects}) == len(objects)
    previous_end = data_offset
    for o in sorted(objects, key=lambda x: x['start']):
        assert data_offset <= previous_end <= o['start']
        assert o['start'] + o['size'] <= len(raw)
        previous_end = o['start'] + o['size']
        if o['class_id'] == 49:
            assert o['start'] <= o['script_start'] <= o['script_start'] + o['script_length'] <= previous_end
