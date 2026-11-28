"""A tap on the "new private message" banner (UI_Remind) opens that girl's chat on the phone.

Stock flow: S2C.ServerPhoneMsg (nCmd 3) -> PhoneMsgLogic:ServerResponseLetter builds {desc, launcherIcon,
launcherName, index} -> RemindManager:NewLetter -> RemindManager:ShowRemind -> UI_Remind slides in at the top
right ("Cornelia / Why did you attack against orders? / 2 more private messages"). The banner has only the
BtnNext and BtnClose buttons: a tap on the message itself does nothing.

This recipe:
- PhoneMsgLogic.lua: both banner pushes of ServerResponseLetter also pass the girl's id (`npcId`).
- RemindManager.lua: NewLetter keeps `npcId` next to the name and icon it shows (the newest letter wins, as
  for the name and icon).
- UI_Remind.lua: ShowRemind keeps the shown entry; OnInit gives Panel/Message a Button (clicks on its texts and
  icon bubble up to it; BtnNext and BtnClose keep their own clicks). A tap on a letter banner closes the
  banner and opens UI_Phone on the Private tab with that girl's chat selected, the way the main menu phone
  button opens it (UI.CloseAndOpen from UI_Main, else UI.Open so Back returns to the screen under it).
  No tap action during a fight or a guide, and for any other banner kind.
"""

LUA_NAMES = {'UI_Remind.lua', 'RemindManager.lua', 'PhoneMsgLogic.lua'}

PHONE_NEW_OLD = '\t\t\ttbLetter.launcherName = PhoneMsgLogic:GetNpcNickName(tbNewLetter.Initiator)\n'
PHONE_NEW_NEW = PHONE_NEW_OLD + '\t\t\ttbLetter.npcId = tbNewLetter.Initiator -- offline: banner tap opens this chat\n'

PHONE_REPLY_OLD = '\t\t\t\ttbLetter.launcherName = PhoneMsgLogic:GetNpcNickName(nNpcId)\n'
PHONE_REPLY_NEW = PHONE_REPLY_OLD + '\t\t\t\ttbLetter.npcId = nNpcId -- offline: banner tap opens this chat\n'

REMIND_OLD = '\t\ttemp.index = tbParam.index\t\n'
REMIND_NEW = REMIND_OLD + '\t\ttemp.npcId = tbParam.npcId -- offline: banner tap opens this chat\n'

INIT_OLD = "\tself:OnClick('Panel/CoffeeMessage/BtnClose',function() UI.Close(self) end)\nend\n"
INIT_NEW = (
    "\tself:OnClick('Panel/CoffeeMessage/BtnClose',function() UI.Close(self) end)\n"
    "\t-- offline: a tap on a private-message banner opens that girl's chat\n"
    "\tlocal msgGo = self:Find('Panel/Message').gameObject\n"
    "\tlocal tapBtn = msgGo:GetComponent(typeof(U3D.UI.Button))\n"
    "\tif not tapBtn then tapBtn = msgGo:AddComponent(typeof(U3D.UI.Button)) end\n"
    "\ttapBtn.onClick:AddListener(function() self:OnTapLetter() end)\n"
    "end\n"
)

OPEN_OLD = 'function tbClass:OnOpen()\n\tself.count = 0\n'
OPEN_NEW = 'function tbClass:OnOpen()\n\tself.curConf = nil -- offline: banner tap\n\tself.count = 0\n'

SHOW_OLD = 'function tbClass:ShowRemind(tbConf)\n'
SHOW_NEW = SHOW_OLD + '\tself.curConf = tbConf -- offline: banner tap\n'

TAP_FUNCTION = '''
-- offline: open the phone at the chat of the girl the letter banner shows
function tbClass:OnTapLetter()
	local tbConf = self.curConf
	if not tbConf or tbConf ~= RemindManager.UnreadRemind.Letter or not tbConf.npcId then return end
	if GuideManager:IsGuiding() or Game.Map.isFight == true then return end
	local npcId = tbConf.npcId
	self.count = 0
	RemindManager:DeleteCloseAniTimer()
	UI.Close(self)
	PhoneMsgLogic:MakeLetterAll()
	PhoneMsgLogic.SelectLetter = npcId
	local ui
	if UI.IsOpen('UI_Phone') then
		ui = UI.GetClass('UI_Phone')
		if ui and ui.nShowType == ui.TYPE_LETTER then ui:ShowMainPanel(ui.TYPE_LETTER) end
	elseif UI.tbCurrent and UI.tbCurrent.sClass == 'UI_Main' then
		UI.CloseAndOpen('UI_Phone')
		ui = UI.GetClass('UI_Phone')
	else
		ui = UI.Open('UI_Phone')
	end
	if ui and ui.TogglePanel and ui.nShowType ~= ui.TYPE_LETTER then
		ui.TogglePanel:Find('Toggle3'):GetComponent('Toggle').isOn = true
	end
end
'''


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:120]
    return text.replace(old, new)


def lua_script(name, source):
    assert name in LUA_NAMES, name
    text = source.decode('utf8').replace('\r\n', '\n')
    if name == 'PhoneMsgLogic.lua':
        text = replace_one(text, PHONE_NEW_OLD, PHONE_NEW_NEW)
        text = replace_one(text, PHONE_REPLY_OLD, PHONE_REPLY_NEW)
    elif name == 'RemindManager.lua':
        text = replace_one(text, REMIND_OLD, REMIND_NEW)
    else:
        text = replace_one(text, INIT_OLD, INIT_NEW)
        text = replace_one(text, OPEN_OLD, OPEN_NEW)
        text = replace_one(text, SHOW_OLD, SHOW_NEW)
        assert 'function tbClass:OnTapLetter(' not in text
        text = text.rstrip('\n') + '\n' + TAP_FUNCTION
    return text.encode('utf8')
