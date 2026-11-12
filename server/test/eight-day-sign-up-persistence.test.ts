import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  eightDaySignUpProgress,
  hasClaimedEightDaySignUpReward,
  makeEightDaySignUpTaskId,
} from "../src/game-data/eight-day-sign-up-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  EightDaySignUpError,
  makeInitialState,
  MONEY_DIAMOND,
  PlayerRepository,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

it("records one cumulative login per operational day and claims activity 29", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-eight-day-sign-up-"));
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

    const firstLogin = await repository.markLogin(
      "tester",
      Date.parse("2026-07-28T12:00:00Z"),
    );
    const firstTask = firstLogin.taskValues[String(makeEightDaySignUpTaskId(23))] ?? 0;
    expect(eightDaySignUpProgress(firstTask)).toBe(1);
    expect(hasClaimedEightDaySignUpReward(firstTask)).toBe(false);

    const duplicateLogin = await repository.markLogin(
      "tester",
      Date.parse("2026-07-28T19:59:59Z"),
    );
    expect(
      eightDaySignUpProgress(
        duplicateLogin.taskValues[String(makeEightDaySignUpTaskId(23))] ?? 0,
      ),
    ).toBe(1);

    const firstReward = await repository.claimEightDaySignUpAward("tester", 23);
    expect(firstReward.awards).toEqual([[15, 2, 1, 1, 30]]);
    expect(firstReward.updatedMoney).toEqual([{ id: MONEY_DIAMOND, count: 30 }]);
    expect(
      hasClaimedEightDaySignUpReward(
        firstReward.player.taskValues[String(makeEightDaySignUpTaskId(23))] ?? 0,
      ),
    ).toBe(true);

    await expect(
      repository.claimEightDaySignUpAward("tester", 23),
    ).rejects.toBeInstanceOf(EightDaySignUpError);

    const secondLogin = await repository.markLogin(
      "tester",
      Date.parse("2026-07-28T20:00:00Z"),
    );
    expect(
      eightDaySignUpProgress(
        secondLogin.taskValues[String(makeEightDaySignUpTaskId(24))] ?? 0,
      ),
    ).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
