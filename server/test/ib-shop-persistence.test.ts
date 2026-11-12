import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FREE_GIFT_PACK_AWARD,
  FREE_GIFT_PACK_ID,
  makeIBItemTaskId,
  makeIBShopTaskId,
  makeMonthCardTaskId,
  MONTH_CARD_DAYS,
  MONTH_CARD_DIAMONDS,
  MONTH_CARD_ITEM_ID,
  MONTH_CARD_LIMIT_DAYS,
} from "../src/game-data/ib-shop-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  IBShopError,
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

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createRepository(): Promise<PlayerRepository> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-ib-shop-"));
  directories.push(directory);
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
  return repository;
}

const NOW = new Date("2026-08-16T12:00:00+08:00").getTime();
const NEXT_DAY = new Date("2026-08-17T12:00:00+08:00").getTime();

describe("ib shop free pack persistence", () => {
  it("grants the pack item and records the purchase count", async () => {
    const repository = await createRepository();
    const result = await repository.claimIBShopFreePack("tester", NOW);
    expect(result.purchaseCount).toBe(1);
    expect(result.item.genre).toBe(FREE_GIFT_PACK_AWARD[0]);
    expect(result.item.detail).toBe(FREE_GIFT_PACK_AWARD[1]);
    expect(result.item.particular).toBe(FREE_GIFT_PACK_AWARD[2]);
    expect(result.item.templateLevel).toBe(FREE_GIFT_PACK_AWARD[3]);
    expect(result.item.count).toBe(FREE_GIFT_PACK_AWARD[4]);
    const taskId = String(makeIBShopTaskId(FREE_GIFT_PACK_ID));
    expect(result.player.taskValues[taskId]).toBe(1);
  });

  it("rejects a second claim on the same operational day", async () => {
    const repository = await createRepository();
    await repository.claimIBShopFreePack("tester", NOW);
    await expect(repository.claimIBShopFreePack("tester", NOW)).rejects.toThrow(
      IBShopError,
    );
    await repository.claimIBShopFreePack("tester", NOW).catch((error: unknown) => {
      expect(error).toBeInstanceOf(IBShopError);
      expect((error as IBShopError).reason).toBe("limit_reached");
      expect((error as IBShopError).clientError).toBe(20075);
    });
  });

  it("resets the purchase count on the next operational day", async () => {
    const repository = await createRepository();
    await repository.claimIBShopFreePack("tester", NOW);
    const result = await repository.claimIBShopFreePack("tester", NEXT_DAY);
    expect(result.purchaseCount).toBe(1);
    const taskId = String(makeIBShopTaskId(FREE_GIFT_PACK_ID));
    expect(result.player.taskValues[taskId]).toBe(1);
    const boxes = result.player.inventory.filter(
      ({ genre, detail, particular }) =>
        genre === FREE_GIFT_PACK_AWARD[0] &&
        detail === FREE_GIFT_PACK_AWARD[1] &&
        particular === FREE_GIFT_PACK_AWARD[2],
    );
    expect(boxes.reduce((total, { count }) => total + count, 0)).toBe(2);
  });

  it("fails for an unknown account", async () => {
    const repository = await createRepository();
    await expect(repository.claimIBShopFreePack("nobody", NOW)).rejects.toThrow(
      "Unknown player account: nobody",
    );
  });
});

describe("ib item month card persistence", () => {
  const monthTaskId = String(makeMonthCardTaskId());

  it("grants diamonds, extends the month card and counts the purchase", async () => {
    const repository = await createRepository();
    const result = await repository.claimIBItemFree("tester", MONTH_CARD_ITEM_ID, NOW);
    expect(result.purchaseCount).toBe(1);
    expect(result.diamonds).toBe(MONTH_CARD_DIAMONDS);
    const diamond = result.updatedMoney.find(({ id }) => id === 3);
    expect(diamond?.count).toBe(MONTH_CARD_DIAMONDS);
    const nowSeconds = Math.floor(NOW / 1000);
    expect(result.monthCardEndTime).toBe(nowSeconds + MONTH_CARD_DAYS * 86_400);
    expect(result.player.taskValues[monthTaskId]).toBe(result.monthCardEndTime);
    expect(result.player.taskValues[String(makeIBItemTaskId(MONTH_CARD_ITEM_ID))]).toBe(
      1,
    );
  });

  it("extends from the current end time when the card is still active", async () => {
    const repository = await createRepository();
    const first = await repository.claimIBItemFree("tester", MONTH_CARD_ITEM_ID, NOW);
    const second = await repository.claimIBItemFree(
      "tester",
      MONTH_CARD_ITEM_ID,
      NOW + 3_600_000,
    );
    expect(second.purchaseCount).toBe(2);
    expect(second.monthCardEndTime).toBe(
      first.monthCardEndTime + MONTH_CARD_DAYS * 86_400,
    );
    const diamond = second.player.money.find(({ id }) => id === 3);
    expect(diamond?.count).toBe(MONTH_CARD_DIAMONDS * 2);
  });

  it("caps the month card end time at the 330 day limit", async () => {
    const repository = await createRepository();
    const nowSeconds = Math.floor(NOW / 1000);
    const nearCap = nowSeconds + (MONTH_CARD_LIMIT_DAYS - 5) * 86_400;
    await repository.setTaskValues("tester", [
      { id: makeMonthCardTaskId(), value: nearCap },
    ]);
    const result = await repository.claimIBItemFree("tester", MONTH_CARD_ITEM_ID, NOW);
    expect(result.monthCardEndTime).toBe(nowSeconds + MONTH_CARD_LIMIT_DAYS * 86_400);
  });

  it("rejects unknown ib items", async () => {
    const repository = await createRepository();
    await expect(repository.claimIBItemFree("tester", 999, NOW)).rejects.toThrow(
      IBShopError,
    );
    await repository.claimIBItemFree("tester", 999, NOW).catch((error: unknown) => {
      expect((error as IBShopError).reason).toBe("unknown_item");
      expect((error as IBShopError).clientError).toBe(20074);
    });
  });
});
