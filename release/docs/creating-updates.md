# Creating a resource update

Use Python 3.10 or newer and a JDK (Java and javac on the same installation).
Set `GCG_JAVA` to the Java executable if it is not discovered automatically.
Work from the repository root. Keep a backup of the installed release's full
manifest: its `releaseId` is the update's required base.

1. Create a `changes/` directory with only changed/new resources at their normal
   relative paths, such as `changes/lang.u` or `changes/npc/example.u`.
2. Give the update a new release ID. Run:

   ```sh
   python release/tools/make_update.py --base-manifest inputs/manifest.json --changes changes --release-id community-001 --output outputs/community-001.gcgupdate
   ```

3. The first invocation creates a private signing identity under
   `release/private/signing/` and embeds its **public** verification key in the
   update. Preserve the private key securely; do not publish it. Share the public
   key's SHA-256 fingerprint through a trusted channel so players can compare the
   one-time trust prompt.
4. Import the package through the login Update button. It must match the
   currently committed base release and pass verification before publication.

Use `--remove path/to/obsolete.u` for an intentional resource deletion.
`version.data` must agree with changed asset bundles and their routes, sizes and
CRCs. The tool signs bytes; it cannot validate every game's gameplay schema.

For an embedded server change, build a clean payload from the server source and
add `--server-payload outputs/payload.zip`. Payloads must exclude player state,
logs, profile tools and development configuration. Persistent player data remains
outside payloads.

Official APK deltas additionally take `--base-apk`, `--target-apk`,
`--version-code` and `--certificate`. Both APKs must have the same package and
publisher certificate, and the target version code must increase. Preserve the
exact signed source APK: re-signing or re-compressing it changes its identity.
The delta reuses identical compressed members and stores only the remaining
bytes. Android reconstructs and verifies the exact signed target APK before
showing its installer. Only the APK's original publisher key can authorize this
operation; another data publisher cannot replace it.

For a sequence of community updates, retain a complete manifest for each
resulting resource state. A delta's changed-file list is not a complete full
manifest and must not be used as if it were one.
