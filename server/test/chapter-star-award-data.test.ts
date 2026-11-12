import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  chapterStarAward,
  chapterStarTaskProgress,
  hasClaimedChapterStarAward,
  makeChapterStarTaskId,
} from "../src/game-data/chapter-star-award-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  MONEY_DIAMOND,
  MONEY_GOLD,
  PlayerRepository,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

describe("chapter star awards", () => {
  it("mirrors the bundled client thresholds and rewards", () => {
    expect(chapterStarAward(1, 1, 1)).toEqual({
      chapter: 1,
      difficulty: 1,
      position: 1,
      requiredStars: 6,
      awards: [
        [15, 2, 1, 1, 10],
        [15, 1, 1, 1, 1_500],
        [7, 1, 4, 1, 1],
      ],
    });
    expect(chapterStarAward(4, 2, 3)).toEqual({
      chapter: 4,
      difficulty: 2,
      position: 3,
      requiredStars: 36,
      awards: [
        [15, 2, 1, 1, 60],
        [15, 1, 1, 1, 6_000],
        [7, 3, 1, 3, 1],
      ],
    });
  });

  it("reconciles completed stars, grants rewards, and prevents duplicate claims", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-chapter-stars-"));
    try {
      const store = new JsonStore({
        filePath: path.join(directory, "state.json"),
        initialState: makeInitialState(),
        logger,
      });
      await store.initialize();
      const repository = new PlayerRepository({
        store,
        defaults: {
          name: "",
          level: 1,
          exp: 0,
          fightPower: 0,
          serverZone: 8,
          firstLevelComplete: false,
        },
        logger,
      });
      await repository.getOrCreate("tester");
      await repository.completeLevel("tester", 1, 1, 1, 7);
      const completed = await repository.completeLevel("tester", 1, 2, 1, 7);

      const taskId = String(makeChapterStarTaskId(1, 1));
      expect(chapterStarTaskProgress(completed.taskValues[taskId] ?? 0)).toBe(6);
      expect(hasClaimedChapterStarAward(completed.taskValues[taskId] ?? 0, 1)).toBe(
        false,
      );

      const claimed = await repository.claimChapterStarAward("tester", 1, 1, 1);
      expect(claimed.updatedMoney).toEqual([
        { id: MONEY_GOLD, count: 1_500 },
        { id: MONEY_DIAMOND, count: 10 },
      ]);
      expect(claimed.updatedItems).toMatchObject([
        { genre: 7, detail: 1, particular: 4, templateLevel: 1, count: 1 },
      ]);
      expect(
        hasClaimedChapterStarAward(claimed.player.taskValues[taskId] ?? 0, 1),
      ).toBe(true);

      await expect(
        repository.claimChapterStarAward("tester", 1, 1, 1),
      ).rejects.toMatchObject({
        reason: "already_claimed",
      });
      await expect(
        repository.claimChapterStarAward("tester", 1, 1, 2),
      ).rejects.toMatchObject({
        reason: "not_completed",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
