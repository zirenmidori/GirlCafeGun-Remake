import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShopCatalog } from "../src/game-data/shop-data.js";
import {
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  achievementProgress,
  makeAchievementTaskId,
} from "../src/game-data/activity-achievement-data.js";
import { CafeCatalog } from "../src/game-data/cafe-catalog.js";
import { cafeComfort } from "../src/game-data/cafe-runtime.js";
import {
  guideMissionProgress,
  makeGuideTaskId,
} from "../src/game-data/guide-mission-data.js";
import type { HouseChanges } from "../src/game-data/house-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  CafeOperationError,
  HouseOperationError,
  makeInitialState,
  PlayerRepository,
  type CafeFurnitureState,
} from "../src/persistence/player-repository.js";

const NOW = Date.UTC(2026, 10, 6, 12),
  seconds = NOW / 1_000;
const root = path.resolve(import.meta.dirname, "../../tools/cafe-fix"),
  directories: string[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const defaults = {
  name: "",
  level: 100,
  exp: 0,
  fightPower: 0,
  serverZone: 8,
  firstLevelComplete: false,
};
const catalog = CafeCatalog.loadDefault();
function furniture(objId: number, templateId: number, posX = 0): CafeFurnitureState {
  return {
    objId,
    templateId,
    parentId: 2,
    roomId: 1,
    pose: { templateId, parentTemplateId: 2, place: 1, posX, posY: 0, rotate: 0 },
    status: 7,
    isNew: false,
    bizcount: 3,
  };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (
      !resolved.startsWith(`${root}${path.sep}`) ||
      !path.basename(resolved).startsWith("cafe-test-")
    )
      throw new Error("Unsafe café test cleanup target");
    await rm(resolved, { recursive: true, force: true });
  }
});
async function fixture() {
  const directory = await mkdtemp(path.join(root, "cafe-test-"));
  directories.push(directory);
  const filePath = path.join(directory, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const players = new PlayerRepository({ store, defaults, logger });
  await players.getOrCreate("tester", NOW);
  await store.update((state) => {
    const player = state.players.tester!;
    player.cafe.level = 30;
    player.cafe.furniture = [furniture(10_000, 101, 1), furniture(10_001, 102, 5)];
    player.money.find((money) => money.id === 2)!.count = 100_000;
    player.money.push({ id: 7, count: 0 });
  });
  const call = (command: number, tbParam: unknown = {}, now = NOW) =>
    players.handleCafeRequest(
      "tester",
      command,
      { sCmd: command, tbParam },
      now,
      catalog,
    );
  const reload = async () => {
    await store.flush();
    const otherStore = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await otherStore.initialize();
    return new PlayerRepository({ store: otherStore, defaults, logger });
  };
  return { store, players, call, reload };
}
function delta(
  f: Awaited<ReturnType<typeof fixture>>,
  fields: Partial<HouseChanges>,
): HouseChanges {
  return {
    roleId: f.players.get("tester")!.roleId,
    rooms: [],
    furniture: [],
    themes: [],
    ...fields,
  };
}
async function oneSeat(f: Awaited<ReturnType<typeof fixture>>) {
  await f.call(112);
  await f.call(114, { seatlist: [{ position: 100_000 }] });
}
async function regularGuests(f: Awaited<ReturnType<typeof fixture>>) {
  await f.store.update((state) => {
    const business = state.players.tester!.cafe.business!;
    business.weights = [{ Id: 201, Weight: 1 }];
    business.lastGeneratedAt = seconds - 10;
  });
}

describe("durable café house changes", () => {
  it("merges changed-only furniture membership and preserves omitted business fields after reload", async () => {
    const f = await fixture();
    const result = await f.players.persistHouseChanges(
      "tester",
      delta(f, {
        rooms: [{ roomId: 1, furnitureIds: [10_000] }],
        furniture: [{ objId: 10_000, templateId: 101, pose: { posX: 9 } }],
      }),
      NOW,
    );
    expect(result.house.furniture).toHaveLength(2);
    expect(result.house.rooms.find((room) => room.roomId === 1)!.furnitureIds).toEqual([
      10_000, 10_001,
    ]);
    expect(result.house.furniture[0]).toMatchObject({
      status: 7,
      bizcount: 3,
      pose: { posX: 9, place: 1, posY: 0, parentTemplateId: 2 },
    });
    expect(result.house.furniture[1]).toEqual(furniture(10_001, 102, 5));
    const restored = await f.reload();
    expect(restored.get("tester")!.cafe.furniture).toEqual(result.house.furniture);
  });

  it("stores removals without deleting owned furniture and rejects unowned GUIDs/cycles atomically", async () => {
    const f = await fixture();
    await f.players.persistHouseChanges(
      "tester",
      delta(f, {
        furniture: [
          {
            objId: 10_000,
            templateId: 101,
            parentId: 0,
            roomId: 0,
            pose: { posX: 0, posY: 0 },
          },
        ],
      }),
      NOW,
    );
    expect(f.players.get("tester")!.cafe.furniture![0]).toMatchObject({
      roomId: 0,
      parentId: 0,
      status: 0,
      bizcount: 3,
    });
    const before = f.store.snapshot();
    await expect(
      f.players.persistHouseChanges(
        "tester",
        delta(f, { furniture: [{ objId: 99_999, templateId: 101, roomId: 1 }] }),
        NOW,
      ),
    ).rejects.toBeInstanceOf(HouseOperationError);
    await expect(
      f.players.persistHouseChanges(
        "tester",
        delta(f, {
          furniture: [
            { objId: 10_000, templateId: 101, parentId: 10_001, roomId: 1 },
            { objId: 10_001, templateId: 102, parentId: 10_000, roomId: 1 },
          ],
        }),
        NOW,
      ),
    ).rejects.toMatchObject({ reason: "parent_cycle" });
    expect(f.store.snapshot()).toEqual(before);
  });

  it("allocates saved theme IDs, preserves poses on rename and deletes only the selected theme", async () => {
    const f = await fixture();
    const pose = furniture(10_000, 101).pose;
    const first = await f.players.persistHouseChanges(
      "tester",
      delta(f, {
        themes: [{ newGenerate: true, name: "My café", roomtype: 1, poses: [pose] }],
      }),
      NOW,
    );
    const id = first.updatedThemes[0]!.themeId;
    const renamed = await f.players.persistHouseChanges(
      "tester",
      delta(f, { themes: [{ themeId: id, name: "Renamed" }] }),
      NOW,
    );
    expect(renamed.updatedThemes[0]).toMatchObject({ name: "Renamed", poses: [pose] });
    await f.players.deleteHouseTheme("tester", id);
    expect(f.players.get("tester")!.cafe.themes).toEqual([]);
    expect(f.players.get("tester")!.cafe.furniture).toHaveLength(2);
  });
});

describe("atomic café business", () => {
  it("accepts real staff pairs, emits exact pairs, initializes both vigor timers and rolls back duplicates", async () => {
    const f = await fixture();
    const rows = [[[2, 1]], [[7, 1]], [[9, 1]]];
    expect((await f.call(113, rows)).response).toEqual(rows);
    const snapshot = (await f.call(112)).response as { roomgirlslist: unknown };
    expect(snapshot.roomgirlslist).toEqual(rows);
    expect(f.players.get("tester")!.taskValues).toMatchObject({
      [String((41 << 16) | 10_002)]: seconds,
      [String((41 << 16) | 7)]: seconds,
      [String((41 << 16) | 9)]: seconds,
    });
    const before = f.store.snapshot();
    await expect(f.call(113, [[[2, 1]], [[2, 1]], []])).rejects.toBeInstanceOf(
      CafeOperationError,
    );
    expect(f.store.snapshot()).toEqual(before);
  });

  it("charges production costs, honors the café-level capacity and preserves stock on invalid batches", async () => {
    const f = await fixture();
    const count = catalog.level(30)!.MaxCoffee;
    expect((await f.call(119, { coffeetype: 1, count })).response).toMatchObject({
      coffeelist: [{ coffeetype: 1, count }],
    });
    expect(f.players.get("tester")!.money.find((money) => money.id === 2)!.count).toBe(
      100_000 - count * 5,
    );
    const before = f.store.snapshot();
    await expect(f.call(119, { coffeetype: 1, count: 1 })).rejects.toMatchObject({
      reason: "coffee_capacity",
    });
    await expect(f.call(119, { coffeetype: 9999, count: 1 })).rejects.toBeInstanceOf(
      CafeOperationError,
    );
    expect(f.store.snapshot()).toEqual(before);
    const restored = await f.reload();
    expect(restored.get("tester")!.cafe.coffees[0]!.count).toBe(count);
  });

  it("does not let an empty historical recipe bypass active display-slot capacity", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      const player = state.players.tester!;
      player.cafe.level = 1;
      player.cafe.coffees = [
        { coffeetype: 1, count: 0 },
        { coffeetype: 2, count: 1 },
      ];
    });
    await expect(f.call(119, { coffeetype: 1, count: 1 })).rejects.toMatchObject({
      reason: "coffee_slot_capacity",
    });
  });

  it("validates native composite seat IDs against actual biz points and owned placement", async () => {
    const f = await fixture();
    await oneSeat(f);
    const before = f.store.snapshot();
    for (const position of [100_001, 999_990, 10_000])
      await expect(f.call(114, { seatlist: [{ position }] })).rejects.toMatchObject({
        reason: "invalid_seat",
      });
    expect(f.store.snapshot()).toEqual(before);
  });

  it("settles real customers once, credits coffee wallet7 and advances guide sales exactly once", async () => {
    const f = await fixture();
    await oneSeat(f);
    await f.call(119, { coffeetype: 1, count: 3 });
    await regularGuests(f);
    await f.call(115);
    const seated = (await f.call(117)).response as {
      newguest: { customeridx: number };
    };
    const id = seated.newguest.customeridx;
    for (const elapsed of [50, 100, 150, 200])
      await f.call(115, {}, NOW + elapsed * 1_000);
    const early = f.store.snapshot();
    await expect(f.call(116, { customeridx: id }, NOW + 239_000)).rejects.toMatchObject(
      { reason: "customer_still_drinking" },
    );
    expect(f.store.snapshot()).toEqual(early);
    const result = await f.call(116, { customeridx: id }, NOW + 240_000);
    expect(result.response).toMatchObject({
      error: 0,
      customeridx: id,
      earn_base: [11, 1, 1],
      earn_ex: [0, 0, 0],
    });
    expect(result.player.money.find((money) => money.id === 7)?.count).toBe(1);
    expect(
      guideMissionProgress(
        result.player.taskValues[String(makeGuideTaskId(40_017))] ?? 0,
      ),
    ).toBe(1);
    // Event page achievement 61 (activity 16): sell 500 coffees.
    expect(
      achievementProgress(
        result.player.taskValues[
          String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 61))
        ] ?? 0,
      ),
    ).toBe(1);
    expect(result.taskValuesChanged).toBe(true);
    const before = f.store.snapshot();
    const duplicate = await f.call(116, { customeridx: id }, NOW + 240_000);
    expect(duplicate.response).toEqual(result.response);
    expect(f.store.snapshot()).toEqual(before);
  });

  it("uses a positive drain-time override instead of adding it to the recipe duration", async () => {
    const f = await fixture();
    await oneSeat(f);
    await f.call(119, { coffeetype: 1, count: 1 });
    await regularGuests(f);
    await f.call(115);
    const row = (await f.call(117)).response as { newguest: { customeridx: number } };
    await f.store.update((state) => {
      state.players.tester!.cafe.business!.seats[0]!.draintime = 30;
    });
    expect(
      (await f.call(116, { customeridx: row.newguest.customeridx }, NOW + 30_000))
        .response,
    ).toMatchObject({ error: 0 });
  });

  it("sells only real stock offline, emits one report and never pays it twice after reload", async () => {
    const f = await fixture();
    await oneSeat(f);
    await f.call(119, { coffeetype: 1, count: 4 });
    await regularGuests(f);
    await f.call(125);
    const restored = await f.reload();
    const result = await restored.handleCafeRequest("tester", 112, {}, NOW + 3_600_000);
    expect(result.player.cafe.coffees[0]!.count).toBe(0);
    expect(result.player.money.find((money) => money.id === 7)?.count).toBe(4);
    expect(result.notifications).toContainEqual(
      expect.objectContaining({
        command: 122,
        parameters: expect.objectContaining({ outlist: { "1": 4 } }),
      }),
    );
    const money = structuredClone(result.player.money);
    const repeat = await restored.handleCafeRequest("tester", 112, {}, NOW + 3_600_000);
    expect(repeat.player.money).toEqual(money);
    expect(repeat.notifications).toEqual([]);
  });

  it("does not write idle polling reads, and does not charge staff for hours without guests", async () => {
    const f = await fixture();
    await f.call(113, [[[2, 1]], [], []]);
    await f.call(112);
    const update = vi.spyOn(f.store, "update");
    await f.call(112, {}, NOW + 1_000);
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
    await f.call(240, { girlid: [2] }, NOW + 3_600_000);
    expect(
      f.players.get("tester")!.girls.find((girl) => girl.girlId === 2)!.vigor,
    ).toBe(100);
    await f.call(114, { seatlist: [{ position: 100_000 }] }, NOW + 3_600_000);
    await f.call(119, { coffeetype: 1, count: 1 }, NOW + 3_600_000);
    await f.store.update((state) => {
      state.players.tester!.cafe.business!.lastGeneratedAt = seconds + 3_590;
    });
    await f.call(115, {}, NOW + 3_600_000);
    await f.call(117, {}, NOW + 3_600_000);
    await f.call(240, { girlid: [2] }, NOW + 3_650_000);
    expect(
      f.players.get("tester")!.girls.find((girl) => girl.girlId === 2)!.vigor,
    ).toBe(100);
  });

  it("grants café-level currency and physical furniture rewards once", async () => {
    const f = await fixture();
    await f.call(112);
    await f.store.update((state) => {
      const cafe = state.players.tester!.cafe;
      cafe.level = 1;
      cafe.business!.hot = catalog.level(2)!.NeedHot;
    });
    const upgraded = await f.call(111);
    expect(upgraded.player.cafe.level).toBe(2);
    expect(upgraded.player.money.find((money) => money.id === 7)?.count).toBe(600);
    await f.store.update((state) => {
      state.players.tester!.cafe.business!.hot = catalog.level(3)!.NeedHot;
    });
    const physical = await f.call(111);
    expect(physical.player.cafe.level).toBe(3);
    expect(physical.updatedFurniture).toHaveLength(1);
    expect(physical.updatedFurniture[0]).toMatchObject({
      templateId: 101,
      parentId: 0,
      roomId: 0,
    });
    const before = f.store.snapshot();
    await expect(f.call(111)).rejects.toMatchObject({ reason: "level_requirements" });
    expect(f.store.snapshot()).toEqual(before);
  });

  it("materializes ordinary shop13 furniture rewards in the same paid transaction", async () => {
    const f = await fixture();
    const shop = ShopCatalog.loadDefault();
    const goods = shop
      .goodsForShop(40_001)
      .find(
        (goods) =>
          goods.genre === 11 &&
          goods.detail === 1 &&
          goods.particular === 1 &&
          goods.templateLevel === 1,
      )!;
    expect(goods).toBeDefined();
    await f.store.update((state) => {
      const player = state.players.tester!,
        wallet = player.money.find((money) => money.id === goods.moneyType);
      if (wallet) wallet.count = 100_000;
      else player.money.push({ id: goods.moneyType, count: 100_000 });
    });
    const result = await f.players.buyShopGoods(
      "tester",
      shop,
      40_001,
      goods.goodsId,
      2,
      NOW,
    );
    expect(result.updatedFurniture).toHaveLength(2);
    expect(
      f.players.get("tester")!.money.find((money) => money.id === goods.moneyType)
        ?.count,
    ).toBe(100_000 - result.price);
    expect(
      result.updatedFurniture.every(
        (item) => item.templateId === 101 && item.objId >= 10_002,
      ),
    ).toBe(true);
    expect(
      f.players
        .get("tester")!
        .inventory.filter(
          (item) => item.genre === 11 && item.detail === 1 && item.particular === 1,
        )
        .every((item) => item.count === 0),
    ).toBe(true);
    expect(f.players.get("tester")!.cafe.furniture).toHaveLength(4);
  });

  it("native1050 consumes owned automatic tokens and never mints on repeated template requests", async () => {
    const f = await fixture();
    const before = f.store.snapshot();
    await expect(
      f.players.materializeCafeFurniture("tester", [101]),
    ).rejects.toMatchObject({ reason: "furniture_item_not_owned" });
    expect(f.store.snapshot()).toEqual(before);
    await f.store.update((state) => {
      state.players.tester!.inventory.push({
        guid: 30_000,
        genre: 11,
        detail: 1,
        particular: 1,
        templateLevel: 1,
        count: 1,
        createTime: 1,
        enhanceLevel: 0,
        enhanceExp: 0,
        breakLevel: 0,
        lockOn: 0,
      });
    });
    expect(
      (await f.players.materializeCafeFurniture("tester", [101])).updatedFurniture,
    ).toHaveLength(1);
    const after = f.store.snapshot();
    await expect(
      f.players.materializeCafeFurniture("tester", [101]),
    ).rejects.toMatchObject({ reason: "furniture_item_not_owned" });
    expect(f.store.snapshot()).toEqual(after);
  });

  it("persists only valid default or owned five-field music tuples including audioId0", async () => {
    const f = await fixture();
    const defaultTrack = catalog.music(8001)!;
    const tuple = [
      defaultTrack.Extension1,
      defaultTrack.G,
      defaultTrack.D,
      defaultTrack.P,
      defaultTrack.L,
    ];
    expect(tuple[0]).toBe(0);
    expect((await f.call(138, tuple)).response).toEqual({});
    expect(f.players.get("tester")!.cafe.music).toEqual({
      id: tuple[0],
      nG: tuple[1],
      nD: tuple[2],
      nP: tuple[3],
      nL: tuple[4],
    });
    const before = f.store.snapshot();
    await expect(f.call(138, [9999, ...tuple.slice(1)])).rejects.toMatchObject({
      reason: "music_not_owned",
    });
    expect(f.store.snapshot()).toEqual(before);
    const locked = catalog.musicEntries().find((entry) => entry.IsIgnoreLock === 0)!;
    const lockedTuple = [locked.Extension1, locked.G, locked.D, locked.P, locked.L];
    await expect(f.call(138, lockedTuple)).rejects.toMatchObject({
      reason: "music_not_owned",
    });
    await f.store.update((state) => {
      state.players.tester!.taskValues[String((53 << 16) | locked.Id)] = 1;
    });
    await f.call(138, lockedTuple);
    await f.call(138, [0, 0, 0, 0, 0]);
    expect(f.players.get("tester")!.cafe.music).toEqual({
      id: 0,
      nG: 0,
      nD: 0,
      nP: 0,
      nL: 0,
    });
  });
});

