# Girl Cafe Gun Re:make

Release **0.1.0**. See [validation and compatibility](docs/release-status.md).

GCG Offline runs its game server on the Android device. A PC, USB connection and
server-address configuration are not needed. The first login creates a fresh
local player; later logins return to that same player. The release contains no
development profiles or personal saves, and no GM console.

Android 7.0 or newer and an ARM32 or ARM64 device are required. The first data
installation needs approximately **8 GB free space**; leave more room for Android,
future updates and temporary files. Installed game resources occupy roughly
6.1 GB, with approximately 5.5 GB downloaded for the first installation.

## Install

**The APK's automatic data download is the easiest setup method.** Install the
release APK, open Girl Cafe Gun, and approve the initial data download. The
installer shows overall percentage and downloaded/total size. Keep it open until
download and verification finish. Choosing **Not now** postpones the download;
an interrupted download can be resumed. Once the initial data is installed,
ordinary play does not require an Internet connection.

Each new player receives a one-time welcome mail containing Legendary Neptune
and the Astral Covenant weapon. Claim it from the in-game mailbox when mail is
available. Both rewards start at their normal base level. Development inventories
are not included.

This repository contains source code, build/update tools and documentation.
The game APK, artwork, audio, video, native game binaries and data packs are
distributed separately and are not included here.

## Manual data setup

1. Install the release APK. Open it once to create its storage directory, then
   close it before copying data.
2. Obtain all data packs for the **same release as the APK**. Extract every pack
   into `Android/data/com.zirenmidori.gcg.offline/files/` on the phone's shared
   storage. Retain their internal directories.
3. `version.data`, `setting.u`, `lua.u`, `AutoAudio/`, `Raw/` and the other resource
   directories belong directly under `files/`. Do not add an extra enclosing
   `files`, pack-name or release-name directory.
4. Reopen Girl Cafe Gun. It verifies the data before starting the local server.
   Complete matching files are adopted without a download prompt. If files are
   missing or incorrect, the app asks before downloading the needed packs.

On recent Android versions, file managers and the system picker may be unable to
browse `Android/data`. A USB connection to a computer is a practical alternative
for manually placing the initial resources. Automatic setup avoids this step.
Do not copy another player's app-private data or saves into the release.

## Install updates

Update files can be found on Discord under **#update**, or you can **create
updates yourself** using the included tools. An update is a `.gcgupdate` file
containing changed resources and, when necessary, an app delta or server update.
Use a package made for your currently installed base release.

Open **Update** on the login screen. Choose one:

- **Check online** to check the publisher's signed update channel manually.
- **Updates in game folder** after placing the `.gcgupdate` file in
  `Android/data/com.zirenmidori.gcg.offline/files/updates/`.
- **Choose update file** to select a package from Downloads or another document
  provider. Android grants access to the selected file through its picker;
  all-files storage permission is not required.

Follow the update prompt and return to the game when it finishes. An APK change
also requires Android's normal installation approval; Android 8 and newer may
ask you to allow this app to request installation. Never uninstall the game to
apply an update: uninstalling can remove the local profile. Updates preserve the
profile, verify their publisher and content, and recover interrupted resource
transactions before the game starts.

## Create an update

See [the update format](docs/update-format.md) and
[the update-building guide](docs/creating-updates.md). The tools create deltas
instead of repackaging the complete game data. A community data-only package can
use its own publisher key; the player must explicitly trust its displayed key
fingerprint for that import. Community packages cannot replace the APK.

## Source layout and development

The TypeScript server retains its repository structure under `server/`.
`release/android/` contains the local launcher and transactional updater;
`release/client/` contains the release client patch recipes; `release/tools/`
contains the packaging and signing tools. Build outputs and private signing keys
stay outside source control. See [building](docs/building.md) and
[upstream notes](docs/upstream.md).

The server is CC0-1.0, with retained MIT notices for adapted upstream code.
Game assets and third-party SDKs retain their respective owners' rights; the
source license does not grant rights to those assets. See [third-party notices](THIRD_PARTY_NOTICES.md).
