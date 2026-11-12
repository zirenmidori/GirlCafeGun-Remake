import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  getBountyLevel,
  makeBountyDailyTaskId,
  makeBountyPassTaskId,
  rollBountyRun,
} from "../src/game-data/bounty-data.js";
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

it("settles bounty energy, rewards, progress and daily bonus atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-bounty-"));
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
        level: 34,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        firstLevelComplete: false,
      },
      logger,
    });
    const initial = await repository.getOrCreate("tester");
    const level = getBountyLevel(1, 1)!;
    const run = rollBountyRun(level, "first", 2);

    // Joining is deliberately read-only; failure and exit therefore spend nothing.
    expect(initial.money.find(({ id }) => id === 1)?.count).toBe(28);
    const settled = await repository.settleBounty(
      "tester",
      level,
      run.awards,
      run.dailyBonusApplied,
      null,
    );

    expect(settled.energyCost).toBe(5);
    expect(settled.player.money.find(({ id }) => id === 1)?.count).toBe(23);
    expect(settled.player.money.find(({ id }) => id === 2)?.count).toBe(18_000);
    expect(settled.player.taskValues[String(makeBountyPassTaskId(1))]).toBe(1);
    expect(settled.player.taskValues[String(makeBountyDailyTaskId(1))]).toBe(1);
    expect(settled.player.bounty?.completionCounts["1:1"]).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
