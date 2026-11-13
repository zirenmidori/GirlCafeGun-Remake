"""Exercise local account, gateway pinning, manual Update, and retry behavior."""
from pathlib import Path
import sys,zipfile
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'translation/tools/.deps'))
from lupa.lua53 import LuaRuntime

def check_connection(login_source=None):
    """Run the retained stock Connect, rather than an account-click stub."""
    if login_source is None:
        import asset_tools,patch_lua
        with zipfile.ZipFile(ROOT/'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.apk') as apk:
            blob=apk.read('assets/lua.u')
        _,raw=asset_tools.unityfs(asset_tools.transform(blob))
        _,objects=asset_tools.serialized_objects(raw)
        obj=next(o for o in objects if o.get('name')=='UI_Login.lua')
        login_source=patch_lua.patch_script('UI_Login.lua',raw[obj['script_start']:obj['script_start']+obj['script_length']]).decode('utf8')
    start=login_source.index('function tbClass:Connect()')
    end=login_source.index('\nfunction ',start+1)
    connect=login_source[start:end]
    assert 'not self:IsReleaseLocalGateway() and not Game.Login.IsNetworkReachability()' in connect
    lua=LuaRuntime()
    lua.execute('''
local events, reachable, nativeResult
local bLoginWait, bVerify = false, false
function UIText(s) return s end
function Text(s) return s end
Game={Login={
 IsNetworkReachability=function() events.reachability=events.reachability+1; return reachable end,
 SetServerParam=function() events.params=events.params+1 end,
 Connect=function(ip,port,fn)
  events.connect=events.connect+1;events.ip=ip;events.port=port;fn(nativeResult)
 end},
 MessageBox={Simple=function(s) events.message=s end},
 Timer={Add=function(_,fn) events.timer=fn;return 17 end},
 Blocking={Show=function() events.block=true end,Hide=function() events.block=false end},
 ServerList={GetUrlErrorServer=function() return 'server' end,GetUrlErrorGate=function() return 'gate' end}}
UI={Open=function(_,url) events.errorUrl=url end}
tbClass={OnInit=function() end,OnClose=function() end,
 ShowLoading=function() events.loading=true end,HideLoading=function() events.loading=false end,
 Verify=function() events.verified=events.verified+1 end,
 Login2Game=function() events.login=events.login+1 end}
'''+Path(__file__).with_name('release_login.lua').read_text(encoding='utf8')+'\n'+connect+'''
local function attempt(server,online,success,verified)
 events={reachability=0,connect=0,params=0,verified=0,login=0}
 reachable,nativeResult=online,success
 bLoginWait,bVerify=false,verified or false
 tbClass.pSelected=server
 tbClass:Connect()
 return events
end
local localServer={ip='127.0.0.1',port={31400},state=1,aid=1,sid=1,name='Local'}
local e=attempt(localServer,false,true)
assert(e.connect==1 and e.ip=='127.0.0.1' and e.port==31400 and e.verified==1)
assert(e.reachability==0 and e.params==1 and not e.block and not e.message)
-- Failure is real: the bypass must never pretend a missing server connected.
e=attempt(localServer,false,false)
assert(e.connect==1 and e.verified==0 and e.message=='ui.login.connect_failed')
assert(e.errorUrl=='gate' and not e.block and not e.loading and not bLoginWait)
e=attempt(localServer,false,true,true)
assert(e.login==1 and e.connect==0 and e.reachability==0)
e=attempt({ip='127.0.0.1',port={31400,31400},state=1},false,true)
assert(e.connect==1 and e.verified==1)
-- No Internet bypass for another host, port, missing port, or mixed gateway.
local rejected={
 {ip='192.0.2.1',port={31400},state=1},
 {ip='127.0.0.2',port={31400},state=1},
 {ip='localhost',port={31400},state=1},
 {ip='127.0.0.1',port={28080},state=1},
 {ip='127.0.0.1',port={31400,28080},state=1},
 {ip='127.0.0.1',port={'31400'},state=1},
 {ip='127.0.0.1',port={},state=1},
 {ip='127.0.0.1',state=1}}
for _,server in ipairs(rejected) do
 e=attempt(server,false,true)
 assert(e.connect==0 and e.message=='UI_Login.NetWorkError' and e.reachability==1)
end
e=attempt(nil,false,true)
assert(e.connect==0 and e.message=='UI_Login.NetWorkError')
-- Preserve the stock disabled-server and online remote behaviors.
e=attempt({ip='127.0.0.1',port={31400},state=0},false,true)
assert(e.connect==0 and e.message=='Error.10208' and e.errorUrl=='server')
e=attempt({ip='192.0.2.1',port={31400},state=1},true,true)
assert(e.connect==1 and e.verified==1 and e.reachability==1)
''')
    return {'radiosOffLoopbackConnects':True,'realSocketFailureStillReported':True,
            'invalidOrRemoteGatewaysNotBypassed':True,'stockOnlineRemoteBehaviorPreserved':True,
            'stockConnectMethodExecuted':True}

