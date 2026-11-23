"""Checks of save_tool.py and playtest_apk.py that need no phone: python tools/save-tool/test_save_tool.py"""
import contextlib, io, json, struct, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import playtest_apk
import save_tool


class FakePhone:
    """A phone that keeps the private folder of the app in memory."""
    package = save_tool.PACKAGE
    PROBE = 'test -f %s && echo yes || echo no' % save_tool.SAVE

    def __init__(self, save=None, daily=None, debuggable=True):
        self.save, self.daily, self.debuggable, self.stops = save, dict(daily or {}), debuggable, 0
        self.corrupt_after_write = False

    def check(self):
        if not self.debuggable:
            sys.exit('the tool cannot reach the save: the installed APK is not debuggable.')

    def model(self): return 'Test phone'
    def stop(self): self.stops += 1
    def app(self, command):
        """The shell as the app: answers the save probe from the in-memory save; nothing else says anything."""
        return (0, 'yes\n' if self.save is not None else 'no\n') if command == self.PROBE else (0, '')
    def has_save(self):
        return save_tool.has_save_answer(self.app(self.PROBE)[1])
    def read_save(self): return self.save
    def daily_names(self): return sorted(self.daily)
    def read_daily(self, name): return self.daily[name]

    def write_save(self, source):
        body = Path(source).read_bytes()
        self.save, self.daily = body + (b'x' if self.corrupt_after_write else b''), {}
        return ''

    def remove_save(self):
        self.save, self.daily = None, {}
        return ''


class GarbagePhone(FakePhone):
    """A phone whose app shell answers the save probe with garbage: an adb hiccup or a run-as error."""

    def app(self, command):
        return 0, 'run-as: package not found\n'


