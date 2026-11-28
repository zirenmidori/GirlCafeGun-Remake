import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  makeShopGoodsListTbParam,
  parseShopTabs,
  ShopCatalog,
  shopOperationalDate,
  shopOperationalWeek,
  shopShelfKey,
  type GoodsConfig,
  type ShopTabConfig,
} from "../src/game-data/shop-data.js";
import type { Logger } from "../src/logger.js";
import {
  makeDailyMissionTaskId,
  dailyMissionProgress,
} from "../src/game-data/daily-mission-data.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  MONEY_DIAMOND,
  MONEY_PAY_DIAMOND,
  PlayerRepository,
  ShopError,
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

const NOW = new Date("2026-08-19T12:00:00+08:00").getTime();
const NEXT_DAY = new Date("2026-08-20T12:00:00+08:00").getTime();
const NEXT_WEEK = new Date("2026-08-24T12:00:00+08:00").getTime();

function makeGoods(overrides: Partial<GoodsConfig>): GoodsConfig {
  return {
    shopType: 2,
    shopId: 20_001,
    goodsId: 1,
    genre: 7,
    detail: 1,
    particular: 1,
    templateLevel: 3,
    goodsNum: 1,
    group: "",
    weight: 10,
    moneyType: MONEY_DIAMOND,
    sellingPrice: [20],
    refreshLimitNum: null,
    dailyLimitNum: null,
    weekLimitNum: null,
    totalLimitNum: null,
    shelfLifeLmt: null,
    promotion: 0,
    discountList: [{ weight: 100, discount: 100 }],
    begin: null,
    end: null,
    dayIndex: 0,
    needCafeLevel: 0,
    ...overrides,
  };
}

function makeTab(overrides: Partial<ShopTabConfig>): ShopTabConfig {
  return {
    shopId: 20_001,
    onOff: 1,
    columns: 8,
    refreshRule: 1,
    refreshTimes: [14_400, 64_800],
    refreshFees: [15, 30],
    refreshMoneyType: MONEY_DIAMOND,
    refreshLimits: 2,
    begin: null,
    end: null,
    ...overrides,
  };
}

function makeCatalog(tabs: ShopTabConfig[], goods: GoodsConfig[]): ShopCatalog {
  return new ShopCatalog(
    new Map(tabs.map((tab) => [tab.shopId, tab])),
    new Map(goods.map((config) => [config.goodsId, config])),
  );
}

const RANDOM_STOCK = [1, 2, 3].map((id) =>
  makeGoods({ goodsId: id, refreshLimitNum: 1 }),
);
const DAILY_GOODS = makeGoods({
  goodsId: 10,
  shopId: 20_010,
  dailyLimitNum: 2,
  weekLimitNum: 4,
  sellingPrice: [5],
});
const LADDER_GOODS = makeGoods({
  goodsId: 20,
  shopId: 30_001,
  totalLimitNum: 3,
  sellingPrice: [10, 20, 30],
});

const catalog = makeCatalog(
  [
    makeTab({}),
    makeTab({ shopId: 20_010, refreshRule: 2, refreshTimes: [], columns: 0 }),
    makeTab({ shopId: 30_001, refreshRule: 4, refreshTimes: [], columns: 0 }),
    makeTab({ shopId: 99_999, onOff: 0 }),
  ],
  [...RANDOM_STOCK, DAILY_GOODS, LADDER_GOODS],
);

async function createRepository(): Promise<{
  repository: PlayerRepository;
  store: JsonStore<ReturnType<typeof makeInitialState>>;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-shop-"));
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
  await repository.settleLevel("tester", 1, 1, 1, 3, 0, [[15, 2, 1, 1, 1_000, 0]], 0);
  return { repository, store };
}

