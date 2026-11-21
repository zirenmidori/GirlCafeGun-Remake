import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CardBreakError } from "../src/game-data/card-break-data.js";
import {
  CardEnhancementError,
  CARD_EXP_MATERIALS,
} from "../src/game-data/card-enhancement-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  InsufficientGoldError,
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

const account = "tester";
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function entry(
  guid: number,
  genre: number,
  detail: number,
  particular: number,
  templateLevel: number,
  count = 1,
  overrides: Partial<InventoryEntryState> = {},
): InventoryEntryState {
  return {
    guid,
    genre,
    detail,
    particular,
    templateLevel,
    count,
    createTime: 1,
    enhanceLevel: genre === 1 ? 1 : 0,
    enhanceExp: 0,
    breakLevel: 0,
    lockOn: 0,
    ...overrides,
  };
}

/** Card 100 is the target: girl 1, P=1, L=1 (1 star, break type 21, three skills). */
const target = (overrides: Partial<InventoryEntryState> = {}) =>
  entry(100, 1, 1, 1, 1, 1, overrides);
const sameCard = (guid: number, overrides: Partial<InventoryEntryState> = {}) =>
  entry(guid, 1, 1, 1, 1, 1, overrides);
/** A different 2 star card of girl 1. */
const otherCard = (guid: number, overrides: Partial<InventoryEntryState> = {}) =>
  entry(guid, 1, 1, 2, 2, 1, overrides);

async function fixture(inventory: InventoryEntryState[], gold = 1_000_000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-card-awaken-"));
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
  await repository.getOrCreate(account);
  await store.update((state) => {
    const player = state.players[account]!;
    player.inventory = inventory;
    player.formations = [];
    player.money = [{ id: 2, count: gold }];
    player.nextItemGuid = 1_000;
  });
  return { store, repository };
}

function inventoryOf(repository: PlayerRepository, guid: number) {
  return repository
    .get(account)!
    .inventory.find((candidate) => candidate.guid === guid)!;
}

function hasItem(repository: PlayerRepository, guid: number): boolean {
  return repository
    .get(account)!
    .inventory.some((candidate) => candidate.guid === guid);
}

describe("card awakening with materials", () => {
  it("removes a same-card duplicate and raises skills by 3 points plus its own levels", async () => {
    const { repository } = await fixture([
      target(),
      sameCard(101, { cardSkillLevels: [2, 1, 1, 1] }),
    ]);

    const result = await repository.enhanceCard(
      account,
      100,
      [{ kind: 2, reference: 101, count: 1 }],
      () => 0,
    );

    expect(result.addedSkillPoints).toBe(4);
    expect(result.addedExperience).toBe(0);
    expect(result.card).toMatchObject({
      guid: 100,
      enhanceLevel: 1,
      cardSkillLevels: [4, 2, 1, 1],
    });
    expect(result.consumedItems).toMatchObject([{ guid: 101, count: 0 }]);
    expect(result.coinCost).toBe(500);
    expect(result.updatedMoney).toEqual([{ id: 2, count: 999_500 }]);
    // The consumed copy leaves the save, so it no longer counts as owned.
    expect(hasItem(repository, 101)).toBe(false);
  });

  it("adds experience for a different card and removes it", async () => {
    const { repository } = await fixture([target(), otherCard(102)]);

    const result = await repository.enhanceCard(account, 100, [
      { kind: 2, reference: 102, count: 1 },
    ]);

    expect(result.addedExperience).toBe(2_000);
    expect(result.addedSkillPoints).toBe(0);
    expect(result.card).toMatchObject({ enhanceLevel: 6, enhanceExp: 449 });
    expect(result.card.cardSkillLevels).toBeUndefined();
    expect(result.coinCost).toBe(2_000);
    expect(result.consumedItems).toMatchObject([{ guid: 102, count: 0 }]);
  });

  it("spends skill item 25 for one skill point each", async () => {
    const { repository } = await fixture([target(), entry(110, 7, 4, 1, 3, 2)]);

    const result = await repository.enhanceCard(
      account,
      100,
      [{ kind: 1, reference: 25, count: 2 }],
      () => 0,
    );

    expect(result.addedSkillPoints).toBe(2);
    expect(result.card.cardSkillLevels).toEqual([3, 1, 1, 1]);
    expect(result.consumedItems).toMatchObject([{ guid: 110, count: 0 }]);
    expect(result.coinCost).toBe(3_000);
  });

  it("spends skill item 26 from its own stack", async () => {
    const { repository } = await fixture([
      target(),
      entry(110, 7, 4, 1, 3, 1),
      entry(111, 7, 4, 1, 4, 1),
    ]);

    const result = await repository.enhanceCard(
      account,
      100,
      [{ kind: 1, reference: 26, count: 1 }],
      () => 0,
    );

    expect(result.consumedItems).toMatchObject([{ guid: 111, count: 0 }]);
    expect(result.coinCost).toBe(3_500);
    expect(inventoryOf(repository, 110).count).toBe(1);
  });

  it("keeps the card level, and adds no experience, when the card is above its cap", async () => {
    const { repository } = await fixture([
      target({ enhanceLevel: 50, enhanceExp: 9 }),
      sameCard(101),
      entry(120, 7, 1, 1, 1, 1),
    ]);

    const awakened = await repository.enhanceCard(
      account,
      100,
      [{ kind: 2, reference: 101, count: 1 }],
      () => 0,
    );
    expect(awakened.card).toMatchObject({
      enhanceLevel: 50,
      enhanceExp: 9,
      cardSkillLevels: [4, 1, 1, 1],
    });

    const before = repository.get(account);
    await expect(
      repository.enhanceCard(account, 100, [{ kind: 1, reference: 1, count: 1 }]),
    ).rejects.toMatchObject({ reason: "level_cap" });
    expect(repository.get(account)).toEqual(before);
  });

  it("stops experience at level 40 until the card is broken", async () => {
    const { repository } = await fixture([target(), entry(130, 7, 1, 1, 4, 3)]);
    expect(CARD_EXP_MATERIALS.get(19)).toMatchObject({
      particular: 1,
      templateLevel: 4,
    });

    const result = await repository.enhanceCard(account, 100, [
      { kind: 1, reference: 19, count: 3 },
    ]);

    expect(result.card.enhanceLevel).toBe(40);
  });
});

