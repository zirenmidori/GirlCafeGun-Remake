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
