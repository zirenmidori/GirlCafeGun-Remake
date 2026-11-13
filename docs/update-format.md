# Android release and update format v1

This is the shared packer/Android contract. Android 7/API 24 is the minimum.
Application ID: `com.zirenmidori.gcg.offline`. ARM32 and ARM64 native libraries
are retained from the owned input APK. No save, preferences, logs, account
database, signing private key, or host owner token belongs in a release.

## Authentication

The APK embeds `assets/gcg-release/publickey.der` (X.509 SubjectPublicKeyInfo RSA
public key), `manifest.json`, and `manifest.sig`. A manual `.gcgupdate` ZIP has
`manifest.json` and `manifest.sig` at its root. `manifest.sig` is a raw RSA
PKCS#1 v1.5 SHA-256 signature of the **exact UTF-8 manifest bytes**. Verify the
signature before interpreting its JSON. No JSON canonicalizer runs on Android.
All digests are lowercase SHA-256 hex. All byte counts and offsets are JSON
integers in [0, 2^53-1]. Paths use `/`, are relative, ASCII, and have no empty,
dot, dot-dot, backslash, colon, control, or leading slash components.

## Manifest

```json
{
  "schemaVersion": 1,
  "kind": "full",
  "packageName": "com.zirenmidori.gcg.offline",
  "releaseId": "1.0.0",
  "baseReleaseId": null,
  "minApkVersionCode": 10137,
  "files": [
    {"path":"setting.u","size":8088944,"sha256":"...","pack":"core-000"}
  ],
  "remove": [],
  "packs": [
    {"id":"core-000","url":"https://public-host/example.zip","size":123,"sha256":"..."}
  ],
  "serverPayload": null,
  "apk": null
}
```

`kind` is `full` for first-install complete asset provisioning, or `delta` for a
manual update. A delta requires `baseReleaseId` equal to the committed release;
`files` lists changed/new resources and `remove` lists explicitly deleted
resources. Unlisted resources stay unchanged. A full manifest lists the complete
approved resource set. The installed APK's versionCode must meet
`minApkVersionCode`; if an `apk` update is included it is installed first and the
remaining resource transaction resumes after the replacement APK starts.

Each downloaded pack is an independent ZIP (not split ZIP), at most 180 MiB;
its entries are the `path` values assigned to that pack, with no `files/`
prefix. Only the declared regular files are accepted, each checked by size and
SHA-256 while streaming. ZIP directory entries are optional. Unknown or duplicate
file members, traversal, excess expansion and undeclared data fail. Android
ZipFile does not expose Unix mode bits: extraction always creates regular files,
never symlinks; a link-shaped entry is only inert bytes and still must match an
explicit signed regular-file record. Existing filesystem symlinks are rejected.
Bootstrap URLs must be public HTTPS direct downloads. An incomplete `.part` is
resumable only with matching expected digest and HTTP Range response. No network
check or automatic upgrade occurs after full provisioning unless the user starts
an update; manual updates can be entirely offline.

In a manual ZIP, resource bytes are `files/<path>`, and `packs` is empty. Resource
names are a build-generated allowlist embedded in the signed full manifest.
Delta additions must be in the approved game-resource namespace (`*.u`, approved
`Raw/*.mp4`, the indexed `Raw/pv_sound.txt`, `AutoAudio/Android/*.bnk` or `*.wem`, and `version.data`). Private
paths and arbitrary code/files outside those namespaces are never writable.

Optional `serverPayload` is
`{"entry":"server/payload.zip","size":123,"sha256":"...","expandedSize":456,"entries":698}`.
It is a complete immutable server code/resources ZIP with the existing payload
layout, staged into private `gcg-server/payloads/<sha256>` and selected only on
commit. It must contain no `data/`, `logs/`, saves or account state. The persistent
`gcg-server/data/state.json` is outside every payload and every update allowlist.

## APK delta

The APK representation reconstructs the **entire exact signed APK byte stream**:

```json
{
  "sourceSha256":"...",
  "targetSha256":"...",
  "size":403150180,
  "versionCode":10138,
  "certificateSha256":"...",
  "ops":[
    {"kind":"copy","offset":0,"length":12345},
    {"kind":"literal","entry":"apk/000001.bin","offset":0,"length":321}
  ]
}
```

Copy offsets address the installed `ApplicationInfo.sourceDir` APK, using bounded
`RandomAccessFile` reads. Literal offsets address uncompressed bytes of the named
ZIP entry (normally offset0). Operations are ordered, lengths sum to `size`, and
the reconstructed file must match target SHA-256. Python can reuse raw compressed
member spans without a bzip2/native decoder; it must also include all ZIP headers,
alignment, APK signing block and central directory via copies or literals.

Before presenting installation, Android checks the reconstructed APK package,
strictly increasing versionCode, and signing certificate against the installed
app and the signed manifest. It streams into `PackageInstaller.Session`, fsyncs,
and handles `STATUS_PENDING_USER_ACTION` with official Android approval. API26+
uses the per-app unknown-source setting when needed. It never uninstalls, roots,
silently installs, or applies an OS/APK downgrade. Android owns APK atomicity;
APK+resource publication is coordinated by a resumable two-phase journal.

## Locally signed user-created data updates

A manual ZIP may include `publisher.der` with its signer's RSA public key. When
it differs from the embedded key, Android first verifies the signature and then
shows that key's SHA-256 fingerprint with an explicit **Trust once and apply**
choice. This is not persisted as a network trust anchor. Foreign publishers may
provide only local `delta` packages without an `apk` section; resource and server
payload path restrictions still apply. Unsigned ZIPs are never accepted.

## Online channel

The login Update screen checks the fixed
`https://raw.githubusercontent.com/zirenmidori/GirlCafeGun-Remake/main/channel.json`
only when the user taps **Check online**. Its JSON envelope is
`{"payload":"<base64 exact UTF-8 descriptor>","signature":"<base64 raw RSA signature>"}`.
The descriptor contains `schemaVersion:1`, `packageName`, `releaseId`, `url`,
`size`, and `sha256` for one `.gcgupdate` package. Both envelope and downloaded
package must verify with the embedded publisher key. The imported package is
then reviewed in the same confirmation UI as a local package.

## Transaction and restart

Unity must be cold/stopped before publication. Updates run in the dedicated
`:releaseupdater` process; the game process cooperatively closes and terminates
before apply. Resources stage on the same external-files volume as their final
paths. Every changed/deleted preimage is copied to a transaction backup and
hashed. A complete durable private rollback plan is written before any publication;
`version.data` publishes last. The committed release marker is written only after
all actual destination hashes match. Server payload activation is part of that
commit. On interruption, bootstrap recovers/rolls back before starting Unity.
Profiles and preferences are neither restored nor replaced by asset rollback.

Import UI first scans the app's own `files/updates/*.gcgupdate`; system document
picker (`ACTION_OPEN_DOCUMENT`, ZIP/octet-stream) imports from Downloads or a
provider into app-private staging. It never asks SAF to open Android/data (blocked
on Android11+) and does not require all-files access. No PC/server selector exists.
