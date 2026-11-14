#!/usr/bin/env python3
"""Story viewer and translation editor for Girl Cafe Gun (main story and event stories).

Reads the game data (read-only), shows every story cutscene the way the game lists it, lets a translator rewrite the
text, and tags each line as original English, machine translated or human translated.

  python tools/story-editor/story_editor.py --data <game data folder>
      the folder that holds com.u, setting.u, lang.u, bg/, l2d/ ... (the app's files/ folder, or the unpacked data packs)

  --lang FILE       text table to show and to patch (default: <data>/lang.u)
  --official FILE   an official English lang.u, or an .obb/.apk/.zip that holds assets/lang.u; may be given more
                    than once. A line that equals an official text is tagged "original English".
  --archive FILE    .obb or .zip with assets/<path>: used for every file the data folder does not have
  --port N          default 4310          --open     open the page in the default browser
  --rebuild         read the data again   --export   write work/export/lang.u and story-edits.json, then exit

GCG_DATA can replace --data. Nothing outside tools/story-editor/work/ is written. See README.md in this folder.
"""
import argparse
import collections
import datetime
import hashlib
import io
import json
import os
import re
import struct
import sys
import threading
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import moc3_repair  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
CFG = {"data": None, "archive": None, "lang": None, "official": [], "label": "data"}   # set by configure()
SEED = 0x166920ED
CACHE_VERSION = 6

CJK = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]")
CJK_WORD = re.compile(r"[㐀-䶿一-鿿]{2,}|[ぁ-ゖァ-ヺ]{3,}")
HAN = re.compile(r"[㐀-䶿一-鿿]")
LATIN = re.compile(r"[A-Za-z]")
RUN = re.compile(r"[A-Za-z0-9_./\-]+")
TAGS = ("original", "machine", "human")


def is_cjk_text(v):
    """True when the value holds a Chinese or Japanese word (an emoticon such as (ゝω☆) does not count)."""
    if not v or not CJK.search(v):
        return False
    return bool(CJK_WORD.search(v)) or (bool(HAN.search(v)) and not LATIN.search(v))


# ------------------------------------------------------------------ bundle access
def swap(data):
    """Game.BundleEncrypt (setting.u, lua.u). The routine is its own inverse."""
    d = bytearray(data)
    for i in range(2, len(d), 4):
        j = i - 1
        if SEED % j < j // 3:
            d[j], d[i] = d[i], d[j]
    return bytes(d)


def data_path(*parts):
    return os.path.join(CFG["data"], *parts) if CFG["data"] else None


def archive_read(rel):
    """A file of the fallback archive (assets/<rel>), or None."""
    if not CFG["archive"]:
        return None
    try:
        with zipfile.ZipFile(CFG["archive"]) as z:
            return z.read("assets/" + rel)
    except KeyError:
        return None


def game_file(rel):
    """Bytes of a game data file: from the data folder, else from the archive, else None."""
    q = data_path(*rel.split("/"))
    if q and os.path.exists(q):
        with open(q, "rb") as f:
            return f.read()
    return archive_read(rel)


def source_of(rel):
    """Where a game data file comes from: a path, or ('zip', archive, member)."""
    q = data_path(*rel.split("/"))
    if q and os.path.exists(q):
        return q
    if CFG["archive"]:
        return ("zip", CFG["archive"], "assets/" + rel)
    sys.exit("%s is not in the game data folder %s" % (rel, CFG["data"]))


def table_source(path):
    """A lang.u file, or an archive (.obb, .apk, .zip) that holds assets/lang.u."""
    if path.lower().endswith((".obb", ".apk", ".zip")):
        return ("zip", path, "assets/lang.u")
    return path


def read_source(spec):
    """spec = a file path, or ('zip', archive, member)."""
    if isinstance(spec, tuple):
        with zipfile.ZipFile(spec[1]) as z:
            return z.read(spec[2])
    with open(spec, "rb") as f:
        return f.read()


def source_stamp(spec):
    p = spec[1] if isinstance(spec, tuple) else spec
    st = os.stat(p)
    return [p if not isinstance(spec, tuple) else p + "::" + spec[2], st.st_size, int(st.st_mtime)]


def source_name(spec):
    return spec if isinstance(spec, str) else spec[1] + "::" + spec[2]


def load_env(data):
    import UnityPy
    try:
        env = UnityPy.load(data)
        if env.objects:
            return env
    except Exception:
        pass
    return UnityPy.load(swap(data))


def text_assets(data, prefix):
    """{path below prefix (lower case): text} for every TextAsset of a bundle."""
    env = load_env(data)
    path_of = {obj.path_id: path for path, obj in env.container.items()}
    out = {}
    for o in env.objects:
        if o.type.name != "TextAsset":
            continue
        p = path_of.get(o.path_id, "").lower()
        if not p.startswith(prefix):
            continue
        a = o.read()
        s = a.m_Script
        b = s.encode("utf-8", "surrogateescape") if isinstance(s, str) else bytes(s)
        if b.startswith(b"\xef\xbb\xbf"):
            b = b[3:]
        try:
            t = b.decode("utf-8")
        except UnicodeDecodeError:
            t = b.decode("gbk", "replace")
        out[p[len(prefix):]] = t
    return out


# ------------------------------------------------------------------ language table (FileLangContent)
def lang_object(env):
    for o in env.objects:
        if o.type.name == "MonoBehaviour":
            return o
    sys.exit("lang.u: no language object")


