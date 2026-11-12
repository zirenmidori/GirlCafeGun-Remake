import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CafeCatalog,
  type CafeCatalogContents,
} from "../src/game-data/cafe-catalog.js";

const resourceRoot = path.resolve(process.cwd(), "resources/cafe");
const provenance = JSON.parse(
  readFileSync(path.join(resourceRoot, "provenance.json"), "utf8"),
) as {
  sourceSettingSha256: string;
  files: Record<
    string,
    { source: string; sha256: string; bytes: number; projection?: unknown }
  >;
};
function contents(): CafeCatalogContents {
  return Object.fromEntries(
    Object.keys(provenance.files).map((name) => [
      name.replace(/\.txt$/, ""),
      readFileSync(path.join(resourceRoot, name), "utf8"),
    ]),
  );
}

describe("recovered café catalog", () => {
  it("preserves every source byte and loads the business catalog once", () => {
    expect(provenance.sourceSettingSha256).toBe(
      "89418a55f80c346b24673bfc2f0cabfa731a0b7c0b77913a1a19b0df6d540ef8",
    );
    expect(Object.keys(provenance.files)).toHaveLength(29);
    for (const [name, expected] of Object.entries(provenance.files)) {
      const bytes = readFileSync(path.join(resourceRoot, name));
      expect(bytes.length).toBe(expected.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);
      if (expected.projection === undefined)
        expect(bytes).toEqual(
          readFileSync(path.resolve(process.cwd(), "..", expected.source)),
        );
    }
    const catalog = CafeCatalog.loadDefault();
    expect(CafeCatalog.loadDefault()).toBe(catalog);
    expect(catalog.maxLevel).toBe(30);
    expect(catalog.levels()).toHaveLength(31);
    expect(catalog.coffees()).toHaveLength(12);
    expect(catalog.customers()).toHaveLength(12);
    expect(catalog.staffMembers()).toHaveLength(20);
    expect(catalog.furnitureItems()).toHaveLength(908);
    expect(catalog.themes()).toHaveLength(53);
    expect(Object.isFrozen(catalog.coffee(1))).toBe(true);
  });

  it("keeps normal levels distinct from the max-level exchange row", () => {
    const c = CafeCatalog.loadDefault();
    expect(c.level(1)).toMatchObject({
      SlotEat: 6,
      SlotCoffee: 1,
      MaxCoffee: 240,
      Customer: 10,
      MaxQSize: 1,
      CafeUnlockNum: 1,
      RestUnlockNum: 0,
      DormUnlockNum: 0,
      ReduceVigor: 12,
      AddVigor: 4,
    });
    expect(c.level(2)).toMatchObject({
      NeedHot: 20,
      NeedGold: 500,
      OpenRest: 1,
      RestUnlockNum: 2,
    });
    expect(c.level(2)!.LevelAwards).toEqual([[15, 10, 1, 1, 600]]);
    expect(c.level(8)).toMatchObject({ OpenDorm: 1, DormUnlockNum: 1 });
    expect(c.level(30)).toMatchObject({
      MaxCoffee: 540,
      SlotEat: 16,
      SlotCoffee: 4,
      NeedHot: 91_000,
      NeedGold: 30_000,
      CafeUnlockNum: 3,
      RestUnlockNum: 6,
    });
    expect(c.level(30)!.LevelAwards).toEqual([[6, 28, 7, 4, 1]]);
    expect(c.level(31)).toBeNull();
    expect(c.level(10_001)!.LevelAwards).toEqual([[8, 2, 1, 3, 1]]);
  });

  it("uses final coffee costs, drinking times and unlock conditions without legacy skill-cost invention", () => {
    const c = CafeCatalog.loadDefault();
    expect(c.coffee(1)).toMatchObject({
      Cost: 5,
      Price: 10,
      Time: 240,
      Max: 500,
      AwardA: 10,
      AwardB: 1,
      AwardC: 1,
      RateA: 0,
      RateB: 0,
      RateC: 0,
    });
    expect(c.coffee(1)).toMatchObject({
      LearnCostPoint: 0,
      LearnCostCash: 0,
      PrevCoffee: 0,
      Level: 0,
    });
    expect(c.coffee(5)!.Cond3).toBe(10);
    expect(c.coffee(6)!.Cond1).toEqual([4, 12, 1]);
    expect(c.coffee(10)!.Cond1).toEqual([6, 12, 2]);
    expect(c.coffee(12)).toMatchObject({ Cost: 5, Price: 15, Time: 240, Flavor: 75 });
    expect(c.resetCost(1)).toBe(0);
    expect(c.resetCost(2)).toBe(5);
    expect(c.resetCost(999)).toBe(5);
    expect(c.playerCoffeePoints(1)).toBe(10);
    expect(c.playerCoffeePoints(2)).toBe(20);
    expect(c.coffee(999)).toBeNull();
  });

  it("retains customer probability fields and staff-specific bonuses separately", () => {
    const c = CafeCatalog.loadDefault();
    expect(c.customer(201)).toMatchObject({
      Prefer: "Appearance",
      Preferfactor: 51,
      Weight: 0,
      WeightMin: 1500,
      WeightMax: 2000,
      Rate1: 0,
      Rate2: 0,
      Rate3: 0,
      WaitTime1: 20,
      WaitTime2: 50,
    });
    expect(c.customer(205)).toMatchObject({
      NeedCoffee: 5,
      Type: 2,
      Preferfactor: 61,
      Rate1: 15,
      Rate2: 0,
      Rate3: 0,
    });
    expect(c.customer(212)).toMatchObject({ NeedCoffee: 12, Rate3: 30 });
    expect(c.staff(10)).toMatchObject({
      AttriType: "AddCoin",
      AttriNum: 8,
      GuestId: [210],
      AttriGuestType: "AddCoin",
      AttriPlus: 30,
    });
    expect(c.staff(201)).toMatchObject({
      AttriType: "AddCoffeeCoin",
      AttriNum: 3,
      GuestId: [201],
    });
    expect(c.staff(999)).toBeNull();
  });

  it("handles inclusive comfort thresholds and their exact hourly vigor bonuses", () => {
    const c = CafeCatalog.loadDefault();
    expect(c.comfort(0)).toMatchObject({ Id: 0, AddEarn_Coin: 0, AddVigor: 0 });
    expect(c.comfort(1)).toMatchObject({ Id: 1, AddEarn_Coin: 10 });
    expect(c.comfort(999).Id).toBe(1);
    expect(c.comfort(1000).Id).toBe(2);
    expect(c.comfort(2399).AddVigor).toBe(0);
    expect(c.comfort(2400)).toMatchObject({ AddEarn_Coin: 30, AddVigor: 1 });
    expect(c.comfort(40_200)).toMatchObject({ Id: 9, AddEarn_Coin: 90, AddVigor: 8 });
  });

  it("retains native furniture identities, theme layouts and commerce data", () => {
    const c = CafeCatalog.loadDefault();
    expect(c.furniture(101)).toMatchObject({
      Id: 101,
      Type: 100,
      ItemInfo: [11, 1, 1, 1],
      DicPlace: [1],
      AddScore: 35,
      SellPrice: 210,
    });
    expect(c.furniture(505)!.AwardID).toEqual([[15, 1, 1, 1, 1]]);
    expect(c.theme(1)!.poses[0]).toEqual({
      templateId: 401,
      parentTemplateId: 6,
      posX: 0,
      posY: 5,
      rotate: 0,
    });
    expect(c.theme(2)!.Area).toBe(2);
    expect(c.shop(1)).toMatchObject({
      ItemId: 100,
      MoneyType: 2,
      Money: 2000,
      NeedLevel: 1,
    });
    expect(c.visitMission(1)!.Awards).toEqual([
      [15, 12, 1, 1, 30],
      [15, 14, 1, 1, 40],
      [15, 13, 1, 1, 40],
    ]);
    expect(c.visitAwards().map((row) => row.Point)).toEqual([2, 4, 6, 8, 10]);
    expect(c.visitAward(5)!.awards).toContainEqual([15, 2, 1, 1, 50]);
    expect(c.table("npet/foodboxs")[0]).toMatchObject({ Index: "1", Cost: "[3,0]" });
    expect(c.table("npet/petfoodinfo").length).toBeGreaterThan(0);
  });

  it("retains exact music identities and the fourteen default unlocked tracks", () => {
    const c = CafeCatalog.loadDefault();
    expect(c.musicEntries()).toHaveLength(80);
    expect(c.musicEntries().filter((entry) => entry.IsIgnoreLock > 0)).toHaveLength(14);
    expect(c.music(8001)).toMatchObject({
      Type: 8,
      G: 17,
      D: 1,
      P: 1,
      L: 1,
      Extension1: 0,
      IsIgnoreLock: 1,
    });
    expect(c.music(8004)).toMatchObject({ Type: 8, Extension1: 5 });
    expect(c.music(1001)).toBeNull();
    expect(c.table("riki")).toHaveLength(1098);
  });

  it("fails fast on corrupt business costs and duplicate template identities", () => {
    const base = contents();
    expect(
      () =>
        new CafeCatalog({
          ...base,
          coffeelist: base.coffeelist!.replace("240\t5\t10", "240\t-5\t10"),
        }),
    ).toThrow("Invalid coffee");
    const lines = base.coffeelist!.split(/\r?\n/);
    expect(
      () => new CafeCatalog({ ...base, coffeelist: `${base.coffeelist}\n${lines[3]}` }),
    ).toThrow("duplicate café ID");
    const { ncafelevels: _levels, ...missing } = base;
    expect(_levels).toBeDefined();
    expect(() => new CafeCatalog(missing)).toThrow("Missing café table ncafelevels");
  });
});
