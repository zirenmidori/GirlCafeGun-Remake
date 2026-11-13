# Release 0.1.0 validation

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
