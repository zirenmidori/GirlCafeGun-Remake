"""Validate and upload the complete immutable 0.1.2 R2 base plus APK parts.

The upload is resumable through a local receipt and uses the existing Wrangler
login. It intentionally leaves old objects untouched; retire superseded chunks
only after the Worker is deployed and verified.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
import time

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / "release"
PACKAGE = RELEASE / "artifacts/r2-upload-0.1.2-selfcontained"
VERSION_DIR = PACKAGE / "0.1.2"
RECEIPT = PACKAGE / "r2-upload-receipt.json"
BUCKET = "gcg-offline-releases"
WRANGLER_LAUNCHER = RELEASE / "tools/cloudflare.ps1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate() -> list[tuple[str, Path, str]]:
    manifest_path = VERSION_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (manifest.get("releaseId") != "0.1.2" or manifest.get("kind") != "full"
            or manifest.get("baseReleaseId") is not None):
        raise ValueError("Expected the signed full 0.1.2 base manifest")
    packs = manifest.get("packs")
    if not isinstance(packs, list) or len(packs) != 34:
        raise ValueError("Expected exactly 34 full data packs")
    expected_ids = [f"data-{i:03}" for i in range(34)]
    if [row.get("id") for row in packs] != expected_ids:
        raise ValueError("Data pack IDs are missing or out of order")

    # Verify manifest signature against the bundled publisher key.
    sys.path.insert(0, str(RELEASE / "tools"))
    from release_crypto import verify as verify_signature
    verify_signature(manifest_path, VERSION_DIR / "manifest.sig", VERSION_DIR / "publickey.der")

    artifacts: list[tuple[str, Path, str]] = []
    total_pack_bytes = 0
    for row in packs:
        pack_id = row["id"]
        if not row.get("url", "").endswith(f"/0.1.2/{pack_id}.zip"):
            raise ValueError(f"Pack URL does not point to the 0.1.2 base: {pack_id}")
        path = VERSION_DIR / f"{pack_id}.zip"
        if path.stat().st_size != row["size"] or sha256(path) != row["sha256"]:
            raise ValueError(f"Pack size or SHA-256 differs from signed manifest: {pack_id}")
        artifacts.append((f"0.1.2/{pack_id}.zip", path, "application/zip"))
        total_pack_bytes += row["size"]

    # Readable release metadata is uploaded after the packs.
    for name, content_type in (
        ("manifest.json", "application/json"),
        ("manifest.sig", "application/octet-stream"),
        ("publickey.der", "application/octet-stream"),
        ("checksums.txt", "text/plain; charset=utf-8"),
        ("index.html", "text/html; charset=utf-8"),
    ):
        artifacts.append((f"0.1.2/{name}", VERSION_DIR / name, content_type))

    # The worker uses this index to stream the public APK URL from private parts.
    package_index = json.loads((PACKAGE / "apk-index.json").read_text(encoding="utf-8"))
    worker_index = json.loads((RELEASE / "hosting/apk-index.json").read_text(encoding="utf-8"))
    if package_index != worker_index:
        raise ValueError("Worker APK index does not match the prepared package")
    apk = package_index["apks"]["0.1.2/GCG-Offline-v0.1.2.apk"]
    full_apk = VERSION_DIR / "GCG-Offline-v0.1.2.apk"
    if full_apk.stat().st_size != apk["size"] or sha256(full_apk) != apk["sha256"]:
        raise ValueError("Full APK differs from the Worker APK index")
    joined = hashlib.sha256()
    for i, part in enumerate(apk["parts"]):
        expected_key = f"_apk/0.1.2/{apk['sha256']}/part-{i:03}.bin"
        if part["key"] != expected_key:
            raise ValueError("Unexpected private APK part key")
        path = PACKAGE / part["key"]
        if path.stat().st_size != part["size"] or sha256(path) != part["sha256"]:
            raise ValueError(f"APK part differs from Worker index: {part['key']}")
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                joined.update(block)
        artifacts.append((part["key"], path, "application/octet-stream"))
    if joined.hexdigest() != apk["sha256"]:
        raise ValueError("Concatenated APK parts differ from the full APK")

    # Keep a concise local receipt for a clean retry after an interrupted upload.
    if RECEIPT.exists():
        try:
            receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            receipt = {}
    else:
        receipt = {}
    if receipt.get("releaseId") != "0.1.2":
        receipt = {"releaseId": "0.1.2", "bucket": BUCKET, "uploaded": {}}
    receipt["validatedPackCount"] = len(packs)
    receipt["validatedPackBytes"] = total_pack_bytes
    RECEIPT.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return artifacts


def upload(artifacts: list[tuple[str, Path, str]]) -> None:
    receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
    uploaded = receipt.setdefault("uploaded", {})
    lock = Lock()

    def save_receipt() -> None:
        temporary = RECEIPT.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        temporary.replace(RECEIPT)

    def upload_one(number: int, item: tuple[str, Path, str]) -> None:
        key, path, content_type = item
        expected = {"size": path.stat().st_size, "sha256": sha256(path)}
        with lock:
            if uploaded.get(key) == expected:
                print(f"[{number}/{len(artifacts)}] already recorded: {key}", flush=True)
                return
        command = [
            "pwsh", "-NoProfile", "-File", str(WRANGLER_LAUNCHER),
            "r2", "object", "put", f"{BUCKET}/{key}",
            "--remote", "--file", str(path),
            "--content-type", content_type,
            "--cache-control", "public, max-age=31536000, immutable",
        ]
        for attempt in range(1, 4):
            print(f"[{number}/{len(artifacts)}] uploading {key} ({expected['size']:,} bytes), attempt {attempt}", flush=True)
            result = subprocess.run(command, cwd=ROOT, text=True, encoding="utf-8", errors="replace", capture_output=True)
            if result.returncode == 0:
                with lock:
                    uploaded[key] = expected
                    receipt["updatedUtc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    save_receipt()
                print(f"[{number}/{len(artifacts)}] done: {key}", flush=True)
                break
            if attempt == 3:
                raise RuntimeError(f"Wrangler failed for {key} (exit {result.returncode})\n{result.stdout}\n{result.stderr}")
            time.sleep(attempt * 3)

    def run_phase(items: list[tuple[str, Path, str]], first_number: int) -> None:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(upload_one, first_number + i, item) for i, item in enumerate(items)]
            for future in as_completed(futures):
                future.result()

    pack_items = [item for item in artifacts if item[0].startswith("0.1.2/data-")]
    metadata_items = [item for item in artifacts if item[0].startswith("0.1.2/") and item not in pack_items]
    apk_items = [item for item in artifacts if item[0].startswith("_apk/")]
    run_phase(pack_items, 1)
    run_phase(metadata_items, len(pack_items) + 1)
    run_phase(apk_items, len(pack_items) + len(metadata_items) + 1)
    print(f"Upload complete: {len(uploaded)} objects recorded in {RECEIPT}", flush=True)


if __name__ == "__main__":
    plan = validate()
    print(f"Preflight passed: {len(plan)} objects; uploading verified full 0.1.2 base and APK parts.", flush=True)
    upload(plan)
