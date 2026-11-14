import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ACHIEVEMENT_TASK_GROUP,
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  ActivityAchievementCatalog,
  achievementProgress,
  hasClaimedAchievement,
  makeAchievementTaskId,
  makeAchievementTaskValue,
  requiredAchievementCount,
} from "../src/game-data/activity-achievement-data.js";
import {
  HEAD_FRAME_TASK_GROUP,
  RIKI_TASK_GROUP,
} from "../src/game-data/auto-use-item-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  AchievementAwardError,
  EightDaySignUpError,
  makeInitialState,
  MONEY_COFFEE_COIN,
  MONEY_DIAMOND,
  MONEY_GOLD,
  PlayerRepository,
  type PersistedState,
  type Player,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const account = "tester";
const catalog = ActivityAchievementCatalog.loadDefault();
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createRepository(): Promise<{
  repository: PlayerRepository;
  store: JsonStore<PersistedState>;
  filePath: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-activity-achievement-"));
  directories.push(directory);
  const filePath = path.join(directory, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const repository = new PlayerRepository({
    store,
    defaults: {
      name: "",
      level: 1,
      exp: 0,
      fightPower: 0,
      serverZone: 8,
      firstLevelComplete: false,
    },
    logger,
  });
  await repository.getOrCreate(account);
  return { repository, store, filePath };
}

function taskKey(group: number, achievementId: number): string {
  return String(makeAchievementTaskId(group, achievementId));
}

function otherTask(player: Player, achievementId: number): number {
  return (
    player.taskValues[taskKey(ACTIVITY_ACHIEVEMENT_TASK_GROUP, achievementId)] ?? 0
  );
}

function money(player: Player, id: number): number {
  return player.money.find((entry) => entry.id === id)?.count ?? 0;
}

async function rejection(claim: Promise<unknown>): Promise<string> {
  try {
    await claim;
  } catch (error) {
    if (error instanceof AchievementAwardError) return error.reason;
    throw error;
  }
  throw new Error("Claim was not refused");
}

/** Stands in for a progress source this server does not have yet. */
async function storeProgress(
  store: JsonStore<PersistedState>,
  group: number,
  achievementId: number,
  progress: number,
): Promise<void> {
  await store.update((state) => {
    state.players[account]!.taskValues[taskKey(group, achievementId)] =
      makeAchievementTaskValue(progress, false);
  });
}

describe("event page achievement claims", () => {
  it("pays a Template2 page from AchievementOther and refuses a second claim", async () => {
    const { repository, store, filePath } = await createRepository();

    // Activity 2 "chapter rewards", achievement 4: first clear of stage 1-6 normal.
    expect(
      await rejection(repository.claimActivityAchievementAward(account, 2, 4)),
    ).toBe("not_completed");

    const cleared = await repository.completeLevel(account, 1, 6, 1, 0b111);
    // The level.cleared event projects the progress without a new login.
    expect(achievementProgress(otherTask(cleared, 4))).toBe(1);
    expect(hasClaimedAchievement(otherTask(cleared, 4))).toBe(false);

    const result = await repository.claimActivityAchievementAward(account, 2, 4);
    expect(result.awards).toEqual([
      [15, 2, 1, 1, 20],
      [15, 1, 1, 1, 2_500],
    ]);
    expect(money(result.player, MONEY_DIAMOND) - money(cleared, MONEY_DIAMOND)).toBe(
      20,
    );
    expect(money(result.player, MONEY_GOLD) - money(cleared, MONEY_GOLD)).toBe(2_500);
    expect(result.updatedMoney.map(({ id }) => id).sort()).toEqual(
      [MONEY_GOLD, MONEY_DIAMOND].sort(),
    );
    expect(otherTask(result.player, 4)).toBe(makeAchievementTaskValue(1, true));

    expect(
      await rejection(repository.claimActivityAchievementAward(account, 2, 4)),
    ).toBe("already_claimed");
    expect(money(repository.get(account)!, MONEY_DIAMOND)).toBe(
      money(result.player, MONEY_DIAMOND),
    );

    // The claim mark is in the save file, not only in memory.
    await store.flush();
    const reloaded = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await reloaded.initialize();
    expect(otherTask(reloaded.snapshot().players[account]!, 4)).toBe(
      makeAchievementTaskValue(1, true),
    );
  });

  it("refuses an achievement the activity does not list", async () => {
    const { repository } = await createRepository();
    await repository.completeLevel(account, 1, 6, 1, 0b111);
    // 4 belongs to activity 2, 23 to the eight-day page, 9999 to no table.
    expect(
      await rejection(repository.claimActivityAchievementAward(account, 3, 4)),
    ).toBe("not_in_activity");
    expect(
      await rejection(repository.claimActivityAchievementAward(account, 2, 23)),
    ).toBe("not_in_activity");
    expect(
      await rejection(repository.claimActivityAchievementAward(account, 9_999, 4)),
    ).toBe("not_in_activity");
    expect(otherTask(repository.get(account)!, 4)).toBe(
      makeAchievementTaskValue(1, false),
    );
  });

  it("pays the EightDaysSignUp page by login days, one claim per day reward", async () => {
    const { repository } = await createRepository();
    await repository.markLogin(account, Date.parse("2026-07-28T12:00:00Z"));
    await repository.markLogin(account, Date.parse("2026-07-28T19:00:00Z"));

    const result = await repository.claimActivityAchievementAward(account, 29, 23);
    expect(result.awards).toEqual([[15, 2, 1, 1, 30]]);
    expect(otherTask(result.player, 23)).toBe(makeAchievementTaskValue(1, true));

    expect(
      await rejection(repository.claimActivityAchievementAward(account, 29, 23)),
    ).toBe("already_claimed");
    // The built-in activity 29 handler reads the same claim mark.
    await expect(
      repository.claimEightDaySignUpAward(account, 23),
    ).rejects.toBeInstanceOf(EightDaySignUpError);
    // Two logins on one operational day are one day.
    expect(
      await rejection(repository.claimActivityAchievementAward(account, 29, 24)),
    ).toBe("not_completed");

    await repository.markLogin(account, Date.parse("2026-07-28T20:00:00Z"));
    const second = await repository.claimActivityAchievementAward(account, 29, 24);
    expect(second.awards).toEqual([[1, 2, 4, 3, 1]]);
    expect(second.updatedItems).toHaveLength(1);
  });

  it.each([
    ["ActivityTemplate4", 24, 102],
    ["ActivityTemplate5 AchievementList", 27, 191],
    ["ActivityTemplate5 DailyAchievementList", 27, 141],
    ["EightDaysSignUp2", 41, 751],
    ["WeaponMCGacha", 54, 1018],
  ])(
    "pays a %s page once its stored progress is complete",
    async (_family, activityId, achievementId) => {
      const { repository, store } = await createRepository();
      const config = catalog.achievement(
        ACTIVITY_ACHIEVEMENT_TASK_GROUP,
        achievementId,
      )!;
      const required = requiredAchievementCount(config);
      expect(config.awards?.length).toBeGreaterThan(0);

      await storeProgress(
        store,
        ACTIVITY_ACHIEVEMENT_TASK_GROUP,
        achievementId,
        required - 1,
      );
      expect(
        await rejection(
          repository.claimActivityAchievementAward(account, activityId, achievementId),
        ),
      ).toBe("not_completed");

      await storeProgress(
        store,
        ACTIVITY_ACHIEVEMENT_TASK_GROUP,
        achievementId,
        required,
      );
      const result = await repository.claimActivityAchievementAward(
        account,
        activityId,
        achievementId,
      );
      expect(result.awards).toEqual(config.awards);
      expect(result.updatedItems.length + result.updatedMoney.length).toBeGreaterThan(
        0,
      );
      expect(hasClaimedAchievement(otherTask(result.player, achievementId))).toBe(true);
      expect(
        await rejection(
          repository.claimActivityAchievementAward(account, activityId, achievementId),
        ),
      ).toBe("already_claimed");
    },
  );

  it("projects Soduku cells but pays nothing for them", async () => {
    const { repository } = await createRepository();
    // Activity 20, cell achievement 93: first clear of stage 4-12 normal.
    const cleared = await repository.completeLevel(account, 4, 12, 1, 0b001);
    expect(achievementProgress(otherTask(cleared, 93))).toBe(1);
    // Cells carry no awardsList; the board pays by line, which is not handled.
    expect(
      await rejection(repository.claimActivityAchievementAward(account, 20, 93)),
    ).toBe("no_award");
    expect(hasClaimedAchievement(otherTask(repository.get(account)!, 93))).toBe(false);
  });

  it("pays auto-use awards by their rule and not as dead stacks", async () => {
    const { repository, store } = await createRepository();
    const complete = async (group: number, achievementId: number): Promise<void> =>
      storeProgress(
        store,
        group,
        achievementId,
        requiredAchievementCount(catalog.achievement(group, achievementId)!),
      );
    const task = (group: number, taskId: number): number =>
      repository.get(account)!.taskValues[String((group << 16) | taskId)] ?? 0;
    const startedAt = Math.floor(Date.now() / 1_000);

    // Activity 16, achievement 67: 300 ItemGiftCoffeeCoinAuto -> coffee coins.
    expect(catalog.achievement(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 67)!.awards).toEqual([
      [14, 1, 4, 1, 300],
    ]);
    await complete(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 67);
    const coffee = await repository.claimActivityAchievementAward(account, 16, 67);
    expect(coffee.updatedMoney).toEqual([{ id: MONEY_COFFEE_COIN, count: 300 }]);
    expect(coffee.updatedItems).toEqual([]);

    // Activity 17, achievement 70: 20 of coin 15-6 (ExtParam2 = money 5) and gold.
    await complete(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 70);
    const coin = await repository.claimActivityAchievementAward(account, 17, 70);
    expect(coin.awards).toEqual([
      [15, 6, 1, 1, 20],
      [15, 1, 1, 1, 2_500],
    ]);
    expect(coin.updatedMoney).toContainEqual({ id: 5, count: 20 });
    expect(coin.updatedItems).toEqual([]);

    // Activity 27, achievement 197: head frame 6-28-8-4 (ExtParam1 = frame 9).
    expect(task(HEAD_FRAME_TASK_GROUP, 9)).toBe(0);
    await complete(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 197);
    const frame = await repository.claimActivityAchievementAward(account, 27, 197);
    expect(frame.awards).toEqual([[6, 28, 8, 4, 1]]);
    expect(frame.updatedItems).toEqual([]);
    expect(task(HEAD_FRAME_TASK_GROUP, 9)).toBeGreaterThanOrEqual(startedAt);

    // Panel achievement 39 (clear stage 6-12): diamonds, gold and head frame 6.
    const before = repository.get(account)!;
    await repository.completeLevel(account, 6, 12, 1, 0b111);
    const panel = await repository.claimAchievementAward(account, 39);
    expect(panel.awards).toEqual([
      [15, 2, 1, 1, 20],
      [15, 1, 1, 1, 2_000],
      [6, 28, 5, 4, 1],
    ]);
    expect(money(panel.player, MONEY_DIAMOND) - money(before, MONEY_DIAMOND)).toBe(20);
    expect(task(HEAD_FRAME_TASK_GROUP, 6)).toBeGreaterThanOrEqual(startedAt);

    // Panel achievement 12: gallery entry 16-3-5-1 is Riki.txt row 3058.
    await storeProgress(store, ACHIEVEMENT_TASK_GROUP, 12, 60);
    const riki = await repository.claimAchievementAward(account, 12);
    expect(riki.awards.at(-1)).toEqual([16, 3, 5, 1, 1]);
    expect(task(RIKI_TASK_GROUP, 3_058)).toBe(1);
    expect(
      repository
        .get(account)!
        .inventory.filter(({ genre }) => genre === 6 || genre === 14 || genre === 16),
    ).toEqual([]);
  });

  it("refuses an auto-use award that has no rule", async () => {
    const { repository, store } = await createRepository();
    // Activity 52, achievement 951: [15-40-1-1-1000] is an event score
    // (ItemEatChickenScoreAuto) with no system behind it here.
    const score = catalog.achievement(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 951)!;
    expect(score.awards).toEqual([
      [15, 2, 1, 1, 20],
      [15, 40, 1, 1, 1_000],
    ]);
    await storeProgress(
      store,
      ACTIVITY_ACHIEVEMENT_TASK_GROUP,
      951,
      requiredAchievementCount(score),
    );
    const before = repository.get(account)!;
    expect(
      await rejection(repository.claimActivityAchievementAward(account, 52, 951)),
    ).toBe("unsupported_award");
    // Nothing is paid in part and the claim stays open.
    expect(money(repository.get(account)!, MONEY_DIAMOND)).toBe(
      money(before, MONEY_DIAMOND),
    );
    expect(hasClaimedAchievement(otherTask(repository.get(account)!, 951))).toBe(false);
  });

  it("counts login days at login for every shown page that uses them", async () => {
    const { repository } = await createRepository();
    const first = await repository.markLogin(
      account,
      Date.parse("2026-07-28T12:00:00Z"),
    );
    expect(achievementProgress(otherTask(first, 30))).toBe(1);
    const sameDay = await repository.markLogin(
      account,
      Date.parse("2026-07-28T19:59:59Z"),
    );
    expect(achievementProgress(otherTask(sameDay, 30))).toBe(1);
    const nextDay = await repository.markLogin(
      account,
      Date.parse("2026-07-28T20:00:00Z"),
    );
    expect(achievementProgress(otherTask(nextDay, 30))).toBe(2);
  });
});

describe("achievement panel claims", () => {
  it("pays Achievement.txt from task group 6 and refuses a second claim", async () => {
    const { repository, store } = await createRepository();
    // Achievement 2: commander level 10, [15-2-1-1-20, 15-1-1-1-2000].
    expect(await rejection(repository.claimAchievementAward(account, 2))).toBe(
      "not_completed",
    );
    await storeProgress(store, ACHIEVEMENT_TASK_GROUP, 2, 10);
    const before = repository.get(account)!;
    const result = await repository.claimAchievementAward(account, 2);
    expect(result.group).toBe(ACHIEVEMENT_TASK_GROUP);
    expect(result.awards).toEqual([
      [15, 2, 1, 1, 20],
      [15, 1, 1, 1, 2_000],
    ]);
    expect(money(result.player, MONEY_DIAMOND) - money(before, MONEY_DIAMOND)).toBe(20);
    expect(money(result.player, MONEY_GOLD) - money(before, MONEY_GOLD)).toBe(2_000);
    expect(result.player.taskValues[taskKey(ACHIEVEMENT_TASK_GROUP, 2)]).toBe(
      makeAchievementTaskValue(10, true),
    );
    expect(await rejection(repository.claimAchievementAward(account, 2))).toBe(
      "already_claimed",
    );
    expect(await rejection(repository.claimAchievementAward(account, 60_000))).toBe(
      "unknown_achievement",
    );
  });
});
