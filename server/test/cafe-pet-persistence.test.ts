import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CafePetCatalog } from "../src/game-data/cafe-pet-catalog.js";
import {
  CafePetOperationError,
  cafePetRikiTaskOffset,
  type CafePet,
} from "../src/game-data/cafe-pets.js";
import { PromiseCatalog } from "../src/game-data/girl-promise-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
} from "../src/persistence/player-repository.js";

const NOW = Date.UTC(2026, 10, 11, 12);
const scratch = path.resolve(import.meta.dirname, "../../tools/cafe-fix");
const dirs: string[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const defaults = {
  name: "",
  level: 20,
  exp: 0,
  fightPower: 0,
  serverZone: 8,
  firstLevelComplete: false,
};
const catalog = CafePetCatalog.loadDefault();
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    if (
      path.dirname(dir) !== scratch ||
      !path.basename(dir).startsWith("pet-save-test-")
    )
      throw new Error("Unsafe pet test directory");
    await rm(dir, { recursive: true, force: true });
  }
});
async function fixture() {
  const dir = await mkdtemp(path.join(scratch, "pet-save-test-"));
  dirs.push(dir);
  const filePath = path.join(dir, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const players = new PlayerRepository({ store, defaults, logger });
  await players.getOrCreate("player", NOW);
  await players.getOrCreate("other", NOW);
  const other = players.get("other");
  const call = (parameters: Record<string, unknown>, now = NOW) =>
    players.handleCafePetRequest("player", parameters, now);
  const reload = async () => {
    await store.flush();
    const saved = new JsonStore({ filePath, initialState: makeInitialState(), logger });
    await saved.initialize();
    return new PlayerRepository({ store: saved, defaults, logger });
  };
  return { store, players, call, reload, filePath, other };
}
function pet(uid: number): CafePet {
  return {
    uid,
    templateid: 101,
    exp: 0,
    hot: 100,
    name: "Test pet",
    birthday: NOW / 1000,
    meetday: NOW / 1000,
    hobby: 101,
    iq: 60,
    nature: 1,
    gender: 1,
    lv: 1,
    ext3: 0,
  };
}
describe("persistent café pets", () => {
  it("adopts from a real can, preserves old profiles, reloads the pet and rejects invalid gift atomically", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      state.players.player!.inventory.push({
        guid: 90000,
        genre: 21,
        detail: 1,
        particular: 1,
        templateLevel: 2,
        count: 2,
        createTime: NOW / 1000,
        enhanceLevel: 1,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });
    await f.call({ sCmd: "OnFoodBoxOpen", nBoxId: 1 });
    await f.call({ sCmd: "SetFood", nBoxId: 1, nId: 1 });
    const mature = NOW + 8 * 3600_000;
    await f.call({ sCmd: "UpdateFoodBoxs" }, mature);
    const adopted = await f.call(
      { sCmd: "OnNewPet", nBoxId: 1, name: "Cafe friend" },
      mature,
    );
    expect(adopted.response).toMatchObject({
      sCmd: "AdoptPet",
      petInfo: { uid: 1, name: "Cafe friend" },
    });
    const before = f.players.get("player");
    await expect(
      f.call({ sCmd: "PetGift", uid: 1, tbItem: [22, 1, 9999, 1, 1] }, mature),
    ).rejects.toBeInstanceOf(CafePetOperationError);
    expect(f.players.get("player")).toEqual(before);
    const loaded = await f.reload();
    expect(loaded.get("player")?.cafe.pets?.pets[0]).toMatchObject({
      uid: 1,
      name: "Cafe friend",
    });
    expect(
      loaded.get("player")?.inventory.find((item) => item.guid === 90000)?.count,
    ).toBe(1);
    expect(loaded.get("other")).toEqual(f.other);
  });

  it("does not rewrite saves for repeated unchanged pet or café polls", async () => {
    const f = await fixture();
    await f.call({ sCmd: "GetCafeFoodNum" });
    const bytes = await readFile(f.filePath);
    const write = vi.spyOn(f.store, "update");
    for (let i = 0; i < 60; i++)
      await f.call({ sCmd: "GetCafeFoodNum" }, NOW + i * 1000);
    expect(write).not.toHaveBeenCalled();
    expect(await readFile(f.filePath)).toEqual(bytes);
  });

  it("persists running tours and pays their claim once under concurrent retries", async () => {
    const f = await fixture();
    await f.call({ sCmd: "GetCafeFoodNum" });
    await f.store.update((state) => {
      state.players.player!.cafe.pets!.pets = [pet(1), pet(2), pet(3)];
      state.players.player!.cafe.pets!.nextUid = 4;
    });
    await f.call({ sCmd: "UnLockTourArea", nIndex: 1 });
    await f.call({ sCmd: "SetTourPets", nIndex: 1, tbPets: [1, 2, 3] });
    const loaded = await f.reload();
    const started = loaded.get("player")!;
    expect(started.cafe.pets!.pets.map((p) => p.hot)).toEqual([80, 80, 80]);
    const ready = NOW + catalog.tourArea(1)!.Hour * 3600_000;
    await loaded.handleCafePetRequest(
      "player",
      { sCmd: "CheckTourIsSuccess", nIndex: 1 },
      ready,
    );
    const result = await Promise.allSettled([
      loaded.handleCafePetRequest("player", { sCmd: "CompleteTour", nIndex: 1 }, ready),
      loaded.handleCafePetRequest("player", { sCmd: "CompleteTour", nIndex: 1 }, ready),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(loaded.get("player")!.taskValues[String((49 << 16) | 801)]).toBe(1);
    expect(loaded.get("other")).toEqual(f.other);
    const reopened = await f.reload();
    expect(reopened.get("player")!.taskValues[String((49 << 16) | 801)]).toBe(1);
  });

  it("applies an earned cafe oath buff only after its claim time", async () => {
    const f = await fixture();
    const promises = PromiseCatalog.loadDefault();
    const step = promises
      .getSteps(1)
      .find((s) => s.tasklist.some((id) => promises.task(id)?.strtype === "CafeTime"))!;
    const taskId = step.tasklist.find(
      (id) => promises.task(id)?.strtype === "CafeTime",
    )!;
    await f.store.update((state) => {
      const player = state.players.player!;
      player.promise = {
        version: 1,
        clockMs: NOW,
        assignments: { "1": "work" },
        seenFightRuns: [],
        girls: {
          "1": {
            girlid: 1,
            step: step.step,
            cardguid: 0,
            rewardstep: step.step - 1,
            rewardlist: [],
            taskdatas: [{ id: taskId, count: 0, status: 0 }],
            enteredAtMs: NOW,
            timeCarryMs: {},
          },
        },
      };
      for (const template of catalog.petTemplates())
        player.taskValues[String((49 << 16) | cafePetRikiTaskOffset(template.Id))] =
          1 | (1 << 15);
    });
    await f.call({ sCmd: "GetPawAward", Id: 3 }, NOW + 600_000);
    expect(f.players.get("player")!.promise!.girls["1"]!.taskdatas[0]!.count).toBe(10);
    await f.players.handlePromiseRequest("player", 231, {}, NOW + 1_200_000);
    expect(f.players.get("player")!.promise!.girls["1"]!.taskdatas[0]!.count).toBe(22);
    await f.players.setTaskValues("player", [
      { id: (49 << 16) | 1453, value: 0 },
      { id: (49 << 16) | 1413, value: 0 },
      { id: (49 << 16) | 701, value: 3 },
      { id: (49 << 16) | 501, value: 1 },
    ]);
    const tasks = f.players.get("player")!.taskValues;
    expect(tasks[String((49 << 16) | 1453)]).toBe(1);
    expect(tasks[String((49 << 16) | 1413)]).toBe(1);
    expect(tasks[String((49 << 16) | 701)] ?? 0).toBe(0);
    expect(tasks[String((49 << 16) | 501)]).toBe(1);
    await expect(
      f.call({ sCmd: "GetPawAward", Id: 3 }, NOW + 1_200_000),
    ).rejects.toMatchObject({ reason: "collection_award_claimed" });
  });

  it("resets expired weekly pet tasks before the login snapshot without resetting lifetime achievements", async () => {
    const f = await fixture();
    await f.call({ sCmd: "GetCafeFoodNum" });
    await f.store.update((state) => {
      const tasks = state.players.player!.taskValues;
      tasks[String((18 << 16) | 5001)] = 11;
      tasks[String((18 << 16) | 5201)] = 11;
    });
    const player = await f.players.getOrCreate("player", NOW + 7 * 86_400_000);
    expect(player.taskValues[String((18 << 16) | 5001)]).toBe(0);
    expect(player.taskValues[String((18 << 16) | 5201)]).toBe(11);
    expect(player.cafe.pets!.pets).toEqual([]);
    expect(f.players.get("other")).toEqual(f.other);
    const loaded = await f.reload();
    expect(loaded.get("player")!.taskValues[String((18 << 16) | 5001)]).toBe(0);
  });
});