def run():
    lua=LuaRuntime()
    lua.execute('''
local events={prepared=0,updated=0,connect=0,applied=0,message=0}
local function button()
  local obj={activeSelf=true};function obj:SetActive(v) self.activeSelf=v end
  local event={};function event:RemoveAllListeners() self.fn=nil end
  function event:AddListener(fn) self.fn=fn end
  return {gameObject=obj,onClick=event}
end
local accountReads=0
U3D={AndroidJavaClass=function(name)
  assert(name=='com.zirenmidori.gcg.release.ReleaseBridge')
  return {CallStatic=function(_,method)
    if method=='prepareAccount' then events.prepared=events.prepared+1
    elseif method=='requestUpdate' then events.updated=events.updated+1
    else error('Generic string-return bridge used') end
  end}
end,PlayerPrefs={GetString=function() error('Legacy identity/endpoint read') end}}
GameManager={}
PlayerLogic={ReSetLocalData=function() end}
Game={LuaUtils={IsUpdating=function() return false end},
 MessageBox={Simple=function() events.message=events.message+1 end},
 ServerList={ChangeBaseUrl=function(address,fn)
  assert(address=='http://127.0.0.1:28080'); fn('server response') end}}
Json={Decode=function() return response end}
UI={IsOpen=function(name) return name=='UI_Login' end}
tbClass={OnInit=function() end,OnClose=function() end,
 ShowLoading=function() end,HideLoading=function() end,
 ClearAuthInfo=function() end,Connect=function() events.connect=events.connect+1 end,
 ApplyServerListSuccess=function(self) self.isApplyServerListSuccess=true;events.applied=events.applied+1 end,
 GetComponent=function() return {} end}
for _,name in ipairs({'btnMenu','btnNew','btnUse','btnLogout','btnTransfer','btnResource'}) do tbClass[name]=button() end
tbClass.pnlDev={gameObject=button().gameObject};tbClass.serverObj={gameObject=button().gameObject}
function tbClass:Find() return {gameObject=button().gameObject} end
local bLoginWait=false
local bCheckUpdate=false
'''+Path(__file__).with_name('release_login.lua').read_text(encoding='utf8')+'''
tbClass:OnInit()
assert(GameManager.gcgEmbeddedPlayerAccount=='gcg-offline-player-v1')
assert(events.prepared==1 and not tbClass.serverObj.gameObject.activeSelf)
assert(tbClass.btnMenu.gameObject.activeSelf and not tbClass.btnUse.gameObject.activeSelf)
tbClass.btnMenu.onClick.fn();assert(events.updated==1)
response={serverlist={{ip='127.0.0.1',port={31400}}}}
tbClass:ApplyServerList();assert(events.applied==1)
tbClass.pSelected={};tbClass:OnButtonClickUseAccount();assert(events.connect==1)
response={serverlist={{ip='192.0.2.1',port={31400}}}}
tbClass:ApplyServerList();assert(not tbClass.isApplyServerListSuccess and events.message==1)
response={serverlist={{ip='127.0.0.1',port={28080}}}}
tbClass:ApplyServerList();assert(not tbClass.isApplyServerListSuccess and events.message==2)
''')
    return {'privateAccountBridgeVoidOnly':True,'legacyIdentityNeverRead':True,'httpEndpointPinned':28080,'tcpGameplayGatewayPinned':31400,'remoteOrWrongGatewayRejected':True,'manualUpdateInvokedFromLoginButton':True,'offlineConnection':check_connection()}

if __name__=='__main__':print(run())