describe("shop goods list", () => {
  it("stocks a random-shelf shop with counters and discounts", async () => {
    const { repository } = await createRepository();
    const result = await repository.getShopGoodsList("tester", catalog, 20_001, NOW);
    expect(result.isOpen).toBe(true);
    expect(result.refreshCount).toBe(0);
    expect(result.goodsList).toHaveLength(3);
    for (const entry of result.goodsList) {
      expect(entry.refreshbuynum).toBe(0);
      expect(entry.buynum).toBe(0);
      expect(entry.discount).toBe(100);
    }

    const again = await repository.getShopGoodsList("tester", catalog, 20_001, NOW);
    expect(again.goodsList.map(({ goodsid }) => goodsid)).toEqual(
      result.goodsList.map(({ goodsid }) => goodsid),
    );
  });

  it("restocks when an auto-refresh slot passes", async () => {
    const { repository } = await createRepository();
    await repository.getShopGoodsList("tester", catalog, 20_001, NOW);
    const state = await repository.getOrCreate("tester");
    const before = state.shops?.["20001"]?.shelfKey;
    expect(before).toBe("2026-08-19@1");

    await repository.getShopGoodsList(
      "tester",
      catalog,
      20_001,
      new Date("2026-08-19T19:00:00+08:00").getTime(),
    );
    const after = (await repository.getOrCreate("tester")).shops?.["20001"];
    expect(after?.shelfKey).toBe("2026-08-19@2");
    expect(after?.shelf.every((entry) => entry.bought === 0)).toBe(true);
  });

  it("reports closed and unknown shops without goods", async () => {
    const { repository } = await createRepository();
    const closed = await repository.getShopGoodsList("tester", catalog, 99_999, NOW);
    expect(closed).toMatchObject({ isOpen: false, goodsList: [] });
    const unknown = await repository.getShopGoodsList("tester", catalog, 12_345, NOW);
    expect(unknown).toMatchObject({ isOpen: false, goodsList: [] });
  });

  // UI_ShopEntry:OnShowGoods (UI_ShopEntry.lua:96-105, client 0.1.3) runs for every goods
  // list reply while the shop entry screen is open (GoodsLogicC.lua:318-320). When endtime
  // is non-zero its timer computes `GetTime() - tbParam.begintime or 0`, which throws on
  // every tick when begintime is nil (`or 0` binds to the whole difference).
  it("sends begintime with every non-zero endtime, for every shop tab", async () => {
    const { repository } = await createRepository();
    const real = ShopCatalog.loadDefault();
    const shopIds = [
      ...parseShopTabs(
        readFileSync(
          path.resolve(process.cwd(), "resources/shop/shoptabs.txt"),
          "utf8",
        ),
      ).keys(),
    ];
    const nowSeconds = Math.floor(NOW / 1_000);
    let timed = 0;
    for (const shopId of shopIds) {
      const tbParam: Record<string, unknown> = {
        ...makeShopGoodsListTbParam(
          await repository.getShopGoodsList("tester", real, shopId, NOW),
        ),
      };
      if (tbParam.endtime === 0) continue;
      timed += 1;
      expect(typeof tbParam.begintime, `shop ${shopId} begintime`).toBe("number");
      // An open shop has begun: the entry tile shows its countdown and opens the shop only
      // while GetTime() - begintime > 0 (UI_ShopEntry.lua:109-111).
      if (tbParam.isopen === 1) {
        expect(tbParam.begintime, `shop ${shopId} begintime`).toBeLessThanOrEqual(
          nowSeconds,
        );
      }
    }
    expect(timed).toBeGreaterThan(0);
  });
});