describe("refused card awakening", () => {
  async function expectRefusal(
    inventory: InventoryEntryState[],
    materials: { kind: number; reference: number; count: number }[],
    reason: string,
    errorKey: string,
    formation = false,
  ) {
    const { store, repository } = await fixture(inventory);
    if (formation)
      await store.update((state) => {
        state.players[account]!.formations = [
          {
            id: 1,
            title: "",
            fightCards: [
              {
                mainCardGuid: 100,
                secondaryCardGuids: [101],
                usedCardGuid: 0,
                weaponGuid: 0,
                runeItemGuids: [],
              },
            ],
          },
        ];
      });
    const before = store.snapshot();
    const error = await repository.enhanceCard(account, 100, materials).catch((e) => e);
    expect(error).toBeInstanceOf(CardEnhancementError);
    expect(error).toMatchObject({ reason, errorKey });
    expect(store.snapshot()).toEqual(before);
  }

  it("refuses a locked donor", async () => {
    await expectRefusal(
      [target(), sameCard(101, { lockOn: 1 })],
      [{ kind: 2, reference: 101, count: 1 }],
      "card_locked",
      "Card.Tip02",
    );
  });

  it("refuses a donor that stands in a formation", async () => {
    await expectRefusal(
      [target(), sameCard(101)],
      [{ kind: 2, reference: 101, count: 1 }],
      "card_in_formation",
      "Card.Tip01",
      true,
    );
  });

  it("refuses the target itself, an oath card and an unknown card as material", async () => {
    await expectRefusal(
      [target()],
      [{ kind: 2, reference: 100, count: 1 }],
      "invalid_material",
      "UI_WeaponStrong.NotEnough",
    );
    await expectRefusal(
      [target(), entry(101, 1, 1, 17, 3)],
      [{ kind: 2, reference: 101, count: 1 }],
      "invalid_material",
      "UI_WeaponStrong.NotEnough",
    );
    await expectRefusal(
      [target()],
      [{ kind: 2, reference: 999, count: 1 }],
      "invalid_material",
      "UI_WeaponStrong.NotEnough",
    );
  });

  it("refuses a skill material when every skill is already at level 4", async () => {
    await expectRefusal(
      [
        target({ cardSkillLevels: [4, 4, 1, 4] }),
        sameCard(101),
        entry(110, 7, 4, 1, 3, 1),
      ],
      [{ kind: 2, reference: 101, count: 1 }],
      "skill_maxed",
      "UI_Card.fullskill",
    );
    await expectRefusal(
      [target({ cardSkillLevels: [4, 4, 1, 4] }), entry(110, 7, 4, 1, 3, 1)],
      [{ kind: 1, reference: 25, count: 1 }],
      "skill_maxed",
      "UI_Card.fullskill",
    );
  });

  it("refuses a missing material and an unsupported material kind", async () => {
    await expectRefusal(
      [target()],
      [{ kind: 1, reference: 25, count: 1 }],
      "insufficient_material",
      "UI_WeaponStrong.NotEnough",
    );
    await expectRefusal(
      [target()],
      [{ kind: 3, reference: 25, count: 1 }],
      "unsupported_material_kind",
      "UI_WeaponStrong.NotEnough",
    );
  });

  it("still reports missing gold as insufficient gold", async () => {
    const { repository } = await fixture([target(), otherCard(102)], 10);
    await expect(
      repository.enhanceCard(account, 100, [{ kind: 2, reference: 102, count: 1 }]),
    ).rejects.toBeInstanceOf(InsufficientGoldError);
    expect(inventoryOf(repository, 102).count).toBe(1);
  });
});

