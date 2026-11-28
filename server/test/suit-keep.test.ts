import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getBountyLevel, rollBountyRun } from "../src/game-data/bounty-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
  suitTaskId,
  type PersistedState,
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

// Pack 1007 of the dress shop: costume item [19, 1, 7, 4] = girl 11, model 7001.
const PACK = 1007;
const GIRL = 11;
const SUIT_MODEL = 7001;

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-suit-keep-"));
  directories.push(directory);
  const store = new JsonStore<PersistedState>({
    filePath: path.join(directory, "state.json"),
    initialState: makeInitialState(),
    logger,
  });
  await store.initialize();
  const repository = new PlayerRepository({
    store,
    defaults: {
      name: "",
      level: 40,
      exp: 0,
      fightPower: 0,
      serverZone: 8,
      firstLevelComplete: false,
    },
    logger,
  });
  await repository.getOrCreate("tester");
  await store.update((state) => {
    const player = state.players.tester!;
    // The girl's stock card (model 1) and enough Diamonds and vigour.
    player.inventory.push({
      guid: 900_001,
      genre: 1,
      detail: GIRL,
      particular: 1,
      templateLevel: 1,
      count: 1,
      createTime: 0,
      enhanceLevel: 0,
      enhanceExp: 0,
      breakLevel: 0,
      lockOn: 0,
    });
    player.girls.push({
      girlId: GIRL,
      level: 1,
      exp: 0,
      modelId: 1,
      moodValue: 100,
      vigor: 100,
      flag: 0,
    });
    player.money = player.money.filter(({ id }) => id !== 1 && id !== 3);
    player.money.push({ id: 1, count: 500 }, { id: 3, count: 500 });
  });
  return { repository, store };
}

describe("a costume bought as an item stays on after a battle", () => {
  it("keeps the worn suit model when a bounty settlement grants rewards", async () => {
    const { repository, store } = await fixture();
    await repository.buyCostumePack("tester", PACK);
    expect(
      store.snapshot().players.tester!.taskValues[String(suitTaskId(GIRL, SUIT_MODEL))],
    ).toBeGreaterThan(0);
    const worn = await repository.changeGirlClothes("tester", GIRL, SUIT_MODEL);
    expect(worn.girl.modelId).toBe(SUIT_MODEL);

    const level = getBountyLevel(1, 1)!;
    const run = rollBountyRun(level, "suit-keep", 2);
    const settled = await repository.settleBounty(
      "tester",
      level,
      run.awards,
      run.dailyBonusApplied,
      null,
    );

    expect(settled.player.girls.find(({ girlId }) => girlId === GIRL)?.modelId).toBe(
      SUIT_MODEL,
    );
    expect(settled.updatedGirls.map(({ girlId }) => girlId)).not.toContain(GIRL);
  });

  it("still resets a model that neither a card nor a suit task owns", async () => {
    const { repository, store } = await fixture();
    await store.update((state) => {
      const girl = state.players.tester!.girls.find(({ girlId }) => girlId === GIRL)!;
      girl.modelId = SUIT_MODEL; // never bought: suit task is 0
    });
    const level = getBountyLevel(1, 1)!;
    const run = rollBountyRun(level, "suit-reset", 2);
    const settled = await repository.settleBounty(
      "tester",
      level,
      run.awards,
      run.dailyBonusApplied,
      null,
    );
    expect(settled.player.girls.find(({ girlId }) => girlId === GIRL)?.modelId).toBe(1);
  });
});