def lang_parse(d):
    """-> (head bytes up to the key array, keys, values)"""
    def rstr(pos):
        n = struct.unpack_from("<i", d, pos)[0]
        pos += 4
        s = d[pos:pos + n]
        return s, pos + (n + 3) // 4 * 4

    _, pos = rstr(28)
    head = d[:pos]
    arrays = []
    while pos + 4 <= len(d) and len(arrays) < 2:
        n = struct.unpack_from("<i", d, pos)[0]
        pos += 4
        arr = []
        for _ in range(n):
            s, pos = rstr(pos)
            arr.append(s.decode("utf-8", "surrogateescape"))
        arrays.append(arr)
    if len(arrays) != 2 or len(arrays[0]) != len(arrays[1]) or pos != len(d):
        sys.exit("lang.u: unexpected layout")
    return head, arrays[0], arrays[1]


def lang_pack(head, keys, values):
    def texts(items):
        out = [struct.pack("<i", len(items))]
        for s in items:
            b = s.encode("utf-8", "surrogateescape")
            out.append(struct.pack("<i", len(b)) + b + b"\0" * (-len(b) % 4))
        return b"".join(out)

    return head + texts(keys) + texts(values)


def lang_table(spec):
    _, k, v = lang_parse(lang_object(load_env(read_source(spec))).get_raw_data())
    return dict(zip(k, v))


# ------------------------------------------------------------------ tables
def rows_of(text):
    lines = [l.split("\t") for l in text.replace("\r\n", "\n").split("\n") if l.strip()]
    if len(lines) < 3:
        return {}, []
    hdr = lines[2]
    ix = {}
    for i, h in enumerate(hdr):
        ix.setdefault(h.strip(), i)
    rows = [r + [""] * (len(hdr) - len(r)) for r in lines[3:]]
    return ix, rows


# ------------------------------------------------------------------ cartoon script interpreter
FUNC = re.compile(r"^\s*function\s+(\w+)\s*\(([^)]*)\)")
CALL = re.compile(r"^call\s+(\w+)\s*(.*)$")
SECTION = re.compile(r"^section\s+(\S+)")


def strip_comment(line):
    i = line.find("--")
    return (line[:i] if i >= 0 else line).strip()


def parse_functions(text):
    funcs = {}
    cur = None
    for raw in text.replace("\r", "").split("\n"):
        m = FUNC.match(raw)
        if m:
            params = [p for p in re.split(r"[,\s]+", m.group(2).strip()) if p]
            cur = (params, [])
            funcs[m.group(1)] = cur
            continue
        line = strip_comment(raw)
        if cur is not None:
            if line == "end":
                cur = None
            elif line:
                cur[1].append(line)
    return funcs


def expand(line, funcs, depth=0):
    """A script line -> flat list of primitive commands (function calls replaced by their bodies)."""
    m = CALL.match(line)
    if not m or m.group(1) not in funcs or depth > 6:
        return [line]
    params, body = funcs[m.group(1)]
    a = m.group(2).strip()
    if a.startswith("(") and a.endswith(")"):
        a = a[1:-1]
    args = [x for x in re.split(r"[,\s]+", a) if x]  # the scripts mix commas and spaces
    table = dict(zip(params, args))
    out = []
    for b in body:
        if table:
            b = re.sub(r"(?<![\w.])(" + "|".join(re.escape(p) for p in table) + r")(?![\w.])",
                       lambda mm: table[mm.group(1)], b)
        out += expand(b, funcs, depth + 1)
    return out


class Texts:
    """Key lookup over the language tables."""

    def __init__(self, cur, official):
        self.cur, self.official = cur, official
        self.all = set(cur)
        for t in official:
            self.all.update(t)
        self.prefixes = set(k.split(".", 1)[0] for k in self.all if "." in k)

    def key_tokens(self, line):
        out = []
        for m in RUN.finditer(line):
            t = m.group(0).strip("./-")
            if "." not in t or t.split(".", 1)[0] not in self.prefixes:
                continue
            if t in self.all:
                out.append(t)
            elif not re.search(r"\.(png|prefab|txt|jpg|mp4|mat|bytes|u|json|lua|wav|ogg|anim|asset|tga|bnk)$", t.lower()):
                out.append(t)  # a key the tables do not have: the game shows the raw key
        return out


def image_attrs(tokens):
    """order N / scale S / position X Y / size W H -> {o, s, x, y, w, h}"""
    out = {}
    need = {"order": ("o",), "scale": ("s",), "position": ("x", "y"), "size": ("w", "h")}
    i = 0
    while i < len(tokens):
        names = need.get(tokens[i])
        if names:
            try:
                vals = [float(v) for v in tokens[i + 1:i + 1 + len(names)]]
            except ValueError:
                vals = []
            if len(vals) == len(names):
                out.update(zip(names, vals))
                i += len(names)
        i += 1
    return out


