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

async function makeRepository(directory: string): Promise<PlayerRepository> {
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

async function awardWeapon(repository: PlayerRepository) {
  const settlement = await repository.settleLevel(
    "tester",
    1,
    1,
    1,
    3,
    0,
    [[2, 1, 15, 1, 1, 10_000]],
    0,
  );
  return settlement.updatedItems.find(({ genre }) => genre === 2)!;
}

const rarityOf = (gdpl: Gdpl) => (gdpl.join(":") === "2:1:15:1" ? 3 : null);

describe("weapon decomposition persistence", () => {
  it("persists lock state, removes weapons, and grants both currencies atomically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-weapon-decompose-"));
    try {
      const repository = await makeRepository(directory);
      const weapon = await awardWeapon(repository);

      const locked = await repository.setItemLock("tester", weapon.guid, 1);
      expect(locked.item.lockOn).toBe(1);
      await expect(
        repository.decomposeWeapons("tester", [weapon.guid], rarityOf),
      ).rejects.toMatchObject({
        reason: "weapon_locked",
        guid: weapon.guid,
      });
      expect(repository.get("tester")?.inventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ guid: weapon.guid, lockOn: 1 }),
        ]),
      );

      await repository.setItemLock("tester", weapon.guid, 0);
      const result = await repository.decomposeWeapons(
        "tester",
        [weapon.guid],
        rarityOf,
      );

      expect(result.removedWeapons).toMatchObject([
        { guid: weapon.guid, count: 0, lockOn: 0 },
      ]);
      expect(result.gold).toBe(6_000);
      expect(result.itemList).toEqual([[15, 20, 1, 1, 25]]);
      expect(result.updatedMoney).toEqual([
        { id: 2, count: 6_000 },
        { id: 16, count: 25 },
      ]);
      expect(result.updatedItems).toEqual([]);
      expect(repository.get("tester")?.inventory).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ guid: weapon.guid })]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a weapon equipped by any saved formation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-weapon-equipped-"));
    try {
      const repository = await makeRepository(directory);
      const weapon = await awardWeapon(repository);
      const player = repository.get("tester")!;
      const formation = structuredClone(player.formations[0]!);
      formation.fightCards[0]!.weaponGuid = weapon.guid;
      await repository.updateFormation("tester", formation);

      await expect(
        repository.decomposeWeapons("tester", [weapon.guid], rarityOf),
      ).rejects.toMatchObject({
        reason: "weapon_equipped",
        guid: weapon.guid,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
