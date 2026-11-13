# Release download host

A read-only Cloudflare Worker serves immutable release objects from a private R2
bucket. It supports HTTPS GET/HEAD and single byte ranges for download resume.
There are no public upload routes, credentials or player saves. Restrict upload
credentials to the release bucket and keep them outside source control.

Complete Cloudflare account and R2 billing activation yourself, then authenticate
the official Wrangler CLI. Create `gcg-offline-releases`, upload the verified
artifacts under their release ID (for example `0.1.0/data-000.zip`), and deploy
this Worker. No custom domain is required for a `workers.dev` endpoint.

R2 Standard includes a monthly storage/operation allowance; extra usage may be
billed. Workers Free also has request limits. Review your account's current
pricing and usage. Do not enable a paid Workers plan just for this setup.

Verify a full pack download and byte-range response from the actual public
endpoint before writing it into a signed bootstrap manifest. Published object
keys should be immutable after a release is announced: give changed bytes a new
release ID. The user-approved 0.1.2 migration consolidates the first-release
staging objects into a complete base; future releases should use new IDs. APK
and game-data files remain outside GitHub.

Release 0.1.2 is the self-contained full base: its signed manifest lists all 34
packs under `0.1.2/`, and its download page links only to that prefix. This keeps
new installations independent of the retired 0.1.0 and 0.1.1 full-data folders.
The two small signed update deltas from 0.1.0 and 0.1.1 remain under `0.1.2/` so
existing installations can still migrate. `upload_r2_base_012.py` validates the
manifest signature, pack hashes, APK and split-part hashes before uploading the
base. For future releases, a full manifest may reuse unchanged packs from an
earlier release directory; its page must link every pack at its actual object
path.

Changing an account's `workers.dev` subdomain changes its public URLs. Rebuild
and sign the full manifest with the new host, then publish a paired APK/resource
delta and update the signed channel. The APK's manual online channel is hosted
in the source repository, independently of the artifact host. Do not redirect
old immutable pack keys to different bytes.

Wrangler and the dashboard limit individual uploads to 300 MB. The APK is larger,
so `split_hosted_apk.py` creates two immutable private parts and an `apk-index.json`.
Upload each part under its exact generated key before deploying the index. The
Worker streams them through one ordinary APK URL, preserving Content-Length,
ETag and byte-range resume with bounded memory. Private part paths return 404.
Verify the entire public APK's SHA-256 and a range spanning a part boundary.
