# Release preparation status

The public source is a release candidate, not a claim of completed on-device
release validation. Server behavior and host-side updater transactions have
passed their checks. Final first-install, Android picker/installer and gameplay
smoke checks remain before publication of the APK.

Automatic initial downloads require verified public HTTPS pack URLs. The current
temporary hosting probes have not yet established a reliable direct-download
provider. No APK with placeholder or failed download URLs should be distributed.
The implementation also supports manually placed, matching initial data and
offline `.gcgupdate` imports.

Data reconstruction retains the original legacy Wwise wrapper index entries;
many wrappers are absent from every supplied distribution while raw Android
bank/media files are present. Their native loading path needs a final audit;
missing wrapper files are not replaced with fabricated content.

The original developer APK, cache and source checkpoint are preserved privately.
The clean package has a different application ID and does not reuse personal
test profiles.
