import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PromiseCatalog,
  type PromiseGirlData,
} from "../src/game-data/girl-promise-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
  PromiseOperationError,
  type PersistedState,
  type InventoryEntryState,
  type PromiseFightEvent,
} from "../src/persistence/player-repository.js";
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const directories: string[] = [];
const NOW = Date.UTC(2026, 10, 6, 12);
const catalog = PromiseCatalog.loadDefault();
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const defaults = {
  name: "",
  level: 1,
  exp: 0,
  fightPower: 0,
  serverZone: 8,
  firstLevelComplete: false,
};
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-promise-"));
  directories.push(directory);
  const filePath = path.join(directory, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const repository = new PlayerRepository({ store, defaults, logger });
  await repository.getOrCreate("tester");
  await store.update((state) => {
    const p = state.players.tester!;
    p.levels.push({ id: (6 << 16) | (12 << 8) | 1, star: 15 });
    p.nextItemGuid = 2_000_000;
    for (const girlId of [1, 2, 6, 13, 16])
      if (!p.girls.some((g) => g.girlId === girlId))
        p.girls.push({
          girlId,
          level: 100,
          exp: 0,
          modelId: 1,
          moodValue: 100,
          vigor: 100,
          flag: 0,
        });
    for (const g of p.girls) g.level = 100;
    p.inventory.push(item(900001, [9, 16, 1, 1], 1000));
  });
  return { repository, store, filePath };
}
function item(guid: number, gdpl: readonly number[], count = 1): InventoryEntryState {
  return {
    guid,
    genre: gdpl[0]!,
    detail: gdpl[1]!,
    particular: gdpl[2]!,
    templateLevel: gdpl[3]!,
    count,
    createTime: 0,
    enhanceLevel: gdpl[0] === 1 ? 1 : 0,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
  };
}
async function stage(
  store: JsonStore<PersistedState>,
  repository: PlayerRepository,
  girlId: number,
  step: number,
) {
  await repository.handlePromiseRequest("tester", 233, { girlid: girlId }, NOW);
  await store.update((state) => {
    const p = state.players.tester!,
      g = p.promise!.girls[String(girlId)]!;
    g.step = step;
    g.rewardstep = step - 1;
    g.rewardlist = [0];
    g.enteredAtMs = NOW;
    g.timeCarryMs = {};
    p.promise!.clockMs = NOW;
    g.taskdatas = catalog
      .getStep(girlId, step)!
      .tasklist.map((id) => ({ id, count: 0, status: 0 }));
  });
}
function gdplCount(state: PersistedState, gdpl: readonly number[]) {
  return state.players
    .tester!.inventory.filter(
      (i) =>
        i.genre === gdpl[0] &&
        i.detail === gdpl[1] &&
        i.particular === gdpl[2] &&
        i.templateLevel === gdpl[3],
    )
    .reduce((n, i) => n + i.count, 0);
}
function taskResult(response: unknown): PromiseGirlData {
  return response as PromiseGirlData;
}

