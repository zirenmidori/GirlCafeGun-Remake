import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  dailyMissionProgress,
  hasClaimedDailyMission,
  hasClaimedDailyMissionActiveAward,
  makeDailyMissionTaskId,
  DAILY_MISSION_ACTIVE_AWARD_TASK_ID,
  DAILY_MISSION_ACTIVE_POINT_TASK_ID,
} from "../src/game-data/daily-mission-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  DailyMissionError,
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-daily-mission-"));
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

describe("daily mission persistence", () => {
  it("records progress from supported gameplay and protects server-owned values", async () => {
    const repository = await createRepository();
    let player = await repository.makeCoffee("tester", 1, 1);
    expect(
      dailyMissionProgress(player.taskValues[String(makeDailyMissionTaskId(110))] ?? 0),
    ).toBe(1);

    player = await repository.chargeLevelVigour("tester", 10);
    expect(
      dailyMissionProgress(player.taskValues[String(makeDailyMissionTaskId(109))] ?? 0),
    ).toBe(10);

    player = await repository.setTaskValues("tester", [
      { id: makeDailyMissionTaskId(101), value: 11 },
      { id: 123, value: 9 },
    ]);
    expect(player.taskValues[String(makeDailyMissionTaskId(101))]).toBe(0);
    expect(player.taskValues["123"]).toBe(9);
  });

  it("claims a task once and converts its virtual reward into active points", async () => {
    const repository = await createRepository();
    await repository.recordDailyMissionProgress("tester", 101, 5);

    const result = await repository.claimDailyMissionAwards("tester", 101);
    const taskValue =
      result.player.taskValues[String(makeDailyMissionTaskId(101))] ?? 0;
    expect(dailyMissionProgress(taskValue)).toBe(5);
    expect(hasClaimedDailyMission(taskValue)).toBe(true);
    expect(
      result.player.taskValues[
        String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_POINT_TASK_ID))
      ],
    ).toBe(20);
    expect(result.updatedItems).toEqual([]);
    expect(result.updatedMoney).toEqual([]);

    await expect(
      repository.claimDailyMissionAwards("tester", 101),
    ).rejects.toBeInstanceOf(DailyMissionError);
  });

  it("quick-claims completed tasks and every newly available activity chest", async () => {
    const repository = await createRepository();
    await repository.recordDailyMissionProgress("tester", 101, 5);
    await repository.recordDailyMissionProgress("tester", 104, 1);
    await repository.recordDailyMissionProgress("tester", 105, 5);

    const result = await repository.claimDailyMissionAwards("tester", 0, true);

    expect(result.claimedMissionIds).toEqual([101, 104, 105]);
    expect(result.claimedActiveAwardIds).toEqual([1, 2, 3]);
    expect(
      result.player.taskValues[
        String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_POINT_TASK_ID))
      ],
    ).toBe(50);
    expect(hasClaimedDailyMissionActiveAward(result.player, 1)).toBe(true);
    expect(
      result.player.taskValues[
        String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_AWARD_TASK_ID))
      ],
    ).toBe(14);
    expect(result.player.money).toContainEqual({ id: 2, count: 40_000 });
    expect(
      result.player.inventory.some(
        ({ genre, detail }) => genre === 15 && detail === 52,
      ),
    ).toBe(false);
  });

  it("claims an individual activity chest exactly once", async () => {
    const repository = await createRepository();
    await repository.recordDailyMissionProgress("tester", 101, 5);
    await repository.claimDailyMissionAwards("tester", 101);

    const result = await repository.claimDailyMissionActiveAward("tester", 1);
    expect(result.claimedActiveAwardIds).toEqual([1]);
    expect(result.player.money).toContainEqual({ id: 2, count: 10_000 });

    await expect(
      repository.claimDailyMissionActiveAward("tester", 1),
    ).rejects.toMatchObject({ reason: "already_claimed" });
    await expect(
      repository.claimDailyMissionActiveAward("tester", 2),
    ).rejects.toMatchObject({ reason: "insufficient_active_points" });
  });

  it("resets progress and claim flags at the next 04:00 operational day", async () => {
    const repository = await createRepository();
    const firstDay = Date.parse("2026-07-29T12:00:00Z");
    const nextDay = Date.parse("2026-07-30T12:00:00Z");
    await repository.recordDailyMissionProgress("tester", 110, 1, firstDay);
    await repository.claimDailyMissionAwards("tester", 110, false, firstDay);

    const player = await repository.markLogin("tester", nextDay);
    expect(player.taskValues[String(makeDailyMissionTaskId(110))]).toBe(0);
    expect(
      player.taskValues[
        String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_POINT_TASK_ID))
      ],
    ).toBe(0);
  });
});