describe("shop buy", () => {
  it("credits daily shopping atomically, caps it, resets next day and persists it", async () => {
    const { repository, store } = await createRepository();
    const key = String(makeDailyMissionTaskId(108));
    const first = await repository.buyShopGoods("tester", catalog, 20_010, 10, 1, NOW);
    expect(first.taskValuesChanged).toBe(true);
    expect(dailyMissionProgress(repository.get("tester")!.taskValues[key] ?? 0)).toBe(
      1,
    );
    const second = await repository.buyShopGoods("tester", catalog, 20_010, 10, 1, NOW);
    expect(second.taskValuesChanged).toBe(false);
    await expect(
      repository.buyShopGoods("tester", catalog, 20_010, 10, 1, NOW),
    ).rejects.toMatchObject({ reason: "limit_reached" });
    await store.flush();
    const next = await repository.buyShopGoods(
      "tester",
      catalog,
      20_010,
      10,
      1,
      NEXT_DAY,
    );
    expect(next.taskValuesChanged).toBe(true);
    const player = await repository.markLogin("tester", NEXT_DAY);
    expect(dailyMissionProgress(player.taskValues[key] ?? 0)).toBe(1);
    expect(player.dailyMissions?.operationalDate).toBe("2026-08-20");
  });

  it("does not credit failed purchases or browsing/refreshing a shelf", async () => {
    const { repository } = await createRepository();
    const key = String(makeDailyMissionTaskId(108));
    await repository.getShopGoodsList("tester", catalog, 20_001, NOW);
    await repository.refreshShop("tester", catalog, 20_001, NOW);
    expect(dailyMissionProgress(repository.get("tester")!.taskValues[key] ?? 0)).toBe(
      0,
    );
    await expect(
      repository.buyShopGoods("tester", catalog, 20_010, 999, 1, NOW),
    ).rejects.toThrow(ShopError);
    await expect(
      repository.buyShopGoods("tester", catalog, 20_010, 10, 0, NOW),
    ).rejects.toThrow(ShopError);
    await repository.setTaskValues("tester", [{ id: 123, value: 1 }]);
    expect(dailyMissionProgress(repository.get("tester")!.taskValues[key] ?? 0)).toBe(
      0,
    );
  });

  it("charges diamonds, grants goods and records counters", async () => {
    const { repository } = await createRepository();
    const goodsId = 10;
    const result = await repository.buyShopGoods(
      "tester",
      catalog,
      20_010,
      goodsId,
      2,
      NOW,
    );
    expect(result.price).toBe(10);
    expect(result.updatedMoney).toEqual([{ id: MONEY_DIAMOND, count: 990 }]);
    expect(result.updatedItems).toHaveLength(1);
    expect(result.updatedItems[0]).toMatchObject({
      genre: 7,
      detail: 1,
      particular: 1,
      templateLevel: 3,
      count: 2,
    });
    const entry = result.result.goodsList.find(
      (candidate) => candidate.goodsid === goodsId,
    )!;
    expect(entry.dailybuynum).toBe(2);
    expect(entry.buynum).toBe(2);
    expect(entry.discount).toBe(100);
  });

  it("completes daily mission 108 on a successful purchase", async () => {
    const { repository } = await createRepository();
    await repository.buyShopGoods("tester", catalog, 20_010, 10, 1, NOW);
    const player = repository.get("tester")!;
    expect(
      dailyMissionProgress(player.taskValues[String(makeDailyMissionTaskId(108))] ?? 0),
    ).toBe(1);
  });

  it("falls back to pay diamonds when free diamonds run out", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players["tester"]!.money = [
        { id: MONEY_DIAMOND, count: 3 },
        { id: MONEY_PAY_DIAMOND, count: 100 },
      ];
    });
    const result = await repository.buyShopGoods("tester", catalog, 20_010, 10, 1, NOW);
    expect(result.price).toBe(5);
    expect(result.updatedMoney).toEqual([
      { id: MONEY_DIAMOND, count: 0 },
      { id: MONEY_PAY_DIAMOND, count: 98 },
    ]);
  });

  it("rejects purchases beyond the daily limit and resets across operational days", async () => {
    const { repository } = await createRepository();
    await repository.buyShopGoods("tester", catalog, 20_010, 10, 2, NOW);
    await expect(
      repository.buyShopGoods("tester", catalog, 20_010, 10, 1, NOW),
    ).rejects.toMatchObject({ name: "ShopError", reason: "limit_reached" });

    const nextDay = await repository.buyShopGoods(
      "tester",
      catalog,
      20_010,
      10,
      1,
      NEXT_DAY,
    );
    const entry = nextDay.result.goodsList.find(
      (candidate) => candidate.goodsid === 10,
    )!;
    expect(entry.dailybuynum).toBe(1);
    expect(entry.weekbuynum).toBe(3);
    expect(entry.buynum).toBe(3);
  });

  it("resets weekly counters across operational weeks", async () => {
    const { repository } = await createRepository();
    await repository.buyShopGoods("tester", catalog, 20_010, 10, 2, NOW);
    await repository.buyShopGoods("tester", catalog, 20_010, 10, 2, NEXT_DAY);
    await expect(
      repository.buyShopGoods("tester", catalog, 20_010, 10, 1, NEXT_DAY),
    ).rejects.toMatchObject({ reason: "limit_reached" });

    const nextWeek = await repository.buyShopGoods(
      "tester",
      catalog,
      20_010,
      10,
      1,
      NEXT_WEEK,
    );
    const entry = nextWeek.result.goodsList.find(
      (candidate) => candidate.goodsid === 10,
    )!;
    expect(entry.weekbuynum).toBe(1);
    expect(entry.buynum).toBe(5);
  });

  it("enforces shelf stock for random-shelf shops", async () => {
    const { repository } = await createRepository();
    const list = await repository.getShopGoodsList("tester", catalog, 20_001, NOW);
    const goodsId = list.goodsList[0]!.goodsid;
    await repository.buyShopGoods("tester", catalog, 20_001, goodsId, 1, NOW);
    await expect(
      repository.buyShopGoods("tester", catalog, 20_001, goodsId, 1, NOW),
    ).rejects.toMatchObject({ reason: "limit_reached" });
    const restocked = list.goodsList.find((entry) => entry.goodsid !== goodsId)!;
    const player = await repository.getOrCreate("tester");
    const stillOnShelf = player.shops?.["20001"]?.shelf.map((entry) => entry.goodsId);
    expect(stillOnShelf).toContain(restocked.goodsid);
  });

  it("rejects goods not on the current shelf", async () => {
    const { repository } = await createRepository();
    await repository.getShopGoodsList("tester", catalog, 20_001, NOW);
    await expect(
      repository.buyShopGoods("tester", catalog, 20_001, 99_999, 1, NOW),
    ).rejects.toMatchObject({ reason: "unknown_goods" });
  });

  it("advances the ladder price by total purchases", async () => {
    const { repository } = await createRepository();
    const first = await repository.buyShopGoods("tester", catalog, 30_001, 20, 1, NOW);
    expect(first.price).toBe(10);
    const second = await repository.buyShopGoods("tester", catalog, 30_001, 20, 1, NOW);
    expect(second.price).toBe(20);
    await repository.buyShopGoods("tester", catalog, 30_001, 20, 1, NOW);
    await expect(
      repository.buyShopGoods("tester", catalog, 30_001, 20, 1, NOW),
    ).rejects.toMatchObject({ reason: "limit_reached" });
  });

  it("rejects when funds are insufficient", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players["tester"]!.money = [{ id: MONEY_DIAMOND, count: 4 }];
    });
    await expect(
      repository.buyShopGoods("tester", catalog, 20_010, 10, 1, NOW),
    ).rejects.toMatchObject({ reason: "insufficient_funds" });
  });
});

