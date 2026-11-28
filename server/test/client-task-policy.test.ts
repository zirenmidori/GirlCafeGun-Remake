import { describe, expect, it } from "vitest";

import {
  ACHIEVEMENT_TASK_GROUP,
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  makeAchievementTaskId,
} from "../src/game-data/activity-achievement-data.js";
import {
  makeBountyDailyTaskId,
  makeBountyPassTaskId,
} from "../src/game-data/bounty-data.js";
import { makeChapterStarTaskId } from "../src/game-data/chapter-star-award-data.js";
import { isClientWritableTaskId } from "../src/game-data/client-task-policy.js";
import {
  DAILY_SIGN_UP_MONTH_DIAMOND_TASK,
  DAILY_SIGN_UP_TODAY_TASK,
  makeDailySignUpTaskId,
} from "../src/game-data/daily-sign-up-data.js";
import { makeGuideTaskId } from "../src/game-data/guide-mission-data.js";
import {
  FREE_GIFT_PACK_ID,
  makeIBShopTaskId,
  makeMonthCardTaskId,
} from "../src/game-data/ib-shop-data.js";
import {
  HEADPAT_CHARGE_TASK_ID,
  HEADPAT_REFILL_TASK_ID,
} from "../src/game-data/headpat-data.js";
import {
  makeGachaTaskId,
  MAIN_GIRL_TASK_ID,
} from "../src/persistence/player-repository.js";

const task = (group: number, id: number): number => (group << 16) | id;
const girl = (group: number, girlId: number, offset: number): number =>
  task(group, (girlId - 1) * 2_000 + offset);

// One entry per client-mode SetTaskValue site in the 0.1.3 Lua (constants resolved).
const CLIENT_WRITES: readonly [string, number][] = [
  ["PlayerLogic.lua:337 tutorial step 1/15", task(1, 15)],
  ["UI_JPMessageBox.lua:34 PlayerLogic.BUY_FLAG_TASK 1/37", task(1, 37)],
  ["UI_ClubReward.lua:76 ClubCommon.DailyAwardKey 1/35", task(1, 35)],
  ["ClubCommon.lua:1168 1/43", task(1, 43)],
  ["ClubCommon.lua:566 ClubCommon.PlayStory 1/550", task(1, 550)],
  ["ClubCommon.lua:860 ClubCommon.TodayClubBossRed 1/553", task(1, 553)],
  ["NormalActivityConfig.lua:1093 NewFlagBase + 401", task(1, 1_401)],
  ["MusicActivityLogic.lua:699 1/3301", task(1, 3_301)],
  ["GirlCommon.lua:1063 LastHappyMode", girl(3, 16, 8)],
  ["UI_GirlLove.lua:365 SubStoryId", girl(3, 1, 15)],
  ["GirlCommon:SetGirlTaskEx linked girl LastHappyMode", girl(90, 2, 8)],
  ["UI_ActivitiesTip.lua:148 9/3", task(9, 3)],
  ["GuideManager.lua:126 guide step", task(10, 12)],
  ["NoticeCommon.lua:118 10/10002", task(10, 10_002)],
  ["UI_NormalActivity.lua:188 20/<activity id>", task(20, 401)],
  ["UI_NormalActivity.lua:255 26/1008", task(26, 1_008)],
  ["UI_Sudoku.lua:119 27/<id*10+n>", task(27, 1_003)],
  ["MoneyLogic.lua:288 28/1", task(28, 1)],
  ["GirlMissionManager.lua:209 29", task(29, 1)],
  ["PetLogic.lua:486 30", task(30, 1)],
  ["CoffeeCommon.lua:332 31/30", task(31, 30)],
  ["UI_User.lua:462 32", task(32, 1)],
  ["AnimalizeLogic.lua:148 34", task(34, 1_001)],
  ["PvpCommon.lua:412 38", task(38, 1)],
  ["CartoonData.lua:83 39", task(39, 1)],
  ["UI_PromiseMain.lua:203 44/100", task(44, 100)],
  ["ShopData.lua:265 45/11", task(45, 11)],
  ["UI_CafeTalkMain.lua:95 48", task(48, 1)],
  ["IBLogic.lua:1117 50", task(50, 1)],
  ["EatingChicken.lua:120 52", task(52, 1)],
  ["MicroClimbTower.lua:371 59", task(59, 1)],
  ["ReturnActivityLogic.lua:93 63", task(63, 1)],
  ["UI_ConcertMain.lua:304 64", task(64, 1)],
  ["Online_CoopEvent.lua:46 65", task(65, 1)],
  ["OriginalLogic.lua:74 72", task(72, 1)],
  ["FundActivityLogic.lua:91 73", task(73, 1)],
  ["GameManager.lua:708 75", task(75, 1)],
  ["UI_2ndAnniversaryBoard.lua:49 81", task(81, 1)],
  ["OnlineTeamBattle.lua:187 82", task(82, 1)],
  ["UI_GeminiBirthdayMain.lua:37 84", task(84, 1)],
  ["SeventeenthTowerLogic.lua:151 96", task(96, 1)],
  ["Online_RescueOperation.lua:85 97", task(97, 1)],
  ["UI_User.lua:2503 emoji 98", task(98, 1)],
  ["DiyCommon.lua:545 301/45", task(301, 45)],
];

