-- Dead online links of the client, for the offline build.
-- release/client/patch_offline_links.py places this file at the end of Lib.lua and calls it from
-- DropWay.lua (banners and other jump targets), UI_User.lua (settings) and UI_JPTip.lua.
local P = {}

-- The part of an address that names a page: no scheme, no slash at the end, lower case.
local function pageKey(url)
	if type(url) ~= 'string' then return nil end
	local rest = string.match(url, '^[Hh][Tt][Tt][Pp][Ss]?://(.+)$')
	if not rest then return nil end
	rest = string.gsub(rest, '/+$', '')
	if rest == '' then return nil end
	return string.lower(rest)
end

-- A page that moved: the old address opens the new one.
-- The Japanese fan wiki is gone (no DNS); the English wiki of the game is wiki.girl.cafe.
local MOVED = {
	[pageKey('https://girlcafegun.boom-app.wiki/')] = 'https://wiki.girl.cafe/',
}
-- A page that is gone for good: the button that opens it does nothing.
-- The player survey of the English release (a Google form) is closed.
local CLOSED = {
	[pageKey('https://docs.google.com/forms/d/e/1FAIpQLSevCq76gs6OF2HooAP89RdtiaZ3gpyg0SjTWloMs00RjJESuA/viewform')] = true,
}

-- The address to open in place of url. nil: the page is closed, open nothing.
-- Every other value comes back as it is.
function P.Url(url)
	local key = pageKey(url)
	if not key then return url end
	if CLOSED[key] then
		print('[links] closed page, not opened: ' .. url)
		return nil
	end
	local moved = MOVED[key]
	if moved then
		print('[links] moved page: ' .. url .. ' -> ' .. moved)
		return moved
	end
	return url
end

-- Settings > Other: buttons with nothing behind them in the offline build.
--   Btn1, Btn2  Terms and Privacy: the publisher's account kit shows its own pages.
--   Btn7        Support: the publisher's help desk (a closed web form for this client).
-- The Chinese client (language zh_CN) also shows these; the English client hides them:
--   Btn13       the third-party SDK list, a page of game.bilibili.com.
--   Btn14       account deletion, the bilibili help desk game.bilibili.com/kf/.
--   Title2, List2  the row of the bilibili video editor: its button asks member.bilibili.com for a download
--               address, with the device id in the query.
P.HIDDEN = {
	'Content/List1/Grid/Btn1',
	'Content/List1/Grid/Btn2',
	'Content/List1/Grid/Btn7',
	'Content/List1/Grid/Btn13',
	'Content/List1/Grid/Btn14',
	'Content/Title2',
	'Content/List2',
}

-- Hides the buttons above under root (the Other page of the settings window).
-- A path that the page does not have is skipped.
function P.HideButtons(root)
	if not root then return 0 end
	local hidden = 0
	for _, path in ipairs(P.HIDDEN) do
		local node = root:Find(path)
		if node then
			node.gameObject:SetActive(false)
			hidden = hidden + 1
		end
	end
	print('[links] settings buttons hidden: ' .. hidden)
	return hidden
end

OfflineLinks = P
