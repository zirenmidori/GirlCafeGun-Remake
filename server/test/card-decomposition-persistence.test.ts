import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GachaCatalog } from "../src/game-data/gacha-data.js";
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

describe("character card decomposition persistence", () => {
  it("persists lock state, removes the card, and grants gold and tokens atomically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-card-decompose-"));
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
        [[1, 9, 1, 3, 1, 10_000]],
        0,
      );
      const card = settlement.updatedItems.find(
        ({ genre, detail, particular, templateLevel }) =>
          genre === 1 && detail === 9 && particular === 1 && templateLevel === 3,
      )!;
      const catalog = GachaCatalog.loadDefault();

      const locked = await repository.setItemLock("tester", card.guid, 1);
      expect(locked.item.lockOn).toBe(1);
      await expect(
        repository.decomposeCharacterCards("tester", [card.guid], (gdpl) =>
          catalog.rarityOf(gdpl),
        ),
      ).rejects.toMatchObject({
        reason: "card_locked",
        guid: card.guid,
      });
      expect(repository.get("tester")?.inventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ guid: card.guid, lockOn: 1 }),
        ]),
      );

      await repository.setItemLock("tester", card.guid, 0);
      const result = await repository.decomposeCharacterCards(
        "tester",
        [card.guid],
        (gdpl) => catalog.rarityOf(gdpl),
      );

      expect(result.removedCards).toMatchObject([
        { guid: card.guid, count: 0, lockOn: 0 },
      ]);
      expect(result.gold).toBe(6_000);
      expect(result.itemList).toEqual([[15, 11, 1, 1, 40]]);
      expect(result.updatedMoney).toEqual([
        { id: 2, count: 6_000 },
        { id: 10, count: 40 },
      ]);
      expect(result.updatedItems).toEqual([]);
      expect(repository.get("tester")?.inventory).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ guid: card.guid })]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses cards used by a formation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-card-formation-"));
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
      const player = await repository.getOrCreate("tester");
      const formationCard = player.inventory[0]!;
      const catalog = GachaCatalog.loadDefault();

      await expect(
        repository.decomposeCharacterCards("tester", [formationCard.guid], (gdpl) =>
          catalog.rarityOf(gdpl),
        ),
      ).rejects.toMatchObject({
        reason: "card_in_formation",
        guid: formationCard.guid,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
