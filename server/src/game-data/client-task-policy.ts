import { MONTH_CARD_TASK_GROUP, MONTH_CARD_TASK_ID } from "./ib-shop-data.js";
import { DAILY_SIGN_UP_TASK_GROUP } from "./daily-sign-up-data.js";

/**
 * Task values the client may write with TASK_CHANGE_REQ (1027).
 *
 * Source: every `me:SetTaskValue` and `LuaPlayer.Get():SetTaskValue` call in the
 * 0.1.3 client Lua (`assets/lua.u` of GCG-Offline-v0.1.3.apk) that runs in client
 * mode. Calls under `MODULE_SERVER`, the GM-only `DiyCommon:ClearAllTaskValue`,
 * the AutoTest files and commented-out lines are not client writes.
 *
 * A task id the server computes, or pays or charges on, is server-owned: claim
 * marks, gacha pity, IB shop counters, the month-card end time, bounty counters,
 * girl suits and cards. The gateway refuses a client write to any id outside
 * this list and sends the stored value back.
 */
const GIRL_TASK_STRIDE = 2_000;

/** GirlVarOffset in GirlCommon.lua: the per-girl offsets the client writes. */
const GIRL_CLIENT_OFFSETS = new Set([
  8, // LastHappyMode: GirlCommon.lua:1063
  15, // SubStoryId: UI_GirlLove.lua:365
]);

const isGirlClientOffset = (taskId: number): boolean =>
  GIRL_CLIENT_OFFSETS.has(taskId % GIRL_TASK_STRIDE);

const anyTask = (): boolean => true;

const CLIENT_GROUPS: ReadonlyMap<number, (taskId: number) => boolean> = new Map([
  // PlayerLogic 15 and 37, ClubCommon 35, 43, 550, 553, MusicActivityLogic 3301,
  // NormalActivityConfig.NewFlagBase 1000 + id. Id 36 is the month-card end time.
  [MONTH_CARD_TASK_GROUP, (taskId: number) => taskId !== MONTH_CARD_TASK_ID],
  // Girl state (3) and linked girls (90): only the two offsets above. Offsets
  // 3, 9, 11, 12, 16, 100+, 300+, 400+ and 500+ are the server's.
  [3, isGirlClientOffset],
  [90, isGirlClientOffset],
  // ActivitiesLogic.nTaskKeyConfirm (UI_ActivitiesTip.lua:148). Ids 100+ and
  // 4000+ are bounty pass and daily counters.
  [9, (taskId: number) => taskId === 3],
  // GuideManager steps, EvaluateGuide, NoticeCommon 10002.
  [10, anyTask],
  // UI_NormalActivity.lua:188 red dot on ActivityList ids (1 to 401). Ids from
  // 11001 (NormalActivityConfig.TID_SIGNUP) are the daily sign-up state.
  [DAILY_SIGN_UP_TASK_GROUP, (taskId: number) => taskId < 11_000],
  [26, anyTask], // UI_NormalActivity.lua:255
  [27, anyTask], // NormalActivityConfig.nSodukuTaskGroup1: UI_Sudoku, UI_Birth07Sudoku
  [28, anyTask], // MoneyLogic.lua:283-289 bar counter
  [29, anyTask], // GirlMissionManager Key_Group, UI_CafeInfo
  [30, anyTask], // PetLogic.groupID
  [31, anyTask], // GirlCommon.task_group login time, CoffeeCommon, UI_BusinessReport
  [32, anyTask], // UI_User userdefineGroupId
  [34, anyTask], // AnimalizeLogic and EighthTowerLogic nTaskGroupAnimalize
  [38, anyTask], // PvpCommon.TaskGroup
  [39, anyTask], // CartoonData.TaskGroup read marks (the server only reads them)
  [44, anyTask], // GirlPromise.taskGroup UI flags (UI_PromiseMain)
  [45, anyTask], // ShopData.lua:265-281
  [48, anyTask], // CafeTalk.GID
  [50, anyTask], // IBLogic.FLAG_GROUP
  [52, anyTask], // EatingChicken.GID
  [59, anyTask], // MicroClimbTower.nGroupId
  [63, anyTask], // ReturnActivityLogic, ReturnActivityLogic2
  [64, anyTask], // UI_ConcertMain GID, MercenaryLogic.Group, MusicActivityLogic.nGroup
  [65, anyTask], // Online_CoopEvent.TaskGroup
  [72, anyTask], // OriginalLogic.TASK_GID
  [73, anyTask], // FundActivityLogic, RecruitKRLogic, WeaponWeeklyCardLogic red flags
  [75, anyTask], // GameManager.ADJUST_TASK_GROUP
  [81, anyTask], // UI_2ndAnniversaryBoard.TaskGroup
  [82, anyTask], // OnlineTeamBattle.GID
  [84, anyTask], // GeminiBirthdayLogic.nTaskGroup
  [96, anyTask], // SeventeenthTowerLogic.nTaskGroup
  [97, anyTask], // Online_RescueOperation.nTask_Group
  [98, anyTask], // ChatCommon.EmojiTaskGroup (UI_User.lua:2503)
  [301, anyTask], // DiyCommon.GID: DiyCommon:OnEnterRoom
]);

/**
 * Group 18 is left out on purpose. Its only client write is
 * OnlineTeamBattle:SetCurrId (OnlineTeamBattle.lua:183), which clears the
 * claim marks of an online activity's achievements when a new online team
 * battle opens. Every OnlineActivities.txt window ended in 2022, so the
 * offline game never reaches it, and the server pays those claims.
 */
export function isClientWritableTaskId(id: number): boolean {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffff_ffff) return false;
  const rule = CLIENT_GROUPS.get(Math.trunc(id / 0x10000));
  return rule ? rule(id & 0xffff) : false;
}