describe("shop refresh", () => {
  it("charges the ladder fee, rerolls the shelf and counts refreshes", async () => {
    const { repository } = await createRepository();
    const before = await repository.getShopGoodsList("tester", catalog, 20_001, NOW);
    const { result, updatedMoney } = await repository.refreshShop(
      "tester",
      catalog,
      20_001,
      NOW,
    );
    expect(result.refreshCount).toBe(1);
    expect(updatedMoney).toEqual([{ id: MONEY_DIAMOND, count: 985 }]);
    expect(result.goodsList).toHaveLength(3);
    expect(result.goodsList.every((entry) => entry.refreshbuynum === 0)).toBe(true);
    void before;
  });

  it("rejects manual refresh beyond the daily limit", async () => {
    const { repository } = await createRepository();
    await repository.refreshShop("tester", catalog, 20_001, NOW);
    await repository.refreshShop("tester", catalog, 20_001, NOW);
    await expect(
      repository.refreshShop("tester", catalog, 20_001, NOW),
    ).rejects.toMatchObject({ reason: "limit_reached" });

    const nextDay = await repository.refreshShop("tester", catalog, 20_001, NEXT_DAY);
    expect(nextDay.result.refreshCount).toBe(1);
  });
});

describe("shop error contract", () => {
  it("maps reasons to client error keys", () => {
    expect(new ShopError("limit_reached").clientErrorKey).toBe("Error.20075");
    expect(new ShopError("insufficient_funds").clientErrorKey).toBe("Error.20013");
    expect(new ShopError("unknown_shop").clientErrorKey).toBe("Error.20074");
  });
});