def parse_scene(text, funcs, texts):
    """-> list of sections {name, steps}. Step types: line, cg, text, title, choice, goto, img, note."""
    sections = []
    cur = None
    speaker = "-1"
    pending = []
    images = {}

    def add(step):
        nonlocal cur
        if cur is None:
            cur = {"name": "0", "steps": []}
            sections.append(cur)
        cur["steps"].append(step)

    for raw in text.replace("\r", "").split("\n"):
        line = strip_comment(raw)
        if not line:
            continue
        m = SECTION.match(line)
        if m:
            cur = {"name": m.group(1), "steps": []}
            sections.append(cur)
            continue
        for cmd in expand(line, funcs):
            w = cmd.split()
            if not w:
                continue
            a, b = w[0], (w[1] if len(w) > 1 else "")
            if a == "set" and b == "speaker" and len(w) > 2:
                speaker = w[2]
            elif a == "play" and b == "onebyone" and len(w) > 3:
                add({"t": "line", "sp": speaker, "k": w[3]})
            elif a == "play" and b.startswith("textfade") and len(w) > 3:
                add({"t": "cg", "sp": "-1", "k": w[3]})
            elif a == "set" and b == "history" and len(w) > 3:
                if cur:
                    for st in reversed(cur["steps"]):
                        if st.get("k") == w[2]:
                            if st["t"] == "cg":
                                st["sp"] = w[3]
                            break
            elif a == "set" and b == "title" and len(w) > 2:
                add({"t": "title", "k": w[2]})
            elif a == "if" and b == "choice" and "goto" in w:
                pending.append({"k": w[2], "to": w[-1]})
            elif a == "wait" and b == "choice":
                add({"t": "choice", "opts": pending})
                pending = []
            elif a == "goto" and b == "section" and len(w) > 2:
                add({"t": "goto", "to": w[2]})
            elif a == "load" and b == "rawimage" and len(w) > 4 and w[3] == "as":
                name = w[4]
                images[name] = w[2]
                st = {"t": "img", "op": "load", "n": name, "p": w[2], "full": "fullscreen" in w[5:]}
                st.update(image_attrs(w[5:]))
                add(st)
            elif a == "load" and b == "live2d" and len(w) > 5 and w[4] == "as":
                images[w[5]] = "live2d"
                add({"t": "img", "op": "load", "n": w[5], "l2d": [w[2], w[3]]})
            elif a == "set" and b in ("order", "scale", "position", "size") and len(w) > 3 and w[2] in images:
                at = image_attrs([b] + w[3:])
                if at:
                    add(dict({"t": "img", "op": "attr", "n": w[2]}, **at))
            elif a == "play" and b in ("moveto", "scale") and len(w) > 3 and w[2] in images:
                at = image_attrs(["position" if b == "moveto" else "scale"] + w[3:])
                if at:
                    try:  # the last number is the time the move or zoom takes
                        at["d"] = float(w[5 if b == "moveto" else 4])
                    except (IndexError, ValueError):
                        pass
                    add(dict({"t": "img", "op": "attr", "n": w[2]}, **at))
            elif a == "set" and b in ("show", "hide"):
                for name in w[2:]:
                    if name in images:
                        add({"t": "img", "op": b, "n": name})
            elif a in ("set", "play") and b == "fade" and len(w) > 3 and w[2] in images:
                try:
                    add({"t": "img", "op": "show" if float(w[3]) > 0 else "hide", "n": w[2]})
                except ValueError:
                    pass
            elif a == "delete" and b in images:
                add({"t": "img", "op": "hide", "n": b})
            elif a == "play" and b == "movie" and len(w) > 2:
                add({"t": "note", "x": "video " + w[2]})
            elif a == "play" and b == "music" and len(w) > 2:
                add({"t": "note", "x": "music " + w[2]})
            elif a == "play" and b in ("live2dvoice", "voice", "sound"):
                pass
            else:
                for k in texts.key_tokens(cmd):
                    add({"t": "text", "k": k, "cmd": " ".join(w[:2])})
    if pending:
        add({"t": "choice", "opts": pending})
    return sections


def scene_keys(sections):
    keys = []
    for s in sections:
        for st in s["steps"]:
            if "k" in st:
                keys.append(st["k"])
            for o in st.get("opts", []):
                keys.append(o["k"])
    return list(dict.fromkeys(keys))


# ------------------------------------------------------------------ build the data set
def sources_for(setname=None):
    """The files the story data is made of (name -> path or archive member)."""
    src = collections.OrderedDict([("com", source_of("com.u")), ("setting", source_of("setting.u")),
                                   ("lang", CFG["lang"] or source_of("lang.u"))])
    for n, f in enumerate(CFG["official"]):
        src["official%d" % n] = table_source(f)
    return src


def active_set():
    return CFG["label"]


