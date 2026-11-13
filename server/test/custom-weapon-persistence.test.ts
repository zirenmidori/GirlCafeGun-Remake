import { rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  PlayerRepository,
  makeInitialState,
  type InventoryEntryState,
} from "../src/persistence/player-repository.js";
import { maximumFormationPower } from "../src/game-data/formation-power-data.js";
import { weaponPassiveSkills } from "../src/game-data/weapon-skill-data.js";
import { grantCustomWeapon } from "../src/tools/grant-custom-weapon.js";
import { loadTestProfileCatalog } from "../src/tools/grant-test-profile.js";
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const defaults = {
  name: "",
  level: 1,
  exp: 0,
  fightPower: 0,
  serverZone: 8,
  firstLevelComplete: false,
};
const account = "custom-weapon-fixture";
function item(
  guid: number,
  particular = 28,
  overrides: Partial<InventoryEntryState> = {},
): InventoryEntryState {
  return {
    guid,
    genre: 2,
    detail: 2,
    particular,
    templateLevel: 1,
    count: 1,
    createTime: 1,
    enhanceLevel: 1,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
    ...overrides,
  };
}
async function fixture(
  run: (
    repository: PlayerRepository,
    store: JsonStore<ReturnType<typeof makeInitialState>>,
    file: string,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(path.resolve("../tools/custom-weapon/server-tests-"));
  try {
    const file = path.join(directory, "state.json");
    const store = new JsonStore({
      filePath: file,
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    const repository = new PlayerRepository({ store, defaults, logger });
    await repository.getOrCreate(account);
    await store.update((state) => {
      const p = state.players[account]!;
      p.inventory = [
        item(100),
        ...Array.from({ length: 10 }, (_, i) => item(101 + i)),
        item(200, 10000),
        item(300, 1, { genre: 7, detail: 3, count: 20, templateLevel: 4 }),
      ];
      p.nextItemGuid = 400;
      p.money = [{ id: 2, count: 2000000 }];
      p.formations = [];
    });
    await run(repository, store, file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
describe("Astral Covenant normal gameplay and narrow grants", () => {
  it("cannot equip a consumed donor tombstone and preserves the last valid formation", async () =>
    fixture(async (repo, store) => {
      await store.update((state) => {
        state.players[account]!.inventory.push(item(500, 1, { genre: 1, detail: 7 }));
      });
      await repo.breakthroughWeapon(account, 100, [{ guid: 101, count: 1 }]);
      const formation = {
        id: 1,
        title: "active weapon",
        fightCards: [
          {
            mainCardGuid: 500,
            usedCardGuid: 500,
            secondaryCardGuids: [],
            weaponGuid: 100,
            runeItemGuids: [],
          },
        ],
      };
      const valid = await repo.updateFormation(account, formation);
      expect(valid.formations[0]?.fightCards[0]?.weaponGuid).toBe(100);
      const before = store.snapshot();
      await expect(
        repo.updateFormation(account, {
          ...formation,
          fightCards: [{ ...formation.fightCards[0]!, weaponGuid: 101 }],
        }),
      ).rejects.toThrow(/unknown equipment/);
      expect(store.snapshot()).toEqual(before);
    }));

  it("breaks through each exact stage, pays once, survives reload, then rejects cap/consumed replay atomically", async () =>
    fixture(async (repo, store, file) => {
      let next = 101;
      for (let level = 1; level <= 4; level++) {
        const materials = Array.from({ length: level }, () => ({
          guid: next++,
          count: 1,
        }));
        const result = await repo.breakthroughWeapon(account, 100, materials);
        expect(result.weapon.breakLevel).toBe(level);
        expect(result.coinCost).toBe(50000 * level);
        expect(result.consumedItems.every((donor) => donor.count === 0)).toBe(true);
        expect(
          weaponPassiveSkills(2, 2, 28, 1, result.weapon.breakLevel)[0]?.skillLevel,
        ).toBe(level + 1);
        const before = store.snapshot();
        await expect(
          repo.breakthroughWeapon(account, 100, materials),
        ).rejects.toThrow();
        expect(store.snapshot()).toEqual(before);
      }
      expect(repo.get(account)?.money).toEqual([{ id: 2, count: 1500000 }]);
      const reloaded = new JsonStore({
        filePath: file,
        initialState: makeInitialState(),
        logger,
      });
      await reloaded.initialize();
      const repo2 = new PlayerRepository({ store: reloaded, defaults, logger });
      expect(
        repo2.get(account)?.inventory.find((entry) => entry.guid === 100)?.breakLevel,
      ).toBe(4);
      const before = reloaded.snapshot();
      await expect(
        repo2.breakthroughWeapon(account, 100, [{ guid: 200, count: 4 }]),
      ).rejects.toThrow();
      expect(reloaded.snapshot()).toEqual(before);
    }));
  it.each([
    "self",
    "wrong_template",
    "locked",
    "equipped",
    "insufficient_money",
    "wrong_count",
    "negative",
    "duplicate",
  ])("rolls back invalid breakthrough: %s", async (reason) =>
    fixture(async (repo, store) => {
      let materials = [{ guid: 101, count: 1 }];
      await store.update((state) => {
        const p = state.players[account]!;
        if (reason === "self") materials = [{ guid: 100, count: 1 }];
        if (reason === "wrong_template")
          p.inventory.find((entry) => entry.guid === 101)!.particular = 4;
        if (reason === "locked")
          p.inventory.find((entry) => entry.guid === 101)!.lockOn = 1;
        if (reason === "equipped")
          p.formations = [
            {
              id: 1,
              title: "",
              fightCards: [
                {
                  mainCardGuid: 0,
                  usedCardGuid: 0,
                  secondaryCardGuids: [],
                  weaponGuid: 101,
                  runeItemGuids: [],
                },
              ],
            },
          ];
        if (reason === "insufficient_money") p.money = [];
        if (reason === "wrong_count") materials = [{ guid: 101, count: 2 }];
        if (reason === "negative") materials = [{ guid: 101, count: -1 }];
        if (reason === "duplicate")
          materials = [
            { guid: 101, count: 1 },
            { guid: 101, count: 1 },
          ];
      });
      const before = store.snapshot();
      await expect(repo.breakthroughWeapon(account, 100, materials)).rejects.toThrow();
      expect(store.snapshot()).toEqual(before);
    }),
  );
  it("accepts the actual four-star material, enhances despite missing gacha rarity, and decomposes at four-star value", async () =>
    fixture(async (repo) => {
      await repo.breakthroughWeapon(account, 100, [{ guid: 200, count: 1 }]);
      const result = await repo.enhanceWeapon(
        account,
        100,
        [{ guid: 300, count: 1 }],
        () => null,
      );
      expect(result.weapon.enhanceLevel).toBeGreaterThan(1);
      expect(result.weapon.breakLevel).toBe(1);
      const decomposed = await repo.decomposeWeapons(account, [100], () => null);
      expect(decomposed.itemList).toEqual([[15, 20, 1, 1, 250]]);
      expect(decomposed.removedWeapons[0]?.count).toBe(0);
    }));
  it("uses the same four-star formation weight as the donor; old entries remain unchanged by repeat narrow grants", async () =>
    fixture(async (repo) => {
      const source = repo.get(account)!;
      const card = item(999, 1, { genre: 1, detail: 7 });
      const formation = {
        id: 1,
        title: "",
        fightCards: [
          {
            mainCardGuid: 999,
            usedCardGuid: 999,
            secondaryCardGuids: [],
            weaponGuid: 100,
            runeItemGuids: [],
          },
        ],
      };
      const p = { ...source, inventory: [card, item(100)], formations: [formation] };
      const donor = { ...p, inventory: [card, item(100, 4)] };
      expect(maximumFormationPower(p)).toBe(maximumFormationPower(donor));
      const before = structuredClone(source);
      const granted = grantCustomWeapon(source, "astral-covenant", 13, 100);
      expect(source).toEqual(before);
      expect(granted.inventory.slice(0, source.inventory.length)).toEqual(
        source.inventory,
      );
      expect(granted.formations).toEqual(source.formations);
      expect(granted.taskValues).toEqual(source.taskValues);
      expect(granted.money).toEqual(source.money);
      expect(grantCustomWeapon(granted, "astral-covenant", 13, 200)).toEqual(granted);
      expect(new Set(granted.inventory.map((entry) => entry.guid)).size).toBe(
        granted.inventory.length,
      );
      const catalog = loadTestProfileCatalog();
      expect(catalog.instanceTemplates).toHaveLength(499);
      expect(
        catalog.instanceTemplates.filter(
          (entry) => entry.gdpl.join(":") === "2:2:28:1",
        ),
      ).toEqual([expect.objectContaining({ maxLevel: 80, maxBreakLevel: 4 })]);
    }));
});
