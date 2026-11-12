"""Exercise local account, gateway pinning, manual Update, and retry behavior."""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'translation/tools/.deps'))
from lupa.lua53 import LuaRuntime

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
    return {'privateAccountBridgeVoidOnly':True,'legacyIdentityNeverRead':True,'httpEndpointPinned':28080,'tcpGameplayGatewayPinned':31400,'remoteOrWrongGatewayRejected':True,'manualUpdateInvokedFromLoginButton':True}

if __name__=='__main__':print(run())
