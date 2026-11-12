import { describe, expect, it } from "vitest";

import {
  addGirlAffection,
  girlGiftBaseExperience,
  girlGiftExperience,
  girlLevelAwardIndex,
  handworkGiftState,
  isFavoriteGift,
} from "../src/game-data/girl-gift-data.js";

describe("girl gift data", () => {
  it("mirrors ItemList ExtParam1 for every genre-5 gift", () => {
    expect(girlGiftBaseExperience([5, 1, 7, 2])).toBe(60);
    expect(girlGiftBaseExperience([5, 1, 7, 4])).toBe(300);
    expect(girlGiftBaseExperience([5, 1, 201, 4])).toBe(500);
    expect(girlGiftBaseExperience([5, 2, 1, 1])).toBe(30);
    expect(girlGiftBaseExperience([5, 2, 1, 8])).toBe(300);
    expect(girlGiftBaseExperience([5, 3, 1, 1])).toBeNull();
  });

  it("applies the favorite-gift multiplier from UI_GirlGift", () => {
    expect(isFavoriteGift(7, [5, 1, 7, 2])).toBe(true);
    expect(isFavoriteGift(7, [5, 1, 7, 4])).toBe(true);
    expect(isFavoriteGift(7, [5, 1, 8, 2])).toBe(false);
    expect(isFavoriteGift(201, [5, 1, 201, 4])).toBe(true);

    expect(girlGiftExperience(7, [5, 1, 7, 4])).toBe(375);
    expect(girlGiftExperience(7, [5, 2, 1, 4])).toBe(300);
    expect(girlGiftExperience(201, [5, 1, 201, 4])).toBe(1_000);
  });

  it("levels up with the Friendliness.txt curve", () => {
    const gain = addGirlAffection(7, 1, 0, 375);
    expect(gain).toMatchObject({
      addedExperience: 375,
      oldLevel: 1,
      newLevel: 4,
      oldExperience: 0,
      newExperience: 61,
      reachedMaxLevel: false,
    });
  });

  it("discards overflow experience at the cap like GirlCommon:Add", () => {
    const gain = addGirlAffection(7, 99, 4_499, 30);
    expect(gain).toMatchObject({
      addedExperience: 1,
      oldLevel: 99,
      newLevel: 100,
      newExperience: 0,
      reachedMaxLevel: true,
    });
  });

  it("uses the link curve and cap for link girls", () => {
    const gain = addGirlAffection(201, 1, 0, 1_000);
    expect(gain).toMatchObject({ newLevel: 4, newExperience: 55 });
    expect(addGirlAffection(201, 50, 0, 100)).toBeNull();
    expect(addGirlAffection(7, 100, 0, 100)).toBeNull();
  });

  it("maps LevelAward levels to their claim slots", () => {
    expect(girlLevelAwardIndex(10)).toBe(1);
    expect(girlLevelAwardIndex(200)).toBe(20);
    expect(girlLevelAwardIndex(15)).toBeNull();
    expect(girlLevelAwardIndex(210)).toBeNull();
  });

  it("keeps handwork flags false outside the 2021 activity window", () => {
    expect(handworkGiftState([5, 2, 1, 6])).toEqual({ active: false, special: false });
    expect(handworkGiftState([5, 2, 1, 5])).toEqual({ active: false, special: false });
    const during = new Date(2021, 7, 10, 12).getTime();
    expect(handworkGiftState([5, 2, 1, 6], during)).toEqual({
      active: true,
      special: true,
    });
    expect(handworkGiftState([5, 2, 1, 5], during)).toEqual({
      active: true,
      special: false,
    });
    expect(handworkGiftState([5, 2, 1, 1], during)).toEqual({
      active: false,
      special: false,
    });
  });
});
