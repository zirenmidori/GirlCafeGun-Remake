# Headpats

## Cause and client contract

Legacy saves lacked task2:101 (131173, remaining charges) and2:102 (131174,
refill timestamp). GirlCommon.TouchHeadCount returns zero indefinitely when both
read as0. UI_Main registers the native gesture with a10000 threshold at zero
stock; UI_Girl disables canTouchHead. Normal touch animations can still play,
but the pink progress bar cannot finish and no HeadTouched reaches the server.
The native progress path has no affection-level condition. Restoring charges and
reopening the interaction UI fixes it without an APK, asset or native-library edit.

GirlConfig specifies5 shared charges and3600 seconds per refill. The server uses
the shipped strict elapsed>3600 boundary, preserves partial refill intervals,
clears the timestamp when full, and starts it on the first consumed charge.
Missing legacy fields are initialized lazily at login; valid depleted state is
preserved across restarts. Headpat task values are server-owned.

Normal GirlLogic HeadTouched {nId,nType} accepts type0 (girl page) or1 (home),
validates ownership and consumes one charge. The same atomic save transaction
updates capped affection, unlocks reached secrets/stories, daily mission105 and
matching current oath TouchHead tasks. Max affection still permits successful
headpats and objective progress; no experience overflows the cap. Rejected or
incomplete gestures receive no mission credit.

The callback omits nError on success (even nError:0 is truthy in Lua). Charges,
affection and task notifications precede it so the existing UI redraws correctly.
No-charge errors use nError2, which the client maps to its own message. Retries
with the same positive packet serial and exact JSON reuse a bounded per-connection
response cache. Distinct request serials count as separate completed gestures.

Tutorial type2 is an explicit compatibility choice: its native cartoon gesture
bypasses stock, so preserve the narrative acknowledgement without consuming a
charge, granting affection or incrementing gameplay objectives. This preserves the
working tutorial; its original backend reward policy was not recovered.

## Reconstruction details

The shipped client consumes nAddExp but does not contain the original server's
per-pat reward constant. The reconstruction uses50 affection from the
contemporaneous first-person [GameTeahouse/知北游 play report](https://www.sohu.com/a/363084739_120099888)
(2019-12-27). This value is centralized in HEADPAT_AFFECTION_EXPERIENCE and is
classified as historical gameplay evidence, not a recovered backend constant.
The ordinary and collaboration affection curves/caps reuse the existing tested
gift implementation. No extra runtime file reads or network lookups are needed.

After deployment, fully reopen GCG before testing: a home model created while
stock was0 retains its registered10000 threshold even after a task-value sync.
Its native charge cache also refreshes only every three seconds.

## Verification and rollback

Tests cover legacy initialization, strict refill boundaries, partial intervals,
restart persistence, stock exhaustion, rejected/forged task updates, capped and
uncapped affection, independent tutorial acknowledgement, oath/daily updates and
actual TCP retry/callback ordering. The pre-integration source, running dist,
resources and save are preserved in archive/pre-headpat-20261106.zip at the project
root. A fresh stopped-server snapshot is added before activation. APK SHA256 must
remain3ce51807fb790b6c601b23b3c53a4d3cea77a9b0e66213dfa058d93b795894a6.

Phone playtest passed (2026-11-06): the user confirmed the pink progress bar
works and the mission count increases. Five actual gameplay headpats were
accepted; four on the matching girl advanced active oath task1024 from0/30 to4/30
at affection100. The fifth was on another girl and correctly did not advance
that objective. Stock reached0 after five gestures, with its refill timestamp
persisted. The APK and native Unity allocator fix remain unchanged.
