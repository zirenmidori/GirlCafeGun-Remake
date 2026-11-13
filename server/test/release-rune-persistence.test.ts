import { mkdir, readFile, rm } from "node:fs/promises";
import { mkdtemp } from "./helpers/temp.js";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
  type InventoryEntryState,
} from "../src/persistence/player-repository.js";
import {
  runeItemSkills,
  runeProgressionCatalog,
} from "../src/game-data/rune-progression-data.js";
import { WELCOME_CAMPAIGN } from "../src/game-data/mail-data.js";
import { cardRarityOf } from "../src/game-data/custom-card-data.js";
import { weaponPassiveSkills } from "../src/game-data/weapon-skill-data.js";
import { makeItemUpdateNotification } from "../src/protocol/messages.js";
import { decodeFields, firstBytes, firstNumber } from "../src/protocol/protobuf.js";

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
const account = "release-fixture";
const catalog = runeProgressionCatalog();
const rune = (level = 1): InventoryEntryState => ({
  guid: 100,
  genre: 3,
  detail: 1,
  particular: 4,
  templateLevel: 1,
  count: 1,
  createTime: 1,
  enhanceLevel: level,
  enhanceExp: 0,
  breakLevel: 0,
  lockOn: 0,
});

async function fixture(
  run: (ctx: {
    store: JsonStore<ReturnType<typeof makeInitialState>>;
    repository: PlayerRepository;
    file: string;
    reopen: () => Promise<PlayerRepository>;
  }) => Promise<void>,
  welcomeGifts = false,
) {
  const dir = await mkdtemp(path.resolve("../release/work/server-tests-"));
  const file = path.join(dir, "state.json");
  const make = async () => {
    const store = new JsonStore({
      filePath: file,
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    return {
      store,
      repository: new PlayerRepository({ store, defaults, logger, welcomeGifts }),
    };
  };
  try {
    const ctx = await make();
    await ctx.repository.getOrCreate(account);
    await run({ ...ctx, file, reopen: async () => (await make()).repository });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedRune(
  store: JsonStore<ReturnType<typeof makeInitialState>>,
  level = 1,
) {
  await store.update((state) => {
    const p = state.players[account]!;
    p.inventory = [rune(level)];
    p.formations = [];
    p.money = [
      { id: 2, count: 10_000_000 },
      { id: 16, count: 1000 },
    ];
  });
}

describe("release welcome and custom ownership", () => {
  it("claims each base-level gift once, projects Neptune immediately, and never reseeds deleted mail", async () => {
    await fixture(async ({ repository, store, reopen }) => {
      let p = repository.get(account)!;
      expect(p.inventory.some((i) => i.detail === 27)).toBe(false);
      expect(p.girls.some((g) => g.girlId === 27)).toBe(false);
      expect(p.mail?.deliveredCampaigns).toEqual([WELCOME_CAMPAIGN]);
      const id = p.mail!.messages[0]!.id;
      const result = await repository.updateMailbox(
        account,
        { kind: "claim", ids: [id], autoDelete: true },
        [],
      );
      expect(result.updatedGirls.map((g) => g.girlId)).toContain(27);
      expect(result.taskValuesChanged).toBe(true);
      expect(result.updatedItems).toHaveLength(2);
      for (const gift of result.updatedItems)
        expect(gift).toMatchObject({
          count: 1,
          enhanceLevel: 1,
          breakLevel: 0,
          enhanceExp: 0,
        });
      expect(cardRarityOf([1, 27, 1, 1], () => 1)).toBe(4);
      expect(weaponPassiveSkills(2, 2, 28, 1, 0)[0]?.skillId).toBe(40992);
      await repository.changeGirlClothes(account, 27, 9103);
      await repository.setGirlFightModel(account, 27, true);
      await expect(repository.changeGirlClothes(account, 7, 9103)).rejects.toThrow();
      const reloaded = await reopen();
      p = await reloaded.getOrCreate(account);
      expect(p.mail?.messages).toHaveLength(0);
      expect(p.inventory.filter((i) => i.genre === 1 && i.detail === 27)).toHaveLength(
        1,
      );
      expect(
        (
          await reloaded.updateMailbox(
            account,
            { kind: "claim", ids: [id], autoDelete: false },
            [],
          )
        ).updatedItems,
      ).toHaveLength(0);
      await store.update((state) => {
        state.players[account]!.inventory.find((i) => i.detail === 27)!.count = 0;
      });
      await expect(repository.setGirlFightModel(account, 27, true)).rejects.toThrow(
        /card is required/,
      );
    }, true);
  });
  it("does not issue welcome gifts in the generic development configuration", async () => {
    await fixture(async ({ repository }) => {
      expect(repository.get(account)!.mail).toBeUndefined();
    });
  });
});

describe("MOD progression transactions", () => {
  it("uses the four rarity costs and the real chapter gates; unlocks three persistent distinct skills", async () => {
    expect(catalog.data.costs[1]).toEqual([500, 750, 1250, 2500]);
    await fixture(async ({ store, repository, reopen, file }) => {
      await seedRune(store);
      for (let target = 2; target <= 5; target++)
        await repository.handleRuneRequest(account, 31, { nGuid: 100 }, () => 0);
      let p = repository.get(account)!;
      expect(p.inventory[0]!.runeSkills).toHaveLength(1);
      const before = await readFile(file);
      await expect(
        repository.handleRuneRequest(account, 31, { nGuid: 100 }),
      ).rejects.toThrow(/maximum_level/);
      expect(await readFile(file)).toEqual(before);
      await store.update((state) => {
        state.players[account]!.levels.push({ id: (5 << 16) | (12 << 8) | 1, star: 1 });
      });
      for (let target = 6; target <= 10; target++)
        await repository.handleRuneRequest(account, 31, { nGuid: 100 }, () => 0);
      await expect(
        repository.handleRuneRequest(account, 31, { nGuid: 100 }),
      ).rejects.toThrow(/maximum_level/);
      await store.update((state) => {
        state.players[account]!.levels.push({ id: (6 << 16) | (12 << 8) | 1, star: 1 });
      });
      for (let target = 11; target <= 15; target++)
        await repository.handleRuneRequest(account, 31, { nGuid: 100 }, () => 0);
      p = repository.get(account)!;
      expect(p.inventory[0]!.runeSkills).toHaveLength(3);
      expect(new Set(p.inventory[0]!.runeSkills).size).toBe(3);
      const spent = Array.from(
        { length: 14 },
        (_, i) => catalog.data.costs[i + 1]![3]!,
      ).reduce((a, b) => a + b, 0);
      expect(p.money.find((m) => m.id === 2)?.count).toBe(10_000_000 - spent);
      expect(
        (await (await reopen()).getOrCreate(account)).inventory[0]!.runeSkills,
      ).toEqual(p.inventory[0]!.runeSkills);
    });
  });

  it("validates exact material GUIDs and applies all four breaks, including the final stat-only break", async () => {
    await fixture(async ({ store, repository }) => {
      await seedRune(store, 15);
      const config = catalog.data.breaks[14]!;
      expect(config.steps.map((s) => s.maxLevel)).toEqual([20, 25, 30, 30]);
      for (let stage = 0; stage < 4; stage++) {
        const step = config.steps[stage]!;
        const materials = step.items.map(([g, d, p, l, count], i) => ({
          guid: 200 + i,
          genre: g,
          detail: d,
          particular: p,
          templateLevel: l,
          count,
          createTime: 1,
          enhanceLevel: 0,
          enhanceExp: 0,
          breakLevel: 0,
          lockOn: 0,
        }));
        await store.update((state) => {
          const p = state.players[account]!;
          p.inventory = [p.inventory[0]!, ...materials];
        });
        const supplied = materials.map((i) => [i.guid, i.count]);
        const before = store.snapshot().players[account]!;
        await expect(
          repository.handleRuneRequest(account, 35, {
            nGuid: 100,
            tbGuid: [...supplied, supplied[0]],
          }),
        ).rejects.toThrow(/invalid_materials/);
        expect(store.snapshot().players[account]).toEqual(before);
        const result = await repository.handleRuneRequest(account, 35, {
          nGuid: 100,
          tbGuid: supplied,
        });
        expect(result.rune.breakLevel).toBe(stage + 1);
        expect(result.rune.enhanceLevel).toBe(15);
        expect(
          result.updatedItems.filter((i) => i.guid !== 100).every((i) => i.count === 0),
        ).toBe(true);
        expect(result.updatedMoney[0]!.count).toBe(
          before.money[0]!.count - step.money[1],
        );
      }
      await expect(
        repository.handleRuneRequest(account, 35, { nGuid: 100, tbGuid: [] }),
      ).rejects.toThrow(/maximum_breakthrough/);
    });
  });

  it("persists a true revise preview, charges once, and implements both discard and accept", async () => {
    await fixture(async ({ store, repository, reopen }) => {
      await seedRune(store, 15);
      await repository.getOrCreate(account);
      const old = repository.get(account)!.inventory[0]!.runeSkills!.slice();
      const before = repository.get(account)!.money;
      const preview = await repository.handleRuneRequest(
        account,
        33,
        { rune: 100 },
        () => 0.999,
      );
      expect(preview.rune.runeSkills).toEqual(old);
      expect(preview.rune.runePendingSkills).toHaveLength(3);
      expect(runeItemSkills(preview.rune).map((s) => s.skillType)).toEqual([
        2, 2, 2, 6, 6, 6,
      ]);
      const fields = decodeFields(
        firstBytes(decodeFields(makeItemUpdateNotification([preview.rune])), 1)!,
      );
      const skills = fields
        .filter((f) => f.fieldNumber === 11)
        .map((f) => decodeFields(f.value as Buffer));
      expect(skills.map((s) => firstNumber(s, 3))).toEqual([2, 2, 2, 6, 6, 6]);
      const again = await repository.handleRuneRequest(account, 33, { rune: 100 });
      expect(again.player.money).toEqual(preview.player.money);
      expect(again.rune).toEqual(preview.rune);
      expect(before.find((m) => m.id === 16)!.count).toBeGreaterThan(
        preview.player.money.find((m) => m.id === 16)!.count,
      );
      const restarted = await reopen();
      const restored = await restarted.getOrCreate(account);
      expect(restored.inventory[0]!.runePendingSkills).toEqual(
        preview.rune.runePendingSkills,
      );
      const discarded = await restarted.handleRuneRequest(account, 34, {
        rune: 100,
        usenew: false,
      });
      expect(discarded.rune.runeSkills).toEqual(old);
      expect(discarded.rune.runePendingSkills).toBeUndefined();
      const next = await restarted.handleRuneRequest(
        account,
        33,
        { rune: 100 },
        () => 0.999,
      );
      const accepted = await restarted.handleRuneRequest(account, 34, {
        rune: 100,
        usenew: true,
      });
      expect(accepted.rune.runeSkills).toEqual(next.rune.runePendingSkills);
      expect(accepted.rune.runePendingSkills).toBeUndefined();
      expect(
        (await restarted.handleRuneRequest(account, 34, { rune: 100, usenew: false }))
          .rune,
      ).toEqual(accepted.rune);
    });
  });

  it("rolls back money and skills when a later cost or persistence fails", async () => {
    await fixture(async ({ store, repository, file }) => {
      await seedRune(store, 15);
      await store.update((state) => {
        state.players[account]!.money = [{ id: 2, count: 999999 }];
      });
      const before = store.snapshot();
      const disk = await readFile(file);
      await expect(
        repository.handleRuneRequest(account, 33, { rune: 100 }),
      ).rejects.toThrow(/insufficient_money/);
      expect(store.snapshot()).toEqual(before);
      expect(await readFile(file)).toEqual(disk);
      const temp = `${file}.${process.pid}.tmp`;
      await mkdir(temp);
      await expect(
        repository.handleRuneRequest(account, 34, { rune: 100, usenew: false }),
      ).rejects.toThrow();
      expect(store.snapshot()).toEqual(before);
      expect(await readFile(file)).toEqual(disk);
      await rm(temp, { recursive: true });
    });
  });
});
