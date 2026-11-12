"""Offline GCG binary version.data inspector and single-record staging patcher.

Inspection and --self-test never write. Patching refuses existing/in-place output
and permits output only inside this content-recovery directory. It does not
contact a device, start a server, or execute game/patch code.

Examples:
  python -B version_manifest.py client.apk --member assets/version.data --self-test
  python -B version_manifest.py pulled-version.data --patch-bundle lua.u \
      --size 10810569 --crc 3475597504 --output integration/version.lua-staged.data
"""
from __future__ import annotations
import argparse, hashlib, json, struct, zipfile
from dataclasses import dataclass
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent
MAX_BYTES = 64 * 1024 * 1024
MAX_COUNT = 1_000_000

class ManifestError(ValueError):
    pass

@dataclass(frozen=True)
class BundleRecord:
    name: str
    size: int
    crc_text: str
    dependencies: tuple[int, ...]
    flag: int
    updated: int
    instream: int
    start: int
    end: int
    size_offset: int
    crc_prefix_offset: int
    crc_value_offset: int
    crc_end: int

    def metadata(self):
        return {'name': self.name, 'size': self.size, 'crc': int(self.crc_text),
                'crcText': self.crc_text, 'dependencies': list(self.dependencies),
                'flag': self.flag, 'updated': self.updated, 'instream': self.instream}

class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.position = 0

    def take(self, length: int) -> bytes:
        if length < 0 or self.position + length > len(self.data):
            raise ManifestError(f'Truncated field at byte {self.position}, requested {length}')
        value = self.data[self.position:self.position + length]
        self.position += length
        return value

    def number(self, fmt: str):
        return struct.unpack(fmt, self.take(struct.calcsize(fmt)))[0]

    def count(self, label: str) -> int:
        value = self.number('<I')
        if value > MAX_COUNT:
            raise ManifestError(f'Implausible {label} count: {value}')
        return value

    def string(self) -> tuple[str, int, int, int]:
        prefix = self.position
        length = 0
        for shift in range(0, 35, 7):
            value = self.number('<B')
            if shift == 28 and value > 15:
                raise ManifestError(f'Invalid .NET string length at byte {prefix}')
            length |= (value & 127) << shift
            if value < 128:
                content = self.position
                try:
                    text = self.take(length).decode('utf8')
                except UnicodeDecodeError as error:
                    raise ManifestError(f'Invalid UTF8 string at byte {content}') from error
                return text, prefix, content, self.position
        raise ManifestError(f'Unterminated string length at byte {prefix}')

