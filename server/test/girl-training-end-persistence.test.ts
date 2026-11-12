import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  GirlTrainingError,
  makeInitialState,
  MONEY_GOLD,
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-girl-training-end-"));
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
  return String((3 << 16) | ((girlId - 1) * 2_000 + offset));
}

async function startTraining(
  repository: PlayerRepository,
  girlId: number,
  position: number,
  startedAt: number,
): Promise<void> {
  await repository.startGirlTraining("tester", girlId, position, startedAt);
}

describe("girl training settlement", () => {
  it("grants affection and gold, and clears the training state", async () => {
    const { repository } = await createRepository();
    const startedAt = Date.now() - 4_000_000;
    await startTraining(repository, 7, 11, startedAt);

    const result = await repository.endGirlTraining("tester", 7);

    expect(result.position).toBe(11);
    expect(result.gold).toBe(1_000);
    expect(result.addedExperience).toBe(60);
    expect(result.oldLevel).toBe(1);
    expect(result.newLevel).toBe(1);
    expect(result.newExperience).toBe(60);
    expect(result.girl.exp).toBe(60);
    expect(result.updatedMoney).toHaveLength(1);
    expect(result.updatedMoney[0]).toMatchObject({ id: MONEY_GOLD });
    expect(result.player.taskValues[girlTaskKey(7, 11)]).toBe(0);
    expect(result.player.taskValues[girlTaskKey(7, 12)]).toBe(0);
    expect(result.player.taskValues[girlTaskKey(7, 16)]).toBe(0);
  });

  it("levels up and unlocks FitLove secrets crossed by the training reward", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const girl = state.players.tester?.girls.find(({ girlId }) => girlId === 7);
      if (!girl) throw new Error("missing test girl");
      girl.level = 9;
      girl.exp = 170;
    });
    const startedAt = Date.now() - 29_000_000;
    await startTraining(repository, 7, 41, startedAt);

    const result = await repository.endGirlTraining("tester", 7);

    expect(result.addedExperience).toBe(480);
    expect(result.oldLevel).toBe(9);
    expect(result.newLevel).toBe(12);
    expect(result.newExperience).toBe(115);
    expect(result.unlockedSecretIds).toEqual([8, 9]);
    expect(result.player.taskValues[girlTaskKey(7, 107)]).toBe(1);
    expect(result.player.taskValues[girlTaskKey(7, 108)]).toBe(1);
  });

  it("settles a max-level girl with a zero affection gain", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const girl = state.players.tester?.girls.find(({ girlId }) => girlId === 7);
      if (!girl) throw new Error("missing test girl");
      girl.level = 100;
      girl.exp = 0;
    });
    const startedAt = Date.now() - 4_000_000;
    await startTraining(repository, 7, 11, startedAt);

    const result = await repository.endGirlTraining("tester", 7);

    expect(result.addedExperience).toBe(0);
    expect(result.oldLevel).toBe(100);
    expect(result.newLevel).toBe(100);
    expect(result.gold).toBe(1_000);
  });

  it("rejects girls that are not training or still training", async () => {
    const { repository } = await createRepository();

    await expect(repository.endGirlTraining("tester", 7)).rejects.toMatchObject({
      reason: "not_training",
    });

    await startTraining(repository, 7, 11, Date.now());
    await expect(repository.endGirlTraining("tester", 7)).rejects.toMatchObject({
      reason: "training_not_finished",
    });
    await expect(repository.endGirlTraining("tester", 8)).rejects.toBeInstanceOf(
      GirlTrainingError,
    );
  });
});