def run(phone, store, *argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        save_tool.main(['--store', str(store), *argv], phone)
    return out.getvalue()


def stops(call):
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            call()
    except SystemExit as e:
        return str(e.code)
    return None


def test_save_tool():
    with tempfile.TemporaryDirectory() as tmp:
        store = Path(tmp) / 'saves'
        first, second = b'{"players": {"a": 1}}\n', b'{"players": {"b": 2}}\n'
        phone = FakePhone(first, {'state-20260101.json': b'{}\n'})

        assert 'NOT stored yet' in run(phone, store, 'status')
        run(phone, store, 'backup', '--label', 'chapter 3 / boss')
        rows = save_tool.saves(store)
        assert len(rows) == 1 and rows[0]['name'].endswith('-chapter-3-boss') and rows[0]['sha256'] == save_tool.sha(first)
        folder = rows[0]['path'].parent
        assert (folder / 'phone-daily-copies' / 'state-20260101.json').read_bytes() == b'{}\n'
        assert json.loads((folder / 'info.json').read_text(encoding='utf8'))['bytes'] == len(first)
        assert phone.stops == 0, 'a backup does not stop the game'
        print('ok backup: the save, its daily copies and an info file are stored; the game is not stopped')

        assert 'already stored' in run(phone, store, 'backup') and len(save_tool.saves(store)) == 1
        print('ok backup: the same save is not stored twice')

        phone.save = second
        assert 'backed up' in run(phone, store, 'wipe')
        assert phone.save is None and phone.daily == {} and phone.stops == 1
        assert sorted(r['sha256'] for r in save_tool.saves(store)) == sorted([save_tool.sha(first), save_tool.sha(second)])
        assert 'no save' in run(phone, store, 'status')
        print('ok wipe: the game is stopped, the save is stored first, then the phone has none')

        run(phone, store, 'wipe')
        assert len(save_tool.saves(store)) == 2
        print('ok wipe: a phone without a save is left alone and nothing is stored')

        run(phone, store, 'push', 'chapter-3')
        assert phone.save == first and phone.stops == 3
        phone.save = b'{"players": {"c": 3}}\n'
        run(phone, store, 'push', str(folder / 'state.json'))
        assert phone.save == first and len(save_tool.saves(store)) == 3
        print('ok push: by a part of the name and by file; the save that was on the phone is stored first')

        phone.daily['state-20260102.json'] = b'{"players": {"d": 4}}\n'
        out = run(phone, store, 'wipe')
        assert 'already stored' in out and 'added 1 daily copies' in out
        assert (folder / 'phone-daily-copies' / 'state-20260102.json').read_bytes() == b'{"players": {"d": 4}}\n'
        assert phone.save is None and phone.daily == {}
        print('ok wipe: a daily copy added while the save was already stored is stored before the phone loses it')

        phone.daily = {'state-20260103.json': b'{"players": {"e": 5}}\n'}
        out = run(phone, store, 'push', 'chapter-3')
        daily_only = [p for p in store.iterdir() if (p / 'phone-daily-copies' / 'state-20260103.json').is_file()]
        assert len(daily_only) == 1 and not (daily_only[0] / 'state.json').is_file()
        assert (daily_only[0] / 'phone-daily-copies' / 'state-20260103.json').read_bytes() == b'{"players": {"e": 5}}\n'
        assert 'added 1 daily copies' in out and phone.save == first and phone.daily == {}
        print('ok push: daily copies of a phone without a save get their own folder first')

        phone.save = second
        phone.corrupt_after_write = True
        msg = stops(lambda: run(phone, store, 'push', str(folder / 'state.json')))
        assert msg and 'differs' in msg and 'removed the bad copy' in msg, msg
        assert phone.save is None and any(r['sha256'] == save_tool.sha(second) for r in save_tool.saves(store))
        phone.save, phone.corrupt_after_write = first, False
        print('ok push: a read-back mismatch removes the bad save and keeps the earlier one on the computer')

        assert 'names 0 saves' in stops(lambda: run(phone, store, 'push', 'nothing-like-this'))
        assert 'names 3 saves' in stops(lambda: run(phone, store, 'push', '20'))
        bad = Path(tmp) / 'not-a-save.json'
        bad.write_bytes(b'[1, 2]')
        assert 'not a save' in stops(lambda: run(phone, store, 'push', str(bad))) and phone.save == first
        phone.save = b'\xff\xfe'
        assert 'not a JSON object' in stops(lambda: run(phone, store, 'wipe')) and phone.save == b'\xff\xfe'
        print('ok refusals: an unknown or ambiguous name, a file that is no save, an unreadable save on the phone')

        assert 'not debuggable' in stops(lambda: run(FakePhone(first, debuggable=False), store, 'wipe'))
        print('ok a release build: the tool stops before it changes anything')

        garbage = GarbagePhone(first, {'state-20260104.json': b'{"players": {"f": 6}}\n'})
        daily = dict(garbage.daily)
        assert 'cannot tell' in stops(lambda: run(garbage, store, 'push', 'chapter-3'))
        assert 'cannot tell' in stops(lambda: run(garbage, store, 'wipe'))
        assert garbage.save == first and garbage.daily == daily
        print('ok an unreadable phone: push and wipe stop before they change anything')

        clash = Path(tmp) / 'clash'
        clash.mkdir()
        old, new = b'{"players": {"g": 7}}\n', b'{"players": {"g": 8}}\n'
        assert save_tool.add_daily_copies(FakePhone(first, {'state-20260105.json': old}), clash)[0] == 1
        added, copies = save_tool.add_daily_copies(FakePhone(first, {'state-20260105.json': new}), clash)
        rewritten = 'state-20260105-%s.json' % save_tool.sha(new)[:8]
        assert added == 1 and set(copies) == {'state-20260105.json', rewritten}
        assert (clash / 'phone-daily-copies' / 'state-20260105.json').read_bytes() == old
        assert (clash / 'phone-daily-copies' / rewritten).read_bytes() == new
        print('ok a daily copy the server rewrote under the same name: both versions are kept')

        broken = FakePhone(first, {'state-20260106.json': b'run-as: error\n'})
        assert 'not a JSON object' in stops(lambda: run(broken, store, 'wipe')) and broken.save == first
        print('ok a daily copy that is no save: wipe stops before it removes anything')

        assert save_tool.daily_names_answer(0, '__none\n') == []
        assert save_tool.daily_names_answer(0, '') == []
        assert save_tool.daily_names_answer(0, 'a.json\nb.json\n') == ['a.json', 'b.json']
        for code, out in ((1, ''), (0, 'run-as: package not found\n'), (1, '__none\n')):
            assert 'cannot list' in stops(lambda: save_tool.daily_names_answer(code, out))
        print('ok the daily-copy listing: a failed or garbled answer stops instead of looking empty')


def manifest(value, on='application', kind=0x12):
    """A small binary manifest: <manifest><application android:debuggable=value/></manifest>."""
    strings = ['debuggable', 'http://schemas.android.com/apk/res/android', 'manifest', 'application', 'activity']
    data, offsets = b'', []
    for s in strings:
        offsets.append(len(data))
        data += struct.pack('<H', len(s)) + s.encode('utf-16-le') + b'\0\0'
    data += b'\0' * (-len(data) % 4)
    body = struct.pack('<5I', len(strings), 0, 0, 28 + 4 * len(strings), 0) + struct.pack('<5I', *offsets) + data
    pool = struct.pack('<HHI', 0x0001, 28, 8 + len(body)) + body
    ids = struct.pack('<HHI', 0x0180, 8, 12) + struct.pack('<I', 0x0101000f)

    def start(name, attrs=b''):
        ext = struct.pack('<4I6H', 1, 0xFFFFFFFF, 0xFFFFFFFF, name, 20, 20, len(attrs) // 20, 0, 0, 0) + attrs
        return struct.pack('<HHI', 0x0102, 16, 8 + len(ext)) + ext

    end = lambda name: struct.pack('<HHI', 0x0103, 16, 24) + struct.pack('<4I', 1, 0xFFFFFFFF, 0xFFFFFFFF, name)
    attr = struct.pack('<3IHBBI', 1, 0, 0xFFFFFFFF, 8, 0, kind, value)
    nodes = start(2, attr if on == 'manifest' else b'') + start(3, attr if on == 'application' else b'') + \
        start(4, attr if on == 'activity' else b'') + end(4) + end(3) + end(2)
    return struct.pack('<HHI', 0x0003, 8, 8 + len(pool) + len(ids) + len(nodes)) + pool + ids + nodes


def refused(axml):
    try:
        playtest_apk.debuggable_manifest(axml)
    except ValueError as e:
        return str(e)
    return None


def test_manifest():
    before = manifest(0)
    after, proof = playtest_apk.debuggable_manifest(before)
    assert after == manifest(0xFFFFFFFF) and len(after) == len(before) and proof['valueBefore'] == 0
    assert sum(x != y for x, y in zip(before, after)) == 4
    again, proof = playtest_apk.debuggable_manifest(after)
    assert again == after and proof['valueBefore'] == 0xFFFFFFFF
    print('ok manifest: false becomes true, four bytes differ, a second run changes nothing')
    assert 'no android:debuggable' in refused(before.replace(struct.pack('<I', 0x0101000f), struct.pack('<I', 0x01010003)))
    assert 'not a boolean on <application>' in refused(manifest(0, on='activity'))
    assert 'not a boolean on <application>' in refused(manifest(0, on='manifest'))
    assert 'not a boolean on <application>' in refused(manifest(0, kind=0x10))
    assert 'not a binary XML file' in refused(before[:-4]) and 'not a binary XML file' in refused(b'<manifest/>')
    print('ok manifest: refused without the attribute, on another tag, with another type, on a cut file')


def test_failed_sign():
    """A wrong keystore password: no full-size temporary APK and no half-signed output stay behind."""
    import argparse, shutil, subprocess, zipfile
    from unittest import mock

    sign_ok = False

    def fake_run(args, **kw):
        args = [str(x) for x in args]
        if Path(args[0]).name.startswith('zipalign'):
            shutil.copyfile(args[-2], args[-1])
        elif 'sign' in args:
            out = Path(args[args.index('--out') + 1])
            if not sign_ok:
                out.write_bytes(b'PK half written')
                return subprocess.CompletedProcess(args, 1, '', 'keystore password was incorrect')
            shutil.copyfile(args[-1], out)
            Path(str(out) + '.idsig').write_bytes(b'idsig')
        return subprocess.CompletedProcess(args, 0, '', '')

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        apk = tmp / 'in.apk'
        with zipfile.ZipFile(apk, 'w') as z:
            z.writestr(playtest_apk.MANIFEST, manifest(0))
            z.writestr('assets/data', b'data')
            z.writestr('META-INF/CERT.RSA', b'old signature')
        tools = tmp / 'bt'
        (tools / 'lib').mkdir(parents=True)
        (tools / 'zipalign.exe').write_bytes(b'')
        (tools / 'lib' / 'apksigner.jar').write_bytes(b'')
        out = tmp / 'out' / 'playtest.apk'
        a = argparse.Namespace(apk=apk, out=out, build_tools=str(tools), ks=tmp / 'my.jks', ks_pass='pass:wrong',
                               ks_key_alias=None, ks_type=None, java='java')
        with mock.patch.object(playtest_apk.subprocess, 'run', fake_run):
            assert 'keystore password was incorrect' in str(stops(lambda: playtest_apk.build(a)))
            left = sorted(p.name for p in out.parent.iterdir())
            assert left == [], left
            # an earlier build in --out stays as it was when the next sign fails
            out.write_bytes(b'earlier good build')
            assert 'keystore password was incorrect' in str(stops(lambda: playtest_apk.build(a)))
            left = sorted(p.name for p in out.parent.iterdir())
            assert left == ['playtest.apk'] and out.read_bytes() == b'earlier good build', left
            # a good sign replaces it and leaves nothing else
            sign_ok = True
            assert stops(lambda: playtest_apk.build(a)) is None
            left = sorted(p.name for p in out.parent.iterdir())
            assert left == ['playtest.apk'], left
            with zipfile.ZipFile(out) as z:
                assert 'META-INF/CERT.RSA' not in z.namelist()
    print('ok playtest build: a failed sign leaves no temporary or half-signed APK and keeps an earlier output')


def test_store_folder():
    assert save_tool.default_store({}) == Path(save_tool.__file__).resolve().parent / 'saves'
    assert save_tool.default_store({'GCG_SAVES': 'X:/s'}) == Path('X:/s')
    with tempfile.TemporaryDirectory() as tmp:
        old, new = Path(tmp) / 'old', Path(tmp) / 'new'
        assert save_tool.old_store_note(new, old) == ''
        (old / '20261115-010829').mkdir(parents=True)
        assert str(old) in save_tool.old_store_note(new, old) and str(new) in save_tool.old_store_note(new, old)
        assert save_tool.old_store_note(old, old) == ''
        (new / '20261118-000000').mkdir(parents=True)
        assert save_tool.old_store_note(new, old) == ''
    print('ok store: saves/ next to the script by default, $GCG_SAVES wins, a note for saves in the old folder')


if __name__ == '__main__':
    test_store_folder()
    test_save_tool()
    test_manifest()
    test_failed_sign()
    print('all checks passed')
