import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  dailyMissionProgress,
  makeDailyMissionTaskId,
} from "../src/game-data/daily-mission-data.js";
import {
  HEADPAT_AFFECTION_EXPERIENCE,
  HEADPAT_CHARGE_TASK_ID,
  HEADPAT_REFILL_TASK_ID,
} from "../src/game-data/headpat-data.js";
import { PromiseCatalog } from "../src/game-data/girl-promise-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  HeadpatError,
  makeInitialState,
  makeLevelId,
  PlayerRepository,
} from "../src/persistence/player-repository.js";

const NOW = Date.UTC(2026, 10, 6, 12);
const root = path.resolve(import.meta.dirname, "../../tools/headpat-fix");
const directories: string[] = [];
const countKey = String(HEADPAT_CHARGE_TASK_ID),
  timeKey = String(HEADPAT_REFILL_TASK_ID);
const defaults = {
  name: "",
  level: 1,
  exp: 0,
  fightPower: 0,
  serverZone: 8,
  firstLevelComplete: false,
};
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (
      !resolved.startsWith(`${root}${path.sep}`) ||
      !path.basename(resolved).startsWith("state-test-")
    )
      throw new Error("Refusing cleanup outside isolated headpat test directory");
    await rm(resolved, { recursive: true, force: true });
  }
});
async function fixture() {
  const directory = await mkdtemp(path.join(root, "state-test-"));
  directories.push(directory);
  const filePath = path.join(directory, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const players = new PlayerRepository({ store, defaults, logger });
  await players.getOrCreate("tester", NOW);
  return { store, players, filePath };
}
async function touchStage(f: Awaited<ReturnType<typeof fixture>>) {
  const catalog = PromiseCatalog.loadDefault();
  await f.store.update((state) => {
    const player = state.players.tester!;
    player.levels.push({ id: makeLevelId(6, 12, 1), star: 15 });
    player.inventory.push({
      guid: 20_000,
      genre: 9,
      detail: 16,
      particular: 1,
      templateLevel: 1,
      count: 100,
      createTime: 1,
      enhanceLevel: 0,
      enhanceExp: 0,
      breakLevel: 0,
      lockOn: 0,
    });
  });
  await f.players.handlePromiseRequest("tester", 233, { girlid: 2 }, NOW);
  const stage = catalog
    .getSteps(2)
    .find((step) =>
      step.tasklist.some((id) => catalog.task(id)!.strtype === "TouchHead"),
    )!;
  await f.store.update((state) => {
    const girl = state.players.tester!.promise!.girls["2"]!;
    girl.step = stage.step;
    girl.taskdatas = stage.tasklist.map((id) => ({ id, count: 0, status: 0 }));
  });
  return stage.tasklist.find((id) => catalog.task(id)!.strtype === "TouchHead")!;
}

describe("atomic headpat gameplay", () => {
  it("lazily repairs old profiles and preserves explicit exhausted stock", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      delete state.players.tester!.taskValues[countKey];
      delete state.players.tester!.taskValues[timeKey];
    });
    expect((await f.players.getOrCreate("tester", NOW)).taskValues).toMatchObject({
      [countKey]: 5,
      [timeKey]: 0,
    });
    await f.store.update((state) => {
      state.players.tester!.taskValues[countKey] = 0;
      state.players.tester!.taskValues[timeKey] = NOW / 1_000;
    });
    expect((await f.players.getOrCreate("tester", NOW)).taskValues).toMatchObject({
      [countKey]: 0,
      [timeKey]: NOW / 1_000,
    });
    expect(
      (await f.players.markLogin("tester", NOW + 3_600_000)).taskValues[countKey],
    ).toBe(0);
    expect(
      (await f.players.markLogin("tester", NOW + 3_601_000)).taskValues,
    ).toMatchObject({ [countKey]: 1, [timeKey]: NOW / 1_000 + 3_600 });
  });

  it("consumes one charge and returns exact affection fields without a success nError", async () => {
    const f = await fixture();
    expect(HEADPAT_AFFECTION_EXPERIENCE).toBe(50);
    await f.store.update((state) => {
      const girl = state.players.tester!.girls.find((girl) => girl.girlId === 2)!;
      girl.level = 1;
      girl.exp = 95;
    });
    const result = await f.players.headpatGirl("tester", 2, 0, NOW);
    expect(result.response).toEqual({
      sCmd: "HeadTouched",
      nId: 2,
      nType: 0,
      nAddExp: 50,
      nOldExp: 95,
      nNewExp: 45,
      nOldLevel: 1,
      nNewLevel: 2,
    });
    expect(result.response).not.toHaveProperty("nError");
    expect(result.player.taskValues).toMatchObject({
      [countKey]: 4,
      [timeKey]: NOW / 1_000,
    });
    expect(result.updatedGirls).toContainEqual(
      expect.objectContaining({ girlId: 2, level: 2, exp: 45 }),
    );
    expect(
      dailyMissionProgress(
        result.player.taskValues[String(makeDailyMissionTaskId(105))] ?? 0,
      ),
    ).toBe(1);
  });

  it("unlocks level-gated secrets through the existing affection path", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      const girl = state.players.tester!.girls.find((girl) => girl.girlId === 2)!;
      girl.level = 9;
      girl.exp = 150;
    });
    const result = await f.players.headpatGirl("tester", 2, 1, NOW);
    expect(result.response.nNewLevel).toBe(10);
    for (const secretId of [8, 9])
      expect(
        result.player.taskValues[String((3 << 16) | (2_000 + 100 + secretId - 1))],
      ).toBe(1);
  });

  it("counts accepted max-affection headpats for daily and active Oath tasks without overflow", async () => {
    const f = await fixture();
    const taskId = await touchStage(f);
    await f.store.update((state) => {
      const girl = state.players.tester!.girls.find((girl) => girl.girlId === 2)!;
      girl.level = 100;
      girl.exp = 0;
    });
    const result = await f.players.headpatGirl("tester", 2, 1, NOW);
    expect(result.response).toMatchObject({
      nIsMaxlevel: true,
      nAddExp: 0,
      nOldLevel: 100,
      nNewLevel: 100,
      nNewExp: 0,
    });
    expect(
      result.player.promise!.girls["2"]!.taskdatas.find(({ id }) => id === taskId),
    ).toMatchObject({ count: 1, status: 0 });
    expect(result.player.taskValues[countKey]).toBe(4);
    expect(
      dailyMissionProgress(
        result.player.taskValues[String(makeDailyMissionTaskId(105))] ?? 0,
      ),
    ).toBe(1);
  });

  it("trims a cap-crossing reward rather than reporting an already-maxed girl", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      const girl = state.players.tester!.girls.find((girl) => girl.girlId === 2)!;
      girl.level = 99;
      girl.exp = 4_490;
    });
    const result = await f.players.headpatGirl("tester", 2, 0, NOW);
    expect(result.response).toMatchObject({ nAddExp: 10, nNewLevel: 100, nNewExp: 0 });
    expect(result.response).not.toHaveProperty("nIsMaxlevel");
  });

  it("rejects invalid or exhausted interactions without charging or awarding any counters", async () => {
    const f = await fixture();
    await touchStage(f);
    await f.store.update((state) => {
      state.players.tester!.taskValues[countKey] = 0;
      state.players.tester!.taskValues[timeKey] = NOW / 1_000;
    });
    const before = f.store.snapshot();
    for (const [girl, type] of [
      [2, 0],
      [2, 3],
      [2, -1],
      [2, 0.5],
      [201, 1],
      [2.5, 1],
    ]) {
      await expect(
        f.players.headpatGirl("tester", girl!, type!, NOW),
      ).rejects.toBeInstanceOf(HeadpatError);
      expect(f.store.snapshot()).toEqual(before);
    }
    await expect(f.players.headpatGirl("tester", 2, 0, NOW)).rejects.toMatchObject({
      reason: "no_charges",
      clientError: 2,
    });
  });

  it("acknowledges the tutorial gesture at zero stock without gameplay credit", async () => {
    const f = await fixture();
    await touchStage(f);
    await f.store.update((state) => {
      state.players.tester!.taskValues[countKey] = 0;
      state.players.tester!.taskValues[timeKey] = 0;
    });
    const before = f.players.get("tester");
    const result = await f.players.headpatGirl("tester", 2, 2, NOW);
    expect(result.response).toEqual({ sCmd: "HeadTouched", nId: 2, nType: 2 });
    expect(result.player).toEqual(before);
    expect(result.updatedGirls).toEqual([]);
    expect(result.completedTaskIds).toEqual([]);
  });

  it("serializes concurrent accepted headpats with exactly five charges", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      state.players.tester!.girls.find((girl) => girl.girlId === 2)!.level = 100;
    });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => f.players.headpatGirl("tester", 2, 0, NOW)),
    );
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(5);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const player = f.players.get("tester")!;
    expect(player.taskValues[countKey]).toBe(0);
    expect(
      dailyMissionProgress(player.taskValues[String(makeDailyMissionTaskId(105))] ?? 0),
    ).toBe(5);
  });

  it("protects stock against client task writes and preserves refill state across reload", async () => {
    const f = await fixture();
    await f.players.headpatGirl("tester", 2, 0, NOW);
    const updated = await f.players.setTaskValues("tester", [
      { id: HEADPAT_CHARGE_TASK_ID, value: 999 },
      { id: HEADPAT_REFILL_TASK_ID, value: 0 },
      { id: (44 << 16) | 101, value: 2 },
    ]);
    expect(updated.taskValues).toMatchObject({
      [countKey]: 4,
      [timeKey]: NOW / 1_000,
      [String((44 << 16) | 101)]: 2,
    });
    await f.store.flush();
    const store = new JsonStore({
      filePath: f.filePath,
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    const players = new PlayerRepository({ store, defaults, logger });
    expect((await players.markLogin("tester", NOW + 1_000)).taskValues).toMatchObject({
      [countKey]: 4,
      [timeKey]: NOW / 1_000,
    });
    expect(
      (await players.markLogin("tester", NOW + 3_601_000)).taskValues,
    ).toMatchObject({ [countKey]: 5, [timeKey]: 0 });
  });
});
