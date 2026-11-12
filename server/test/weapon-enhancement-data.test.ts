import { describe, expect, it } from "vitest";

import {
  addWeaponExperience,
  parseWeaponEnhancementRequest,
  sacrificedWeaponValue,
  weaponExperienceMaterial,
  weaponMaximumLevel,
} from "../src/game-data/weapon-enhancement-data.js";

describe("weapon enhancement data", () => {
  it("parses the request observed on the device", () => {
    expect(
      parseWeaponEnhancementRequest({
        nGuid: 20_076,
        nCmd: 1,
        tbGuid: [[20_002, 1]],
      }),
    ).toEqual({
      guid: 20_076,
      materials: [{ guid: 20_002, count: 1 }],
    });
  });

  it("uses the exact ItemList values shown by the client", () => {
    expect(
      weaponExperienceMaterial({
        genre: 7,
        detail: 3,
        particular: 1,
        templateLevel: 1,
      }),
    ).toMatchObject({ experience: 500, coinCost: 500 });
    expect(
      weaponExperienceMaterial({
        genre: 7,
        detail: 3,
        particular: 1,
        templateLevel: 4,
      }),
    ).toMatchObject({ experience: 50_000, coinCost: 50_000 });
  });

  it("matches the current UI projection from level 1 with 500 experience", () => {
    expect(addWeaponExperience(1, 0, 500, 40)).toEqual({
      level: 3,
      experience: 180,
    });
  });

  it("uses the client formulas for donor weapons and breakthrough caps", () => {
    expect(sacrificedWeaponValue(1, 3)).toEqual({
      experience: 5_000,
      coinCost: 5_000,
    });
    expect(sacrificedWeaponValue(10, 4)).toEqual({
      experience: 11_669,
      coinCost: 10_000,
    });
    expect(weaponMaximumLevel(2, 4)).toBe(70);
    expect(weaponMaximumLevel(3, 4)).toBe(80);
  });
});
