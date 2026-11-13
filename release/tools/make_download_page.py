"""Generate a static release download page and exact SHA-256 inventory.

Only public artifact names, sizes and hashes are rendered. The manifest signature
and all APK/pack bytes are verified locally; no credentials or player data are read.
This tool does not upload or deploy anything.
"""
from pathlib import Path
import argparse
import hashlib
from html import escape
import json
import re
from urllib.parse import urlsplit

from release_crypto import verify

RELEASE = Path(__file__).resolve().parents[1]


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def checked(path, size, sha256):
    if not isinstance(size, int) or size <= 0 or not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("Invalid artifact metadata")
    if path.stat().st_size != size or digest(path) != sha256:
        raise ValueError("Artifact bytes differ: " + path.name)


def render(release_id, apk_name, apk_size, packs, expanded):
    total = sum(p["size"] for p in packs)
    rows = "\n".join(f'<tr><td><a href="{escape(p["id"])}.zip">{escape(p["id"])}.zip</a></td><td>{p["size"] / 1048576:.1f} MiB</td></tr>' for p in packs)
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Girl Cafe Gun {escape(release_id)}</title>
<style>
body{{max-width:800px;margin:40px auto;padding:0 20px;background:#161a27;color:#eef0f8;font:17px/1.6 system-ui,sans-serif}}
h1,h2{{line-height:1.2}}a{{color:#c7b7ff}}.download{{display:inline-block;background:#c7b7ff;color:#161a27;padding:12px 20px;border-radius:8px;font-weight:700}}
table{{width:100%;border-collapse:collapse}}th,td{{padding:6px 10px;text-align:left;border-bottom:1px solid #3b4155}}td:last-child{{text-align:right}}code{{overflow-wrap:anywhere}}small{{color:#c4cadb}}
</style></head><body>
<main><h1>Girl Cafe Gun <small>{escape(release_id)}</small></h1>
<p>Play with a local server running on your Android phone. The easiest setup is to install the APK and let the game download its data automatically.</p>
<p><a class="download" href="{escape(apk_name)}" download>Download Girl Cafe Gun APK</a><br><small>{apk_size / 1048576:.1f} MiB · Android 7.0 or newer · ARM32 / ARM64</small></p>
<p>The first data download is approximately <strong>{total / 1000000000:.2f} GB</strong>. Installed resources use approximately {expanded / 1000000000:.2f} GB. Keep at least <strong>8 GB free</strong> for installation. Downloads can resume after an interruption.</p>
<h2>Manual data installation</h2>
<p>Automatic installation is recommended. For manual setup, install and open the APK once, close it, then download <strong>all {len(packs)} packs</strong> below. Extract every pack directly into <code>Android/data/com.zirenmidori.gcg.offline/files/</code>, retaining its internal folders. Do not add an extra enclosing folder. Reopen the game to verify the data.</p>
<p>Recent Android versions may restrict file-manager access to Android/data; a USB connection to a computer is an alternative for copying the initial files.</p>
<table><thead><tr><th>Data pack</th><th>Download size</th></tr></thead><tbody>
{rows}
</tbody></table>
<h2>Verify the release</h2>
<p><a href="checksums.txt">SHA-256 checksums</a> · <a href="manifest.json">Signed manifest</a> · <a href="manifest.sig">Manifest signature</a> · <a href="publickey.der">Publisher public key</a></p>
<p><small>The APK and every data pack must belong to the same release. Keep your installed app when applying future updates so your local profile is preserved.</small></p>
</main></body></html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, default=RELEASE / "artifacts/GCG-Offline-v0.1.0.apk")
    parser.add_argument("--apk-report", type=Path)
    parser.add_argument("--manifest", type=Path, default=RELEASE / "android/assets/gcg-release/manifest.json")
    parser.add_argument("--signature", type=Path, default=RELEASE / "android/assets/gcg-release/manifest.sig")
    parser.add_argument("--public-key", type=Path, default=RELEASE / "android/assets/gcg-release/publickey.der")
    parser.add_argument("--data-dir", type=Path, default=RELEASE / "artifacts/data")
    parser.add_argument("--output-dir", type=Path, default=RELEASE / "artifacts/hosting")
    args = parser.parse_args()
    if not re.fullmatch(r"GCG-Offline-[A-Za-z0-9._-]+\.apk", args.apk.name):
        raise ValueError("Invalid public APK filename")
    report = json.loads((args.apk_report or args.apk.with_suffix(".report.json")).read_text(encoding="utf8"))
    checked(args.apk, report["bytes"], report["sha256"])
    if digest(args.manifest) != report["manifestSha256"]:
        raise ValueError("Manifest differs from the APK report")
    verify(args.manifest, args.signature, args.public_key)
    manifest = json.loads(args.manifest.read_text(encoding="utf8"))
    release_id = manifest["releaseId"]
    if manifest["schemaVersion"] != 1 or manifest["kind"] != "full" or manifest["packageName"] != "com.zirenmidori.gcg.offline" or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", release_id):
        raise ValueError("Unexpected full release manifest")
    packs = manifest["packs"]
    if not packs or len(packs) > 1024 or len({p["id"] for p in packs}) != len(packs):
        raise ValueError("Invalid pack inventory")
    checksums = [(report["sha256"], args.apk.name)]
    for pack in packs:
        if not re.fullmatch(r"data-\d{3}", pack["id"]) or urlsplit(pack["url"]).scheme != "https" or urlsplit(pack["url"]).path != f'/{release_id}/{pack["id"]}.zip':
            raise ValueError("Pack URL and public release route differ")
        filename = pack["id"] + ".zip"
        checked(args.data_dir / filename, pack["size"], pack["sha256"])
        checksums.append((pack["sha256"], filename))
    for name, source in [("manifest.json", args.manifest), ("manifest.sig", args.signature), ("publickey.der", args.public_key)]:
        checksums.append((digest(source), name))
    expanded = sum(row["size"] for row in manifest["files"])
    page = render(release_id, args.apk.name, report["bytes"], packs, expanded).encode("utf8")
    checksums.append((hashlib.sha256(page).hexdigest(), "index.html"))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "index.html").write_bytes(page)
    (args.output_dir / "checksums.txt").write_text("".join(f"{sha256}  {name}\n" for sha256, name in checksums), encoding="ascii", newline="\n")
    print(json.dumps({"releaseId": release_id, "apkSha256": report["sha256"], "packs": len(packs), "downloadBytes": sum(p["size"] for p in packs), "expandedBytes": expanded, "checksums": len(checksums), "publicFiles": ["index.html", "checksums.txt"], "privateDataIncluded": False}))


if __name__ == "__main__":
    main()
