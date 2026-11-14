# Event page achievements

## Status

Core implementation; automated tests only, no phone playtest yet.

The claim gate works for every event page that lists achievements. Progress
comes from the saved player state for eight condition types. Conditions that
need a counter (stage clears in total, gifts, coffee sold and so on) stay at
their stored value, so their Claim buttons do not appear yet.

## Client contract

Source: `NormalActivityConfig.lua`, `UI_NormalActivity.lua`,
`UI_EightDaysSignUp.lua`, `UI_Achievement.lua` and `MissionManager.lua` of the
0.1.3 client.

- An event page reads its achievement ids from a `NormalActivity/*.txt` table
  and the achievements themselves from `Mission/AchievementOther.txt`.
- An achievement of `AchievementOther.txt` uses task group 18, one of
  `Achievement.txt` (the achievement panel) task group 6. Bit 0 of the task
  value is the claim mark, bits 1-31 are the progress.
- The page shows Claim when progress >= `missionMax[assistparam[1]]`
  (`MissionManager:CheckInfoState`). The client never counts by itself.
- Claim on an event page: `NormalActivityGetAward {nActivityId, nId, nType = 1}`.
  Claim in the achievement panel: `AchievementGetAward {nId, nType = 0}`.
- Both are answered with `MissionMgrMsg {nError, nMission = 0}`. `nError` is
  compared with 0, so it must be present. The page waits behind a blocking mask,
  so a refusal is answered too. The success callback carries no data and redraws
  the page from the task values, so `TASK_VALUE_RSP` and the item and money
  notifications are sent first. The client builds the reward pop-up from its own
  `awardsList`.

## Pages the client shows

`ActivityList.txt` holds 260 rows. The client shows a row when `Sort` is not 0
and the time is inside the show window. Twelve rows have no end date, so they
show at any date:

| Activity | `Name`                      | Template and table     | Handled                                                      |
| -------- | --------------------------- | ---------------------- | ------------------------------------------------------------ |
| 1        | `activity.dailysign`        | 3                      | module 11                                                    |
| 2        | `activity.capter`           | 2, `ActivityTemplate2` | claims; progress for all 6 achievements (type 2)             |
| 3        | `activity.level`            | 2, `ActivityTemplate2` | claims; progress for 8 of 10 (types 39, 54, 71; not 40, 41)  |
| 8        | `activity.power`            | 4, `EnergyActivity`    | no (`NormalActivityGetAward` without `nType`)                |
| 14       | `activity.battle`           | 2, `ActivityTemplate2` | claims; no progress source (types 22, 42, 59, 104, 105)      |
| 15       | `activity.girl`             | 2, `ActivityTemplate2` | claims; progress for 10 of 16 (types 37, 85; not 18, 29)     |
| 16       | `activity.coffee`           | 2, `ActivityTemplate2` | no: every award list holds item `14-1-4-1`, see Known gaps   |
| 20       | `activity.suduku`           | 6, `SodukuActivity`    | cell progress for 4 of 9 cells; line rewards are not handled |
| 29       | `activity.eightsign`        | 12, `EightDaysSignUp`  | module 11 (unchanged); the same table rows work here         |
| 83       | `activity.HalfYearFestival` | 21                     | no                                                           |
| 108      | `activity.NewMisson`        | 2, `ActivityTemplate2` | claims; progress for 2 of 19 (type 71)                       |
| 149      | `activity.15DayRecruit`     | 26                     | no; shown for the first 30 days of an account                |

Every other row with `Sort` not 0 has an end date in 2022 or earlier. Their
achievement lists are loaded as well (`ActivityTemplate4`, `ActivityTemplate5`,
`EightDaysSignUp2`, `WeaponMCGacha`), so a claim on them passes the same gate.

## Tables

`resources/activity/` holds ten tables copied byte for byte from `setting.u` of
the 0.1.3 release APK. `provenance.json` records the container path, size and
SHA-256 of each; `test/activity-achievement-data.test.ts` checks them.
`achievementother.txt` has the same SHA-256 as the source that
`resources/cafe/provenance.json` names for the pet missions.

Rewards are read from `awardsList` (`[genre-detail-particular-level-count,...]`).
Nothing is added or changed by the server.

## Claim rules

`PlayerRepository.claimActivityAchievementAward` and `claimAchievementAward`,
one `JsonStore` transaction each:

1. Event page only: the achievement must be listed for that activity in one of
   the `NormalActivity` tables. The activity's time window is not checked; the
   client does not offer a page that is closed.
2. The achievement must exist and every award must be one that `grantAwards`
   can place: no malformed tuple (`AchievementOther` 1686 has four numbers), no
   genre 14, no genre 15 currency without a wallet in this server. Such a claim
   is refused (`unsupported_award`) and nothing is marked.
3. An achievement without awards is refused (`no_award`). The matrix board cells
   are such rows.
4. The stored progress is raised to the derived progress, then compared with the
   required count. A set claim mark refuses the claim.
5. The claim mark is set, the awards are granted and the girl appearance state
   is reconciled, as the eight-day handler does.

Every refusal answers `nError = 1`. The original error codes were not recovered.

Activity 29 keeps its own handler in the gateway. Both paths read and write the
same task values, so a reward claimed through one is refused by the other.

## Progress

`derivedAchievementProgress` answers these `Mission/AchieveType.txt` types from
the save:

| Type | Condition (`missionMax`)                              | Source                          |
| ---- | ----------------------------------------------------- | ------------------------------- |
| 1    | commander level `[level]`                             | `player.level`                  |
| 2    | clear a stage `[chapter, section, difficulty, times]` | pass count of that level        |
| 37   | highest girl affection level `[level]`                | `girls[].level`                 |
| 39   | highest character card level `[level]`                | `enhanceLevel` of genre 1       |
| 43   | login days `[days, paid sign-in activity]`            | `eightDaySignUp.cumulativeDays` |
| 54   | cards with limit break N `[cards, break level]`       | `breakLevel` of genre 1         |
| 71   | weapons at level N `[weapons, level]`                 | `enhanceLevel` of genre 2       |
| 85   | girls at affection level N `[girls, level]`           | `girls[].level`                 |

The `activity-achievements` activity handler projects them into task group 18
for the achievements of the pages the client shows now. It runs at login and
account load (`reconcile`) and on `level.cleared` and `weapon.enhanced`. The
projection only raises progress and never touches the claim mark. A claim
projects its own achievement again before the check.

Login days are the existing eight-day counter: one per operational day
(Asia/Shanghai 04:00), at most 8.

## Verification

- `test/activity-achievement-data.test.ts`: byte-exact tables, the list of shown
  pages, the achievement columns of each table family, required counts, award
  parsing, each derived condition, monotonic and idempotent projection.
- `test/activity-achievement-persistence.test.ts`: a claim, its reward and the
  refused second claim for `ActivityTemplate2`, `EightDaysSignUp`,
  `ActivityTemplate4`, `ActivityTemplate5` (both lists), `EightDaysSignUp2` and
  `WeaponMCGacha`; refusal of foreign, incomplete, award-less and unsupported
  claims; login days counted once per day; the achievement panel claim.
- `test/activity-achievement-gateway.test.ts`: both Lua calls over TCP, the
  order of task sync and callback, and the refusal answer.

## Known gaps

- No counters. Types 18, 22, 24, 29, 40, 41, 42, 59, 75, 76, 79, 104, 105, 107,
  109, 137, 171, 193, 195-199 and 230 of the shown pages have no progress source.
- Girl affection and card level change without a domain event, so their
  progress reaches the client at the next login.
- Page 16 pays `14-1-4-1` (`ItemGiftCoffeeCoinAuto`), an auto-use item that this
  server has no rule for. Its claims are refused until that rule exists.
- The matrix board (activity 20) pays by line with
  `NormalActivityGetAward {nActivityId, nIndex}` and `NormalActivityMsg nType 6`.
  Not handled.
- The achievement panel (`Achievement.txt`, 1451 rows) has the claim handler
  only. Nothing projects progress into task group 6.
- `preMissionId`, `level` and `ChapterLimit` of an achievement are not checked;
  the client hides such rows by itself.
- Activity 25 (growth fund, ended) is not tied to the fund purchase flag (task
  group 1, task 31) that the client checks before it sends the claim.
- Table dates are read as UTC+8. How the client's `GetSecFromNowData` maps them
  to server time was not traced.
- The client can still write task groups 6 and 18 with `TASK_CHANGE_REQ`, as it
  can for most task values.
