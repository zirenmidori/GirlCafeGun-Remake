# Build the release

The repository contains source and recipes. You must supply the owned game APK,
resource archives and SDK components used as build inputs. Generated APKs, game
assets and signing secrets are intentionally excluded from Git.

## Server

Use Node.js 22 or newer and pnpm. In `server/`, install from the lockfile, then
run `pnpm test`, `pnpm lint`, and `pnpm build`. Production Android configuration
is `server/config/release.json`; the generic desktop configuration remains useful
for development. The production account identity is confined to the Android
app-private save; no sample player database is shipped.

`release/tools/build-server-payload.py` compiles the canonical TypeScript and
packages an allowlist of runtime modules, configuration, tables and dependencies.
It excludes development tools, profiles, state and logs. The payload is immutable;
the app keeps `data/state.json` in a separate private directory. Keep that
separation when creating future server updates.

## Android and client

Use Python 3.10+, JDK 21, Android SDK build-tools 32.0.0 and the Android 33 compile
platform. Compilation targets Java 8 bytecode and Android API 24. Set `GCG_JAVA`
and `GCG_ANDROID_SDK` to their installation locations when needed.

The client recipes operate on a hash-pinned input and produce an overlay rather
than editing the original. Both ARM libraries retain the Unity allocator and
Cubism compatibility fixes. Native developer entry points are disabled before
their UI, socket or command paths execute; developer Lua and UI content are
removed. The launcher, embedded server, resource installer and updater are Java
source under `release/android/`.

Generate and host the complete data packs, set their actual HTTPS direct URLs in
the full manifest, then sign its exact bytes with `release/tools/release_crypto.py`.
Do not publish a bootstrap manifest with placeholder URLs. The build command is:

```sh
python release/tools/build_android_release.py --input inputs/game.apk --input-sha256 EXPECTED_SHA256 --client-overlay inputs/apk-overlay.json --server-payload release/work/server/payload.zip --manifest inputs/manifest.json --manifest-signature inputs/manifest.sig --output release/artifacts/GCG-Offline.apk
```

The APK is signed with the identity in `release/private/signing/`, verified with
Android's signer and alignment tools, and checked for package identity, API
minimum, both ARM library sets, permissions and exact overlay readback. Keep the
private signing identity backed up outside the public repository. Losing it
prevents normal APK upgrades to the installed application.

Android's `versionName` remains `1.1.36` for the original game protocol. The
independent offline release ID is stored in the signed release manifest.

## Validation

```sh
python -B -m unittest discover -s release/tests -p "test_*.py" -v
```

Server tests exercise gameplay transactions and the real local TCP protocol.
Updater tests use production Java classes with host-only Android stubs for
signature checks, verified resource publication, interruption/recovery, profile
preservation and exact APK reconstruction. They do not replace device tests of
Unity, Android's document picker or PackageInstaller confirmation.

## Publication

Publish source with an explicit allowlist. Never commit APKs, caches, game
art/audio/video, extracted binaries, `data/`, `logs/`, account catalogs, phone
backups, host credentials or private keys. Use the export report to review every
published file. External hosting and GitHub source publication are independent.