class Manifest:
    def __init__(self, data: bytes):
        if len(data) > MAX_BYTES:
            raise ManifestError('Manifest exceeds the 64 MiB input limit')
        self.data = data
        r = Reader(data)
        self.version = r.number('<i')
        self.build_version = r.number('<i')
        self.pack_counter = r.number('<i')
        self.pack_count = r.count('pack')
        for _ in range(self.pack_count):
            r.string()
            r.take(9)  # pack size:uint32, count:int32, isVoice:byte
            r.string()
        self.bundle_count = r.count('bundle-name')
        self.bundle_names = [r.string()[0] for _ in range(self.bundle_count)]
        self.a2b_count = r.count('asset-to-bundle')
        self.a2b_offset = r.position
        self.a2b = [struct.unpack('<II', r.take(8)) for _ in range(self.a2b_count)]
        if any(index >= self.bundle_count for _, index in self.a2b):
            raise ManifestError('Asset-to-bundle index exceeds bundle-name count')
        self.record_count = r.count('abinfo')
        self.records = []
        for _ in range(self.record_count):
            start = r.position
            name = r.string()[0]
            size_offset = r.position
            size = r.number('<q')
            if size < 0:
                raise ManifestError(f'Negative bundle size for {name!r}')
            crc_text, prefix, content, crc_end = r.string()
            if not crc_text or not crc_text.isascii() or not crc_text.isdecimal() or int(crc_text) > 0xffffffff:
                raise ManifestError(f'Invalid decimal uint32 CRC for {name!r}: {crc_text!r}')
            dependencies = tuple(r.number('<i') for _ in range(r.count('dependency')))
            if any(index < 0 or index >= self.bundle_count for index in dependencies):
                raise ManifestError(f'Dependency index exceeds bundle-name count for {name!r}')
            flag = r.number('<i')
            updated, instream = r.number('<B'), r.number('<B')
            if updated not in (0, 1) or instream not in (0, 1):
                raise ManifestError(f'Invalid boolean bytes for {name!r}')
            self.records.append(BundleRecord(name, size, crc_text, dependencies, flag,
                                             updated, instream, start, r.position,
                                             size_offset, prefix, content, crc_end))
        self.tail_offset = r.position
        self.opaque_tail = data[r.position:]

    def one(self, name: str) -> BundleRecord:
        rows = [row for row in self.records if row.name == name]
        if len(rows) != 1:
            raise ManifestError(f'Expected exactly one {name!r} record, found {len(rows)}')
        return rows[0]

    def summary(self, names):
        selected = []
        for name in names:
            row = self.one(name)
            selected.append({**row.metadata(), 'recordOffset': row.start,
                             'recordEnd': row.end, 'sizeOffset': row.size_offset,
                             'crcPrefixOffset': row.crc_prefix_offset,
                             'crcValueOffset': row.crc_value_offset,
                             'crcEnd': row.crc_end})
        return {'format': 'GCG binary version.data; little endian/.NET strings',
                'bytes': len(self.data), 'sha256': sha(self.data),
                'version': self.version, 'buildVersion': self.build_version,
                'packCounter': self.pack_counter, 'packEntries': self.pack_count,
                'bundleNames': self.bundle_count, 'a2bEntries': self.a2b_count,
                'abinfoEntries': self.record_count, 'parsedBytes': self.tail_offset,
                'opaqueTailBytes': len(self.opaque_tail), 'records': selected}

def require(condition, message):
    if not condition:
        raise ManifestError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def encode_string(text):
    body = text.encode('utf8')
    length = len(body)
    prefix = bytearray()
    while length >= 128:
        prefix.append((length & 127) | 128)
        length >>= 7
    prefix.append(length)
    return bytes(prefix) + body

def patched_bytes(before: Manifest, name: str, size=None, crc=None):
    row = before.one(name)
    desired_size = row.size if size is None else size
    desired_crc = int(row.crc_text) if crc is None else crc
    if not 0 <= desired_size <= 0x7fffffffffffffff:
        raise ManifestError('Size must be a nonnegative int64')
    if not 0 <= desired_crc <= 0xffffffff:
        raise ManifestError('CRC must be a uint32')
    size_bytes = before.data[row.size_offset:row.size_offset + 8] if desired_size == row.size else struct.pack('<q', desired_size)
    crc_bytes = before.data[row.crc_prefix_offset:row.crc_end] if desired_crc == int(row.crc_text) else encode_string(str(desired_crc))
    output = before.data[:row.size_offset] + size_bytes + crc_bytes + before.data[row.crc_end:]
    after = Manifest(output)
    target = after.one(name)
    # Everything before size64 and after the complete CRC field is copied verbatim.
    require(output[:target.size_offset] == before.data[:row.size_offset], 'Bytes before target fields changed')
    require(output[target.crc_end:] == before.data[row.crc_end:], 'Bytes after target fields changed')
    require(len(before.records) == len(after.records), 'Record count changed')
    for old, new in zip(before.records, after.records):
        if old.name != name:
            require(before.data[old.start:old.end] == output[new.start:new.end], f'Other record changed: {old.name}')
        else:
            require(new.name == old.name, 'Target name changed')
            require(new.size == desired_size and int(new.crc_text) == desired_crc, 'Target values failed verification')
            require((old.dependencies, old.flag, old.updated, old.instream) == (new.dependencies, new.flag, new.updated, new.instream), 'Other target fields changed')
    require(before.opaque_tail == after.opaque_tail, 'Opaque tail changed')
    require(before.bundle_names == after.bundle_names and before.a2b == after.a2b, 'Name/asset mapping tables changed')
    return output, after