def build(setname, log=print):
    src = sources_for(setname)
    log("reading language tables ...")
    cur = lang_table(src["lang"])
    official = [lang_table(v) for k, v in src.items() if k.startswith("official")]
    texts = Texts(cur, official)
    log("reading cartoon scripts (com.u) ...")
    scripts = text_assets(read_source(src["com"]), "assets/_game/settinggen/cartoon/")
    scripts = {k[:-4]: v for k, v in scripts.items() if k.endswith(".txt")}
    funcs = parse_functions(scripts.get("functions", ""))
    log("reading tables (setting.u) ...")
    tables = text_assets(read_source(src["setting"]), "assets/_game/settinggen/")

    scenes = {}

    def scene(sid):
        sid = sid.strip().lower()
        if sid.endswith(".txt"):
            sid = sid[:-4]
        if sid not in scenes:
            if sid not in scripts:
                return None
            sec = parse_scene(scripts[sid], funcs, texts)
            scenes[sid] = {"sections": sec, "keys": scene_keys(sec)}
        return sid

    used = set()
    # ---- main story: the stage map (map/chapter.txt) plus the interludes of the story archive (guide/riki.txt)
    ix, rows = rows_of(tables.get("map/chapter.txt", ""))
    chapters = collections.OrderedDict()
    for r in rows:
        try:
            ch, idx, diff = int(r[ix["Chapter"]]), int(r[ix["Index"]]), int(r[ix["Difficult"]])
        except (ValueError, KeyError):
            continue
        if diff != 1 or ch >= 100 or not r[ix["StoryID"]].strip():
            continue
        ids = [s.strip() for s in re.split(r"[;,|]", r[ix["StoryID"]]) if s.strip()]
        stype = r[ix["StoryType"]].strip()
        when = {"1": ["Before the stage"], "2": ["After the stage"], "3": ["Before the stage", "After the stage"]}.get(stype, [])
        items = []
        for i, s in enumerate(ids):
            sid = scene(s)
            label = when[i] if i < len(when) else "Scene %d" % (i + 1)
            items.append({"id": sid or s.lower(), "label": label, "missing": sid is None})
            if sid:
                used.add(sid)
        chapters.setdefault(ch, []).append({"n": idx, "nameKey": "map.Level%d_%d.name" % (ch, idx), "scenes": items})
    rix, rrows = rows_of(tables.get("guide/riki.txt", ""))
    events = collections.OrderedDict()
    interludes = collections.defaultdict(list)
    for r in rrows:
        if r[rix.get("Type", 0)].strip() != "6":
            continue
        sid = scene(r[rix["Extension1"]])
        if not sid:
            continue
        used.add(sid)
        hidden = "4" in re.findall(r"-?\d+", r[rix["IgnoreList"]]) or r[rix["IgnoreList"]].strip() == "-1"
        try:
            p, l = int(r[rix["P"]]), int(r[rix["L"]])
        except ValueError:
            p, l = -1, 0
        ext2, ext3 = r[rix["Extension2"]].strip(), r[rix["Extension3"]].strip()
        if sid.startswith("main"):
            m = re.match(r"(\d+),(\d+)", ext2)
            ch, st = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
            interludes[ch].append({"after": st, "id": sid, "titleKey": "ui." + ext3, "hidden": hidden})
        else:
            ev = events.setdefault(p, {"p": p, "nameKey": ext2, "hidden": hidden, "scenes": []})
            ev["hidden"] = ev["hidden"] and hidden
            ev["scenes"].append({"l": l, "id": sid, "titleKey": ext3})
    main = []
    for ch, stages in chapters.items():
        parts = [k for k in ("ui.chapter.normal.%d" % ch, "ui.chapter.normal.%d1" % ch, "ui.chapter.normal.%d2" % ch) if k in cur]
        for it in interludes.get(ch, []):
            pos = max([i for i, s in enumerate(stages) if s["n"] is not None and s["n"] <= it["after"]] + [-1]) + 1
            while pos < len(stages) and stages[pos]["n"] is None:
                pos += 1
            stages.insert(pos, {"n": None, "nameKey": it["titleKey"], "interlude": True,
                                "scenes": [{"id": it["id"], "label": "Interlude", "missing": False}]})
        main.append({"ch": ch, "titleKeys": parts, "stages": stages})
    for ch in sorted(set(interludes) - set(chapters)):
        main.append({"ch": ch, "titleKeys": [], "stages": [
            {"n": None, "nameKey": it["titleKey"], "interlude": True,
             "scenes": [{"id": it["id"], "label": "Interlude", "missing": False}]} for it in interludes[ch]]})
    ev_list = []
    for p in sorted(events):
        ev = events[p]
        ev["scenes"].sort(key=lambda s: s["l"])
        ev_list.append(ev)
    # ---- scripts of the story folders that neither table lists
    unlisted = collections.OrderedDict()
    for sid in sorted(scripts):
        top = sid.split("/")[0]
        if "/" not in sid or sid in used:
            continue
        if top.startswith("main") or top.startswith("activity") or top == "1stanniversaryblessing":
            if scene(sid):
                unlisted.setdefault(top, []).append({"id": sid, "label": sid.split("/")[-1]})
    unlisted = [{"folder": f, "scenes": s} for f, s in unlisted.items()]

    keys = set()
    for s in scenes.values():
        keys.update(s["keys"])
        for sec in s["sections"]:
            for st in sec["steps"]:
                sp = st.get("sp")
                if sp and "." in sp:
                    keys.add(sp)
    for c in main:
        keys.update(c["titleKeys"])
        keys.update(s["nameKey"] for s in c["stages"])
    for e in ev_list:
        keys.add(e["nameKey"])
        keys.update(s["titleKey"] for s in e["scenes"])
    names = {}
    for k in cur:
        m = re.match(r"(?:ui\.npcid\.(\d+)\.name|_GirlInfo\.(\d+)\.(?:NickName|GirlName))$", k)
        if m:
            names[k] = cur[k]
    data = {
        "version": CACHE_VERSION, "set": setname,
        "stamps": [source_stamp(s) for s in src.values()],
        "sources": {k: source_name(v) for k, v in src.items()},
        "official": [os.path.basename(source_name(v).split("::")[0]) for k, v in src.items() if k.startswith("official")],
        "nav": {"main": main, "events": ev_list, "unlisted": unlisted},
        "scenes": scenes,
        "texts": {k: [cur.get(k)] + [t.get(k) for t in official] for k in sorted(keys)},
        "names": names,
    }
    return data


def load_data(setname, rebuild=False, log=print):
    cache = os.path.join(WORK, "cache", "story-%s.json" % hashlib.sha1(setname.encode()).hexdigest()[:10])
    src = sources_for(setname)
    stamps = [source_stamp(s) for s in src.values()]
    if not rebuild and os.path.exists(cache):
        try:
            with open(cache, encoding="utf-8") as f:
                data = json.load(f)
            if data.get("version") == CACHE_VERSION and data.get("stamps") == stamps:
                return data
            log("the bundles changed; reading them again")
        except (ValueError, OSError):
            pass
    data = build(setname, log)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(cache + ".tmp", cache)
    return data