describe("card break", () => {
  const breakItems = () => [entry(140, 7, 2, 3, 1, 5), entry(141, 7, 2, 3, 2, 3)];

  it("takes the step items and gold, raises the break level and the level cap", async () => {
    const { repository } = await fixture([target(), ...breakItems()], 30_000);

    const result = await repository.breakCard(account, 100);

    expect(result.card).toMatchObject({ guid: 100, breakLevel: 1 });
    expect(result.coinCost).toBe(20_000);
    expect(result.updatedMoney).toEqual([{ id: 2, count: 10_000 }]);
    expect(result.consumedItems).toMatchObject([
      { guid: 140, count: 2 },
      { guid: 141, count: 0 },
    ]);
    expect(inventoryOf(repository, 100).breakLevel).toBe(1);
  });

  it("raises the level cap from 40 to 50", async () => {
    const { store, repository } = await fixture([
      target(),
      entry(130, 7, 1, 1, 4, 6),
      ...breakItems(),
    ]);
    const first = await repository.enhanceCard(account, 100, [
      { kind: 1, reference: 19, count: 3 },
    ]);
    expect(first.card.enhanceLevel).toBe(40);
    await expect(
      repository.enhanceCard(account, 100, [{ kind: 1, reference: 19, count: 1 }]),
    ).rejects.toMatchObject({ reason: "level_cap" });

    await repository.breakCard(account, 100);
    const second = await repository.enhanceCard(account, 100, [
      { kind: 1, reference: 19, count: 3 },
    ]);
    expect(second.card.enhanceLevel).toBe(50);
    expect(second.card.breakLevel).toBe(1);
    expect(store.snapshot().players[account]!.money[0]!.count).toBeLessThan(1_000_000);
  });

  it("changes nothing without the items, without the gold and past the last step", async () => {
    for (const [inventory, gold, reason] of [
      [[target(), entry(140, 7, 2, 3, 1, 5)], 1_000_000, "insufficient_items"],
      [[target(), ...breakItems()], 19_999, "insufficient_money"],
      [[target({ breakLevel: 3 }), ...breakItems()], 1_000_000, "maximum_break"],
      [[...breakItems()], 1_000_000, "card_not_owned"],
      [[entry(100, 1, 1, 17, 3), ...breakItems()], 1_000_000, "card_not_owned"],
    ] as const) {
      const { store, repository } = await fixture([...inventory], gold);
      const before = store.snapshot();
      const error = await repository.breakCard(account, 100).catch((e) => e);
      expect(error).toBeInstanceOf(CardBreakError);
      expect(error).toMatchObject({ reason });
      expect(store.snapshot()).toEqual(before);
    }
  });

  it("takes the items from several stacks", async () => {
    const { repository } = await fixture([
      target(),
      entry(140, 7, 2, 3, 1, 2),
      entry(142, 7, 2, 3, 1, 2),
      entry(141, 7, 2, 3, 2, 3),
    ]);
    const result = await repository.breakCard(account, 100);
    expect(result.consumedItems.map(({ guid, count }) => [guid, count])).toEqual([
      [140, 0],
      [142, 1],
      [141, 0],
    ]);
  });
});
