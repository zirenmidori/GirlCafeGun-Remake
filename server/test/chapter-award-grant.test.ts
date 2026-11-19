import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { RIKI_TASK_GROUP } from "../src/game-data/auto-use-item-data.js";
import { ChapterCatalog, rollChapterAwards } from "../src/game-data/chapter-config.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

async function withRepository(
  run: (repository: PlayerRepository) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-chapter-award-"));
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
    await run(repository);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("chapter settlement awards", () => {
  it("unlocks the gallery entry of a Riki first-clear award instead of keeping a stack", async () => {
    // chapter.txt 1-5-1 FirstAward holds [17-1-12-1-1]; Riki.txt lists it as
    // entry 8012, and Riki.lua shows the entry when task 53/8012 is 1.
    const level = ChapterCatalog.loadDefault().get(1, 5, 1)!;
    const awards = rollChapterAwards(level, true, "tester:1-5-1:0");
    expect(
      awards.some(([g, d, p, l]) => g === 17 && d === 1 && p === 12 && l === 1),
    ).toBe(true);

    await withRepository(async (repository) => {
      const settlement = await repository.settleLevel(
        "tester",
        1,
        5,
        1,
        3,
        0,
        awards,
        0,
      );
      expect(
        settlement.player.taskValues[String((RIKI_TASK_GROUP << 16) | 8_012)],
      ).toBe(1);
      expect(settlement.player.inventory.some(({ genre }) => genre === 17)).toBe(false);
    });
  });

  it("pays a coffee coin award into the wallet", async () => {
    await withRepository(async (repository) => {
      const settlement = await repository.settleLevel(
        "tester",
        1,
        1,
        1,
        3,
        0,
        [[15, 10, 1, 1, 100, 0]],
        0,
      );
      expect(settlement.player.money.find(({ id }) => id === 7)?.count).toBe(100);
      expect(settlement.updatedMoney.map(({ id }) => id)).toContain(7);
      expect(settlement.player.inventory.some(({ genre }) => genre === 15)).toBe(false);
    });
  });
});
