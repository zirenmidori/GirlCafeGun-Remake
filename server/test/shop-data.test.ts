import { expect, it } from "vitest";

import {
  isGoodsInWindow,
  isShopOpen,
  makeShopGoodsListTbParam,
  nextPriceIndex,
  parseGoods,
  parseShopTabs,
  refreshFee,
  rollDiscount,
  rollShelf,
  ShopCatalog,
  shopOperationalDate,
  shopNextRefreshTime,
  shopOperationalWeek,
  shopShelfKey,
  unitPrice,
  type GoodsConfig,
} from "../src/game-data/shop-data.js";

it("loads the real shop tables extracted from the client", () => {
  const catalog = ShopCatalog.loadDefault();
  expect(catalog.size).toBeGreaterThan(2_000);

  const tab = catalog.getTab(20_001);
  expect(tab).toMatchObject({
    shopId: 20_001,
    onOff: 1,
    columns: 8,
    refreshRule: 1,
    refreshTimes: [14_400, 64_800],
    refreshFees: [15, 30, 60, 90, 120],
    refreshMoneyType: 3,
    refreshLimits: 5,
  });

  const goods = catalog.getGoods(20_101);
  expect(goods).toMatchObject({
    shopType: 2,
    shopId: 20_001,
    goodsId: 20_101,
    genre: 7,
    detail: 1,
    particular: 1,
    templateLevel: 3,
    goodsNum: 1,
    weight: 10,
    moneyType: 3,
    sellingPrice: [20],
    refreshLimitNum: 1,
  });

  expect(catalog.goodsForShop(20_001).length).toBe(56);
  expect(catalog.goodsForShop(20_010).length).toBe(75);
});

it("parses ladder prices, discount lists and time windows", () => {
  const goods = parseGoods(
    [
      "INT\tINT",
      "注释",
      "ShopType\tShopId\tGoodsId\tGDPLNX\tName\tGroup\tWeight\tPrice1\tPrice2\tRefreshLimitNum\tDailyLimitNum\tWeekLimitNum\tTotalLimitNum\tShelfLifeLmt\tPromotion\tDiscountList\tBegin\tEnd\tDayIndex\tNeedCafeLevel",
      "3\t30001\t30101\t[2-3-3-1-1]\t千本红莲\t\t10\t5|[60,90,120]\t6|[20,30]\t\t\t\t6\t\t1\t[1-10],[99-100]\t[202601010000]\t[202612312359]\t\t",
    ].join("\n"),
  );
  const config = goods.get(30_101)!;
  expect(config.moneyType).toBe(5);
  expect(config.sellingPrice).toEqual([60, 90, 120]);
  expect(config.totalLimitNum).toBe(6);
  expect(config.discountList).toEqual([
    { weight: 1, discount: 10 },
    { weight: 99, discount: 100 },
  ]);
  expect(config.begin).toBe(
    Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1_000) - 8 * 3_600,
  );
  expect(isGoodsInWindow(config, Date.UTC(2026, 5, 1) / 1_000)).toBe(true);
  expect(isGoodsInWindow(config, Date.UTC(2027, 5, 1) / 1_000)).toBe(false);
});

it("parses shop tab open windows with dash-separated times", () => {
  const tabs = parseShopTabs(
    [
      "INT",
      "注释",
      "ShopId\tName\tLabel\tOnOff\tBegin\tEnd\tColumns\tRefreshRule\tRefreshTime\tRefreshFee\tMoneyType\tRefreshLimits",
      "30026\tx\tx\t1\t2022-01-06-08-00-00\t2022-01-26-04-00-00\t999\t4\t\t\t3\t0",
    ].join("\n"),
  );
  const tab = tabs.get(30_026)!;
  expect(tab.begin).toBe(Math.floor(Date.UTC(2022, 0, 6, 0, 0, 0) / 1_000));
  expect(tab.end).toBe(Math.floor(Date.UTC(2022, 0, 25, 20, 0, 0) / 1_000));
  expect(isShopOpen(tab, Date.UTC(2022, 0, 10) / 1_000)).toBe(true);
  expect(isShopOpen(tab, Date.UTC(2026, 0, 10) / 1_000)).toBe(false);
});

