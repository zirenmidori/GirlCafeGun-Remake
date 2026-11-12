# Cafe and house

## Current scope

Core cafe implementation (2026-11-06), phone playtest passed.
Furniture layouts, saved themes, furniture commerce, coffee skills/stock/costs,
NPC customers and sales, staff assignments and mood, upgrades, offline reports,
and the existing music-selection request now have durable server state.
Pets and pet tours were added on 2026-11-11; phone playtest is pending.
Visits to other saved accounts remain deferred. The pet update changes only the
embedded server payload; native libraries, the Unity allocator fix and the paired
asset cache retain their working bytes.

## Furniture persistence and commerce

House1056 is a partial update, not a full layout. The repository merges changes
by object/room/theme identity, preserves omitted pose and business fields, and
rebuilds full room membership from all owned furniture. Moving an item to storage
does not delete ownership. Saved theme IDs are allocated by the server; rename,
poses and selected theme survive reloads. Invalid foreign/unowned objects or
parent cycles fail atomically.

The54 native scene identities remain distinct from acquired furniture, whose
GUIDs start at10000. This preserves the working repair for the original740-item
test collection. Native fixed objects do not consume owned storage capacity.

| Protocol  | Behavior                                                                 |
| --------- | ------------------------------------------------------------------------ |
| 1048/1049 | Fresh persisted furniture, poses, rooms and saved themes                 |
| 1050/1051 | Convert actually owned genre11 acquisition items into physical furniture |
| 1052/1053 | Validate and purchase a predefined theme; synchronize its items          |
| 1054/1055 | Delete only the selected saved theme                                     |
| 1056/1057 | Persist and acknowledge the actual changed objects                       |
| 1105/1106 | Return both authoritative server time and server zone                    |

Modern furniture purchases use shop40001 (OnOff2 means a cafe shop), Lua13 single
purchase, or Lua14 batch purchase. The same transaction charges the proper wallet,
enforces stock/ownership/storage limits, and materializes genre11 items into house
objects. Native1051 updates precede the Lua callback so purchases appear without
restarting. Lua126/127 handle legacy theme purchase/ownership checks;137 recycles
eligible unplaced furniture and pays its configured sale price once.

## Business and staff

| LuaCall     | Persisted behavior                                                              |
| ----------- | ------------------------------------------------------------------------------- |
| 111         | Upgrade requirements, gold costs, level awards and unlocks                      |
| 112         | Current business snapshot and pending offline report                            |
| 113         | Actual three-row numeric pairs: Cafe, Rest, Dorm                                |
| 114         | Reachable dining positions from owned placed furniture                          |
| 115         | Eligible weighted NPC arrivals and stable customer identities                   |
| 116         | Timed settlement, exact receipts and resource notifications                     |
| 117         | Seat a queued customer, reserve one real cup, synchronize stock                 |
| 118/119     | Clear a recipe / make coffee with learned-skill, cost, slot and capacity checks |
| 120/121     | Coffee learning and reset requirements/costs/task bits                          |
| 123/124/125 | Clock advisory, placed-furniture guest weights, leave/report handling           |
| 135         | Configured max-level popularity exchange                                        |
| 138         | Validate and persist the actual five-value music tuple                          |
| 240         | Owned staff mood refresh with standard girl/task notifications                  |
| 241         | Owned furniture count, excluding native scene objects                           |

Staff requests and responses use `[girlId,modelId]` pairs, as the phone actually
sends. Legacy object-form saves are retained internally and projected correctly.
Work/rest/dorm capacity and ownership are validated. Work/rest timestamps, mood
carry and assignment boundaries persist, and training removes assigned girls
consistently. The existing oath CafeTime/RestTime progress remains connected.

Dining positions are native `furnitureObjId*10+zeroBasedBizPoint`. Validation
requires an owned Type100 item in room1 and an actual configured biz point.
Coffee.Time is the drinking duration; positive draintime overrides that total
rather than adding to it. No coffee or valid dining space means no invented sales.

Gold awards remain wallet2. Genre15/detail10 is cafe coins, wallet7; wallet10 is
card coins and is kept separate. Sales enforce configured limits and preserve
fractional gains. Matching coffee properties determine good-review rewards and
extra-tip chances. Guide mission40017 is advanced only by actual settled cups.

