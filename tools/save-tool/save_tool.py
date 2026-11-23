"""Save management for playtests: back the save up to this computer, put a stored save on the phone, wipe it.

The save of GCG Offline is one file in the private storage of the app (files/gcg-server/data/state.json).
No game or server code takes part: the tool reads and writes the file with `adb shell run-as <package>`.
Android allows that only for a debuggable build, so the tool needs a playtest APK (playtest_apk.py in this
folder); it stops with a clear message on a release build.

Commands:
  status                phone: can the tool reach the save, is there one; and the saves on the computer
  list                  the saves on the computer
  backup [--label L]    copy the phone's save (and the server's daily copies) to the computer. The game may run.
  push <save>           put a stored save on the phone. <save> is a folder name from `list`, a part of one,
                        or a .json file
  wipe                  remove the save on the phone; the game makes a new one at its next start

push and wipe stop the game first and always back the phone's save up before they change it.
Saves are kept in --store (default: $GCG_SAVES, or saves/ next to this script), one folder each:
<time>[-label]/state.json with an info.json. The repository ignores tools/save-tool/saves/.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

PACKAGE = 'com.zirenmidori.gcg.offline'
DATA = 'files/gcg-server/data'          # relative to the app's private folder, where run-as starts
SAVE = DATA + '/state.json'
DAILY = DATA + '/backups'
TEMP = '/data/local/tmp/gcg-save-in-%d-%d.json' % (os.getpid(), time.time_ns())
sha = lambda b: hashlib.sha256(b).hexdigest()


HERE = Path(__file__).resolve().parent
OLD_STORE = Path.home() / 'gcg-offline-saves'      # the default before the tool became portable


def default_store(env=os.environ):
    """$GCG_SAVES, or saves/ next to this script: the tool writes nothing outside its own folder."""
    return Path(env['GCG_SAVES']) if env.get('GCG_SAVES') else HERE / 'saves'


def old_store_note(store, old=OLD_STORE):
    """A note when saves are still in the old default folder and the new one has none. Nothing is moved."""
    has_saves = lambda d: d.is_dir() and any(x.is_dir() for x in d.iterdir())
    if store != old and has_saves(old) and not has_saves(store):
        return (f'note: saves from an older version of this tool are in {old}. '
                f'Move them to {store}, or pass --store "{old}".')
    return ''


def has_save_answer(out):
    """The answer of `test -f <SAVE> && echo yes || echo no`: True, False, or a stop with the raw output."""
    text = out.strip()
    if text == 'yes':
        return True
    if text == 'no':
        return False
    sys.exit('cannot tell whether the phone has a save (raw output: %r): stopped, nothing changed' % out)


DAILY_NONE = '__none'


def daily_names_answer(code, out):
    """The answer of the daily-copy listing: the file names, [] when the folder is missing, or a stop.
    A failed adb call must not look like "no daily copies": push and wipe delete that folder next."""
    if code == 0 and out.strip() == DAILY_NONE:
        return []
    names = out.split()
    if code != 0 or DAILY_NONE in names or any(not re.fullmatch(r'[A-Za-z0-9._-]+', n) for n in names):
        sys.exit('cannot list the daily copies on the phone (raw output: %r): stopped, nothing changed' % out)
    return names


class Phone:
    """The phone, through adb. The tests replace this class with one that keeps the files in memory."""

    def __init__(self, adb, package):
        self.adb, self.package = adb, package

    def _adb(self, *args, binary=False):
        r = subprocess.run([self.adb, *args], capture_output=True, timeout=120)
        out = r.stdout if binary else r.stdout.decode('utf8', 'replace').replace('\r\n', '\n')
        return r.returncode, out, r.stderr.decode('utf8', 'replace')

    def app(self, command):
        """Run a shell command as the app, inside its private folder. Returns (exit code, output)."""
        code, out, err = self._adb('shell', 'run-as %s sh -c "%s"; echo __rc=$?' % (self.package, command))
        m = re.search(r'__rc=(\d+)\s*$', out)
        return (int(m.group(1)) if m else 1), (out[:m.start()] if m else out + err)

    def _read(self, path):
        code, out, err = self._adb('exec-out', 'run-as', self.package, 'cat', path, binary=True)
        if code:
            sys.exit('cannot read %s: %s' % (path, err))
        return out

    def check(self):
        code, out, err = self._adb('get-state')
        if code or 'device' not in out:
            sys.exit('no phone on adb (%s)' % (out + err).strip())
        if 'package:' not in self._adb('shell', 'pm path ' + self.package)[1]:
            sys.exit(self.package + ' is not installed on the phone')
        code, out = self.app('echo ok')
        if code or 'ok' not in out:
            sys.exit('the tool cannot reach the save: the installed APK is not debuggable.\n'
                     'Make a playtest build with tools/save-tool/playtest_apk.py (see the README there).')

    def model(self):
        return self._adb('shell', 'getprop', 'ro.product.model')[1].strip()

    def stop(self):
        self._adb('shell', 'am', 'force-stop', self.package)
        time.sleep(1)

    def has_save(self):
        return has_save_answer(self.app('test -f %s && echo yes || echo no' % SAVE)[1])

    def read_save(self):
        return self._read(SAVE)

    def daily_names(self):
        return daily_names_answer(*self.app('if [ -d %s ]; then ls %s; else echo %s; fi' % (DAILY, DAILY, DAILY_NONE)))

    def read_daily(self, name):
        return self._read(DAILY + '/' + name)

    def write_save(self, source):
        """Put the file on the phone as the save. Returns '' or the reason it failed."""
        code, out, err = self._adb('push', str(source), TEMP)
        if code:
            return 'adb push failed: ' + out + err
        # Copy as the app, then rename: the game never sees a half-written file. The daily copies of
        # the other save go away (the backup holds them), so the server does not mix two saves.
        code, out = self.app('mkdir -p %s && cp %s %s.pc && mv %s.pc %s && rm -rf %s' % (DATA, TEMP, SAVE, SAVE, SAVE, DAILY))
        self._adb('shell', 'rm', '-f', TEMP)
        return out.strip() or 'copy failed' if code else ''

    def remove_save(self):
        code, out = self.app('rm -f %s && rm -rf %s' % (SAVE, DAILY))
        return out.strip() or 'remove failed' if code else ''


def saves(store):
    rows = []
    for folder in sorted(p for p in store.iterdir() if (p / 'state.json').is_file()) if store.is_dir() else []:
        body = (folder / 'state.json').read_bytes()
        info = json.loads((folder / 'info.json').read_text(encoding='utf8')) if (folder / 'info.json').is_file() else {}
        rows.append({'name': folder.name, 'bytes': len(body), 'sha256': sha(body), 'label': info.get('label', ''),
                     'path': folder / 'state.json'})
    return rows


def show(rows):
    if not rows:
        print('  (none)')
    for r in rows:
        print('  %-42s %9d bytes  %s  %s' % (r['name'], r['bytes'], r['sha256'][:12], r['label']))


def looks_like_a_save(body):
    try:
        return isinstance(json.loads(body.decode('utf8')), dict)
    except (UnicodeDecodeError, ValueError):
        return False


def new_folder(store, label, now=None):
    label = re.sub(r'[^A-Za-z0-9_-]+', '-', label or '').strip('-')
    stamp = time.strftime('%Y%m%d-%H%M%S', time.localtime(now))
    folder = store / (stamp + ('-' + label if label else ''))
    while folder.exists():  # two backups in one second
        folder = folder.with_name(folder.name + '-b')
    folder.mkdir(parents=True)
    return folder


def add_daily_copies(phone, folder):
    """Copy the phone's daily copies that are not stored in folder yet. Returns (how many were added, the stored copies)."""
    info_path = folder / 'info.json'
    info = json.loads(info_path.read_text(encoding='utf8')) if info_path.is_file() else {}
    copies = dict(info.get('dailyCopies') or {})
    added = 0
    for name in phone.daily_names():
        copy = phone.read_daily(name)
        if not looks_like_a_save(copy):
            sys.exit('the daily copy %s on the phone is not a JSON object: stopped, nothing changed' % name)
        if sha(copy) in copies.values():
            continue
        stored = name
        if stored in copies:  # the server rewrote the copy of that date: keep both
            stem, dot, ext = name.rpartition('.')
            stored = '%s-%s.%s' % (stem, sha(copy)[:8], ext) if dot else '%s-%s' % (name, sha(copy)[:8])
        (folder / 'phone-daily-copies').mkdir(parents=True, exist_ok=True)
        (folder / 'phone-daily-copies' / stored).write_bytes(copy)
        copies[stored] = sha(copy)
        added += 1
    if added:
        info['dailyCopies'] = copies
        info_path.write_text(json.dumps(info, indent=2) + '\n', encoding='utf8')
    return added, copies


