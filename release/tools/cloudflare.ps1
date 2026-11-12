# Official CLI launcher; credentials, logs, caches and temporary files stay on D:.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$WranglerArgs)
$ReleaseRoot=Split-Path -Parent $PSScriptRoot
$env:XDG_CONFIG_HOME=Join-Path $ReleaseRoot 'private/cloudflare'
$env:XDG_CACHE_HOME=Join-Path $ReleaseRoot 'work/cloudflare-cache'
$env:XDG_DATA_HOME=Join-Path $ReleaseRoot 'private/cloudflare/data'
$env:WRANGLER_LOG_PATH=Join-Path $ReleaseRoot 'private/cloudflare/logs'
$env:WRANGLER_CACHE_DIR=Join-Path $ReleaseRoot 'work/cloudflare-cache/wrangler'
$env:WRANGLER_SEND_METRICS='false'
$env:WRANGLER_SEND_ERROR_REPORTS='false'
$env:TEMP=Join-Path $ReleaseRoot 'work/cloudflare-tmp'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$Wrangler=Join-Path $ReleaseRoot 'work/cloudflare-cli/node_modules/wrangler/bin/wrangler.js'
& node $Wrangler @WranglerArgs
exit $LASTEXITCODE