it("mirrors the client price-index priority and caps at the ladder end", () => {
  const config = {
    sellingPrice: [10, 20, 30],
    shelfLifeLmt: 5,
    totalLimitNum: 10,
    weekLimitNum: null,
    dailyLimitNum: null,
    refreshLimitNum: null,
  } as GoodsConfig;
  expect(nextPriceIndex(config, { shelfBuyNum: 1, totalBuyNum: 2 })).toBe(2);
  expect(nextPriceIndex(config, { totalBuyNum: 2 })).toBe(3);
  expect(nextPriceIndex(config, { totalBuyNum: 9 })).toBe(3);
  expect(nextPriceIndex(config, {})).toBe(1);
  expect(unitPrice(config, 2, 100)).toBe(20);
  expect(unitPrice(config, 2, 50)).toBe(10);
  expect(unitPrice(config, 1, 33)).toBe(4);
});

it("rolls a weighted shelf without replacement and rolls discounts", () => {
  const goods = parseGoods(
    [
      "INT",
      "注释",
      "ShopType\tShopId\tGoodsId\tGDPLNX\tName\tGroup\tWeight\tPrice1",
      ...[1, 2, 3, 4].map((id) => `2\t20001\t${id}\t[7-1-1-3-1]\tg${id}\t\t10\t3|20`),
    ].join("\n"),
  );
  const pool = [...goods.values()];
  const shelf = rollShelf(pool, 3, () => 0.5);
  expect(shelf).toHaveLength(3);
  expect(new Set(shelf.map((entry) => entry.goodsId)).size).toBe(3);
  expect(shelf.every((entry) => entry.discount === 100)).toBe(true);

  const discounted = rollDiscount(
    {
      discountList: [
        { weight: 1, discount: 50 },
        { weight: 99, discount: 100 },
      ],
    } as GoodsConfig,
    () => 0,
  );
  expect(discounted).toBe(50);
});

it("computes operational date, week and refresh shelf key", () => {
  const sunday = new Date("2026-08-16T12:00:00+08:00").getTime();
  const monday = new Date("2026-08-17T12:00:00+08:00").getTime();
  const beforeDawn = new Date("2026-08-17T02:00:00+08:00").getTime();
  expect(shopOperationalDate(sunday)).toBe("2026-08-16");
  expect(shopOperationalDate(beforeDawn)).toBe("2026-08-16");
  expect(shopOperationalWeek(sunday)).toBe("2026-08-10");
  expect(shopOperationalWeek(monday)).toBe("2026-08-17");
  expect(shopOperationalWeek(beforeDawn)).toBe("2026-08-10");

  const tab = {
    refreshTimes: [14_400, 64_800],
  } as ReturnType<typeof parseShopTabs> extends Map<number, infer T> ? T : never;
  expect(shopShelfKey(tab, sunday)).toBe("2026-08-16@1");
  expect(shopShelfKey(tab, new Date("2026-08-16T19:00:00+08:00").getTime())).toBe(
    "2026-08-16@2",
  );
  expect(shopShelfKey(tab, beforeDawn)).toBe("2026-08-16@2");
});

it("computes the manual refresh fee ladder", () => {
  const tab = ShopCatalog.loadDefault().getTab(20_001)!;
  expect(refreshFee(tab, 0)).toBe(15);
  expect(refreshFee(tab, 3)).toBe(90);
  expect(refreshFee(tab, 99)).toBe(120);
  expect(refreshFee({ ...tab, refreshFees: [] }, 0)).toBe(0);
});

