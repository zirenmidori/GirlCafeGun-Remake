import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  achievementProgress,
  hasClaimedAchievement,
  makeAchievementTaskId,
  makeAchievementTaskValue,
} from "../src/game-data/activity-achievement-data.js";
import { getBountyLevel, rollBountyRun } from "../src/game-data/bounty-data.js";
import { CARD_EXP_MATERIALS } from "../src/game-data/card-enhancement-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
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
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createRepository(level = 1): Promise<{
  repository: PlayerRepository;
  store: JsonStore<PersistedState>;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-achievement-progress-"));
  directories.push(directory);
  const store = new JsonStore({
    filePath: path.join(directory, "state.json"),
    initialState: makeInitialState(),
    logger,
  });
  await store.initialize();
  const repository = new PlayerRepository({
    store,
    defaults: {
      name: "",
      level,
      exp: 0,
      fightPower: 0,
      serverZone: 8,
      firstLevelComplete: false,
    },
    logger,
  });
  await repository.getOrCreate(account);
  return { repository, store };
}

function key(achievementId: number): string {
  return String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, achievementId));
}

function progress(player: Player, achievementId: number): number {
  return achievementProgress(player.taskValues[key(achievementId)] ?? 0);
}

function highestAffection(player: Player): number {
  return Math.max(0, ...player.girls.map(({ level }) => level));
}

function addItem(
  player: Player,
  guid: number,
  gdpl: readonly [number, number, number, number],
  count: number,
): void {
  player.inventory.push({
    guid,
    genre: gdpl[0],
    detail: gdpl[1],
    particular: gdpl[2],
    templateLevel: gdpl[3],
    count,
    createTime: 0,
    enhanceLevel: 0,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
  });
}

