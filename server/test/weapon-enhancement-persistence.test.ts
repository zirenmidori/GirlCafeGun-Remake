import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { Gdpl } from "../src/game-data/gacha-data.js";
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

describe("weapon enhancement persistence", () => {
  it("atomically consumes the selected material, gold, and updates the weapon", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-weapon-enhance-"));
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
      const seeded = await repository.settleLevel(
        "tester",
        1,
        1,
        1,
        3,
        0,
        [
          [15, 1, 1, 1, 2_000, 0],
          [7, 3, 1, 1, 2, 100],
          [2, 1, 15, 1, 1, 100],
        ],
        0,
      );
      const material = seeded.player.inventory.find(
        ({ genre, detail }) => genre === 7 && detail === 3,
      )!;
      const weapon = seeded.player.inventory.find(({ genre }) => genre === 2)!;
      const rarityOf = (gdpl: Gdpl) => (gdpl.join(":") === "2:1:15:1" ? 3 : null);

      const result = await repository.enhanceWeapon(
        "tester",
        weapon.guid,
        [{ guid: material.guid, count: 1 }],
        rarityOf,
      );

      expect(result.weapon).toMatchObject({
        guid: weapon.guid,
        enhanceLevel: 3,
        enhanceExp: 180,
      });
      expect(result.consumedItems).toMatchObject([{ guid: material.guid, count: 1 }]);
      expect(result.addedExperience).toBe(500);
      expect(result.coinCost).toBe(500);
      expect(result.updatedMoney).toEqual([{ id: 2, count: 1_500 }]);
      expect(repository.get("tester")?.inventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            guid: weapon.guid,
            enhanceLevel: 3,
            enhanceExp: 180,
          }),
          expect.objectContaining({ guid: material.guid, count: 1 }),
        ]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