def self_test(document: Manifest):
    row = document.one('lua.u')
    same, _ = patched_bytes(document, 'lua.u', row.size, int(row.crc_text))
    require(same == document.data, 'No-op was not byte exact')
    requested, requested_doc = patched_bytes(document, 'lua.u', 10810569, 3475597504)
    changed, changed_doc = patched_bytes(document, 'lua.u', row.size, 0)
    restored, _ = patched_bytes(changed_doc, 'lua.u', row.size, int(row.crc_text))
    require(restored == document.data, 'Length-changing CRC roundtrip was not byte exact')
    with_tail = Manifest(document.data + b'\xffGCG_OPAQUE_TAIL\x00')
    tail_result, tail_doc = patched_bytes(with_tail, 'lua.u', 10810569, 3475597504)
    require(tail_doc.opaque_tail == with_tail.opaque_tail, 'Opaque-tail test failed')
    require(tail_result.endswith(b'\xffGCG_OPAQUE_TAIL\x00'), 'Opaque-tail sentinel was not preserved')
    return {'noOpByteExact': True, 'requestedLuaPatchVerifiedInMemory': True,
            'changedCrcStringLengthAndRestoredByteExact': True,
            'opaqueTailPreserved': True, 'noFilesWritten': True,
            'requestedPatch': requested_doc.summary(['lua.u', 'setting.u']),
            'lengthChangingExample': {'beforeBytes': len(document.data), 'crcZeroBytes': len(changed)}}

def read_input(path, member):
    if member:
        with zipfile.ZipFile(path) as archive:
            info = archive.getinfo(member)
            if info.file_size > MAX_BYTES:
                raise ManifestError('Archive member exceeds 64 MiB limit')
            return archive.read(info)
    if path.stat().st_size > MAX_BYTES:
        raise ManifestError('Input exceeds 64 MiB; use --member for an APK/ZIP entry')
    return path.read_bytes()

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', type=Path)
    ap.add_argument('--member', help='Read this exact APK/ZIP member in memory')
    ap.add_argument('--bundle', action='append', help='Inspect this exact abinfo name; repeatable')
    ap.add_argument('--self-test', action='store_true', help='Run byte-preservation checks only in memory')
    ap.add_argument('--patch-bundle', help='Change only one exact abinfo record; requires --output')
    ap.add_argument('--size', type=int)
    ap.add_argument('--crc', type=int, help='Decimal uint32 CRC')
    ap.add_argument('--output', type=Path, help='New staged file inside content-recovery; never overwritten')
    args = ap.parse_args()
    try:
        input_path = args.source.resolve(strict=True)
        before = Manifest(read_input(input_path, args.member))
        report = {'source': str(input_path), 'member': args.member,
                  'inspection': before.summary(args.bundle or ['lua.u', 'setting.u'])}
        if args.self_test:
            report['selfTest'] = self_test(before)
        if args.patch_bundle:
            if args.output is None or (args.size is None and args.crc is None):
                raise ManifestError('Patching requires --output and at least one of --size/--crc')
            destination = args.output.resolve() if args.output.is_absolute() else (TOOL_ROOT / args.output).resolve()
            if not destination.is_relative_to(TOOL_ROOT) or destination == input_path:
                raise ManifestError('Output must be a separate staged path inside content-recovery')
            if destination.exists():
                raise ManifestError('Output already exists; overwrite/in-place editing is forbidden')
            output, after = patched_bytes(before, args.patch_bundle, args.size, args.crc)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as stream:
                stream.write(output)
            report['stagedOutput'] = {'path': str(destination), 'bytes': len(output),
                                      'sha256': sha(output), 'byteDelta': len(output) - len(before.data),
                                      'changedRecord': after.summary([args.patch_bundle])['records'][0],
                                      'otherRecordsByteExact': True, 'opaqueTailByteExact': True}
        elif args.output is not None or args.size is not None or args.crc is not None:
            raise ManifestError('--size/--crc/--output require --patch-bundle')
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except (ManifestError, OSError, zipfile.BadZipFile, KeyError, AssertionError) as error:
        ap.exit(2, f'ERROR: {error}\n')

if __name__ == '__main__':
    main()
