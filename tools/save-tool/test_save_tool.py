"""Checks of save_tool.py and playtest_apk.py that need no phone: python tools/save-tool/test_save_tool.py"""
import contextlib, io, json, struct, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import playtest_apk
import save_tool


class FakePhone:
    """A phone that keeps the private folder of the app in memory."""
    package = save_tool.PACKAGE

    def __init__(self, save=None, daily=None, debuggable=True):
        self.save, self.daily, self.debuggable, self.stops = save, dict(daily or {}), debuggable, 0

    def check(self):
        if not self.debuggable:
            sys.exit('the tool cannot reach the save: the installed APK is not debuggable.')

    def model(self): return 'Test phone'
    def stop(self): self.stops += 1
    def has_save(self): return self.save is not None
    def read_save(self): return self.save
    def daily_names(self): return sorted(self.daily)
    def read_daily(self, name): return self.daily[name]

    def write_save(self, source):
        self.save, self.daily = Path(source).read_bytes(), {}
        return ''

    def remove_save(self):
        self.save, self.daily = None, {}
        return ''


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
    print('all checks passed')
