#!/usr/bin/env python3
"""One-step launcher for the story editor.

Run it (or double-click start.cmd). It does everything the first time:
  1. makes a private Python environment in work/venv,
  2. installs the packages from requirements.txt if they are missing,
  3. asks for the game data folder once and remembers it (work/config.json),
  4. offers to download the Live2D runtime once (needed only to draw characters),
  5. starts the editor and opens the page.
Next runs skip every step that is already done. Extra options go to story_editor.py
(for example: --official <lang.u> --rebuild --port 4311). Nothing outside work/ is written.
"""
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
VENV = WORK / "venv"
CONFIG = WORK / "config.json"
CORE = WORK / "vendor" / "live2dcubismcore.min.js"
CORE_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
MARKER_FILES = ("setting.u", "lang.u")


def say(text):
    print("[story-editor] " + text, flush=True)


def venv_python():
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], **kw)


def ensure_venv():
    py = venv_python()
    if py.exists() and run([py, "-c", "import sys"], capture_output=True).returncode == 0:
        return py
    say("Creating the Python environment (first run only) ...")
    if VENV.exists():
        import shutil
        shutil.rmtree(VENV, ignore_errors=True)
    WORK.mkdir(exist_ok=True)
    r = run([sys.executable, "-m", "venv", VENV])
    if r.returncode != 0 or not py.exists():
        sys.exit("Could not create the environment. On Linux install the 'python3-venv' package, then run again.")
    return py


def ensure_packages(py):
    ok = run([py, "-c", "import UnityPy"], capture_output=True).returncode == 0
    if ok:
        return
    say("Installing the required packages (UnityPy) ...")
    r = run([py, "-m", "pip", "install", "--disable-pip-version-check", "-r", HERE / "requirements.txt"])
    if r.returncode != 0:
        sys.exit("Package install failed (see the messages above). Check the internet connection and run again.")
    if run([py, "-c", "import UnityPy"], capture_output=True).returncode != 0:
        sys.exit("UnityPy still cannot be imported after the install.")


def load_config():
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    WORK.mkdir(exist_ok=True)
    CONFIG.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def looks_like_data(folder):
    return folder.is_dir() and all((folder / f).exists() for f in MARKER_FILES)


def ask_data_folder(cfg):
    say("Which folder holds the game data (it contains setting.u and lang.u)?")
    say("This is the app's 'files' folder, or where you unpacked the data packs.")
    while True:
        try:
            text = input("Game data folder: ").strip().strip('"')
        except EOFError:
            sys.exit("No game data folder given. Start again with: --data <folder>")
        folder = Path(text).expanduser()
        if looks_like_data(folder):
            cfg["data"] = str(folder.resolve())
            save_config(cfg)
            return cfg["data"]
        say("That folder has no setting.u and lang.u. Try again (Ctrl+C to quit).")


def offer_live2d(cfg):
    if CORE.exists() or cfg.get("live2d") == "no":
        return
    say("Characters need the Live2D Cubism Core, which Live2D publishes under its own licence")
    say("(https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).")
    try:
        answer = input("Download it now into work/vendor? [y/N]: ").strip().lower()
    except EOFError:
        answer = ""
    if answer != "y":
        cfg["live2d"] = "no"
        save_config(cfg)
        say("Skipped. The editor works; the characters checkbox does nothing. Delete work/config.json to be asked again.")
        return
    try:
        CORE.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(CORE_URL, timeout=60) as resp:
            CORE.write_bytes(resp.read())
        say("Live2D runtime saved.")
    except Exception as exc:  # network errors vary
        say("Download failed (%s). Put the file there by hand: %s" % (exc, CORE))


def main():
    if sys.version_info < (3, 10):
        sys.exit("Python 3.10 or newer is needed. This is %s." % sys.version.split()[0])
    args = sys.argv[1:]
    py = ensure_venv()
    ensure_packages(py)
    cfg = load_config()

    needs_data = not any(a == "--data" or a.startswith("--data=") for a in args) and not os.environ.get("GCG_DATA")
    if needs_data:
        data = cfg.get("data")
        if not data or not looks_like_data(Path(data)):
            data = ask_data_folder(cfg)
        args = ["--data", data] + args
    if "--open" not in args and "--export" not in args and "--no-open" not in args:
        args.append("--open")
    args = [a for a in args if a != "--no-open"]
    offer_live2d(cfg)

    say("Starting. Page: http://127.0.0.1:4310 (Ctrl+C stops it).")
    env = dict(os.environ, PYTHONUTF8="1")
    try:
        rc = run([py, "-X", "utf8", HERE / "story_editor.py"] + args, env=env).returncode
    except KeyboardInterrupt:
        rc = 0
    sys.exit(rc)


if __name__ == "__main__":
    main()
