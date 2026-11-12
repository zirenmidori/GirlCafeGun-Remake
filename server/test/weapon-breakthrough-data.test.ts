import { describe, expect, it } from "vitest";
import {
  WeaponBreakthroughCatalog,
  parseWeaponBreakthroughRequest,
} from "../src/game-data/weapon-breakthrough-data.js";
import {
  weaponRarityOf,
  weaponPassiveSkills,
} from "../src/game-data/weapon-skill-data.js";
import { GachaCatalog } from "../src/game-data/gacha-data.js";

describe("custom weapon template and exact breakthrough data", () => {
  it("knows Astral independently of pools, and projects passive level through all breaks", () => {
    const pool = GachaCatalog.loadDefault(0);
    expect(pool.rarityOf([2, 2, 28, 1])).toBeNull();
    expect(weaponRarityOf([2, 2, 28, 1], () => 1)).toBe(4);
    expect(weaponRarityOf([2, 999, 999, 1], () => 3)).toBe(3);
    for (let level = 0; level <= 4; level++)
      expect(weaponPassiveSkills(2, 2, 28, 1, level)).toEqual([
        { skillId: 40992, skillLevel: level + 1, skillType: 2 },
      ]);
    expect(weaponPassiveSkills(2, 2, 4, 1, 4)).toEqual([
      { skillId: 40164, skillLevel: 5, skillType: 2 },
    ]);
  });
  it("matches four-star costs and lower rarity maximum stages; caches the parsed table", () => {
    const catalog = WeaponBreakthroughCatalog.loadDefault();
    expect(WeaponBreakthroughCatalog.loadDefault()).toBe(catalog);
    for (let level = 1; level <= 4; level++)
      expect(catalog.stage(4, level)).toEqual({
        rarity: 4,
        breakLevel: level,
        materialCount: level,
        currencyId: 2,
        currencyCount: 50000 * level,
        maximumLevel: 40 + 10 * level,
      });
    expect(catalog.stage(1, 4)).toBeNull();
    expect(catalog.stage(2, 4)).toBeNull();
    expect(catalog.stage(3, 4)?.currencyCount).toBe(160000);
  });
  it("rejects malformed/duplicate/self-amplifying material requests", () => {
    expect(
      parseWeaponBreakthroughRequest({
        nGuid: 12,
        tbGuid: [
          [13, 1],
          [14, 2],
        ],
      }),
    ).toEqual({
      guid: 12,
      materials: [
        { guid: 13, count: 1 },
        { guid: 14, count: 2 },
      ],
    });
    for (const tbGuid of [
      [],
      [[13, 0]],
      [[13, -1]],
      [[13, 5]],
      [
        [13, 1],
        [13, 1],
      ],
      [[13, 1.5]],
      [[13, "NaN"]],
    ])
      expect(parseWeaponBreakthroughRequest({ nGuid: 12, tbGuid })).toBeNull();
  });
});
