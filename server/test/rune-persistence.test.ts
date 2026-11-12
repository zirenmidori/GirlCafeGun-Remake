import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

describe("rune persistence", () => {
  it("initializes runes at level 1 and rejects a rune in the wrong slot", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-rune-"));
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
      const settlement = await repository.settleLevel(
        "tester",
        1,
        1,
        1,
        3,
        0,
        [[3, 4, 2, 5, 1, 100]],
        0,
      );
      const shield = settlement.player.inventory.find(({ genre }) => genre === 3)!;
      expect(shield).toMatchObject({ detail: 4, enhanceLevel: 1 });

      const card = settlement.player.inventory.find(({ genre }) => genre === 1)!;
      await expect(
        repository.updateFormation("tester", {
          id: 2,
          title: "invalid",
          fightCards: [
            {
              mainCardGuid: card.guid,
              secondaryCardGuids: [],
              usedCardGuid: 0,
              weaponGuid: 0,
              runeItemGuids: [0, shield.guid, 0, 0],
            },
          ],
        }),
      ).rejects.toThrow(/incompatible with slot 1/);

      const equipped = await repository.updateFormation("tester", {
        id: 2,
        title: "valid",
        fightCards: [
          {
            mainCardGuid: card.guid,
            secondaryCardGuids: [],
            usedCardGuid: 0,
            weaponGuid: 0,
            runeItemGuids: [0, 0, 0, shield.guid],
          },
        ],
      });
      expect(equipped.formations.at(-1)?.fightCards[0]?.runeItemGuids).toEqual([
        0,
        0,
        0,
        shield.guid,
      ]);

      await store.update((state) => {
        const player = state.players.tester!;
        player.inventory.find(({ guid }) => guid === shield.guid)!.enhanceLevel = 0;
        player.formations.at(-1)!.fightCards[0]!.runeItemGuids = [shield.guid];
      });
      const migrated = await repository.getOrCreate("tester");
      expect(
        migrated.inventory.find(({ guid }) => guid === shield.guid)?.enhanceLevel,
      ).toBe(1);
      expect(migrated.formations.at(-1)?.fightCards[0]?.runeItemGuids).toEqual([
        0,
        0,
        0,
        shield.guid,
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