def backup(phone, store, label, why='', now=None):
    """Copy the phone's save and its daily copies to a folder. Returns the folder, or None when the phone has neither."""
    if not phone.has_save():
        print('the phone has no save: nothing to back up')
        if not phone.daily_names():
            return None
        folder = new_folder(store, label, now)
        added, copies = add_daily_copies(phone, folder)
        info = {'when': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now)), 'label': label, 'reason': why,
                'phone': phone.model(), 'package': phone.package, 'dailyCopies': copies}
        (folder / 'info.json').write_text(json.dumps(info, indent=2) + '\n', encoding='utf8')
        print('added %d daily copies to %s (the phone has no save)' % (added, folder))
        return folder
    body = phone.read_save()
    if not looks_like_a_save(body):
        sys.exit('the save on the phone is not a JSON object (%d bytes): stopped, nothing changed' % len(body))
    same = [r for r in saves(store) if r['sha256'] == sha(body)]
    if same:
        print('the phone\'s save is already stored as %s' % same[-1]['name'])
        folder = same[-1]['path'].parent
        added, _ = add_daily_copies(phone, folder)
        if added:
            print('added %d daily copies to %s' % (added, folder))
        return folder
    folder = new_folder(store, label, now)
    (folder / 'state.json').write_bytes(body)
    added, copies = add_daily_copies(phone, folder)
    info = {'when': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now)), 'label': label, 'reason': why,
            'phone': phone.model(), 'package': phone.package, 'bytes': len(body), 'sha256': sha(body), 'dailyCopies': copies}
    (folder / 'info.json').write_text(json.dumps(info, indent=2) + '\n', encoding='utf8')
    print('backed up: %s (%d bytes, sha256 %s, %d daily copies)' % (folder, len(body), sha(body)[:12], added))
    return folder