const SERVER_OWNED: readonly [string, number][] = [
  ["month-card end time", makeMonthCardTaskId()],
  ["rename count (priced in Diamonds)", (1 << 16) | 14],
  ["signature changes left", (1 << 16) | 29],
  ["main girl (set through LuaCall)", MAIN_GIRL_TASK_ID],
  ["headpat charge", HEADPAT_CHARGE_TASK_ID],
  ["headpat refill", HEADPAT_REFILL_TASK_ID],
  ["girl cafe position", girl(3, 1, 3)],
  ["girl training end time", girl(3, 1, 12)],
  ["girl secret", girl(3, 1, 100)],
  ["girl suit", girl(4, 1, 1)],
  ["girl card", girl(7, 1, 21)],
  ["linked girl suit", girl(91, 1, 1)],
  ["guide mission claim", makeGuideTaskId(40_001)],
  ["achievement claim", makeAchievementTaskId(ACHIEVEMENT_TASK_GROUP, 1)],
  [
    "event achievement claim",
    makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 4),
  ],
  ["online activity achievement (OnlineTeamBattle.lua:183)", task(18, 801)],
  ["bounty pass", makeBountyPassTaskId(1)],
  ["bounty daily", makeBountyDailyTaskId(1)],
  ["chapter stars", makeChapterStarTaskId(1, 1)],
  ["gacha pity", makeGachaTaskId(2 + 1)],
  ["gacha custom up", makeGachaTaskId(6_001 + 1)],
  ["daily sign-up", makeDailySignUpTaskId(DAILY_SIGN_UP_TODAY_TASK)],
  ["month-card daily diamond", makeDailySignUpTaskId(DAILY_SIGN_UP_MONTH_DIAMOND_TASK)],
  ["IB shop counter", makeIBShopTaskId(FREE_GIFT_PACK_ID)],
  ["cafe coffee", task(23, 1)],
  ["cafe pet", task(49, 200)],
  ["promise exchange limit", task(60, 101)],
  ["DiyCommon server-only group 305", task(305, 1)],
  ["unknown group", task(200, 1)],
];

describe("isClientWritableTaskId", () => {
  it.each(CLIENT_WRITES)("allows %s", (_site, id) => {
    expect(isClientWritableTaskId(id)).toBe(true);
  });

  it.each(SERVER_OWNED)("refuses %s", (_what, id) => {
    expect(isClientWritableTaskId(id)).toBe(false);
  });

  it("refuses ids that are not uint32 task ids", () => {
    for (const id of [0, -1, 0x1_0000_0000, Number.NaN, 1.5]) {
      expect(isClientWritableTaskId(id)).toBe(false);
    }
  });
});