describe("persistent Fantasy Oath", () => {
  it("reads availability without writes and enforces6-12 only on mutations", async () => {
    const { repository, store, filePath } = await fixture();
    await store.update((s) => {
      s.players.tester!.levels = [];
    });
    const before = await readFile(filePath, "utf8");
    expect(
      (await repository.handlePromiseRequest("tester", 230, {}, NOW)).response,
    ).toEqual({ PromiseIsOpen: true });
    expect(
      (await repository.handlePromiseRequest("tester", 232, {}, NOW)).response,
    ).toEqual({ OpenGirlList: catalog.girlIds });
    expect(await readFile(filePath, "utf8")).toBe(before);
    await expect(
      repository.handlePromiseRequest("tester", 233, { girlid: 2 }, NOW),
    ).rejects.toMatchObject({ reason: "chapter_locked" });
    expect(await readFile(filePath, "utf8")).toBe(before);
  });
  it("charges activation once and retains ordered progress across restart", async () => {
    const { repository, store, filePath } = await fixture();
    const first = taskResult(
      (await repository.handlePromiseRequest("tester", 233, { girlid: 2 }, NOW))
        .response,
    );
    expect(first.taskdatas.map((t) => t.id)).toEqual(catalog.getStep(2, 1)!.tasklist);
    expect(first.taskdatas.find((t) => t.id === 217)?.status).toBe(1);
    await repository.handlePromiseRequest("tester", 233, { girlid: 2 }, NOW + 1000);
    expect(gdplCount(store.snapshot(), [9, 16, 1, 1])).toBe(990);
    const reopened = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await reopened.initialize();
    const loaded = new PlayerRepository({ store: reopened, defaults, logger });
    expect(
      (await loaded.handlePromiseRequest("tester", 231, {}, NOW + 1000)).response,
    ).toEqual([first]);
  });
  it("rejects unfinished tasks without mutation and consumes split stacks once", async () => {
    const { repository, store } = await fixture();
    await stage(store, repository, 2, 1);
    const config = catalog.task(201)!;
    await store.update((s) => {
      s.players.tester!.inventory = s.players.tester!.inventory.filter(
        (i) =>
          !(
            i.genre === config.gdpl![0] &&
            i.detail === config.gdpl![1] &&
            i.particular === config.gdpl![2] &&
            i.templateLevel === config.gdpl![3]
          ),
      );
    });
    const before = store.snapshot();
    await expect(
      repository.handlePromiseRequest("tester", 234, { girlid: 2, taskid: 201 }, NOW),
    ).rejects.toBeInstanceOf(PromiseOperationError);
    expect(store.snapshot()).toEqual(before);
    await store.update((s) => {
      s.players.tester!.inventory.push(
        item(900002, config.gdpl!, Math.floor(config.count / 2)),
        item(900003, config.gdpl!, Math.ceil(config.count / 2)),
      );
    });
    const once = await repository.handlePromiseRequest(
      "tester",
      234,
      { girlid: 2, taskid: 201 },
      NOW,
    );
    expect(once.response).toEqual({ id: 201, count: config.count, status: 2 });
    await repository.handlePromiseRequest(
      "tester",
      234,
      { girlid: 2, taskid: 201 },
      NOW,
    );
    expect(gdplCount(store.snapshot(), config.gdpl!)).toBe(0);
    expect(once.updatedItems).toHaveLength(2);
  });
  it("requires every task before advancing and reuses stronger owned GUID and skills", async () => {
    const { repository, store } = await fixture();
    await store.update((s) => {
      const p = s.players.tester!;
      p.inventory.push({
        ...item(900004, [1, 2, 17, 5]),
        enhanceLevel: 90,
        breakLevel: 4,
        cardSkillLevels: [4, 4, 4, 4],
      });
    });
    await stage(store, repository, 2, 1);
    await expect(
      repository.handlePromiseRequest("tester", 235, { girlid: 2 }, NOW),
    ).rejects.toMatchObject({ reason: "stage_not_ready" });
    await store.update((s) => {
      for (const t of s.players.tester!.promise!.girls["2"]!.taskdatas) {
        t.status = 2;
        t.count = catalog.task(t.id)!.count;
      }
    });
    const result = await repository.handlePromiseRequest(
      "tester",
      235,
      { girlid: 2 },
      NOW,
    );
    expect(taskResult(result.response)).toMatchObject({
      step: 2,
      rewardstep: 1,
      cardguid: 900004,
    });
    expect(
      result.player.inventory.filter(
        (i) => i.genre === 1 && i.detail === 2 && i.particular === 17,
      ),
    ).toHaveLength(1);
    expect(result.updatedItems[0]).toMatchObject({
      guid: 900004,
      templateLevel: 5,
      enhanceLevel: 90,
      breakLevel: 4,
      cardSkillLevels: [4, 4, 4, 4],
    });
    await expect(
      repository.handlePromiseRequest("tester", 235, { girlid: 2 }, NOW),
    ).rejects.toMatchObject({ reason: "stage_not_ready" });
  });
  it("creates a single reward card only when a normal stage is earned", async () => {
    const { repository, store } = await fixture();
    await stage(store, repository, 2, 1);
    expect(store.snapshot().players.tester!.promise!.girls["2"]!.cardguid).toBe(0);
    await store.update((s) => {
      for (const t of s.players.tester!.promise!.girls["2"]!.taskdatas) {
        t.status = 2;
        t.count = catalog.task(t.id)!.count;
      }
    });
    const result = await repository.handlePromiseRequest(
      "tester",
      235,
      { girlid: 2 },
      NOW,
    );
    expect(result.updatedItems.find((i) => i.particular === 17)).toMatchObject({
      detail: 2,
      templateLevel: 3,
      enhanceLevel: 40,
      breakLevel: 0,
      cardSkillLevels: [1, 1, 1, 1],
    });
  });
  it("advances simplified stories sequentially without costs or cards", async () => {
    const { repository, store } = await fixture();
    const before = store.snapshot().players.tester!.inventory;
    await repository.handlePromiseRequest("tester", 233, { girlid: 13 }, NOW);
    await expect(
      repository.handlePromiseRequest("tester", 228, { girlId: 13, step: 3 }, NOW),
    ).rejects.toMatchObject({ reason: "invalid_simple_stage" });
    for (let step = 2; step <= 7; step++)
      await repository.handlePromiseRequest("tester", 228, { girlId: 13, step }, NOW);
    await repository.handlePromiseRequest("tester", 228, { girlId: 13, step: 7 }, NOW);
    expect(store.snapshot().players.tester!.promise!.girls["13"]).toMatchObject({
      step: 7,
      rewardstep: 6,
      cardguid: 0,
      taskdatas: [],
    });
    expect(store.snapshot().players.tester!.inventory).toEqual(before);
  });
  it("awards stage7 thresholds once, including after reload", async () => {
    const { repository, store, filePath } = await fixture();
    await stage(store, repository, 1, 7);
    await store.update((s) => {
      for (const t of s.players.tester!.promise!.girls["1"]!.taskdatas) {
        t.status = 2;
        t.count = catalog.task(t.id)!.count;
      }
    });
    const result = await repository.handlePromiseRequest(
      "tester",
      239,
      { girlid: 1, step: 7 },
      NOW,
    );
    expect(result.response).toMatchObject({ errid: 0, ncompletedtasknum: 9 });
    expect((result.response as { tbaward: unknown[] }).tbaward).toHaveLength(9);
    const snapshot = store.snapshot().players.tester!;
    const reopened = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await reopened.initialize();
    const loaded = new PlayerRepository({ store: reopened, defaults, logger });
    expect(
      (await loaded.handlePromiseRequest("tester", 239, { girlid: 1, step: 7 }, NOW))
        .response,
    ).toMatchObject({ errid: 0, ncompletedtasknum: 9, tbaward: [] });
    expect(reopened.snapshot().players.tester!.inventory).toEqual(snapshot.inventory);
    expect(reopened.snapshot().players.tester!.money).toEqual(snapshot.money);
  });
  it("claims only earned stage7 thresholds", async () => {
    const { repository, store } = await fixture();
    await stage(store, repository, 1, 7);
    await store.update((s) => {
      const g = s.players.tester!.promise!.girls["1"]!;
      for (const t of g.taskdatas.slice(0, 3)) {
        t.status = 2;
        t.count = catalog.task(t.id)!.count;
      }
    });
    expect(
      (
        await repository.handlePromiseRequest(
          "tester",
          239,
          { girlid: 1, step: 7 },
          NOW,
        )
      ).response,
    ).toMatchObject({
      ncompletedtasknum: 3,
      tbaward: catalog
        .getStep(1, 7)!
        .rewards.slice(0, 3)
        .map((r) => r.slice(0, 5)),
    });
    expect(store.snapshot().players.tester!.promise!.girls["1"]!.rewardstep).toBe(6);
  });
  it("atomically enforces exchange limits and currency deductions", async () => {
    const { repository, store } = await fixture();
    const before = store.snapshot();
    await expect(
      repository.handlePromiseRequest("tester", 229, { Id: 1, Num: 11 }, NOW),
    ).rejects.toMatchObject({ reason: "exchange_limit" });
    expect(store.snapshot()).toEqual(before);
    await repository.handlePromiseRequest("tester", 229, { Id: 1, Num: 2 }, NOW);
    expect(gdplCount(store.snapshot(), [9, 16, 1, 1])).toBe(960);
    expect(store.snapshot().players.tester!.taskValues[String((60 << 16) | 101)]).toBe(
      2,
    );
    await expect(
      repository.handlePromiseRequest("tester", 229, { Id: 4, Num: 1 }, NOW),
    ).rejects.toMatchObject({ reason: "insufficient_money" });
    await store.update((s) => {
      s.players.tester!.money.push({ id: 63, count: 40 });
    });
    await repository.handlePromiseRequest("tester", 229, { Id: 4, Num: 2 }, NOW);
    expect(store.snapshot().players.tester!.money.find((m) => m.id === 63)?.count).toBe(
      0,
    );
    expect(gdplCount(store.snapshot(), [9, 33, 1, 1])).toBe(2);
  });
  it("preserves all three room rows and accumulates only active time across restart", async () => {
    const { repository, store, filePath } = await fixture();
    await stage(store, repository, 1, 6);
    const storedRows = [[{ girlId: 1, modelId: 1 }], [], [{ girlId: 2, modelId: 1 }]];
    const rows = [[[1, 1]], [], [[2, 1]]];
    expect((await repository.setCafeWaiterList("tester", rows, NOW)).response).toEqual(
      rows,
    );
    await expect(
      repository.setCafeWaiterList("tester", [[[2, 1]], [[2, 1]], []], NOW),
    ).rejects.toMatchObject({ reason: "invalid_waiter" });
    const reopened = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await reopened.initialize();
    const loaded = new PlayerRepository({ store: reopened, defaults, logger });
    expect(loaded.get("tester")!.cafe.roomGirlsList).toEqual(storedRows);
    await loaded.setCafeWaiterList("tester", [[], [], []], NOW + 120000);
    const g = loaded.get("tester")!.promise!.girls["1"]!;
    const work = g.taskdatas.find((t) => catalog.task(t.id)!.strtype === "CafeTime");
    expect(work?.count).toBe(2);
    expect(store.snapshot().players.tester!.cafe.roomGirlsList).toEqual(storedRows);
  });
  it("accrues greeter/rest/work minutes exactly at assignment boundaries", async () => {
    const { repository, store } = await fixture();
    await stage(store, repository, 2, 6);
    const cfg = catalog
      .getSteps(2)
      .find((s) => s.tasklist.some((id) => catalog.task(id)!.strtype === "RestTime"))!;
    await stage(store, repository, 2, cfg.step);
    await repository.setPromiseWaiters(
      "tester",
      [{ girlId: 2, position: "rest" }],
      NOW,
    );
    await repository.setPromiseWaiters("tester", [], NOW + 150000);
    await repository.handlePromiseRequest("tester", 231, {}, NOW + 3600000);
    const t = store
      .snapshot()
      .players.tester!.promise!.girls["2"]!.taskdatas.find(
        (t) => catalog.task(t.id)!.strtype === "RestTime",
      )!;
    expect(t.count).toBe(2);
  });
  it("counts head touches and capped-affection gifts only from actual operations", async () => {
    const { repository, store } = await fixture();
    const cfg = catalog
      .getSteps(2)
      .find((s) => s.tasklist.some((id) => catalog.task(id)!.strtype === "GiftCount"))!;
    await stage(store, repository, 2, cfg.step);
    const gift = catalog.task(
      catalog
        .getStep(2, cfg.step)!
        .tasklist.find((id) => catalog.task(id)!.strtype === "GiftCount")!,
    )!;
    await store.update((s) => {
      s.players.tester!.inventory.push(
        item(900008, [5, 2, 1, Math.max(4, gift.lvlmt ?? 0)], 10),
      );
    });
    await repository.sendGirlGift(
      "tester",
      2,
      [5, 2, 1, Math.max(4, gift.lvlmt ?? 0)],
      2,
      NOW,
    );
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find((t) => t.id === gift.id)
        ?.count,
    ).toBe(2);
    expect(
      store.snapshot().players.tester!.girls.find((g) => g.girlId === 2)?.level,
    ).toBe(100);
    const touchStage = catalog
      .getSteps(2)
      .find((s) => s.tasklist.some((id) => catalog.task(id)!.strtype === "TouchHead"))!;
    await stage(store, repository, 2, touchStage.step);
    await repository.recordPromiseHeadTouch("tester", 2, NOW);
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find(
          (t) => catalog.task(t.id)!.strtype === "TouchHead",
        )?.count,
    ).toBe(1);
  });
  it("deduplicates captured combat runs across reload and accepts roster edits", async () => {
    const { repository, store, filePath } = await fixture();
    await stage(store, repository, 2, 1);
    await store.update((s) => {
      s.players.tester!.inventory.push(item(900009, [1, 2, 17, 3]));
    });
    const event: PromiseFightEvent = {
      kind: "chapter",
      runId: "trusted-entry-1",
      formationId: 1,
      cardGuids: [900009],
      chapter: 100,
      index: 1,
      difficulty: 10,
    };
    await repository.recordPromiseFight("tester", event, NOW);
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find((t) => t.id === 223),
    ).toMatchObject({ count: 1, status: 1 });
    const reopened = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await reopened.initialize();
    const loaded = new PlayerRepository({ store: reopened, defaults, logger });
    await loaded.recordPromiseFight("tester", event, NOW);
    expect(
      loaded.get("tester")!.promise!.girls["2"]!.taskdatas.find((t) => t.id === 223)
        ?.count,
    ).toBe(1);
  });
  it("requires the oath outfit for infight2 and does not count duplicate suits", async () => {
    const { repository, store } = await fixture();
    const cfg = catalog
      .getSteps(2)
      .find((s) =>
        s.tasklist.some(
          (id) =>
            catalog.task(id)!.strtype === "EventFight" &&
            catalog.task(id)!.infight === 2,
        ),
      )!;
    await stage(store, repository, 2, cfg.step);
    await store.update((s) => {
      s.players.tester!.inventory.push(
        item(900010, [1, 2, 2, 3]),
        item(900011, [1, 2, 17, 3]),
      );
    });
    const event: PromiseFightEvent = {
      kind: "bounty",
      runId: "bounty-training-outfit",
      formationId: 1,
      cardGuids: [900010],
      eventType: 2,
      difficulty: 1,
    };
    await repository.recordPromiseFight("tester", event, NOW);
    const id = cfg.tasklist.find((id) => catalog.task(id)!.strtype === "EventFight")!;
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find((t) => t.id === id)?.count,
    ).toBe(0);
    await repository.recordPromiseFight(
      "tester",
      { ...event, runId: "bounty-oath-outfit", cardGuids: [900011] },
      NOW,
    );
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find((t) => t.id === id)?.count,
    ).toBe(1);
  });
  it("counts distinct outfits rather than duplicate instances or oath rarity tiers", async () => {
    const { repository, store } = await fixture();
    await stage(store, repository, 2, 2);
    await store.update((s) => {
      const p = s.players.tester!;
      for (const [id, particular, tier] of [
        [900021, 17, 3],
        [900022, 17, 4],
        [900023, 17, 5],
        [900024, 2, 3],
      ])
        p.inventory.push({
          ...item(id!, [1, 2, particular!, tier!]),
          enhanceLevel: 90,
        });
    });
    await repository.handlePromiseRequest("tester", 231, {}, NOW);
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find((t) => t.id === 226)
        ?.count,
    ).toBe(2);
  });
  it("counts completed training once and removes café assignments atomically", async () => {
    const { repository, store } = await fixture();
    await stage(store, repository, 2, 5);
    await repository.setCafeWaiterList(
      "tester",
      [[{ girlId: 2, modelId: 1 }], [], []],
      NOW,
    );
    await repository.startGirlTraining("tester", 2, 31, NOW);
    expect(store.snapshot().players.tester!.cafe.roomGirlsList).toEqual([[], [], []]);
    await repository.endGirlTraining("tester", 2, NOW + 14400000);
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find((t) => t.id === 234)
        ?.count,
    ).toBe(1);
    await expect(
      repository.endGirlTraining("tester", 2, NOW + 14400000),
    ).rejects.toMatchObject({ reason: "not_training" });
  });
  it("credits greeter time until the main girl changes", async () => {
    const { repository, store } = await fixture();
    await stage(store, repository, 2, 3);
    await repository.setMainGirl("tester", 2, NOW);
    await repository.setMainGirl("tester", 1, NOW + 180000);
    await repository.handlePromiseRequest("tester", 231, {}, NOW + 3600000);
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find((t) => t.id === 230)
        ?.count,
    ).toBe(3);
  });
  it("tracks PVP and arbitrary wins while honoring type/coordinate filters", async () => {
    const { repository, store } = await fixture();
    await stage(store, repository, 2, 5);
    await store.update((s) => {
      s.players.tester!.inventory.push(item(900031, [1, 2, 17, 4]));
    });
    await repository.recordPromiseFight(
      "tester",
      {
        kind: "pvp",
        runId: "pvp1",
        formationId: 1,
        cardGuids: [900031],
        activityId: 1,
        difficulty: 1,
      },
      NOW,
    );
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["2"]!.taskdatas.find((t) => t.id === 232)
        ?.count,
    ).toBe(1);
    await stage(store, repository, 6, 7);
    await store.update((s) => {
      s.players.tester!.inventory.push(item(900032, [1, 6, 17, 5]));
    });
    await repository.recordPromiseFight(
      "tester",
      {
        kind: "chapter",
        runId: "any1",
        formationId: 1,
        cardGuids: [900032],
        chapter: 1,
        index: 1,
        difficulty: 1,
      },
      NOW,
    );
    expect(
      store
        .snapshot()
        .players.tester!.promise!.girls["6"]!.taskdatas.find((t) => t.id === 640)
        ?.count,
    ).toBe(1);
  });
  it("keeps exchange limits server-owned while preserving group44 UI flags", async () => {
    const { repository, store } = await fixture();
    await repository.handlePromiseRequest("tester", 229, { Id: 1, Num: 10 }, NOW);
    await repository.setTaskValues("tester", [
      { id: (60 << 16) | 101, value: 0 },
      { id: (44 << 16) | 100, value: 1 },
    ]);
    expect(store.snapshot().players.tester!.taskValues[String((60 << 16) | 101)]).toBe(
      10,
    );
    expect(store.snapshot().players.tester!.taskValues[String((44 << 16) | 100)]).toBe(
      1,
    );
    await expect(
      repository.handlePromiseRequest("tester", 229, { Id: 1, Num: 1 }, NOW),
    ).rejects.toMatchObject({ reason: "exchange_limit" });
  });
});
