import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  DAILY_SIGN_UP_MONTH_DIAMOND_TASK,
  DAILY_SIGN_UP_MONTH_ENERGY_TASK,
  DAILY_SIGN_UP_TODAY_TASK,
  DAILY_SIGN_UP_TOTAL_TASK,
  makeDailySignUpTaskId,
} from "../src/game-data/daily-sign-up-data.js";
import { makeMonthCardTaskId } from "../src/game-data/ib-shop-data.js";
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

it("persists one reward per operational day and resets the month", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-sign-up-"));
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

    const first = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-27T20:00:00Z"),
    );
    expect(first.fresh).toBe(true);
    expect(first.awards).toEqual([[15, 1, 1, 1, 5_000]]);
    expect(first.updatedMoney).toEqual([{ id: 2, count: 5_000 }]);

    const duplicate = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-28T19:59:59Z"),
    );
    expect(duplicate.fresh).toBe(false);
    expect(duplicate.updatedMoney).toEqual([]);

    const nextDay = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-28T20:00:00Z"),
    );
    expect(nextDay.fresh).toBe(true);
    expect(nextDay.awards).toEqual([[10, 1, 1, 2, 1]]);
    expect(nextDay.updatedItems).toMatchObject([
      { genre: 10, detail: 1, particular: 1, templateLevel: 2, count: 1 },
    ]);

    const nextMonth = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-31T20:00:00Z"),
    );
    expect(nextMonth.fresh).toBe(true);
    expect(nextMonth.awards).toEqual([[15, 1, 1, 1, 5_000]]);
    expect(
      nextMonth.player.taskValues[
        String(makeDailySignUpTaskId(DAILY_SIGN_UP_TODAY_TASK))
      ],
    ).toBe(1);
    expect(
      nextMonth.player.taskValues[
        String(makeDailySignUpTaskId(DAILY_SIGN_UP_TOTAL_TASK))
      ],
    ).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("grants month card daily diamond and energy with the sign-in", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-sign-up-month-"));
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

    const now = Date.parse("2026-07-27T20:00:00Z");
    const nowSeconds = Math.floor(now / 1000);
    await repository.setTaskValues("tester", [
      { id: makeMonthCardTaskId(), value: nowSeconds + 30 * 86_400 },
    ]);

    const first = await repository.signUpDaily("tester", now);
    expect(first.fresh).toBe(true);
    expect(first.awards).toEqual([
      [15, 1, 1, 1, 5_000],
      [15, 2, 1, 1, 50],
      [15, 4, 1, 1, 30],
    ]);
    expect(
      first.player.taskValues[
        String(makeDailySignUpTaskId(DAILY_SIGN_UP_MONTH_DIAMOND_TASK))
      ],
    ).toBe(1);
    expect(
      first.player.taskValues[
        String(makeDailySignUpTaskId(DAILY_SIGN_UP_MONTH_ENERGY_TASK))
      ],
    ).toBe(1);
    expect(first.player.money.find(({ id }) => id === 3)?.count).toBe(50);
    expect(first.player.money.find(({ id }) => id === 1)?.count).toBe(28 + 30);

    // 当天重复签到：不再发任何奖励
    const duplicate = await repository.signUpDaily("tester", now + 3_600_000);
    expect(duplicate.fresh).toBe(false);
    expect(duplicate.awards).toEqual([]);

    // 次日凌晨 4 点后：月卡签到位随 11001 一起重置，可再领
    const nextDay = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-28T20:00:00Z"),
    );
    expect(nextDay.awards).toEqual([
      [10, 1, 1, 2, 1],
      [15, 2, 1, 1, 50],
      [15, 4, 1, 1, 30],
    ]);
    expect(nextDay.player.money.find(({ id }) => id === 3)?.count).toBe(100);
    expect(nextDay.player.money.find(({ id }) => id === 1)?.count).toBe(28 + 60);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("signs the month card part when the card is bought after signing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-sign-up-late-card-"));
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

    const now = Date.parse("2026-07-27T20:00:00Z");
    const signed = await repository.signUpDaily("tester", now);
    expect(signed.awards).toEqual([[15, 1, 1, 1, 5_000]]);

    // 当天先签到、后购卡：再次点签到只补月卡部分
    await repository.claimIBItemFree("tester", 1, now + 3_600_000);
    const late = await repository.signUpDaily("tester", now + 7_200_000);
    expect(late.fresh).toBe(false);
    expect(late.awards).toEqual([
      [15, 2, 1, 1, 50],
      [15, 4, 1, 1, 30],
    ]);
    expect(late.cumulativeCount).toBe(1);
    expect(
      late.player.taskValues[
        String(makeDailySignUpTaskId(DAILY_SIGN_UP_MONTH_DIAMOND_TASK))
      ],
    ).toBe(1);
    expect(
      late.player.taskValues[
        String(makeDailySignUpTaskId(DAILY_SIGN_UP_MONTH_ENERGY_TASK))
      ],
    ).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
