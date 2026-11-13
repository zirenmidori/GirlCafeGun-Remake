# Release validation

## Release 0.1.2

New players receive 200 character draws and 200 weapon draws in the existing
one-time welcome mail. Existing profiles receive no retroactive welcome tickets.
Railgun is permanent with all four collaboration cards. The weekly rotation
covers the independently audited 222 eligible characters and 134 weapons in
182 days, including Legendary Neptune and excluding oath/gameplay cards.

Daily mail budgets 50 draws per weekly banner and 10 per other banner: currently
70 character and 60 weapon draws. Every 100 qualifying rotation draws earns a
category-specific selector. Independent counters carry partial progress across
weeks; boxes retain the original lineup permanently. Ordinary RNG and pity are
unchanged. Railgun's existing 300-pull selector is also redeemable.

The broader server suite passed 410 tests. Final affected checks passed 26 tests,
including real TCP draws, selector redemption, failed-cost rollback, replay
rejection, persistence and old boxes after weekly rollover. The clean extracted
server ZIP independently passed fresh/existing-player mail checks and 100 actual
draws and selector redemption in each category, without importing development
server modules or including test saves.

Neptune now uses a stock-size 203×268 thumbnail and separate original 1920×1080
landscape artwork. Collection framing, the expanded view, codex and all three
post-combat styles have explicit settings. Actual retained expanded-view Lua
passed at three screen ratios. Native selector UI ordering, error handling and
progress were exercised in Lua; 52 new items and 167 options preserve the
server's exact order. All 117,441 existing translations remain unchanged.

The signed APK retains API 24, both ARM variants, all 31 native libraries and all
Live2D bundles byte-for-byte. Both base-specific updates reconstructed its exact
bytes locally. Twenty-five production Java updater checks, thirteen hosting
checks, six delta checks, four channel checks and four download-page checks
passed. The updater now selects a compatible signed data-base route before
downloading.

Public-host verification passed on 2026-11-13: all 34 packs returned exact
metadata and range bytes; the three changed pack bodies, full 405,366,349-byte
APK, both signed deltas, manifests, checksums and download page matched their
local SHA-256 values. The signed channel matched both the current repository
and legacy channel. Previous installer links redirect to 0.1.2 with no-store;
hosted old APK parts were still present at verification time.

The prior 0.1.0 and 0.1.1 local APKs are removed to save space; exact private
rollback archives remain and were verified restorable. Phone rendering and
full in-game selector playtest remain pending until the user reconnects the device.
The 0.1.1 device results below remain historical evidence.

## Release 0.1.1

This update repairs the client's offline login gate. Unity's reported network
availability previously blocked login before trying the on-phone server when
Wi-Fi and mobile data were unavailable. The bypass is limited to the validated
local gateway at `127.0.0.1:31400`; actual socket failures retain normal error
handling. It does not change native libraries, ABI support or the Android API
minimum.

The release also changes artifact hosting to the `zirenmidori.workers.dev`
subdomain and the manual update channel to the renamed `GirlCafeGun-Remake`
source repository. The signed 0.1.0-to-0.1.1 package pairs the APK delta with
changed resources while preserving profiles and unchanged data packs.

Lua checks exercise the patched `Connect()` path with no reported network,
actual connection failure, invalid/mixed/remote gateways, a disabled server and
the original online remote behavior. The generated bundle changes only
`UI_Login.lua`; its other 833 Unity objects remain byte-identical. The signed
0.1.1 APK and paired resource update were installed on the ARM64 phone. The
original error was reproduced with no active network; both login and login
after a full app/server restart then reached the opening story without a
network connection. Normal protocol checks before and after retained the same
level-1 player, inventory and unclaimed welcome rewards. The game was left
closed, and the separate private test app was untouched.

All 31 native libraries and the server payload are byte-identical to 0.1.0.
The signed delta reconstructed the exact 405,366,349-byte target APK locally;
its paired resources were applied through the game's update-folder menu on the
phone. Android API 24 and both ARM library sets remain supported. All 34 packs
passed headers and exact byte-range checks on the new host. Both changed packs,
the complete APK and the 8,217,867-byte signed update matched their local SHA-256
hashes; APK ranges across the storage-part boundary also matched. Public
metadata matched exactly, and private APK part URLs returned 404. Unchanged
packs retain the complete SHA-256 verification recorded for 0.1.0.

## Release 0.1.0

The clean APK completed its full automatic data installation on the ARM64
playtest phone. Download approval, postponement/retry, overall progress, partial
download resume, local server startup, first login and a cold restart were
verified. The original private test app and its profiles remain separate.

The phone's fresh profile remained level 1 with its three starter cards. Its
one-time welcome mail contained one Neptune card and one Astral Covenant weapon,
unclaimed. Normal TCP logins before and after server updates/restarts kept the
same player, inventory and mailbox. Separate packaged-server tests verified
claiming the rewards once and retaining them after restart.

All 34 initial data packs are hosted on Cloudflare R2 through a read-only HTTPS
download endpoint. Every complete hosted pack passed SHA-256 readback and exact
HTTP Range checks. The signed bootstrap contains their actual direct URLs.
The complete public APK also passed full SHA-256 readback and byte-range checks,
including a range across its storage-part boundary. Matching manually placed
initial data is verified and adopted without downloading; this path is covered
by production-Java tests.

On the phone, a signed server update was imported through Android's document
picker and applied successfully. Another update was found in the game folder
and restored the published release identifier. The manual online check verified
the signed channel and reported the current release. A 205,809-byte APK delta
reconstructed and verified a 405,362,253-byte target APK on the phone. Installation
was deliberately cancelled at the Android installation-permission step; an
actual APK replacement through PackageInstaller was not performed in this pass.

Server gameplay/transaction checks, 20 production-Java updater checks, 6 Python
delta/signature checks and 11 hosting checks passed. The build retains both ARM
library sets and Android API 24 compatibility, with v1/v2/v3 APK signatures.
This release was physically tested on ARM64; ARM32 and Android 7 compatibility
checks were static/host checks, not additional physical-device playtests.

Data reconstruction retains the original legacy Wwise wrapper index entries;
many wrappers are absent from every supplied distribution while raw Android
bank/media files are present. Missing legacy wrappers are not replaced with
fabricated content. Full mode-by-mode and long-session gameplay testing remains
part of the ongoing playtest.

The original developer APK, cache and source checkpoint are preserved privately.
The clean package has a different application ID and does not reuse personal
test profiles.
