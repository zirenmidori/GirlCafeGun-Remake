-- Local pages for the web windows of the client.
-- release/client/patch_offline_web.py places this file in Lib.lua and calls it from the windows.
-- Ported from the GirlCafeGun-Offline phone build (MIT, GCG2-Offline contributors).
local P = {}

-- envir.json of the release names the local server, with no page, for every web window:
-- "http://127.0.0.1:28080/". The server has no page at that address.
local LOCAL_HOSTS = { ['127.0.0.1'] = true, ['localhost'] = true, ['[::1]'] = true }

-- The address with the page, when the address is one of the local server and names no page.
local function withPage(url, page)
	if type(url) ~= 'string' or type(page) ~= 'string' then return nil end
	local scheme, authority, rest = string.match(url, '^(%a[%w+.-]*)://([^/?#]*)(.*)$')
	if not scheme then return nil end
	local kind = string.lower(scheme)
	if kind ~= 'http' and kind ~= 'https' then return nil end
	local host = string.lower((string.gsub(authority, ':%d*$', '')))
	if not LOCAL_HOSTS[host] then return nil end
	local tail = string.match(rest, '^/?([?#].*)$') or (string.match(rest, '^/?$') and '')
	if not tail then return nil end
	return string.sub(url, 1, string.len(scheme) + 3 + string.len(authority)) .. '/' .. page .. tail
end

-- An address of the local server that names no page gets the page of the window that asks.
-- A query stays (the windows add the time to it). Every other address stays as it is.
function P.Url(url, page)
	local mapped = withPage(url, page)
	if not mapped then return url end
	print('[web] local page: ' .. page)
	return mapped
end

-- The text of the server-error window. That window opens when the local server does not answer,
-- so the text is here and not on the server. The page has no '#' and no '%': some load paths of a
-- web view read them as address syntax.
function P.ErrorHtml()
	return [==[<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
body{margin:0;padding:16px;background:rgb(243,245,248);color:rgb(43,48,56);font:15px/1.7 Roboto,Arial,sans-serif}
.box{max-width:560px;margin:0 auto;background:white;border-radius:4px;padding:20px 24px}
h1{font-size:19px;margin:0 0 10px;color:rgb(11,123,176)}
ol{margin:8px 0 0;padding-left:22px}
.tip{color:rgb(95,107,122);font-size:12px;margin:14px 0 0}
</style></head><body><div class="box">
<h1>The game server did not answer</h1>
<p>This is the offline build. The game server runs inside the app on this device. It needs no internet.</p>
<ol>
<li>Close the game fully (remove it from the recent apps list).</li>
<li>Open the game again and wait at the title screen for a few seconds.</li>
<li>If the error stays, restart the device.</li>
</ol>
<p class="tip">Your save data stays on the device. This error does not delete it.</p>
</div></body></html>]==]
end

-- The server-error window. An address of another host loads as in the stock window. For the
-- address of the local server the web view shows the text above. A web view that cannot take a
-- text loads the page of the local server with that text.
function P.LoadError(view, url)
	local page = withPage(url, 'web/maintenance/index.html')
	if not page then
		view:Load(url)
		return
	end
	local ok, err = pcall(function() view:LoadHTMLString(P.ErrorHtml(), '', false) end)
	if ok then
		print('[web] server error: text shown')
		return
	end
	print('[web] server error: text not shown, the page is loaded: ' .. tostring(err))
	view:Load(page)
end

OfflineWeb = P
