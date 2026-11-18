# Save tool for playtests

Back the save up from the phone to your computer, put a stored save on the phone, or wipe it. A playtest
often needs a save at a known point (a new account, a chapter, a full roster); with this tool the saves are
files on your computer and the phone gets the one you need.

No game or server code takes part. The save is one file in the private storage of the app,
`files/gcg-server/data/state.json`, and the tool reads and writes it with `adb shell run-as`.

## What you need

- Python 3.10+ and `adb` (Android platform-tools). No Python packages.
- A phone with USB debugging on.
- **A playtest build of the APK.** Android lets `run-as` into the private storage of an app only when the APK
  is debuggable. The release build sets `android:debuggable="false"` on purpose, so on a release build the tool
  stops with a message and changes nothing. See "Playtest build" below.

## Commands

    python tools/save-tool/save_tool.py status
    python tools/save-tool/save_tool.py list
    python tools/save-tool/save_tool.py backup --label chapter-3
    python tools/save-tool/save_tool.py push chapter-3
    python tools/save-tool/save_tool.py wipe

| Command | What it does |
|---|---|
| `status` | Says whether the phone has a save, whether that save is stored on the computer, and lists the stored saves. |
| `list` | Lists the stored saves. Needs no phone. |
| `backup [--label L]` | Copies the phone's save to a new folder. The game may run. A save that is already stored (same hash) is not stored twice. |
| `push <save>` | Puts a stored save on the phone. `<save>` is a folder name from `list`, a part of one, a label, or a path to a `.json` file. |
| `wipe` | Removes the save on the phone. The game makes a new one at its next start. |

`push` and `wipe` stop the game first and back the phone's save up before they change anything, so no save is
lost. `push` copies the file as the app, renames it into place, reads it back and compares it.

The server keeps daily copies of the save next to it (`data/backups`), when the build has them. `backup` stores
them in `phone-daily-copies/`; `push` and `wipe` remove them on the phone, so that copies of two different saves
do not mix.

Options for every command: `--adb <program>` (default: `adb` on `PATH`), `--package <name>`,
`--store <folder>`.

## Where the saves are

`--store`, or `$GCG_SAVES`, or `saves/` next to `save_tool.py`. The tool writes nothing outside its own
folder, so deleting the folder removes everything. One folder per save:

    20261115-010829-chapter-3/
      state.json            the save
      info.json             time, label, phone model, size, sha256
      phone-daily-copies/   the server's daily copies at that time, if any

A save holds your account. The repository ignores `tools/save-tool/saves/`; a `--store` elsewhere must stay
out of any repository too. Older versions of the tool kept the saves in `gcg-offline-saves` in your home
folder: the tool prints a note while they are there and the new folder is empty. Move them, or pass `--store`.

## Playtest build

    python tools/save-tool/playtest_apk.py --apk GCG-Offline-v0.1.3.apk --out GCG-Offline-playtest.apk \
        --build-tools <Android SDK>/build-tools/<version> --ks my-key.p12 --ks-pass file:my-key-password.txt

It copies the APK, sets `android:debuggable` to true (four bytes of `AndroidManifest.xml`; nothing else in the
APK changes) and signs the copy with your key. It needs `zipalign` and `lib/apksigner.jar` from the Android
build-tools, and Java.

- **The signer changes.** Android installs an APK over another one only when both have the same signer. Going
  from the published APK to your playtest build needs an uninstall, and an uninstall deletes the save and the
  downloaded game data. After that, playtest builds with the same key install with `adb install -r` and keep
  everything. Published APK updates do not install over a playtest build.
- **Do not publish a playtest build.** On a debuggable build every computer with adb access to the phone can
  read and change the private files of the app.
- A build pipeline that signs with the release key can make the same APK without the signer change: it is the
  release APK with that one attribute set to true.

## Checks

    python tools/save-tool/test_save_tool.py

Runs without a phone: the commands against a phone kept in memory (backup, no double backup, wipe, push,
refusals, a release build), and the manifest change on a small binary manifest.

## Limits

- Tried on one phone (Galaxy S24+, Android 17). `run-as` is part of Android, but vendors differ.
- The tool does not look inside a save. A save from another server version is put on the phone as it is; the
  server decides whether it loads it. A save it refuses is still stored on the computer.
- One account per save file is assumed, as the release has it.