# ------------------------------------------------------------------ edits and tags
class Store:
    def __init__(self, data):
        self.data = data
        self.path = os.path.join(WORK, "edits.json")
        self.lock = threading.Lock()
        self.edits = {}
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.edits = json.load(f).get("edits", {})

    def _write(self):
        os.makedirs(WORK, exist_ok=True)
        with open(self.path + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"note": "story editor edits: key -> text / tag", "edits": self.edits}, f, ensure_ascii=False, indent=1)
        os.replace(self.path + ".tmp", self.path)

    def base(self, key):
        return self.data["texts"].get(key) or [None]

    def info(self, key):
        vals = self.base(key)
        cur, refs = vals[0], vals[1:]
        e = self.edits.get(key, {})
        text = e["text"] if "text" in e else cur
        official = [v for v in refs if v and not is_cjk_text(v)]
        if text is None:
            auto = "missing"
        elif "text" in e and e["text"] != cur:
            auto = "human"
        elif is_cjk_text(text):
            auto = "untranslated"
        elif not refs:
            auto = "untagged"          # no official table was given: the tool cannot tell original from machine
        elif text in official:
            auto = "original"
        else:
            auto = "machine"
        names = self.data.get("official", [])
        shown = []
        for n, v in enumerate(refs):
            if v and v != text and v not in [x["text"] for x in shown]:
                shown.append({"label": ("Source text, " if is_cjk_text(v) else "Official text, ") + (names[n] if n < len(names) else "table %d" % (n + 1)),
                              "text": v, "source": is_cjk_text(v)})
        return {"key": key, "text": text, "tag": e.get("tag") or auto, "auto": auto, "edited": "text" in e,
                "tagSet": "tag" in e, "base": cur, "refs": shown, "updated": e.get("updated")}

    def save(self, key, text=None, tag=None):
        with self.lock:
            e = dict(self.edits.get(key, {}))
            if text is not None:
                if text == self.base(key)[0]:
                    e.pop("text", None)
                else:
                    e["text"] = text
            if tag is not None:
                if tag in TAGS:
                    e["tag"] = tag
                else:
                    e.pop("tag", None)
            if "text" in e or "tag" in e:
                e["updated"] = datetime.datetime.now().isoformat(timespec="seconds")
                self.edits[key] = e
            else:
                self.edits.pop(key, None)
            self._write()
        return self.info(key)

    def revert(self, key):
        with self.lock:
            self.edits.pop(key, None)
            self._write()
        return self.info(key)

    def counts(self, keys):
        c = collections.Counter(self.info(k)["tag"] for k in keys)
        return {t: c[t] for t in ("original", "machine", "human", "untagged", "untranslated", "missing") if c[t]}


def speaker_name(store, sp):
    if sp in (None, "", "-1"):
        return ""
    if sp == "playername":
        return "[Player]"
    names = store.data["names"]
    if sp.isdigit():
        for k in ("ui.npcid.%s.name" % sp, "_GirlInfo.%s.NickName" % sp, "_GirlInfo.%s.GirlName" % sp):
            if names.get(k):
                return names[k]
        return "#" + sp
    if "." in sp:
        return store.info(sp)["text"] or sp
    return sp


def nav_payload(store):
    d = store.data

    def title(key, fallback=""):
        return (store.info(key)["text"] if key else None) or fallback

    def sc(item, label=None):
        s = d["scenes"].get(item["id"])
        return {"id": item["id"], "label": label or item.get("label", ""), "missing": s is None,
                "lines": len(s["keys"]) if s else 0, "counts": store.counts(s["keys"]) if s else {}}

    main = []
    for c in d["nav"]["main"]:
        names = [title(k) for k in c["titleKeys"]]
        main.append({"title": " / ".join(n for n in names if n) or "Chapter %d" % c["ch"], "ch": c["ch"], "stages": [
            {"title": title(s["nameKey"], s["nameKey"]), "interlude": s.get("interlude", False),
             "scenes": [sc(x) for x in s["scenes"]]} for s in c["stages"]]})
    events = []
    for e in d["nav"]["events"]:
        events.append({"title": title(e["nameKey"], e["nameKey"] or "Event %s" % e["p"]), "p": e["p"],
                       "hidden": e["hidden"],
                       "scenes": [sc(x, title(x["titleKey"], x["id"].split("/")[-1])) for x in e["scenes"]]})
    unlisted = [{"title": u["folder"], "scenes": [sc(x) for x in u["scenes"]]} for u in d["nav"]["unlisted"]]
    allkeys = set()
    for s in d["scenes"].values():
        allkeys.update(s["keys"])
    rev = hashlib.sha1(json.dumps(d["stamps"]).encode()).hexdigest()[:12]
    return {"set": os.path.basename(CFG["data"] or CFG["archive"] or ""), "official": len(d.get("official", [])), "rev": rev, "sources": d["sources"], "main": main, "events": events, "unlisted": unlisted,
            "totals": store.counts(allkeys), "edits": len(store.edits)}


def scene_payload(store, sid):
    s = store.data["scenes"].get(sid)
    if not s:
        return None
    sections = []
    for sec in s["sections"]:
        steps = []
        for st in sec["steps"]:
            st = dict(st)
            if "sp" in st:
                st["name"] = speaker_name(store, st["sp"])
            steps.append(st)
        sections.append({"name": sec["name"], "steps": steps})
    return {"id": sid, "sections": sections, "texts": {k: store.info(k) for k in s["keys"]}}


def search(store, q, limit=200):
    q = q.lower()
    out = []
    for sid, s in store.data["scenes"].items():
        for k in s["keys"]:
            i = store.info(k)
            if q in k.lower() or (i["text"] and q in i["text"].lower()):
                out.append({"scene": sid, "key": k, "text": i["text"], "tag": i["tag"]})
                if len(out) >= limit:
                    return out
    return out