// Achievement ids below are from resources/activity/achievementother.txt and
// belong to activities the client shows today (2, 3, 14, 15, 16, 20, 29, 108).
describe("event page achievements move without a new login", () => {
  it("headpat raises the affection level achievements (types 37, 85)", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const player = state.players[account]!;
      for (const girl of player.girls) {
        girl.level = 1;
        girl.exp = 0;
      }
      player.girls.find(({ girlId }) => girlId === 2)!.exp = 95;
      // A level set in the save directly, without an event or a login.
      player.girls.find(({ girlId }) => girlId === 7)!.level = 10;
      player.taskValues[key(45)] = makeAchievementTaskValue(1, false);
    });

    const result = await repository.headpatGirl(account, 2, 0);

    expect(result.response).toMatchObject({ nOldLevel: 1 });
    expect(result.response.nNewLevel).toBeGreaterThan(1);
    // 45: highest affection 5 (type 37).
    expect(progress(result.player, 45)).toBe(highestAffection(result.player));
    // 99: one girl at affection 10 (type 85 [1, 10]).
    expect(progress(result.player, 99)).toBe(1);
  });

  it("card enhance raises the card level achievements (type 39)", async () => {
    const { repository, store } = await createRepository();
    const material = CARD_EXP_MATERIALS.get(6)!;
    await store.update((state) => {
      const player = state.players[account]!;
      addItem(
        player,
        900_001,
        [material.genre, material.detail, material.particular, material.templateLevel],
        5,
      );
      player.money.find(({ id }) => id === 2)!.count = 1_000_000;
    });
    const before = (await repository.getOrCreate(account)).inventory.find(
      ({ guid }) => guid === 10_003,
    )!.enhanceLevel;

    const result = await repository.enhanceCard(account, 10_003, [
      { kind: 1, reference: 6, count: 5 },
    ]);

    expect(result.card.enhanceLevel).toBeGreaterThan(before);
    // 10: any card level 20 (type 39).
    expect(progress(result.player, 10)).toBe(
      Math.max(
        ...result.player.inventory
          .filter(({ genre }) => genre === 1)
          .map(({ enhanceLevel }) => enhanceLevel),
      ),
    );
  });

  it("a won fight counts clears, vigour and the new commander level (types 22, 24, 1)", async () => {
    const { repository } = await createRepository();

    const settlement = await repository.settleLevel(
      account,
      1,
      1,
      1,
      3,
      3,
      [[15, 1, 1, 1, 1_000, 0]],
      36,
    );

    expect(settlement.experienceUpdate.levelsGained).toBeGreaterThan(0);
    // 100: commander level 15 (type 1), projected after the experience.
    expect(progress(settlement.player, 100)).toBe(settlement.player.level);
    // 31: 20 clears at difficulty 1 (type 22); 96 (type 2, hard 2-6) is unrelated.
    expect(progress(settlement.player, 31)).toBe(1);
    // 97: spend 600 vigour (type 24).
    expect(progress(settlement.player, 97)).toBe(3);

    const second = await repository.settleLevel(account, 1, 1, 2, 1, 4, [], 0);
    // A hard clear does not count toward the normal-difficulty achievement.
    expect(progress(second.player, 31)).toBe(1);
    expect(progress(second.player, 97)).toBe(7);
  });

  it("a story level does not count as a stage clear (type 22)", async () => {
    const { repository } = await createRepository();

    const result = await repository.completeStoryLevel(account, {
      chapter: 1,
      index: 1,
      difficulty: 1,
      firstAwards: [],
    } as unknown as Parameters<PlayerRepository["completeStoryLevel"]>[1]);

    expect(progress(result.player, 31)).toBe(0);
  });

  it("a failed fight still counts the vigour it spent (type 24)", async () => {
    const { repository } = await createRepository();

    const player = await repository.chargeLevelVigour(account, 3);

    expect(progress(player, 97)).toBe(3);
  });

  it("a bounty clear counts bounty clears and vigour (types 42, 24)", async () => {
    const { repository } = await createRepository(34);
    const level = getBountyLevel(1, 1)!;
    const run = rollBountyRun(level, "first", 2);

    const settled = await repository.settleBounty(
      account,
      level,
      run.awards,
      run.dailyBonusApplied,
      null,
    );

    // 36: 5 bounty clears (type 42).
    expect(progress(settled.player, 36)).toBe(1);
    expect(progress(settled.player, 97)).toBe(settled.energyCost);
  });

  it("a gift counts every gift item and refreshes affection (types 18, 37)", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      addItem(state.players[account]!, 900_001, [5, 2, 1, 1], 10);
    });

    const first = await repository.sendGirlGift(account, 7, [5, 2, 1, 1], 3);
    // 55: give 10 gifts (type 18).
    expect(progress(first.player, 55)).toBe(3);
    expect(first.achievementsChanged).toBe(true);
    expect(progress(first.player, 45)).toBe(highestAffection(first.player));

    const second = await repository.sendGirlGift(account, 7, [5, 2, 1, 1], 2);
    expect(progress(second.player, 55)).toBe(5);
  });

  it("a finished training counts once (type 29)", async () => {
    const { repository } = await createRepository();
    await repository.startGirlTraining(account, 7, 11, Date.now() - 4_000_000);

    const result = await repository.endGirlTraining(account, 7);

    // 58: 5 trainings (type 29).
    expect(progress(result.player, 58)).toBe(1);
  });

  it("a weapon limit break counts once (type 40)", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const player = state.players[account]!;
      addItem(player, 100, [2, 2, 28, 1], 1);
      addItem(player, 101, [2, 2, 28, 1], 1);
      player.money = [{ id: 2, count: 2_000_000 }];
      player.formations = [];
    });

    const result = await repository.breakthroughWeapon(account, 100, [
      { guid: 101, count: 1 },
    ]);

    expect(result.weapon.breakLevel).toBe(1);
    // 305: one weapon limit break (type 40).
    expect(progress(result.player, 305)).toBe(1);
  });

  it("counting keeps the claim mark", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players[account]!.taskValues[key(97)] = makeAchievementTaskValue(600, true);
    });

    const player = await repository.chargeLevelVigour(account, 3);

    expect(progress(player, 97)).toBe(603);
    expect(hasClaimedAchievement(player.taskValues[key(97)] ?? 0)).toBe(true);
  });
});
