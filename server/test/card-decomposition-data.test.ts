import { describe, expect, it } from "vitest";

import {
  cardCumulativeExperience,
  characterCardDecompositionReward,
  parseCardDecompositionRequest,
} from "../src/game-data/card-decomposition-data.js";

describe("character card decomposition data", () => {
  it("matches the client's rarity rewards", () => {
    expect(characterCardDecompositionReward(1, 1)).toEqual({
      gold: 500,
      tokenCount: 0,
    });
    expect(characterCardDecompositionReward(1, 2)).toEqual({
      gold: 2_000,
      tokenCount: 10,
    });
    expect(characterCardDecompositionReward(1, 3)).toEqual({
      gold: 6_000,
      tokenCount: 40,
    });
    expect(characterCardDecompositionReward(1, 4)).toEqual({
      gold: 40_000,
      tokenCount: 200,
    });
    expect(characterCardDecompositionReward(1, 5)).toEqual({
      gold: 500,
      tokenCount: 0,
    });
  });

  it("prices only experience spent reaching the current level", () => {
    expect(cardCumulativeExperience(26)).toBe(56_924);
    expect(characterCardDecompositionReward(26, 4)).toEqual({
      gold: 57_077,
      tokenCount: 200,
    });
  });

  it("parses a unique list of at most forty positive GUIDs", () => {
    expect(
      parseCardDecompositionRequest({ sCmd: 1, tbParam: [20_044, 20_045] }),
    ).toEqual([20_044, 20_045]);
    expect(parseCardDecompositionRequest({ sCmd: 1, tbParam: [] })).toBeNull();
    expect(
      parseCardDecompositionRequest({ sCmd: 1, tbParam: [20_044, 20_044] }),
    ).toBeNull();
    expect(
      parseCardDecompositionRequest({
        sCmd: 1,
        tbParam: Array.from({ length: 41 }, (_, index) => index + 1),
      }),
    ).toBeNull();
  });
});
