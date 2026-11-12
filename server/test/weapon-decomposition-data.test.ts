import { describe, expect, it } from "vitest";

import {
  parseWeaponDecompositionRequest,
  weaponDecompositionReward,
} from "../src/game-data/weapon-decomposition-data.js";

describe("weapon decomposition data", () => {
  it("matches the client's ItemRarityItem Param2 rewards", () => {
    expect(weaponDecompositionReward(1, 1)).toEqual({
      gold: 500,
      tokenCount: 0,
    });
    expect(weaponDecompositionReward(1, 2)).toEqual({
      gold: 2_000,
      tokenCount: 5,
    });
    expect(weaponDecompositionReward(1, 3)).toEqual({
      gold: 6_000,
      tokenCount: 25,
    });
    expect(weaponDecompositionReward(1, 4)).toEqual({
      gold: 40_000,
      tokenCount: 250,
    });
    expect(weaponDecompositionReward(1, 5)).toEqual({
      gold: 500,
      tokenCount: 0,
    });
  });

  it("prices experience spent reaching the weapon's current level", () => {
    expect(weaponDecompositionReward(26, 4)).toEqual({
      gold: 57_077,
      tokenCount: 250,
    });
  });

  it("parses a unique list of at most forty weapon GUIDs", () => {
    expect(
      parseWeaponDecompositionRequest({
        nCmd: 2,
        tbGuid: [20_104, 20_025],
      }),
    ).toEqual([20_104, 20_025]);
    expect(parseWeaponDecompositionRequest({ nCmd: 2, tbGuid: [] })).toBeNull();
    expect(
      parseWeaponDecompositionRequest({
        nCmd: 2,
        tbGuid: [20_104, 20_104],
      }),
    ).toBeNull();
    expect(
      parseWeaponDecompositionRequest({
        nCmd: 2,
        tbGuid: Array.from({ length: 41 }, (_, index) => index + 1),
      }),
    ).toBeNull();
  });
});
