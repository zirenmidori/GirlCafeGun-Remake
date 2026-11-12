import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  GirlGiftError,
  GirlLevelAwardError,
  makeInitialState,
  PlayerRepository,
  type PersistedState,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

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
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-girl-gift-"));
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
      level: 1,
      exp: 0,
      fightPower: 0,
      serverZone: 8,
      firstLevelComplete: false,
    },
    logger,
  });
  await repository.getOrCreate("tester");
  return { repository, store };
}

function girlTaskKey(girlId: number, offset: number): string {
  const link = girlId >= 201 && girlId <= 204;
  const group = link ? 90 : 3;
  const normalized = link ? girlId - 200 : girlId;
  return String((group << 16) | ((normalized - 1) * 2_000 + offset));
}

describe("girl gift persistence", () => {
  it("consumes the gift and applies generic gift experience", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players.tester?.inventory.push({
        guid: 900_001,
        genre: 5,
        detail: 2,
        particular: 1,
        templateLevel: 1,
        count: 10,
        createTime: 0,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });

    const result = await repository.sendGirlGift("tester", 7, [5, 2, 1, 1], 1);

    expect(result.loved).toBe(false);
    expect(result.activityGift).toBe(false);
    expect(result.specialActivityGift).toBe(false);
    expect(result.addedExperience).toBe(30);
    expect(result.oldLevel).toBe(1);
    expect(result.newLevel).toBe(1);
    expect(result.newExperience).toBe(30);
    expect(result.girl.level).toBe(1);
    expect(result.girl.exp).toBe(30);
    expect(result.consumedItem.count).toBe(9);
    expect(result.unlockedSecretIds).toEqual([]);
  });

  it("applies the favorite-gift multiplier and unlocks the gift secret", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players.tester?.inventory.push({
        guid: 900_002,
        genre: 5,
        detail: 1,
        particular: 7,
        templateLevel: 4,
        count: 2,
        createTime: 0,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });

    const result = await repository.sendGirlGift("tester", 7, [5, 1, 7, 4], 1);

    expect(result.loved).toBe(true);
    expect(result.addedExperience).toBe(375);
    expect(result.newLevel).toBe(4);
    expect(result.newExperience).toBe(61);
    expect(result.unlockedSecretIds).toEqual([12]);
    expect(result.player.taskValues[girlTaskKey(7, 111)]).toBe(1);
  });

  it("scales multi-gift sends by the item count", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players.tester?.inventory.push({
        guid: 900_003,
        genre: 5,
        detail: 2,
        particular: 1,
        templateLevel: 1,
        count: 10,
        createTime: 0,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });

    const result = await repository.sendGirlGift("tester", 7, [5, 2, 1, 1], 2);

    expect(result.addedExperience).toBe(60);
    expect(result.girl.exp).toBe(60);
    expect(result.consumedItem.count).toBe(8);
  });

  it("rejects max-level girls with client error 4", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const player = state.players.tester;
      if (!player) throw new Error("missing test player");
      const girl = player.girls.find(({ girlId }) => girlId === 7);
      if (!girl) throw new Error("missing test girl");
      girl.level = 100;
      girl.exp = 0;
      player.inventory.push({
        guid: 900_004,
        genre: 5,
        detail: 2,
        particular: 1,
        templateLevel: 1,
        count: 10,
        createTime: 0,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });

    const error = await repository
      .sendGirlGift("tester", 7, [5, 2, 1, 1], 1)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GirlGiftError);
    expect((error as GirlGiftError).reason).toBe("max_level");
    expect((error as GirlGiftError).clientError).toBe(4);
  });

  it("rejects unknown gifts, missing items and foreign girls", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players.tester?.inventory.push({
        guid: 900_005,
        genre: 5,
        detail: 2,
        particular: 1,
        templateLevel: 1,
        count: 1,
        createTime: 0,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });

    await expect(
      repository.sendGirlGift("tester", 7, [5, 3, 1, 1], 1),
    ).rejects.toMatchObject({
      reason: "gift_not_found",
      clientError: 2,
    });
    await expect(
      repository.sendGirlGift("tester", 7, [5, 2, 1, 1], 2),
    ).rejects.toMatchObject({
      reason: "insufficient_gift",
      clientError: 2,
    });
    await expect(
      repository.sendGirlGift("tester", 8, [5, 2, 1, 1], 1),
    ).rejects.toMatchObject({
      reason: "girl_not_owned",
      clientError: 3,
    });
    await expect(
      repository.sendGirlGift("tester", 7, [5, 2, 1, 1], 0),
    ).rejects.toMatchObject({
      reason: "invalid_request",
      clientError: 1,
    });
  });

  it("supports link girls with their own curve and secret", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const player = state.players.tester;
      if (!player) throw new Error("missing test player");
      player.girls.push({
        girlId: 201,
        level: 1,
        exp: 0,
        modelId: 1,
        moodValue: 100,
        vigor: 100,
        flag: 0,
      });
      player.inventory.push({
        guid: 900_006,
        genre: 5,
        detail: 1,
        particular: 201,
        templateLevel: 4,
        count: 1,
        createTime: 0,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });

    const result = await repository.sendGirlGift("tester", 201, [5, 1, 201, 4], 1);

    expect(result.loved).toBe(true);
    expect(result.addedExperience).toBe(1_000);
    expect(result.newLevel).toBe(4);
    expect(result.newExperience).toBe(55);
    expect(result.unlockedSecretIds).toEqual([5]);
    expect(result.player.taskValues[girlTaskKey(201, 104)]).toBe(1);
  });

  it("records LevelAward claims idempotently", async () => {
    const { repository } = await createRepository();

    const player = await repository.claimGirlLevelAward("tester", 7, 10);
    expect(player.taskValues[girlTaskKey(7, 500)]).toBe(1);

    const again = await repository.claimGirlLevelAward("tester", 7, 10);
    expect(again.taskValues[girlTaskKey(7, 500)]).toBe(1);

    await expect(
      repository.claimGirlLevelAward("tester", 7, 15),
    ).rejects.toBeInstanceOf(GirlLevelAwardError);
    await expect(
      repository.claimGirlLevelAward("tester", 8, 10),
    ).rejects.toBeInstanceOf(GirlLevelAwardError);
  });
});
