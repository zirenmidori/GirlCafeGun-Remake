"""Remove developer Lua and bind release login to the private Android bridge."""
from pathlib import Path
import hashlib, re, struct, sys
import patch_gacha
import patch_offline_web
import patch_selectors
ROOT = Path(__file__).resolve().parents[2]
from asset_tools import load_reviewed_parsers, validate_ranges, container_paths,pack

def replace_one(s, old, new):
    assert s.count(old) == 1, old[:150]
    return s.replace(old,new)

def patch_script(name, data):
    s=data.decode('utf8').replace('\r\n','\n')
    if name == 'UI_Login.lua':
        s=replace_one(s, '-- Local server settings. Appended to the exact supplied UI_Login TextAsset.', '\0SPLIT')
        s=s.split('\0SPLIT')[0]
        s=re.sub(r'\tself\.btnSwitch\.onClick:AddListener\(function\(\).*?\n\tend\);', '\tself.btnSwitch.gameObject:SetActive(false);',s,count=1,flags=re.S)
        s=replace_one(s, '\tif Game.Utils.TryOpenGM() and not Game.GM.Get() then \n\t\tGM:LoadUI(); \n\t\tGM.view:Register() \n\tend', '')
        # Unity reports no Internet interface when both radios are disabled,
        # although Android loopback TCP remains usable. Bypass that advisory
        # only for the release's validated on-phone gameplay gateway; retain
        # the original TCP connection and failure callback below this guard.
        s=replace_one(s, '\tif not Game.Login.IsNetworkReachability() then',
            '\tif not self:IsReleaseLocalGateway() and not Game.Login.IsNetworkReachability() then')
        # Account verification never consults test PlayerPrefs identities.
        start=s.index('function tbClass:Verify()')
        end=s.index('\nfunction ',start+1)
        old=s[start:end]
        v=old.index('\tif self:UseSDK() then')
        w=old.index('\n\tbVerify = false;',v)
        old2=old[:v]+"\tself.sAccount = GameManager.gcgEmbeddedPlayerAccount;\n\tassert(self.sAccount and self.sAccount ~= '', 'Local account unavailable');"+old[w:]
        s=s[:start]+old2+s[end:]
        s+='\n'+Path(__file__).with_name('release_login.lua').read_text(encoding='utf8')
    elif name == 'GameManager.lua':
        s=replace_one(s,"\tlocal address = U3D.PlayerPrefs.GetString('gcg.localServerUrl', '')\n\treturn address:match('^%s*(.-)%s*$'):gsub('/+$', '') == 'http://127.0.0.1:28080'",'\treturn true')
        s=replace_one(s,"\tlocal acc = GameManager.IsEmbeddedProfileServer() and self.gcgEmbeddedPlayerAccount\n\t\tor U3D.PlayerPrefs.GetString('account', '');", "\tlocal acc = self.gcgEmbeddedPlayerAccount;\n\tassert(acc and acc ~= '', 'Local account unavailable');")
    elif name == 'Preload.lua':
        s=s.replace('--local breakSocketHandle,debugXpCall = StartDebug("localhost",7003);','')
        s=replace_one(s,"\tloadlua 'GM/GM.lua';", "\tGM = { IsOpen=function() return false end, LoadUI=function() end, DoCommand=function() end };\n\tOpenGM = false;")
        s=s.replace("\tloadlua\t'Acivities/GMActivity.lua'",'')
    elif name in {'GM.lua','UI_GM.lua','LuaHotFixCSharp.lua','develop.lua','GMActivity.lua'}:
        s='-- Developer implementation omitted from the release.\n'
        if name=='GM.lua':s+="GM = { IsOpen=function() return false end, LoadUI=function() end, DoCommand=function() end }; OpenGM=false;\n"
    elif name=='S2CCall.lua':
        s,n=re.subn(r'function S2C.DebugEditor\(tbParam\).*?\nend','function S2C.DebugEditor() end',s,count=1,flags=re.S); assert n==1
        s,n=re.subn(r'function S2C.SetDebugActive\(tb\).*?\nend','function S2C.SetDebugActive() end',s,count=1,flags=re.S); assert n==1
    elif name=='LuaCall.lua':
        s,n=re.subn(r'RegisterCMD\(LuaCall.DoLuaString, function\(sCmd, tbParam\).*?\nend\)', 'RegisterCMD(LuaCall.DoLuaString, function() end)',s,count=1,flags=re.S);assert n==1
    elif name=='UI_User.lua':
        s,n=re.subn(r'\tif Game.Localization.Lang == Game.LangType.zh_CN then\n\t\tself.BtnDevelopPanel.*?\n\tend','',s,count=1,flags=re.S);assert n==1
    result=s.encode('utf8')
    if name in {'GachaCommon.lua','UI_GachaHistory.lua'}:result=patch_gacha.lua_script(name,result)
    if name in patch_selectors.LUA_NAMES:result=patch_selectors.lua_script(name,result)
    if name in patch_offline_web.LUA_NAMES:result=patch_offline_web.lua_script(name,result)
    return result

