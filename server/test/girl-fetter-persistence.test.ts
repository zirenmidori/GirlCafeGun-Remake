import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GIRL_FETTER_EVENT_OFFSET } from "../src/game-data/girl-fetter-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  GirlViewStoryError,
  makeInitialState,
  makeLevelId,
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-girl-fetter-"));
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

function fetterTaskKey(girlId: number, index: number): string {
  return String(
    (3 << 16) | ((girlId - 1) * 2_000 + GIRL_FETTER_EVENT_OFFSET + index - 1),
  );
}

async function setGirlLevel(
  store: JsonStore<PersistedState>,
  girlId: number,
  level: number,
): Promise<void> {
  await store.update((state) => {
    const girl = state.players.tester?.girls.find(
      (candidate) => candidate.girlId === girlId,
    );
    if (girl) girl.level = level;
  });
}

describe("girl fetter unlock reconciliation", () => {
  it("unlocks nodes whose affection level is met", async () => {
    const { repository, store } = await createRepository();
    await setGirlLevel(store, 2, 5);
    const { unlocks, player } = await repository.reconcileGirlFetter("tester");
    expect(unlocks).toContainEqual({ girlId: 2, index: 2 });
    // 等级 1 的主线节点在建号时已解锁
    expect(player.taskValues[fetterTaskKey(2, 1)]).toBe(1);
    expect(player.taskValues[fetterTaskKey(2, 2)]).toBe(1);
    // 等级 15 的节点不解锁
    expect(player.taskValues[fetterTaskKey(2, 11)] ?? 0).toBe(0);
  });

  it("keeps chapter-gated nodes locked until the chapter is cleared", async () => {
    const { repository, store } = await createRepository();
    await setGirlLevel(store, 2, 15);
    const before = await repository.reconcileGirlFetter("tester");
    expect(before.player.taskValues[fetterTaskKey(2, 11)] ?? 0).toBe(0);

    await store.update((state) => {
      state.players.tester?.levels.push({ id: makeLevelId(2, 6, 1), star: 1 });
    });
    const after = await repository.reconcileGirlFetter("tester");
    expect(after.unlocks).toContainEqual({ girlId: 2, index: 11 });
    expect(after.player.taskValues[fetterTaskKey(2, 11)]).toBe(1);
  });

  it("is idempotent and reconciles on login", async () => {
    const { repository, store } = await createRepository();
    await setGirlLevel(store, 2, 5);
    await repository.reconcileGirlFetter("tester");
    const again = await repository.reconcileGirlFetter("tester");
    expect(again.unlocks).toEqual([]);

    await setGirlLevel(store, 7, 10);
    const player = await repository.markLogin("tester");
    expect(player.taskValues[fetterTaskKey(7, 1)]).toBe(1);
    expect(player.taskValues[fetterTaskKey(7, 5)]).toBe(1);
  });

  it("unlocks fetter nodes when a gift raises the affection level", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players.tester?.inventory.push({
        guid: 900_001,
        genre: 5,
        detail: 2,
        particular: 1,
        templateLevel: 1,
        count: 30,
        createTime: 0,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });
    const result = await repository.sendGirlGift("tester", 2, [5, 2, 1, 1], 30);
    expect(result.newLevel).toBeGreaterThanOrEqual(5);
    expect(result.fetterUnlocks).toContainEqual({ girlId: 2, index: 2 });
    expect(result.player.taskValues[fetterTaskKey(2, 2)]).toBe(1);
  });
});

describe("view girl story", () => {
  it("grants the node award once and marks the node read", async () => {
    const { repository, store } = await createRepository();
    await setGirlLevel(store, 2, 5);
    await repository.reconcileGirlFetter("tester");

    const first = await repository.viewGirlStory("tester", 2, 1, 2);
    expect(first.alreadyRead).toBe(false);
    expect(first.awards).toEqual([
      [15, 2, 1, 1, 10],
      [15, 1, 1, 1, 3000],
    ]);
    expect(first.player.taskValues[fetterTaskKey(2, 2)]).toBe(2);
    expect(first.player.money.find(({ id }) => id === 3)?.count).toBe(10);
    expect(first.player.money.find(({ id }) => id === 2)?.count).toBe(3_000);

    const second = await repository.viewGirlStory("tester", 2, 1, 2);
    expect(second.alreadyRead).toBe(true);
    expect(second.awards).toEqual([]);
    expect(second.player.money.find(({ id }) => id === 3)?.count).toBe(10);
  });

  it("rejects locked or unknown stories", async () => {
    const { repository } = await createRepository();
    await expect(repository.viewGirlStory("tester", 2, 1, 2)).rejects.toThrow(
      GirlViewStoryError,
    );
    await repository.viewGirlStory("tester", 2, 1, 2).catch((error: unknown) => {
      expect((error as GirlViewStoryError).reason).toBe("story_locked");
    });
    await repository.viewGirlStory("tester", 2, 1, 999).catch((error: unknown) => {
      expect((error as GirlViewStoryError).reason).toBe("story_not_found");
    });
    await expect(repository.viewGirlStory("tester", 99, 1, 1)).rejects.toThrow(
      GirlViewStoryError,
    );
  });

  it("marks card stories read without awards (nType=3)", async () => {
    const { repository } = await createRepository();
    const result = await repository.viewGirlStory("tester", 2, 3, 1);
    expect(result.awards).toEqual([]);
    const key = String((3 << 16) | ((2 - 1) * 2_000 + 400 + 1 - 1));
    expect(result.player.taskValues[key]).toBe(2);
  });
});