describe("shop groups (one goods per group, pos = group)", () => {
  const WEEKLY_GROUPED = [
    makeGoods({ goodsId: 31, shopId: 20_005, group: "2", weekLimitNum: 3 }),
    makeGoods({ goodsId: 32, shopId: 20_005, group: "2", weekLimitNum: 3 }),
    makeGoods({ goodsId: 33, shopId: 20_005, group: "1", weekLimitNum: 3 }),
    makeGoods({ goodsId: 34, shopId: 20_005, group: "1", weekLimitNum: 3 }),
  ];
  const SHELF_LIFE_GROUPED = [
    makeGoods({ goodsId: 41, shopId: 20_007, group: "2", shelfLifeLmt: 1 }),
    makeGoods({ goodsId: 42, shopId: 20_007, group: "1", shelfLifeLmt: 1 }),
  ];
  const groupedCatalog = makeCatalog(
    [
      makeTab({
        shopId: 20_005,
        refreshRule: 3,
        refreshTimes: [],
        refreshFees: [],
        refreshLimits: 0,
        columns: 2,
      }),
      makeTab({
        shopId: 20_007,
        refreshRule: 5,
        refreshTimes: [],
        refreshFees: [],
        refreshLimits: 0,
        columns: 2,
      }),
    ],
    [...WEEKLY_GROUPED, ...SHELF_LIFE_GROUPED],
  );

  it("stocks a weekly grouped shop with one goods per group and sends pos", async () => {
    const { repository } = await createRepository();
    const result = await repository.getShopGoodsList(
      "tester",
      groupedCatalog,
      20_005,
      NOW,
    );
    expect(result.goodsList.map((entry) => entry.pos)).toEqual([1, 2]);
    expect([33, 34]).toContain(result.goodsList[0]!.goodsid);
    expect([31, 32]).toContain(result.goodsList[1]!.goodsid);

    const again = await repository.getShopGoodsList(
      "tester",
      groupedCatalog,
      20_005,
      NEXT_DAY,
    );
    expect(again.goodsList.map(({ goodsid }) => goodsid)).toEqual(
      result.goodsList.map(({ goodsid }) => goodsid),
    );
  });

  it("rejects buying a grouped goods that is not on the shelf", async () => {
    const { repository } = await createRepository();
    const result = await repository.getShopGoodsList(
      "tester",
      groupedCatalog,
      20_005,
      NOW,
    );
    const onShelf = new Set(result.goodsList.map(({ goodsid }) => goodsid));
    const offShelf = WEEKLY_GROUPED.find((config) => !onShelf.has(config.goodsId))!;
    await expect(
      repository.buyShopGoods(
        "tester",
        groupedCatalog,
        20_005,
        offShelf.goodsId,
        1,
        NOW,
      ),
    ).rejects.toMatchObject({ reason: "not_on_shelf" });
  });

  it("keeps the weekly counters of a save that has no shelf yet", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players["tester"]!.shops = {
        "20005": {
          operationalDate: "2026-08-19",
          weekId: "2026-08-17",
          refreshCount: 0,
          shelfKey: null,
          shelf: [],
          counters: {
            "31": { daily: 2, week: 2, total: 5, shelf: 5 },
            "32": { daily: 2, week: 2, total: 5, shelf: 5 },
          },
        },
      };
    });
    const result = await repository.getShopGoodsList(
      "tester",
      groupedCatalog,
      20_005,
      NOW,
    );
    expect(result.goodsList).toHaveLength(2);
    const group2 = result.goodsList.find((entry) => entry.pos === 2)!;
    expect(group2.weekbuynum).toBe(2);
    expect(group2.buynum).toBe(5);
  });

  it("lists a shelf-life grouped shop in full, in pos order, and keeps its counts", async () => {
    const { repository } = await createRepository();
    const before = await repository.getShopGoodsList(
      "tester",
      groupedCatalog,
      20_007,
      NOW,
    );
    expect(before.goodsList.map(({ goodsid, pos }) => [goodsid, pos])).toEqual([
      [42, 1],
      [41, 2],
    ]);
    await repository.buyShopGoods("tester", groupedCatalog, 20_007, 41, 1, NOW);
    await expect(
      repository.buyShopGoods("tester", groupedCatalog, 20_007, 41, 1, NEXT_WEEK),
    ).rejects.toMatchObject({ reason: "limit_reached" });
  });

  it("stocks the real pet shop 20010 with 11 goods, pos 1..11, at full price", async () => {
    const { repository } = await createRepository();
    const result = await repository.getShopGoodsList(
      "tester",
      ShopCatalog.loadDefault(),
      20_010,
      NOW,
    );
    expect(result.goodsList.map((entry) => entry.pos)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(result.goodsList.every((entry) => entry.discount === 100)).toBe(true);
  });

  it("sends pos 1..17 for the real club shop 20006", async () => {
    const { repository } = await createRepository();
    const result = await repository.getShopGoodsList(
      "tester",
      ShopCatalog.loadDefault(),
      20_006,
      NOW,
    );
    expect(result.goodsList.map((entry) => entry.pos)).toEqual(
      Array.from({ length: 17 }, (_, index) => index + 1),
    );
  });

  it("keeps an old 20001 shelf until the next slot and sends it in pos order", async () => {
    const realCatalog = ShopCatalog.loadDefault();
    const tab = realCatalog.getTab(20_001)!;
    const group = (pos: string): number[] =>
      realCatalog
        .goodsForShop(20_001)
        .filter((config) => config.group === pos)
        .map((config) => config.goodsId);
    const [gift1, gift2] = group("7");
    const [first] = group("1");
    const { repository, store } = await createRepository();
    await store.update((state) => {
      state.players["tester"]!.shops = {
        "20001": {
          operationalDate: shopOperationalDate(NOW),
          weekId: shopOperationalWeek(NOW),
          refreshCount: 0,
          shelfKey: shopShelfKey(tab, NOW),
          shelf: [
            { goodsId: gift1!, discount: 50, bought: 1 },
            { goodsId: first!, discount: 100, bought: 0 },
            { goodsId: gift2!, discount: 100, bought: 0 },
          ],
          counters: {},
        },
      };
    });
    const result = await repository.getShopGoodsList(
      "tester",
      realCatalog,
      20_001,
      NOW,
    );
    expect(result.goodsList.map(({ goodsid, pos }) => [goodsid, pos])).toEqual([
      [first, 1],
      [gift1, 7],
      [gift2, 7],
    ]);
    expect(result.goodsList[1]).toMatchObject({ discount: 50, refreshbuynum: 1 });
  });
});