NAMES={'UI_Login.lua','GameManager.lua','Preload.lua','GM.lua','UI_GM.lua','LuaHotFixCSharp.lua','develop.lua','S2CCall.lua','LuaCall.lua','UI_User.lua','GMActivity.lua','GachaCommon.lua','UI_GachaHistory.lua'}
NAMES |= patch_selectors.LUA_NAMES
NAMES |= patch_offline_web.LUA_NAMES

def build(source):
    cipher,unity,builder=load_reviewed_parsers()
    meta,raw=unity.unityfs(cipher.transform(source));offset,objects=builder.serialized_objects(raw)
    validate_ranges(raw,objects); paths=container_paths(raw,objects)
    chosen=[o for o in objects if o.get('name') in NAMES];assert {o['name'] for o in chosen}==NAMES
    expected={};receipt={};removed_bodies=[]
    from lupa.lua53 import LuaRuntime
    lua=LuaRuntime()
    for o in chosen:
        start=o['script_start'];end=start+o['script_length'];old=raw[start:end];new=patch_script(o['name'],old)
        lua.execute('assert(load(...))',new.decode('utf8'))
        payload=raw[o['start']:o['script_length_at']]+struct.pack('<I',len(new))+new
        payload+=bytes(-len(payload)%4)+raw[(end+3)//4*4:o['start']+o['size']]
        expected[o['path_id']]=payload
        if o['name'] in {'GM.lua','UI_GM.lua','LuaHotFixCSharp.lua','develop.lua','GMActivity.lua'}:removed_bodies.append(old)
        receipt[o['name']]={'beforeSha256':hashlib.sha256(old).hexdigest(),'afterSha256':hashlib.sha256(new).hexdigest()}
    # Compact every object so replaced/orphaned developer source is physically
    # removed, including old dead copies retained by historical append writers.
    rebuilt=bytearray(raw[:offset])
    for o in sorted(objects,key=lambda x:x['start']):
        payload=expected.get(o['path_id'],raw[o['start']:o['start']+o['size']])
        rebuilt+=bytes(-len(rebuilt)%8);at=len(rebuilt);rebuilt+=payload
        struct.pack_into('<II',rebuilt,o['record']+8,at-offset,len(payload))
    assert all(body not in rebuilt for body in removed_bodies)
    struct.pack_into('>I',rebuilt,4,len(rebuilt));assert len(meta['nodes'])==1
    _,_,flags,cab=meta['nodes'][0];meta['nodes']=[(0,len(rebuilt),flags,cab)]
    result=cipher.transform(pack(meta,bytes(rebuilt)));_,check=unity.unityfs(cipher.transform(result));assert check==rebuilt
    _,checked=builder.serialized_objects(check);validate_ranges(check,checked);assert container_paths(check,checked)==paths
    byid={o['path_id']:o for o in checked};assert set(byid)=={o['path_id'] for o in objects}
    for o in objects:
        q=byid[o['path_id']];assert check[q['start']:q['start']+q['size']]==expected.get(o['path_id'],raw[o['start']:o['start']+o['size']])
    return result,{'changedScripts':receipt,'unchangedObjects':len(objects)-len(chosen),'allLuaSyntaxPassed':True,'containerUnchanged':True,'orphanedReplacedSourcePhysicallyRemoved':True}
