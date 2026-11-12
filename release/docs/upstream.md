# Upstream sources

The canonical server is the TypeScript `Yricky/new-cafe` checkout at
`a2614e2dead9072e8c5631f77b9745a39fccefd1`, with the existing local gameplay
extensions retained. Its server license is CC0-1.0.

The [GirlCafeGun-Offline server](https://github.com/BlackrUSter4/GirlCafeGun-Offline)
was reviewed at main commit `a357bc45dc8ca0569441d5d37764a0e4e0be14b9`.
Its C# source informed MOD costs, progression gates and protocol behavior.
It was adapted to this server's atomic JSON transactions. The MIT notice,
copyright 2025 luoxiadesu, is retained in `server/LICENSES/SssjServer-MIT.txt`
and in the embedded payload. Upstream tooling and documentation have a separate
MIT notice, copyright 2026 GCG2-Offline contributors. These licenses do not
license the game's art, audio, binaries, trademarks or other game assets.

The complete pull request inventory at review time contained one open request,
zero closed requests, and no review or conversation comments:
[PR #1](https://github.com/BlackrUSter4/GirlCafeGun-Offline/pull/1), 53 files and
18 commits, head `f2772356566214000630cba227a67ecf1cc2ac24`. It was unmerged.
The request concerns phone packaging, controller input, local pages, purchases,
event rewards and transaction hardening; it contains no Neptune or MOD fix.
Potentially useful references, rather than changes blindly copied into this release:

- [88c397d](https://github.com/BlackrUSter4/GirlCafeGun-Offline/commit/88c397df641a1de19daba9c352aefc459682974c): gacha snapshots, stack consumption and arithmetic guards.
- [ba40bca](https://github.com/BlackrUSter4/GirlCafeGun-Offline/commit/ba40bcacb31bbba92206e809261e3b13313c18db): preserve committed state when response sending fails.
- [d46a615](https://github.com/BlackrUSter4/GirlCafeGun-Offline/commit/d46a615f90668393ad4c4e97d9112cee5f871b2d): activity achievements and login-day rewards.
- [5a66d20](https://github.com/BlackrUSter4/GirlCafeGun-Offline/commit/5a66d204db734bc78fabc7704c4d1abcd8d26883): offline purchases and shop arithmetic.

The local extracted C# reference and upstream have identical normalized source
for `RuneFeature.cs` (Git blob `aca74fc4cd2fc57bd9a6c6a788741d7c63f1a68d`) and
`RuneTable.cs` (`ac703fd32ded6cff980bbd24a7f1282e220b6920`). We corrected several
gaps rather than reproducing them: skills now unlock during enhancement;
revision preserves active and proposed skills separately; discarding a revision
really keeps the old skills; and breakthrough validates the submitted material
GUIDs. The client already supports active type-2 and pending type-6 skill entries.

Welcome rewards use their own persistent campaign marker, independent of other
mail and surviving message deletion. The fixed local account starts a fresh
tutorial save; development profiles and trial-state copying are not shipped.
