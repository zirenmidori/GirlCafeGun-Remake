import { expect, it } from "vitest";

import {
  characterCardModelId,
  isPlayableGirlId,
  PLAYABLE_GIRL_IDS,
} from "../src/game-data/character-card-data.js";

it("maps all playable girls and historical special card models", () => {
  expect(PLAYABLE_GIRL_IDS).toHaveLength(21);
  expect(
    characterCardModelId({ genre: 1, detail: 27, particular: 1, templateLevel: 1 }),
  ).toBe(1);
  expect(PLAYABLE_GIRL_IDS.every(isPlayableGirlId)).toBe(true);
  expect(isPlayableGirlId(17)).toBe(false);
  expect(isPlayableGirlId(200)).toBe(false);

  expect(
    characterCardModelId({
      genre: 1,
      detail: 1,
      particular: 2,
      templateLevel: 2,
    }),
  ).toBe(2);
  expect(
    characterCardModelId({
      genre: 1,
      detail: 1,
      particular: 81,
      templateLevel: 5,
    }),
  ).toBe(8001);
  expect(
    characterCardModelId({
      genre: 1,
      detail: 12,
      particular: 72,
      templateLevel: 4,
    }),
  ).toBe(7002);
  expect(
    characterCardModelId({
      genre: 1,
      detail: 201,
      particular: 1,
      templateLevel: 4,
    }),
  ).toBe(1);
});