# ------------------------------------------------------------------ export
def export(store, log=print):
    """Writes work/export/lang.u (the text table + the edited text) and story-edits.json."""
    src = sources_for(store.data["set"])["lang"]
    env = load_env(read_source(src))
    obj = lang_object(env)
    head, keys, values = lang_parse(obj.get_raw_data())
    pos = {k: i for i, k in enumerate(keys)}
    changed = added = 0
    for k, e in sorted(store.edits.items()):
        if "text" not in e:
            continue
        if k in pos:
            if values[pos[k]] != e["text"]:
                values[pos[k]] = e["text"]
                changed += 1
        else:
            keys.append(k)
            values.append(e["text"])
            added += 1
    obj.set_raw_data(lang_pack(head, keys, values))
    out = env.file.save(packer="original")
    _, k2, v2 = lang_parse(lang_object(load_env(out)).get_raw_data())
    if k2 != keys or v2 != values:
        sys.exit("lang.u: the saved bundle does not read back")
    d = os.path.join(WORK, "export")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "lang.u"), "wb") as f:
        f.write(out)
    rows = [{"key": k, **store.info(k)} for k in sorted(store.edits)]
    with open(os.path.join(d, "story-edits.json"), "w", encoding="utf-8") as f:
        json.dump({"exported": datetime.datetime.now().isoformat(timespec="seconds"), "data": os.path.basename(CFG["data"] or ""),
                   "base": source_name(src), "edits": [{"key": r["key"], "text": r["text"], "tag": r["tag"], "was": r["base"]}
                                               for r in rows]}, f, ensure_ascii=False, indent=1)
    res = {"dir": d, "lang": os.path.join(d, "lang.u"), "bytes": len(out), "entries": len(keys),
           "changed": changed, "added": added, "tagOnly": sum(1 for e in store.edits.values() if "text" not in e)}
    log("export: %(changed)d changed, %(added)d added, %(entries)d entries -> %(lang)s" % res)
    return res


# ------------------------------------------------------------------ images (backgrounds, CG, pictures)
IMG_LOCK = threading.Lock()
PER_FILE_DIR = {"card/all": "cardbig", "live2dbg": "l2dbg"}          # one bundle per image: <dir>/<name>_png.u
GROUP_DIR = {"boss": ["boss"], "npc": ["npc"], "type": ["t_ui.u"], "otherbig": ["o_big"], "commonbig": ["c_big"],
             "item": ["item"], "card": ["card"], "phone": ["phone.u"], "riki": ["riki.u"]}
GROUP_INDEX = {}


def group_index(top):
    """{texture path below textures/ (lower case): [bundle, container path]} for one texture folder."""
    files = []
    for entry in GROUP_DIR.get(top, []):
        q = data_path(entry)
        if os.path.isdir(q):
            files += [os.path.join(q, f) for f in sorted(os.listdir(q)) if f.endswith(".u")]
        elif os.path.exists(q):
            files.append(q)
    stamp = [len(files), max([int(os.path.getmtime(f)) for f in files] + [0])]
    hit = GROUP_INDEX.get(top)
    if hit and hit["stamp"] == stamp:
        return hit["index"]
    cache = os.path.join(WORK, "cache", "tex-%s.json" % top)
    if os.path.exists(cache):
        try:
            with open(cache, encoding="utf-8") as f:
                hit = json.load(f)
            if hit.get("stamp") == stamp:
                GROUP_INDEX[top] = hit
                return hit["index"]
        except (ValueError, OSError):
            pass
    index = {}
    for f in files:
        try:
            env = load_env(open(f, "rb").read())
        except Exception:
            continue
        for c, o in env.container.items():
            if "/textures/" not in c or o.type.name not in ("Texture2D", "Sprite"):
                continue
            key = c.split("/textures/", 1)[1].lower()
            if key not in index or o.type.name == "Texture2D":
                index[key] = [f, c]
    hit = {"stamp": stamp, "index": index}
    GROUP_INDEX[top] = hit
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(hit, f)
    return index


def find_texture(key):
    """key = lower-case game path with extension -> UnityPy texture or sprite object (None when not found)."""
    d, name = os.path.split(key)
    stem, ext = name.rsplit(".", 1)
    for folder in dict.fromkeys([d, PER_FILE_DIR.get(d, d)]):
        rel = "%s/%s_%s.u" % (folder, stem, ext)
        data = game_file(rel)
        if data:
            best = None
            for o in load_env(data).objects:
                if o.type.name == "Texture2D":
                    t = o.read()
                    if best is None or t.m_Width * t.m_Height > best.m_Width * best.m_Height:
                        best = t
            if best is not None:
                return best
    top = key.split("/")[0]
    if top in GROUP_DIR:
        hit = group_index(top).get(key)
        if hit:
            env = load_env(open(hit[0], "rb").read())
            o = next((obj for c, obj in env.container.items() if c == hit[1]), None)
            if o is not None:
                return o.read()
    return None