it("maps the goods list result to the client tbParam shape", () => {
  expect(
    makeShopGoodsListTbParam({
      shopId: 20_001,
      isOpen: true,
      refreshCount: 2,
      goodsList: [{ goodsid: 20_101, buynum: 1, refreshbuynum: 0 }],
      endTime: 0,
    }),
  ).toEqual({
    shopid: 20_001,
    isopen: 1,
    refreshcount: 2,
    goodslist: [{ goodsid: 20_101, buynum: 1, refreshbuynum: 0 }],
    endtime: 0,
  });
});

it("sends the next auto refresh of a refreshing shop as nextrefreshtime", () => {
  const catalog = ShopCatalog.loadDefault();
  const at = (iso: string): number => Math.floor(new Date(iso).getTime() / 1_000);

  // 20001 Mercantile Exchange: RefreshRule 1, slots 04:00 and 18:00 (UTC+8).
  const exchange = catalog.getTab(20_001)!;
  expect(shopNextRefreshTime(exchange, at("2026-11-28T12:00:00+08:00"))).toBe(
    at("2026-11-28T18:00:00+08:00"),
  );
  expect(shopNextRefreshTime(exchange, at("2026-11-28T19:00:00+08:00"))).toBe(
    at("2026-11-29T04:00:00+08:00"),
  );
  expect(shopNextRefreshTime(exchange, at("2026-11-28T03:59:59+08:00"))).toBe(
    at("2026-11-28T04:00:00+08:00"),
  );
  // On the boundary the next one is the following slot, so the client never re-pulls in a loop.
  expect(shopNextRefreshTime(exchange, at("2026-11-28T04:00:00+08:00"))).toBe(
    at("2026-11-28T18:00:00+08:00"),
  );

  // 20010 pet shop: RefreshRule 2, one daily slot at 04:00.
  const pets = catalog.getTab(20_010)!;
  expect(pets.refreshRule).toBe(2);
  expect(shopNextRefreshTime(pets, at("2026-11-28T12:00:00+08:00"))).toBe(
    at("2026-11-29T04:00:00+08:00"),
  );

  // 20005 card shop: RefreshRule 3, weekly, Monday 04:00 (UTC+8) like shopOperationalWeek.
  const cards = catalog.getTab(20_005)!;
  expect(cards.refreshRule).toBe(3);
  expect(shopNextRefreshTime(cards, at("2026-11-28T12:00:00+08:00"))).toBe(
    at("2026-11-30T04:00:00+08:00"),
  );
  expect(shopNextRefreshTime(cards, at("2026-11-30T03:00:00+08:00"))).toBe(
    at("2026-11-30T04:00:00+08:00"),
  );
  expect(shopNextRefreshTime(cards, at("2026-11-30T05:00:00+08:00"))).toBe(
    at("2026-12-07T04:00:00+08:00"),
  );

  // Event (4) and one-time (5) shops do not refresh: no countdown.
  expect(
    shopNextRefreshTime(catalog.getTab(30_001)!, at("2026-11-28T12:00:00+08:00")),
  ).toBe(0);
  expect(
    shopNextRefreshTime(catalog.getTab(20_007)!, at("2026-11-28T12:00:00+08:00")),
  ).toBe(0);
});

it("adds nextrefreshtime to the tbParam only when it is set", () => {
  const base = {
    shopId: 20_001,
    isOpen: true,
    refreshCount: 0,
    goodsList: [],
    endTime: 0,
  };
  expect(
    makeShopGoodsListTbParam({ ...base, nextRefreshTime: 1_800_000_000 }),
  ).toMatchObject({
    nextrefreshtime: 1_800_000_000,
  });
  expect(makeShopGoodsListTbParam({ ...base, nextRefreshTime: 0 })).not.toHaveProperty(
    "nextrefreshtime",
  );
});