def discard_bad_save(phone):
    return phone.remove_save()


def pick(store, name):
    path = Path(name)
    if path.is_file():
        return path
    rows = saves(store)
    hits = [r for r in rows if r['name'] == name] or [r for r in rows if name in r['name'] or name == r['label']]
    if len(hits) != 1:
        print('stored saves:'); show(rows)
        sys.exit('"%s" names %d saves: give one folder name' % (name, len(hits)))
    return hits[0]['path']


def cmd_status(a, phone):
    phone.check()
    if phone.has_save():
        body = phone.read_save()
        known = [r['name'] for r in saves(a.store) if r['sha256'] == sha(body)]
        print('phone (%s): save of %d bytes, sha256 %s, %s' % (phone.model(), len(body), sha(body)[:12],
              'stored as ' + known[-1] if known else 'NOT stored yet'))
    else:
        print('phone (%s): no save; the game makes a new one at its next start' % phone.model())
    print('daily copies on the phone: %d' % len(phone.daily_names()))
    cmd_list(a, phone)


def cmd_list(a, phone):
    print('stored saves (%s):' % a.store)
    show(saves(a.store))


def cmd_backup(a, phone):
    phone.check()
    backup(phone, a.store, a.label)


def cmd_push(a, phone):
    source = pick(a.store, a.save)
    body = source.read_bytes()
    if not looks_like_a_save(body):
        sys.exit('%s is not a JSON object: not a save of this game' % source)
    phone.check()
    phone.stop()
    previous = backup(phone, a.store, 'before-push', why='before push of ' + source.parent.name)
    problem = phone.write_save(source)
    if problem:
        sys.exit('could not write the save on the phone: ' + problem)
    if phone.read_save() != body:
        problem = discard_bad_save(phone)
        kept = 'the earlier save is in %s' % previous.name if previous else 'there was no earlier save on the phone'
        if problem:
            sys.exit('the save on the phone differs from %s after the copy; %s; %s' % (source, problem, kept))
        sys.exit('the save on the phone differs from %s after the copy; removed the bad copy; %s' % (source, kept))
    print('on the phone now: %s (%d bytes, sha256 %s). Start the game.' % (source, len(body), sha(body)[:12]))


def cmd_wipe(a, phone):
    phone.check()
    phone.stop()
    backup(phone, a.store, 'before-wipe', why='before wipe')
    problem = phone.remove_save()
    if problem or phone.has_save():
        sys.exit('could not remove the save on the phone: ' + problem)
    print('the phone has no save now. The game makes a new one at its next start.')


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--adb', default=shutil.which('adb') or 'adb', help='adb program (default: the one on PATH)')
    p.add_argument('--package', default=PACKAGE)
    p.add_argument('--store', type=Path, default=default_store(), help='folder of the stored saves')
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('status').set_defaults(run=cmd_status)
    sub.add_parser('list').set_defaults(run=cmd_list)
    s = sub.add_parser('backup'); s.add_argument('--label', default=''); s.set_defaults(run=cmd_backup)
    s = sub.add_parser('push'); s.add_argument('save'); s.set_defaults(run=cmd_push)
    sub.add_parser('wipe').set_defaults(run=cmd_wipe)
    return p


def main(argv=None, phone=None):
    a = parser().parse_args(argv)
    note = old_store_note(a.store)
    if note:
        print(note, file=sys.stderr)
    a.run(a, phone or Phone(a.adb, a.package))


if __name__ == '__main__':
    main()