Success shapes follow each Lua callback: several require nError to be absent,
while116 has its own numeric `error` field. Duplicate settlements replay stored
receipts without paying again. Positive packet-serial retries are bounded and
replayed without repeating a purchase or layout mutation.

## Timing and performance

`CafeCatalog` loads the exact recovered tables once per process; lookups perform
no runtime file reads. Business progression is event driven. Customer/seat/stock,
receipts, mood and report state survive process restarts. Offline catch-up uses
only real stock and valid uploaded seats, and reports already-paid earnings rather
than granting them again. Read-only polling and idle reentry do not rewrite saves.
There is no recurring server tick or background database writer.

On a disposable907KB copy of the actual seven-profile save (1461 items and740
furniture in the test profile),150 advancing-time polls plus three idle reentries
produced zero writes.500 offline sales took about108ms and one commit; replay
after reload produced no writes or duplicate earnings. These are measurements on
this PC, not a latency guarantee. See tools/cafe-fix/performance-report.json.

The original backend's random selection and offline scheduler were not shipped.
Their reconstruction uses the recovered eligibility, timing, capacity, reward and
bonus tables with deterministic local randomness. This is not a claim that every
original server scheduling choice has been recovered.

## Verification and recovery

Automated tests cover actual TCP layout merge/reload/removal, staff wire format,
coffee costs/stock/invalid operations, customers/timing/duplicate receipts/offline
reports, single and batch physical purchases, recycling, clock sync, and repository
edge cases. Existing headpat, oath, combat and other server regressions must pass.

Rollback source, running build, resources, tests and save are in
archive/pre-cafe-persistence-20261106.zip at the project root. A fresh stopped-server
save snapshot is added immediately before activation. Stop the server before
restoring a save. The working APK remains SHA256
3ce51807fb790b6c601b23b3c53a4d3cea77a9b0e66213dfa058d93b795894a6.

Phone test: reopen GCG after deployment, place and confirm a dining item, assign
staff, make coffee and observe customers. Fully close/reopen the client to verify
the layout and assignments. A normal basic coffee takes240 seconds to drink;
arrivals follow the configured cafe-level interval. Pet and multiplayer visit
systems retain their previous behavior and are not included in this pass.

Phone playtest passed (2026-11-06): the user confirmed layout and staff persist
after fully closing/reopening GCG, and coffee/customers work. The live save
retains747 owned furniture after seven purchases, three placed items and three working staff. Other six
profiles were deep-checked unchanged. The playtest started with100,000,000 cafe coins,
above the normal level30 storage cap300,000, so additional cafe-coin income is
correctly capped; gold/sales and ordinary below-cap rewards remain functional.
All317server tests passed for that core cafe release. Other-account visits remain deferred.

## Pets and pet tours (2026-11-11)

The MIT-licensed SssjServer source from GCG2-Offline supplied protocol/state-machine
references, adapted to our final-CN client rather than installing its server or
launcher. Attribution is retained in LICENSES/SssjServer-MIT.txt. Our current
20 TourMission variants take precedence over the reference's obsolete TourInfo.

Food bowls, attraction timers, adoption/release, names, affection/levels, energy
gifts, locks, cafe placement, food stock and collection rewards are persistent.
The75 configured pet missions/achievement tiers use real pet actions, shared
group18 claim bits and prerequisite chains. Weekly missions reset Monday04:00
Shanghai; lifetime achievements persist. Existing history supplies only provable
lifetime lower bounds, never invented past gifts, food use or weekly activity.
Native1049 HouseCache field5 restores pets at login; Lua112 restores bowls,
placement and locks. Pet notifications precede callbacks that inspect the cache.
Gift inventory, purchases and rewards use the existing atomic save transaction.
Failed operations cannot partially consume items or money.

Tours validate unlocks, three distinct owned available pets and energy costs,
persist their formation/start time and pre-rolled rewards, and settle on demand.
Species/nature conditions control bonus rewards rather than blocking departure.
Elapsed tours succeed: the current client ships no original success-odds formula,
so this is a reconstruction choice, not recovered original server behavior.
Rewards and completion counters can be claimed only once, including retries after
restart. Earned collection buffs retain their client task bits; cafe/rest/greeter
oath time uses the highest-weight applicable buff without retroactive gains.