it("opens the actual cafe shop flag without opening disabled or expired shops", () => {
  const tab = ShopCatalog.loadDefault().getTab(40_001)!;
  const now = Date.UTC(2026, 10, 6) / 1000;
  expect(tab.onOff).toBe(2);
  expect(isShopOpen(tab, now)).toBe(true);
  expect(isShopOpen({ ...tab, onOff: 0 }, now)).toBe(false);
  expect(isShopOpen({ ...tab, onOff: 3 }, now)).toBe(false);
  expect(isShopOpen({ ...tab, end: now - 1 }, now)).toBe(false);
  expect(isShopOpen({ ...tab, begin: now + 1 }, now)).toBe(false);
});

/** Deterministic RNG (mulberry32) so the shelf tests do not depend on luck. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function groupsOf(catalog: ShopCatalog, goodsIds: number[]): number[] {
  return goodsIds.map((goodsId) =>
    Number.parseInt(catalog.getGoods(goodsId)!.group, 10),
  );
}

it("stocks shop 20001 with exactly one goods per group 1..8, in group order", () => {
  const catalog = ShopCatalog.loadDefault();
  const pool = catalog.goodsForShop(20_001);
  const random = seeded(51);
  for (let run = 0; run < 500; run += 1) {
    const shelf = rollShelf(pool, catalog.getTab(20_001)!.columns, random);
    const goodsIds = shelf.map((entry) => entry.goodsId);
    expect(groupsOf(catalog, goodsIds)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Groups 3 and 4 hold one weapon material each: they are on every shelf.
    expect(goodsIds).toContain(20_111);
    expect(goodsIds).toContain(20_112);
  }
});

it("stocks the pet shop 20010 with one goods per group for all 11 groups", () => {
  const catalog = ShopCatalog.loadDefault();
  const random = seeded(20_010);
  for (let run = 0; run < 200; run += 1) {
    const shelf = rollShelf(
      catalog.goodsForShop(20_010),
      catalog.getTab(20_010)!.columns,
      random,
    );
    expect(
      groupsOf(
        catalog,
        shelf.map((entry) => entry.goodsId),
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(shelf.every((entry) => entry.discount === 100)).toBe(true);
  }
});

it("picks inside a group by weight and sorts groups numerically", () => {
  const goods = parseGoods(
    [
      "INT",
      "注释",
      "ShopType\tShopId\tGoodsId\tGDPLNX\tName\tGroup\tWeight\tPrice1",
      "2\t20005\t1\t[7-1-1-3-1]\ta\t[10]\t10\t3|20",
      "2\t20005\t2\t[7-1-1-3-1]\tb\t[2]\t1\t3|20",
      "2\t20005\t3\t[7-1-1-3-1]\tc\t[2]\t3\t3|20",
      "2\t20005\t4\t[7-1-1-3-1]\td\t[2]\t0\t3|20",
    ].join("\n"),
  );
  // Group 2 weights 1:3 (goods 4 has weight 0 and never shows).
  expect(rollShelf([...goods.values()], 0, () => 0.2).map((e) => e.goodsId)).toEqual([
    2, 1,
  ]);
  expect(rollShelf([...goods.values()], 0, () => 0.3).map((e) => e.goodsId)).toEqual([
    3, 1,
  ]);
});

it("keys weekly-refresh shelves (RefreshRule 3) by operational week", () => {
  const tab = {
    refreshRule: 3,
    refreshTimes: [],
  } as unknown as ReturnType<typeof parseShopTabs> extends Map<number, infer T>
    ? T
    : never;
  const monday = new Date("2026-08-17T12:00:00+08:00").getTime();
  const sunday = new Date("2026-08-23T12:00:00+08:00").getTime();
  const nextMonday = new Date("2026-08-24T12:00:00+08:00").getTime();
  expect(shopShelfKey(tab, monday)).toBe(shopShelfKey(tab, sunday));
  expect(shopShelfKey(tab, nextMonday)).not.toBe(shopShelfKey(tab, sunday));
});
