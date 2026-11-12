# Fantasy Oath

The recovered client already contains all 16 girls, stories, fragments, and six
chapter100/difficulty10 trials. The server now implements its LuaCall lifecycle
rather than the former command230=false/231=[] placeholders. APK, Unity, assets,
login settings and global event dates are unchanged.

## Contracts and state

Availability/released-girl queries are read-only; configuration is cached. Objective
updates skip persistence for unactivated accounts, and query callbacks avoid redundant
full task-value notifications.

`PromiseCatalog` parses the four exact recovered Pldge tables once per process.
`resources/pledge/` contains their original bytes, including 670 task rows and
583 tasks referenced by the ordered stage configurations. Girls13 and16 follow
the simplified six-story path; the other14 use the material/objective path.
Activation requires chapter6-12Normal and an owned released girl. Command230 is
global release availability; the client applies its own chapter lock separately.

Commands228/229/230/231/232/233/234/235/239 have their exact client field casing
and response shapes. Task states are0unfinished,1ready,2confirmed. Command234
success omits `Err`; even `Err:0` would fail in the client. Rejected activation
uses a nil callback, a known client tip, and an authoritative girl-list refresh.
There is no invented command237 implementation.

Optional `Player.promise` stores stage, stable oath card GUID, ordered current
tasks, reward markers, fractional timer carry and bounded processed run IDs.
Existing saves initialize this lazily. All material deductions, exchanges,
manual task claims, stage upgrades and rewards use one atomic save transaction.
Repeated activation/claims never charge or grant twice. Stage7 rewards follow
the configured completed-task thresholds. Exchange limits persist in group60;
group44 remains client presentation state.

Card rewards reuse the strongest owned oath card instead of creating copies or
downgrading a granted card. The optional four card skill levels are emitted as
native MiniSkill entries using the exact current template IDs. Heart presentation
comes from the final card template, level and oath reward stage; no guessed item
field or native patch is used.

## Objective sources

Friend level and distinct owned outfits are reconciled from current saved state.
Material requirements are checked again and consumed on confirmation. Head touches,
gifts and completed training increment their matching objectives. Greeter and
café/rest timers accrue only while the saved assignment is active, including
across process restarts, preserving fractional minutes. Café work/rest/dorm rows
round-trip through112/113 without collapsing the two rest rooms.

Chapter/trial and bounty settlement use the owned main-card roster captured at
successful entry and a server-generated run ID. Progress is recorded in the same
transaction as combat rewards. Settlement retries cannot count the same run twice.
An old settlement without captured entry context still follows the existing combat
compatibility behavior, but cannot manufacture new oath progress.

Eight configured PvpFight objectives still depend on genuine co-op win settlement.
The existing co-op server only acknowledges room lifecycle messages; the shipped
UnityGameEnd1702 request contains a room ID and no outcome. Entering a room,
receiving the placeholder221 reward, or sending cleanup1702 must not count as a
win. The repository supports filtered, deduplicated PVP progress once that
settlement source is implemented. These eight objectives remain pending for now.

The three expired fight-menu event slots remain unchanged. Restoring their event
calendars and online event rules is a separate feature.

## Validation and rollback

Catalog, persistence, real TCP gateway and native item-wire tests exercise normal,
malformed, duplicate and restart paths. Full server checks must pass before rollout.
Rollback build/resources/save are in `archive/pre-fantasy-oath-20261105.zip` under
the project root. Stop the owned server before restoring a save; retain the final
pre-restart save snapshot when preserving subsequent playtest progress.

## Phone playtest — 2026-11-05

The user confirmed Fantasy Oath is working well on the phone. Headpats currently
do not work and are the next task: repair the interaction, verify the actual
GirlLogic/HeadTouched message, and confirm it advances the oath objectives.

Headpat follow-up (2026-11-06): missing global charge values disabled the native
progress bar before it could send HeadTouched. The server repair is described in
[Headpats](22-headpats.md); normal successful gestures increment matching current
TouchHead objectives in the same transaction as charges, affection and daily105.
