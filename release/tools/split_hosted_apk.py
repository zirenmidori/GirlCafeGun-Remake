"""Split an exact APK into immutable private R2 parts for streamed public delivery.

No uploads, deployment or credentials. Upload parts under the printed R2 keys,
then deploy the Worker with the generated metadata index.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import os


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def split(apk, release_id, output_dir, index_path, part_size=200 * 1024 * 1024):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", release_id):
        raise ValueError("Invalid release ID")
    if not re.fullmatch(r"GCG-Offline-[A-Za-z0-9._-]+\.apk", apk.name):
        raise ValueError("Expected a public GCG-Offline-*.apk filename")
    if not 0 < part_size <= 250 * 1024 * 1024:
        raise ValueError("Parts must be at most 250 MiB")
    size = apk.stat().st_size
    if size <= 0 or (size + part_size - 1) // part_size > 32:
        raise ValueError("APK requires between 1 and 32 parts")
    whole_hash = digest(apk)
    output_dir.mkdir(parents=True, exist_ok=True)
    parts = []
    with apk.open("rb") as source:
        for i in range((size + part_size - 1) // part_size):
            name = f"part-{i:03}.bin"
            target = output_dir / name
            temporary = output_dir / (name + ".tmp")
            h = hashlib.sha256()
            remaining = min(part_size, size - source.tell())
            count = remaining
            try:
                with temporary.open("xb") as out:
                    while remaining:
                        block = source.read(min(1024 * 1024, remaining))
                        if not block:
                            raise ValueError("APK changed while splitting")
                        h.update(block)
                        out.write(block)
                        remaining -= len(block)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(temporary, target)
            finally:
                if temporary.exists():
                    temporary.unlink()
            part_hash = h.hexdigest()
            if target.stat().st_size != count or digest(target) != part_hash:
                raise ValueError("Split part readback differs")
            parts.append({"key": f"_apk/{release_id}/{whole_hash}/{name}", "size": count, "sha256": part_hash})
        if source.read(1):
            raise ValueError("APK grew while splitting")
    joined = hashlib.sha256()
    for i in range(len(parts)):
        with (output_dir / f"part-{i:03}.bin").open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                joined.update(block)
    if joined.hexdigest() != whole_hash or apk.stat().st_size != size:
        raise ValueError("Reconstructed APK differs from input")
    index = json.loads(index_path.read_text(encoding="utf8")) if index_path.exists() else {"schemaVersion": 1, "apks": {}}
    if index.get("schemaVersion") != 1 or not isinstance(index.get("apks"), dict):
        raise ValueError("Invalid existing APK index")
    public_key = f"{release_id}/{apk.name}"
    index["apks"][public_key] = {"size": size, "sha256": whole_hash, "parts": parts}
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_temp = index_path.with_name(index_path.name + ".tmp")
    with index_temp.open("w", encoding="utf8", newline="\n") as out:
        out.write(json.dumps(index, indent=2) + "\n")
        out.flush()
        os.fsync(out.fileno())
    os.replace(index_temp, index_path)
    return {"publicKey": public_key, "size": size, "sha256": whole_hash, "parts": [{**row, "file": str(output_dir / f"part-{i:03}.bin")} for i, row in enumerate(parts)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(split(args.apk, args.release_id, args.output_dir, args.index), indent=2))


if __name__ == "__main__":
    main()