def game_image(path):
    """Game path such as BG/bg_x.png or Boss/body_npc121 -> (cache file, content type), or None."""
    if not re.match(r"^[A-Za-z0-9_/.\-]+$", path) or ".." in path or "/" not in path:
        return None
    key = path.lower()
    if not re.search(r"\.(png|jpg)$", key):
        key += ".png"
    base = os.path.join(WORK, "cache", "img", hashlib.sha1(key.encode()).hexdigest()[:16])
    for ext, ctype in ((".jpg", "image/jpeg"), (".png", "image/png")):
        if os.path.exists(base + ext):
            return base + ext, ctype
    with IMG_LOCK:
        for ext, ctype in ((".jpg", "image/jpeg"), (".png", "image/png")):
            if os.path.exists(base + ext):
                return base + ext, ctype
        tex = find_texture(key)
        if tex is None:
            return None
        img = tex.image
        if img.width > 2048:
            img = img.resize((2048, int(img.height * 2048 / img.width)))
        alpha = img.mode in ("RGBA", "LA") and img.getchannel("A").getextrema()[0] < 255
        ext, ctype, fmt = (".png", "image/png", "PNG") if alpha else (".jpg", "image/jpeg", "JPEG")
        buf = io.BytesIO()
        if alpha:
            img.save(buf, fmt)
        else:
            img.convert("RGB").save(buf, fmt, quality=85)
        os.makedirs(os.path.dirname(base), exist_ok=True)
        with open(base + ext + ".tmp", "wb") as f:
            f.write(buf.getvalue())
        os.replace(base + ext + ".tmp", base + ext)
        return base + ext, ctype


# ------------------------------------------------------------------ Live2D characters
L2D_LOCK = threading.Lock()
CORE_FILE = os.path.join(WORK, "vendor", "live2dcubismcore.min.js")
CORE_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"


def l2d_outfits(girl):
    d = data_path("l2d", "girl%02d" % girl)
    have = {}
    if os.path.isdir(d):
        for f in os.listdir(d):
            m = re.match(r"l2d(\d+)\.u$", f)
            if m:
                have[int(m.group(1))] = os.path.join(d, f)
    return have


def l2d_bad(add=None):
    """Models the runtime could not take (reported by the page), kept per repair version."""
    f = os.path.join(WORK, "cache", "l2d-bad.json")
    bad = {}
    if os.path.exists(f):
        try:
            with open(f, encoding="utf-8") as fh:
                bad = json.load(fh)
        except ValueError:
            bad = {}
    if bad.get("repair") != moc3_repair.VERSION:
        bad = {"repair": moc3_repair.VERSION, "keys": []}
    if add and add not in bad["keys"]:
        bad["keys"].append(add)
        os.makedirs(os.path.dirname(f), exist_ok=True)
        with open(f, "w", encoding="utf-8") as fh:
            json.dump(bad, fh)
    return set(bad["keys"])


def l2d_model(girl, clothes, avoid=()):
    """Extracts the moc3 file and the textures of a Live2D model into the cache. When the outfit of the script is
    absent or the runtime failed on it, the nearest other outfit stands in. Outfit 0 never stands in: it is the bare
    base body. -> info or None"""
    have = l2d_outfits(girl)
    bad = l2d_bad()
    for o in avoid:
        bad = l2d_bad("%d_%d" % (girl, o))
    order = [clothes] + sorted((o for o in have if o != clothes and o != 0), key=lambda o: (abs(o - clothes), o))
    for use in order:
        if "%d_%d" % (girl, use) in bad:
            continue
        info = l2d_extract(girl, use, have)
        if info:
            info["standin"] = use != clothes
            return info
    return None


def l2d_extract(girl, use, have):
    key = "%d_%d" % (girl, use)
    d = os.path.join(WORK, "cache", "l2d", key)
    meta = os.path.join(d, "meta.json")
    want = [2, moc3_repair.VERSION]

    def cached():
        if os.path.exists(meta):
            with open(meta, encoding="utf-8") as f:
                info = json.load(f)
            if info.get("v") == want:
                return info
        return None

    info = cached()
    if info:
        return info
    with L2D_LOCK:
        info = cached()
        if info:
            return info
        data = game_file("l2d/girl%02d/l2d%02d.u" % (girl, use))
        if data is None:
            return None
        env = load_env(data)
        moc = None
        for o in env.objects:
            if o.type.name == "MonoBehaviour":
                raw = o.get_raw_data()
                i = raw.find(b"MOC3")
                if i >= 4:
                    n = struct.unpack_from("<i", raw, i - 4)[0]
                    if 0 < n <= len(raw) - i and (moc is None or n > len(moc)):
                        moc = raw[i:i + n]
        tex = sorted((c, o) for c, o in env.container.items() if o.type.name == "Texture2D" and "texture_" in c)
        if moc is None or not tex:
            return None
        moc, notes = moc3_repair.repair_moc(moc, len(tex))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "model.moc3"), "wb") as f:
            f.write(moc)
        for n, (_, o) in enumerate(tex):
            o.read().image.save(os.path.join(d, "tex%d.png" % n), "PNG")
        info = {"v": want, "key": key, "girl": girl, "outfit": use, "textures": len(tex), "mocBytes": len(moc), "repaired": notes}
        with open(meta + ".tmp", "w", encoding="utf-8") as f:
            json.dump(info, f)
        os.replace(meta + ".tmp", meta)
        return info


# ------------------------------------------------------------------ http
RELOAD_LOCK = threading.Lock()


def fresh_store(handler):
    """The store for the game data on disk now. Reads the bundles again when a file changed."""
    with RELOAD_LOCK:
        try:
            setname = active_set()
            src = sources_for(setname)
            stamps = [source_stamp(v) for v in src.values()]
            st = handler.store
            if st is None or st.data["set"] != setname or st.data["stamps"] != stamps:
                Handler.store = Store(load_data(setname, log=lambda *a: None))
                print("game data loaded again", flush=True)
            Handler.warning = None
        except (Exception, SystemExit) as ex:   # a bundle may be half written during a build: keep the old data
            Handler.warning = "cannot read the game data again: %s" % ex
        return Handler.store


