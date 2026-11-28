import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { characterCardFeedValue } from "../src/game-data/card-decomposition-data.js";
import { parseCardEnhancementRequest } from "../src/game-data/card-enhancement-data.js";
import { CharacterCardCatalog } from "../src/game-data/character-card-template-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
  type InventoryEntryState,
} from "../src/persistence/player-repository.js";
import { mkdtemp } from "./helpers/temp.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

function card(guid: number): InventoryEntryState {
  return {
    guid,
    genre: 1,
    detail: 1,
    particular: 4,
    templateLevel: 3,
    count: 1,
    createTime: 1,
    enhanceLevel: 1,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
  };
}

// UI_CardMain:UpdateSkillItem shows the number of selected copies on the first
// card slot with `card[3] = card[3] + 1`, on the list entry that
// OnBtnClickLevelUp then sends. So with four copies the first card goes out as
// [2, guid, 4] and the others as [2, guid, 1]. A card entry is one card,
// whatever its count says. Request taken from a phone server.log (2026-11-28).
it("awakens with several copies when the client puts the copy total on the first card", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-awaken-copies-"));
  const account = "awaken-copies:local-only";
  try {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const store = new JsonStore({
      filePath: path.join(directory, "state.json"),
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: config.playerDefaults,
      logger,
    });
    await players.getOrCreate(account);
    await store.update((state) => {
      const player = state.players[account]!;
      player.money = [{ id: 2, count: 1_000_000 }];
      player.formations = [];
      player.inventory = [
        card(21658),
        card(20075),
        card(20109),
        card(20346),
        card(20079),
      ];
      player.nextItemGuid = 30_000;
    });

    const request = parseCardEnhancementRequest({
      items: [
        [2, 20075, 4],
        [2, 20109, 1],
        [2, 20346, 1],
        [2, 20079, 1],
      ],
      clientlv: 1,
      clientSkillLv: 4,
      guid: 21658,
    });
    expect(request).not.toBeNull();
    const result = await players.enhanceCard(account, 21658, request!.materials);

    expect(result.addedSkillPoints).toBeGreaterThan(0);
    const inventory = store.snapshot().players[account]!.inventory;
    expect(inventory.map(({ guid }) => guid)).toEqual([21658]);
    // Each copy is paid once: four copies, not seven.
    const template = CharacterCardCatalog.loadDefault().get(card(20075))!;
    const perCopy = characterCardFeedValue(1, template.rarity)!.coinCost;
    expect(result.coinCost).toBe(perCopy * 4);
    expect(store.snapshot().players[account]!.money).toEqual([
      { id: 2, count: 1_000_000 - perCopy * 4 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("still refuses the same card twice in one request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-awaken-copies-"));
  const account = "awaken-copies-dup:local-only";
  try {
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const store = new JsonStore({
      filePath: path.join(directory, "state.json"),
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: config.playerDefaults,
      logger,
    });
    await players.getOrCreate(account);
    await store.update((state) => {
      const player = state.players[account]!;
      player.money = [{ id: 2, count: 1_000_000 }];
      player.formations = [];
      player.inventory = [card(100), card(101)];
    });
    const before = store.snapshot();
    await expect(
      players.enhanceCard(account, 100, [
        { kind: 2, reference: 101, count: 2 },
        { kind: 2, reference: 101, count: 1 },
      ]),
    ).rejects.toThrow(/invalid_material/);
    expect(store.snapshot()).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
