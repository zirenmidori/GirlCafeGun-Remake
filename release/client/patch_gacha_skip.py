"""Keep the Skip-all button of the gacha card screen (UI_GachaGet) visible.

Stock UI_GachaGet.lua hides Panel/BtnSkipAll while a new card plays its UI_Cartoon story and never shows it
again. The screen object is reused, so every later card of the session, and every later pull, has no Skip.
This recipe shows the button again when the screen opens and when the cartoon ends.
"""

LUA_NAMES = {'UI_GachaGet.lua'}

OPEN_OLD = '\tself.fOnSkip = fOnSkip;\n'
OPEN_NEW = OPEN_OLD + '\tself.btnSkipAll.gameObject:SetActive( true );\n'
CARTOON_OLD = "UI.Open( 'UI_Cartoon', tbInfo.sStory, function() self:ShowCard(rItem); end, nil, nil, false );"
CARTOON_NEW = ("UI.Open( 'UI_Cartoon', tbInfo.sStory, function() "
               "self.btnSkipAll.gameObject:SetActive( true ); self:ShowCard(rItem); end, nil, nil, false );")


def replace_one(text, old, new):
    assert text.count(old) == 1, old[:120]
    return text.replace(old, new)


def lua_script(name, source):
    assert name in LUA_NAMES, name
    text = source.decode('utf8').replace('\r\n', '\n')
    text = replace_one(text, OPEN_OLD, OPEN_NEW)
    text = replace_one(text, CARTOON_OLD, CARTOON_NEW)
    return text.encode('utf8')
