# Story editor

A local page for translators. It shows every main-story and event-story cutscene of Girl Cafe Gun the way the game
lists it, lets you rewrite the text, and tags each line as original English, machine translated or human translated.

This folder holds code only. It reads the game data you already have; no game text, picture or model is in the
repository.

## Start

    python tools/story-editor/story_editor.py --data <game data folder> --open

The page is http://127.0.0.1:4310 (this computer only). `Ctrl+C` stops it.

- **Game data folder**: the folder that holds `com.u`, `setting.u`, `lang.u`, `bg/`, `l2d/` and the other
  resource folders. That is the app's `files/` folder, or the place where you unpacked the data packs.
  `GCG_DATA` can replace `--data`.
- Needs Python 3.10+ with [UnityPy](https://pypi.org/project/UnityPy/) (`pip install UnityPy`) and a browser with
  WebGL. The first start reads the bundles (a few seconds) and keeps the result in `work/cache`.

| Option | Meaning |
|---|---|
| `--lang FILE` | text table to show and to patch (default: `<data>/lang.u`) |
| `--official FILE` | an official English `lang.u`, or an `.obb` / `.apk` / `.zip` that holds `assets/lang.u`. Give it more than once for more tables. |
| `--archive FILE` | `.obb` or `.zip` with `assets/<path>`; used for every file the data folder does not have |
| `--port N` | default 4310 |
| `--rebuild` | read the data again |
| `--export` | write the export (see Data) and exit |

## What it shows

- **Main story**: chapters and stages from `map/chapter.txt` in `setting.u` (normal mode; hard mode and the third
  mode have no story), with the scene before and after each stage, plus the interludes of the in-game story archive
  (`guide/riki.txt`, type 6).
- **Event stories**: the events of the story archive, in the archive's order, with the archive's titles.
  "hidden in EN" marks an event that the English archive hides.
- **Unlisted**: scripts in the `main*` and `activity*` script folders that neither table lists.
- **Play** runs the scene script (`com.u`, `cartoon/<scene>.txt`): scene title, speaker, text, choices and branches,
  with the pictures the script shows. **Script** lists all lines of the scene. Double-click a script line to play
  from it.
- Pictures are layers with the script's stacking order, zoom, position and pan time. Three checkboxes switch them:
  **backgrounds**, **CG and pictures** (CG illustrations, card art, boss and NPC art, overlays) and **characters**
  (Live2D models).

Not shown: character motions and expressions, effects, voice, music and video (music and video show as a cue name).

How a line gets its text: a script line is `call set_speaker_and_play1 (<speaker>, mytext, <key>)`, and `<key>` is
looked up in the language table of `lang.u` (one `FileLangContent` object with a key array and a value array).

## Tags

- **Original English**: the text equals the text of an official table (`--official`).
- **Machine translated**: the text is English but is not in an official table.
- **Human translated**: the text was changed in this tool. You can also set any tag by hand.
- **Not translated** / **No text**: the line holds Chinese or Japanese, or the script names a key that has no text.
- **No tag**: no official table was given, so the tool cannot tell original from machine translated text.

When an official table holds Chinese or Japanese for a line, the editor shows it as the source text.

## Characters need the Live2D runtime

The models are Live2D Cubism 3 files (`l2d/girlNN/l2dNN.u`). The page draws them with the official Live2D Cubism
Core. Live2D's licence does not allow that file in a public repository, so put it here yourself:

    tools/story-editor/work/vendor/live2dcubismcore.min.js
    (from https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js)

Without the file the tool works, and the characters checkbox does nothing.

- Characters are drawn once in their default pose, with the eyes open, at the script's position and size. The
  **size** and **height** sliders correct the placement (the screen mapping is a guess: one model unit = scale/10 of
  the screen height).
- **Model repair.** The model files of the game hold about 6 to 14 values each that cannot be right (a flag that is
  13, a begin index outside its table, a count that runs into the next slice, a triangle index beyond its mesh). The
  current runtime crashes or hangs on them. `moc3_repair.py` works out the right value from the redundancy of the
  format (a begin index is the end of the slice before it; an object has one keyform for every combination of the
  keys of its parameters) and fixes the copy in the cache, never the game file. The changes are listed in
  `work/cache/l2d/<model>/meta.json` (`repaired`). `python tools/story-editor/moc3_repair.py <in.moc3> [<out.moc3>]`
  runs it on one file.
- The runtime works in a web worker with a 12 s limit. When it still fails on a model, or the outfit is in no bundle,
  the nearest other outfit of the same character stands in (the tooltip of the character says so). Outfit 0 never
  stands in: it is the bare base body.

## Data

- The server reads the game data again when a file changes (checked on page load and when the page gets the focus),
  so a data update shows up without a restart. Edits are stored by text key and stay.
- Edits: `work/edits.json` (key, text, tag, time). Nothing outside `work/` is written. Keep a copy of this file; it
  is the translator's work.
- **Export lang.u** writes `work/export/lang.u` (the text table with the edited lines; a line for a key with no text
  is added) and `work/export/story-edits.json`. The export is read back and compared before it is written. Use the
  file as `changes/lang.u` of an update (`docs/creating-updates.md`).
- Caches are in `work/cache` (scene data, pictures, models: about 5 to 20 MB per character model). Delete it at any
  time. `work/` is in `.gitignore`.

## What was tested

- English 1.0.9 data with the last official hot update: 818 scenes, 28,247 story lines; play, branches, edit, tags,
  search, export (read back: only the edited line differs); CG layers; the 25 most used character models.
- The `setting.u` and `lang.u` of the 0.1.3 APK together with the English `com.u`: the same 818 scenes load and the
  export holds 117,545 entries.
- Not tested: the `com.u` and the data packs of 0.1.3, and the 162 less used character models.