// Event page achievements of activity 16 (64-66: buy furniture, 67-69: cafe
// comfort) and activity 20 (98: cafe comfort), from achievementother.txt.
describe("cafe event page achievements", () => {
  const achievement = (
    player: { taskValues: Record<string, number> },
    id: number,
  ): number =>
    achievementProgress(
      player.taskValues[
        String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, id))
      ] ?? 0,
    );
  const store = (objId: number, templateId: number): CafeFurnitureState => ({
    ...furniture(objId, templateId),
    parentId: 0,
    roomId: 0,
    pose: { templateId, parentTemplateId: 0, place: 0, posX: 0, posY: 0, rotate: 0 },
    status: 0,
    bizcount: 0,
  });

  it("a layout save that raises the comfort moves the comfort achievements (type 75)", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      state.players.tester!.cafe.furniture = [
        furniture(10_000, 101),
        store(10_001, 102),
      ];
    });
    const before = cafeComfort(f.players.get("tester")!, catalog);
    const result = await f.players.persistHouseChanges(
      "tester",
      delta(f, {
        rooms: [{ roomId: 1, furnitureIds: [10_001] }],
        furniture: [
          {
            objId: 10_001,
            templateId: 102,
            parentId: 2,
            roomId: 1,
            pose: { parentTemplateId: 2, place: 1, posX: 4 },
          },
        ],
      }),
      NOW,
    );
    const comfort = cafeComfort(result.player, catalog);
    expect(comfort).toBeGreaterThan(before);
    expect(result.player.cafe.furniture!.every((item) => item.roomId === 1)).toBe(true);
    expect(achievement(result.player, 67)).toBe(comfort);
    expect(achievement(result.player, 98)).toBe(comfort);

    // Taking furniture out lowers the comfort but never the progress.
    const lowered = await f.players.persistHouseChanges(
      "tester",
      delta(f, {
        furniture: [{ objId: 10_001, templateId: 102, parentId: 0, roomId: 0 }],
      }),
      NOW,
    );
    expect(cafeComfort(lowered.player, catalog)).toBeLessThan(comfort);
    expect(achievement(lowered.player, 67)).toBe(comfort);
  });

  it("a login credits the comfort of a cafe built before (type 75)", async () => {
    const f = await fixture();
    expect(achievement(f.players.get("tester")!, 67)).toBe(0);
    const player = await f.players.markLogin("tester", NOW);
    const comfort = cafeComfort(player, catalog);
    expect(comfort).toBeGreaterThan(0);
    expect(achievement(player, 67)).toBe(comfort);
  });

  it("a claim projects the comfort before its check (type 75)", async () => {
    const f = await fixture();
    // 15 x furniture 102 (AddScore 40) in the cafe room: comfort 600, without an
    // event or a login.
    await f.store.update((state) => {
      state.players.tester!.cafe.furniture = Array.from({ length: 15 }, (_, index) =>
        furniture(10_000 + index, 102),
      );
    });
    expect(cafeComfort(f.players.get("tester")!, catalog)).toBe(600);
    expect(achievement(f.players.get("tester")!, 67)).toBe(0);
    const result = await f.players.claimActivityAchievementAward("tester", 16, 67);
    expect(achievement(result.player, 67)).toBe(600);
    expect(
      result.player.taskValues[
        String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 67))
      ]! & 1,
    ).toBe(1);
  });

  it("a batch furniture buy counts every piece (type 137)", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      state.players.tester!.money.find((money) => money.id === 7)!.count = 100_000;
    });
    const result = await f.call(14, [
      { shopid: 40_001, goodsid: 101, buynum: 1 },
      { shopid: 40_001, goodsid: 102, buynum: 2 },
    ]);
    expect(result.updatedFurniture).toHaveLength(3);
    expect(achievement(result.player, 64)).toBe(3);
    expect(achievement(result.player, 66)).toBe(3);
    expect(result.taskValuesChanged).toBe(true);
  });

  it("a single furniture buy counts its pieces and reports the task change (type 137)", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      state.players.tester!.money.find((money) => money.id === 7)!.count = 100_000;
    });
    const bought = await f.players.buyShopGoods(
      "tester",
      ShopCatalog.loadDefault(),
      40_001,
      101,
      2,
      NOW,
    );
    expect(bought.updatedFurniture).toHaveLength(2);
    expect(bought.taskValuesChanged).toBe(true);
    expect(achievement(f.players.get("tester")!, 64)).toBe(2);
  });

  it("a predefined theme counts only the pieces bought from the shop (type 137)", async () => {
    const f = await fixture();
    await f.store.update((state) => {
      const player = state.players.tester!;
      player.money.find((money) => money.id === 7)!.count = 10_000_000;
      // Theme 3 holds a 505, which the furniture shop does not sell.
      player.cafe.furniture!.push(store(10_002, 505));
    });
    const result = await f.players.buyPredefinedCafeTheme("tester", 3, undefined, NOW);
    expect(result.updatedFurniture.length).toBeGreaterThan(0);
    expect(achievement(result.player, 64)).toBe(result.updatedFurniture.length);
    expect(result.taskValuesChanged).toBe(true);
  });
});