class Handler(BaseHTTPRequestHandler):
    store = None
    warning = None

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8", cache=False):
        if not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html"):
                with open(os.path.join(HERE, "index.html"), "rb") as f:
                    return self.send(200, f.read(), "text/html; charset=utf-8")
            if u.path == "/favicon.ico":
                return self.send(204, b"", "image/x-icon", cache=True)
            if u.path == "/api/nav":
                p = nav_payload(fresh_store(self))
                p["warning"] = Handler.warning
                return self.send(200, p)
            if u.path == "/api/scene":
                p = scene_payload(self.store, q.get("id", [""])[0])
                return self.send(200, p) if p else self.send(404, {"error": "no such scene"})
            if u.path == "/l2d-worker.js":
                with open(os.path.join(HERE, "l2d-worker.js"), "rb") as fh:
                    return self.send(200, fh.read(), "text/javascript; charset=utf-8")
            if u.path == "/vendor/live2dcubismcore.min.js":
                if not os.path.exists(CORE_FILE):
                    return self.send(404, {"error": "Live2D runtime not installed", "file": CORE_FILE, "url": CORE_URL})
                with open(CORE_FILE, "rb") as fh:
                    return self.send(200, fh.read(), "text/javascript; charset=utf-8", cache=True)
            if u.path == "/api/l2d":
                try:
                    girl, clothes = int(q.get("girl", [""])[0]), int(q.get("clothes", [""])[0])
                except ValueError:
                    return self.send(400, {"error": "girl and clothes must be numbers"})
                avoid = tuple(int(x) for x in re.findall(r"\d+", q.get("avoid", [""])[0]))
                info = l2d_model(girl, clothes, avoid)
                return self.send(200, info) if info else self.send(404, {"error": "no such Live2D model"})
            if u.path == "/api/l2d/file":
                key, name = q.get("key", [""])[0], q.get("f", [""])[0]
                if not re.match(r"^\d+_\d+$", key) or not re.match(r"^(model\.moc3|tex\d+\.png)$", name):
                    return self.send(400, {"error": "bad file"})
                f = os.path.join(WORK, "cache", "l2d", key, name)
                if not os.path.exists(f):
                    return self.send(404, {"error": "not extracted"})
                with open(f, "rb") as fh:
                    return self.send(200, fh.read(), "image/png" if name.endswith(".png") else "application/octet-stream", cache=True)
            if u.path == "/api/search":
                return self.send(200, search(self.store, q.get("q", [""])[0]))
            if u.path in ("/api/img", "/api/bg"):
                f = game_image(q.get("path", [""])[0])
                if not f:
                    return self.send(404, {"error": "no such image"})
                with open(f[0], "rb") as fh:
                    return self.send(200, fh.read(), f[1], cache=True)
            self.send(404, {"error": "not found"})
        except Exception as ex:  # report, keep serving
            self.send(500, {"error": "%s: %s" % (type(ex).__name__, ex)})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
            if self.headers.get("Origin") and urllib.parse.urlparse(self.headers["Origin"]).hostname not in ("127.0.0.1", "localhost"):
                return self.send(403, {"error": "foreign origin"})
            if u.path == "/api/save":
                key = body.get("key")
                if not isinstance(key, str) or not key:
                    return self.send(400, {"error": "key is required"})
                text = body.get("text")
                if text is not None and not isinstance(text, str):
                    return self.send(400, {"error": "text must be a string"})
                return self.send(200, self.store.save(key, text, body.get("tag")))
            if u.path == "/api/revert":
                return self.send(200, self.store.revert(body.get("key", "")))
            if u.path == "/api/export":
                return self.send(200, export(self.store, log=lambda *a: None))
            self.send(404, {"error": "not found"})
        except SystemExit as ex:
            self.send(500, {"error": str(ex)})
        except Exception as ex:
            self.send(500, {"error": "%s: %s" % (type(ex).__name__, ex)})


def configure(a):
    data = a.data or os.environ.get("GCG_DATA")
    if not data and not a.archive:
        sys.exit("Give the game data folder: --data <folder with com.u, setting.u, lang.u> (or set GCG_DATA).\n" + __doc__)
    for f in [data, a.archive, a.lang] + list(a.official or []):
        if f and not os.path.exists(f):
            sys.exit("not found: " + f)
    CFG.update(data=os.path.abspath(data) if data else None, archive=os.path.abspath(a.archive) if a.archive else None,
               lang=os.path.abspath(a.lang) if a.lang else None, official=[os.path.abspath(f) for f in a.official or []])
    CFG["label"] = "|".join(str(x) for x in (CFG["data"], CFG["archive"], CFG["lang"], CFG["official"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data", help="game data folder (com.u, setting.u, lang.u, bg/, l2d/ ...)")
    ap.add_argument("--lang", help="text table to show and to patch (default: <data>/lang.u)")
    ap.add_argument("--official", action="append", help="official English lang.u, or .obb/.apk/.zip with assets/lang.u")
    ap.add_argument("--archive", help=".obb or .zip with assets/<path>, for files the data folder does not have")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT") or 4310))
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--open", action="store_true", help="open the page in the default browser")
    a = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    configure(a)
    setname = active_set()
    data = load_data(setname, a.rebuild)
    store = Store(data)
    print("%d scenes, %d text keys, %d edits" % (len(data["scenes"]), len(data["texts"]), len(store.edits)))
    if a.export:
        export(store)
        return
    Handler.store = store
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print("story editor: http://127.0.0.1:%d  (Ctrl+C to stop)" % a.port, flush=True)
    if a.open:
        import webbrowser
        threading.Timer(0.5, webbrowser.open, ["http://127.0.0.1:%d" % a.port]).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
