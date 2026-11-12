import { describe, expect, it } from "vitest";

import { GachaCatalog } from "../src/game-data/gacha-data.js";

const catalog = GachaCatalog.loadDefault();
const weaponCatalog = GachaCatalog.loadDefault(0);

describe("original client gacha tables", () => {
  it("loads the latest definition of all 63 role pools", () => {
    expect(catalog.size).toBe(63);
    expect(catalog.get(666)?.judgeType).toBe(2);
    expect(catalog.get(666)?.normalCards.size).toBe(4);
    expect(catalog.get(70)?.protectNum).toBe(50);
  });

  it("reproduces the published normal rarity probabilities", () => {
    expect(catalog.publishedStarWeights(70, 1)).toEqual([1_200, 7_000, 1_500, 300]);
    const rates = catalog.publishedCardRates(70, 1);
    const totals = new Map<number, number>();
    for (const { card, probability } of rates) {
      const star = Math.min(card.gdpl[3], 4);
      totals.set(star, (totals.get(star) ?? 0) + probability);
    }
    expect(totals.get(1)).toBeCloseTo(0.12, 12);
    expect(totals.get(2)).toBeCloseTo(0.7, 12);
    expect(totals.get(3)).toBeCloseTo(0.15, 12);
    expect(totals.get(4)).toBeCloseTo(0.03, 12);
    expect([...totals.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1,
      12,
    );
  });

  it("uses the dedicated 3-star-or-higher hedge table for the tenth draw", () => {
    const result = catalog.roll(
      666,
      true,
      { pity: 0, upPity: 0, total: 0 },
      new Set(),
      [],
      () => 0,
    );
    expect(result.awards).toHaveLength(10);
    expect(result.awards.slice(0, 9).every(({ tbGDPL }) => tbGDPL[3] === 1)).toBe(true);
    expect(result.awards[9]!.tbGDPL[3]).toBe(3);
  });

  it("forces a four-star card exactly on the configured 50th draw", () => {
    const result = catalog.roll(
      70,
      false,
      { pity: 49, upPity: 49, total: 49 },
      new Set(),
      [],
      () => 0,
    );
    expect(result.awards[0]).toMatchObject({
      nTimes: 50,
      nTotalTimes: 50,
    });
    expect(result.awards[0]!.tbGDPL[3]).toBeGreaterThanOrEqual(4);
    expect(result.counters.pity).toBe(0);
  });

  it("forces an UP four-star by the 100th draw and marks it obtained", () => {
    const result = catalog.roll(
      70,
      false,
      { pity: 0, upPity: 99, total: 99 },
      new Set(),
      [],
      () => 0,
    );
    expect(result.awards[0]).toMatchObject({
      isUp: true,
      nUpTimes: 100,
      nTotalTimes: 100,
    });
    expect(result.awards[0]!.tbGDPL[3]).toBeGreaterThanOrEqual(4);
    expect(result.counters.upPity).toBe(-1);
  });

  it("can draw from every exposed role pool", () => {
    for (const id of catalog.ids) {
      const pool = catalog.get(id)!;
      expect(() =>
        catalog.roll(
          id,
          pool.costOne === null && pool.costTen !== null,
          { pity: 0, upPity: 0, total: 0 },
          new Set(),
          [],
          () => 0,
        ),
      ).not.toThrow();
    }
  });

  it("loads weapon pools and uses their explicit rarity column", () => {
    expect(weaponCatalog.size).toBe(19);
    expect(weaponCatalog.ids).toContain(1);
    expect(weaponCatalog.publishedStarWeights(1, 1)).toEqual([
      1_200, 7_000, 1_500, 300,
    ]);
    const result = weaponCatalog.roll(
      1,
      false,
      { pity: 0, upPity: 0, total: 0 },
      new Set(),
      [],
      () => 0,
    );
    expect(result.awards[0]).toMatchObject({
      tbGDPL: [2, expect.any(Number), expect.any(Number), 1],
    });
  });

  it("applies the original 50-percent weapon custom-UP split", () => {
    const pool = weaponCatalog.get(700)!;
    const selectedIds = pool.normalCards
      .get(4)!
      .slice(0, 2)
      .map(({ id }) => id);
    const rolls = [9_999, 0];
    const result = weaponCatalog.roll(
      700,
      false,
      { pity: 0, upPity: 0, total: 0 },
      new Set(),
      selectedIds,
      () => rolls.shift()!,
    );
    expect(result.awards[0]).toMatchObject({
      nId: selectedIds[0],
      isUp: true,
    });
  });
});
