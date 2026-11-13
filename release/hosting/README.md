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
keys are immutable: upload changed bytes under a new release ID, never replace
an existing release in place. APK and game-data files remain outside GitHub.

Wrangler and the dashboard limit individual uploads to 300 MB. The APK is larger,
so `split_hosted_apk.py` creates two immutable private parts and an `apk-index.json`.
Upload each part under its exact generated key before deploying the index. The
Worker streams them through one ordinary APK URL, preserving Content-Length,
ETag and byte-range resume with bounded memory. Private part paths return 404.
Verify the entire public APK's SHA-256 and a range spanning a part boundary.