Catalogs and resource indexes are cached once per process. There is no recurring
pet timer, scheduler or polling disk read. Unchanged pet polls do not write saves.
On a disposable1.09MB seven-profile save,200 advancing-time polls made zero
writes (about21ms median on this PC; phone CPU timing remains unmeasured). See
tools/cafe-fix/pet-performance-report.json. All391 tests across71 files pass,
along with TypeScript, ESLint and the declaration build. Formatting passes for
changed files;96 unrelated baseline formatting warnings are byte-identical to
the pre-integration backup. A private Moments return interface was exported to
allow declaration emission; all61 runtime modules were recompiled and verified
byte-identical to the signed candidate after that type-only build repair.
Tests cover real TCP callbacks and native pet sync, adoption/gifts, locked release,
offline timers, restart, two simultaneous reward claims, and existing cafe systems.
All39 male/female prefab paths resolve in the working cache; their193-bundle
dependency closure has no missing carrier. Rendering still requires phone testing.

The pre-integration rollback is archive/pre-cafe-pets-20261111T161251Z.zip,
SHA256 fe5e1712ac3144db249e317aab544632a611c76d7dc9d8823c5a10a66f5615ad.
It includes the signed Expression-Hold APK, paired cache, server source and last
verified phone save snapshot (2026-11-10). Back up current phone saves again before
installing the pet candidate. Existing profiles acquire empty pet state lazily;
the update grants no test pets, items, unlocks or currency automatically.

Candidate: client/GCG-Neptune-Cafe-Pets-Test.apk, SHA256
1ec56c3e620864ea23592e6fe583b7f102992a965abea64acd28e661154d5f5a.
Its paired cache ZIP is byte-identical to Expression-Hold. The signed report
records the exact five changed modules and five added payload entries. Validate
offline with Python3.14 tools/cafe-fix/install_pets.py --validate-only; --apply
backs up both private saves and preferences, verifies all eight existing cache
files, installs only the APK, and leaves the game closed. No cache publication
or save replacement is needed for this update. Phone playtest remains pending.

Installed on the authorized SM-S926U1 on2026-11-11. Fresh verified backup:
archive/english-install-20261111T165147Z-97879ed2. Both private saves, bootstrap
preferences and all eight cache files were verified unchanged; the APK hash
matches the candidate above, and the game was left closed for the user's test.
The duplicate backup from the earlier filename-validation abort was removed
only after every data file matched the completed backup byte-for-byte.

## GM pet test roster and account switching (2026-11-11)

At the user's request, only the existing level300 GM role6 received all21 pet
templates:39 pets covering every configured gender, each at its rarity cap
(30/40/50),0 current-level EXP and100 energy. Existing money, item inventory,
layouts and other gameplay progress were retained. Collection/lifetime task
lower bounds reflect the granted pets; rewards were not auto-claimed and weekly
activity was not invented. All seven other profiles, including regular Player
role8, were deep-checked unchanged; the stable sibling save was byte-identical.
Fresh pre-grant backup: archive/gm-pets-20261111T165839Z.

The saved GM password was empty, selecting a different passwordless role instead
of the real GM. Its credential was restored from that existing identity without
merging accounts. The actual cause of recurrence was LuaHotFixCSharp.lua, whose
ReLogin and failed-verification wrappers erased the saved password. Those two
erasures are now guarded only for the embedded profile server. The original
cleanup behavior for hosted/USB routes remains intact. All other833 Lua objects,
the server payload, native libraries and Unity fix retain their working bytes.

The exact four current login modules and delayed hotfix pass the regression
reproduction and three Player/GM round trips with native callbacks simulated.
The signed server separately accepted actual VERIFY/LOGIN and returned the
correct GM and all39 native pets across two store/server startups, with all
other profiles unchanged. Physical client profile switching awaits user testing.

Installed client/GCG-Neptune-Cafe-Pets-GM-Login-Test.apk, SHA256
efa8f648ce8254924236e0430b349c7820e85fa4ad1baa4b3df5572b3b5200b4,
with its paired Lua/index update. The embedded pet server payload is unchanged.
Fresh installation backup: archive/english-install-20261111T171128Z-8f0942da.
Both saves, restored login preferences and unrelated cache files were verified
unchanged during installation; the game was left closed.
