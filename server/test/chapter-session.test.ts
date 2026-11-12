import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  dailyMissionProgress,
  makeDailyMissionTaskId,
} from "../src/game-data/daily-mission-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  InsufficientVigourError,
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

async function createRepository(): Promise<PlayerRepository> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-chapter-"));
  directories.push(directory);
  const store = new JsonStore<PersistedState>({
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
  return repository;
}

const vigourOf = (player: { money: { id: number; count: number }[] }) =>
  player.money.find(({ id }) => id === 1)?.count ?? 0;

describe("stateless chapter settlement persistence", () => {
  it("settles without a prior enter and charges vigour in the same transaction", async () => {
    const repository = await createRepository();
    const before = repository.get("tester")!;

    const settlement = await repository.settleLevel(
      "tester",
      1,
      1,
      1,
      3,
      3,
      [[15, 1, 1, 1, 1_000, 0]],
      0,
    );

    expect(settlement.energyCost).toBe(3);
    expect(vigourOf(settlement.player)).toBe(vigourOf(before) - 3);
    expect(settlement.player.levels).toEqual([{ id: 65_793, star: 11 }]);
    expect(
      dailyMissionProgress(
        settlement.player.taskValues[String(makeDailyMissionTaskId(109))] ?? 0,
      ),
    ).toBe(3);
  });

  it("rejects settlement when vigour is insufficient and persists nothing", async () => {
    const repository = await createRepository();
    const before = repository.get("tester")!;

    await expect(
      repository.settleLevel("tester", 1, 1, 1, 3, 999, [], 0),
    ).rejects.toBeInstanceOf(InsufficientVigourError);

    const after = repository.get("tester")!;
    expect(vigourOf(after)).toBe(vigourOf(before));
    expect(after.levels).toEqual([]);
    expect(
      dailyMissionProgress(after.taskValues[String(makeDailyMissionTaskId(109))] ?? 0),
    ).toBe(0);
  });

  it("charges vigour for a failed fight and rejects when the balance is too low", async () => {
    const repository = await createRepository();
    const before = repository.get("tester")!;

    const charged = await repository.chargeLevelVigour("tester", 3);
    expect(vigourOf(charged)).toBe(vigourOf(before) - 3);
    expect(charged.levels).toEqual([]);

    await expect(repository.chargeLevelVigour("tester", 999)).rejects.toBeInstanceOf(
      InsufficientVigourError,
    );
    expect(vigourOf(repository.get("tester")!)).toBe(vigourOf(before) - 3);
  });
});
