"""Make a playtest copy of a GCG Offline APK: the same APK with android:debuggable set, signed with your key.

Why: the save is in the private storage of the app. `adb shell run-as` reaches it only in a debuggable
build, and the release build sets android:debuggable="false" on purpose. save_tool.py in this folder needs
a playtest build.

What changes: four bytes of AndroidManifest.xml (the value of the one attribute) and the signature. Every
other entry is copied with its compression method.

A playtest build is for your own device. Do not publish it: on a debuggable build every computer with adb
access to the phone can read and change the app's private files.

  python tools/save-tool/playtest_apk.py --apk GCG-Offline-v0.1.3.apk --out GCG-Offline-playtest.apk \\
      --build-tools <Android SDK>/build-tools/<version> --ks my-key.p12 --ks-pass file:my-key-password.txt

The key is yours (for example: keytool -genkeypair -keyalg RSA -keysize 3072 -validity 3650 -storetype PKCS12
-keystore my-key.p12 -alias playtest). Android installs an APK over another one only when both have the same
signer. Moving from the published APK to your playtest build therefore needs an uninstall, which deletes the
save and the downloaded game data; later playtest builds with the same key install with `adb install -r`.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, shutil, struct, subprocess, sys, zipfile
from pathlib import Path

MANIFEST = 'AndroidManifest.xml'
ATTR_DEBUGGABLE = 0x0101000f
TYPE_BOOLEAN = 0x12
sha = lambda b: hashlib.sha256(b).hexdigest()


def debuggable_manifest(axml):
    """Return the binary manifest with android:debuggable set to true on <application>, and the offset changed.

    The release manifest holds the attribute with the value false, so the file keeps its size. A manifest
    without the attribute, or with it anywhere else than on <manifest>/<application>, is refused.
    """
    u16 = lambda o: struct.unpack_from('<H', axml, o)[0]
    u32 = lambda o: struct.unpack_from('<I', axml, o)[0]
    if len(axml) < 8 or u16(0) != 0x0003 or u32(4) != len(axml):
        raise ValueError('not a binary XML file')
    pool = u16(2)
    if u16(pool) != 0x0001:
        raise ValueError('no string pool')
    resource_map = pool + u32(pool + 4)
    if u16(resource_map) != 0x0180:
        raise ValueError('no resource map')
    ids = [u32(resource_map + 8 + 4 * i) for i in range((u32(resource_map + 4) - 8) // 4)]
    if ATTR_DEBUGGABLE not in ids:
        raise ValueError('the manifest has no android:debuggable attribute')
    name = ids.index(ATTR_DEBUGGABLE)  # an attribute name has the index of its id in the resource map
    out = bytearray(axml)
    at, depth, hits = resource_map + u32(resource_map + 4), 0, []
    while at < len(axml):
        kind, size = u16(at), u32(at + 4)
        if size < 8 or at + size > len(axml):
            raise ValueError('broken chunk at %d' % at)
        if kind == 0x0102:
            depth += 1
            start, each, count = struct.unpack_from('<3H', axml, at + 24)
            if each != 20:
                raise ValueError('unknown attribute size')
            for i in range(count):
                row = at + 16 + start + 20 * i
                if u32(row + 4) == name:
                    if depth != 2 or axml[row + 15] != TYPE_BOOLEAN:
                        raise ValueError('android:debuggable is not a boolean on <application>')
                    struct.pack_into('<I', out, row + 16, 0xFFFFFFFF)
                    hits.append((row + 16, u32(row + 16)))
        elif kind == 0x0103:
            depth -= 1
        at += size
    if len(hits) != 1:
        raise ValueError('android:debuggable occurs %d times' % len(hits))
    return bytes(out), {'offset': hits[0][0], 'valueBefore': hits[0][1], 'bytes': len(out)}


def signature_file(name):
    return re.fullmatch(r'META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))', name, re.I) is not None


def build(a):
    tools = Path(a.build_tools)
    zipalign = next((tools / n for n in ('zipalign.exe', 'zipalign') if (tools / n).is_file()), None)
    apksigner = tools / 'lib' / 'apksigner.jar'
    java = a.java or shutil.which('java')
    if not zipalign or not apksigner.is_file() or not java:
        sys.exit('need zipalign and lib/apksigner.jar in --build-tools, and java on PATH or in --java')

    def run(args):
        r = subprocess.run([str(x) for x in args], capture_output=True, text=True)
        if r.returncode:
            sys.exit('failed: %s\n%s\n%s' % (args[0], r.stdout, r.stderr))
        return r.stdout

    with zipfile.ZipFile(a.apk) as src:
        manifest, proof = debuggable_manifest(src.read(MANIFEST))
    if proof['valueBefore']:
        sys.exit('this APK is already debuggable: nothing to do')
    unsigned, aligned = a.out.with_suffix('.unsigned.apk'), a.out.with_suffix('.aligned.apk')
    signed = a.out.with_suffix('.signed.apk')
    a.out.parent.mkdir(parents=True, exist_ok=True)
    # The temporary files are full-size APKs: they go also when a step fails (a wrong keystore password).
    # apksigner writes to a temporary name; --out is replaced only by an APK that passed verify, so a failed
    # run keeps an earlier output and never leaves a half-signed one.
    dropped = []
    try:
        with zipfile.ZipFile(a.apk) as src, zipfile.ZipFile(unsigned, 'w', allowZip64=False) as dst:
            for info in src.infolist():
                if signature_file(info.filename):
                    dropped.append(info.filename)
                    continue
                row = zipfile.ZipInfo(info.filename, info.date_time)
                row.compress_type, row.external_attr, row.create_system = info.compress_type, info.external_attr, info.create_system
                dst.writestr(row, manifest if info.filename == MANIFEST else src.read(info),
                             compress_type=info.compress_type, compresslevel=6)
        run([zipalign, '-f', '-p', '4', unsigned, aligned])
        sign = [java, '-jar', apksigner, 'sign', '--ks', a.ks, '--ks-pass', a.ks_pass, '--out', signed]
        if a.ks_key_alias:
            sign += ['--ks-key-alias', a.ks_key_alias]
        if a.ks_type:
            sign += ['--ks-type', a.ks_type]
        run(sign + [aligned])
        certs = run([java, '-jar', apksigner, 'verify', '--print-certs', signed])
        os.replace(signed, a.out)
    finally:
        for temp in (unsigned, aligned, signed, Path(str(signed) + '.idsig')):
            temp.unlink(missing_ok=True)
    with zipfile.ZipFile(a.apk) as src, zipfile.ZipFile(a.out) as dst:
        before = {i.filename: i.CRC for i in src.infolist() if not signature_file(i.filename)}
        after = {i.filename: i.CRC for i in dst.infolist() if not i.filename.startswith('META-INF/')}
        kept = {n: c for n, c in before.items() if not n.startswith('META-INF/')}
        changed = sorted(n for n in kept if kept[n] != after.get(n))
        assert changed == [MANIFEST] and set(after) == set(kept), changed
        assert dst.read(MANIFEST) == manifest
    print(json.dumps({'file': str(a.out), 'bytes': a.out.stat().st_size, 'sha256': sha(a.out.read_bytes()),
                      'onlyChangedEntry': MANIFEST, 'manifest': proof, 'signatureFilesDropped': dropped,
                      'signer': [line.strip() for line in certs.splitlines() if 'certificate DN' in line or 'SHA-256' in line]},
                     indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--apk', type=Path, required=True, help='a GCG Offline APK (a release build)')
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--build-tools', required=True, help='Android SDK build-tools folder (zipalign, lib/apksigner.jar)')
    p.add_argument('--ks', type=Path, required=True, help='your keystore')
    p.add_argument('--ks-pass', required=True, help='as apksigner takes it, for example file:password.txt')
    p.add_argument('--ks-key-alias'); p.add_argument('--ks-type'); p.add_argument('--java')
    build(p.parse_args())


if __name__ == '__main__':
    main()
