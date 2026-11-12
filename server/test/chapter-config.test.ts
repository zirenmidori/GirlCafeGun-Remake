import { describe, expect, it } from "vitest";

import {
  ChapterCatalog,
  effectiveEnergyCost,
  rollChapterAwards,
} from "../src/game-data/chapter-config.js";

describe("chapter configuration", () => {
  const catalog = ChapterCatalog.loadDefault();

  it("loads all playable rows from the bundled client table", () => {
    expect(catalog.size).toBeGreaterThan(400);
    const level = catalog.get(1, 2, 1);
    expect(level).toMatchObject({
      chapter: 1,
      index: 2,
      difficulty: 1,
      preCost: 1,
      vigour: 5,
      randDropNum: 1,
      masterExp: 6,
      cardExp: 300,
    });
    expect(level?.firstAwards).toEqual([
      [15, 2, 1, 1, 20],
      [7, 1, 4, 1, 1],
      [7, 3, 1, 1, 1],
      [15, 1, 1, 1, 2_000],
    ]);
  });

  it("mirrors the low-level energy discount shown by the client", () => {
    const level = catalog.get(1, 2, 1)!;
    expect(effectiveEnergyCost(level, 1)).toBe(3);
    expect(effectiveEnergyCost(level, 35)).toBe(6);
  });

  it("grants first-clear rewards once and always rolls normal drops", () => {
    const level = catalog.get(1, 2, 1)!;
    const first = rollChapterAwards(level, true, "test-seed");
    expect(first.filter((award) => award[5] === 0)).toHaveLength(4);
    expect(first.filter((award) => award[5] === 100)).toHaveLength(1);
    expect(first.filter((award) => award[5] === 7)).toHaveLength(1);

    const repeat = rollChapterAwards(level, false, "test-seed");
    expect(repeat.some((award) => award[5] === 0)).toBe(false);
    expect(repeat).toHaveLength(2);
  });
});
