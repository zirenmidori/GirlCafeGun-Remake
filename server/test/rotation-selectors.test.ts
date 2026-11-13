import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { mkdtemp } from "./helpers/temp.js";
import { loadConfig } from "../src/config.js";
import { GachaCatalog, type GachaPool } from "../src/game-data/gacha-data.js";
import {
  activeGachaBannerIds,
  GachaRotationCatalog,
} from "../src/game-data/gacha-rotation-data.js";
import { dailyPullMailAwards } from "../src/game-data/mail-data.js";
import {
  parseRecruitmentPolicy,
  recruitmentPolicy,
  ROTATION_SELECTION_TASK,
} from "../src/game-data/recruitment-policy.js";
import {
  rotationSelectorCatalog,
  RotationSelectorCatalog,
} from "../src/game-data/rotation-selector-data.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeGachaTaskId,
  makeInitialState,
  PlayerRepository,
} from "../src/persistence/player-repository.js";
import type { Logger } from "../src/logger.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const cards = GachaCatalog.loadDefault();
const weapons = GachaCatalog.loadDefault(0);
const rotation = GachaRotationCatalog.loadDefault(cards.get(1)!, weapons.get(1)!);
const epoch = Date.UTC(2026, 10, 8, 20);
const week = 7 * 86_400_000;
const count = (player: ReturnType<PlayerRepository["get"]>, gdpl: readonly number[]) =>
  player!.inventory
    .filter(
      (item) =>
        [item.genre, item.detail, item.particular, item.templateLevel].join(":") ===
        gdpl.slice(0, 4).join(":"),
    )
    .reduce((sum, item) => sum + item.count, 0);

it("funds both rotations with fifty draws and other banners with ten, without duplicate banner grants", () => {
  expect(recruitmentPolicy()).toEqual({
    schemaVersion: 1,
    rotationDailyDraws: 50,
    otherBannerDailyDraws: 10,
    selectorEveryDraws: 100,
  });
  const active = activeGachaBannerIds(epoch);
  expect(
    dailyPullMailAwards(active, cards.get(1)!.costTen, weapons.get(1)!.costTen),
  ).toEqual([
    [9, 13, 1, 1, 7],
    [7, 10, 1, 4, 6],
  ]);
  expect(
    dailyPullMailAwards(
      { ...active, character: [...active.character, ...active.character] },
      cards.get(1)!.costTen,
      weapons.get(1)!.costTen,
    ),
  ).toEqual([
    [9, 13, 1, 1, 7],
    [7, 10, 1, 4, 6],
  ]);
  expect(
    parseRecruitmentPolicy({ ...recruitmentPolicy(), selectorEveryDraws: 0 })
      .selectorEveryDraws,
  ).toBe(0);
  for (const invalid of [
    { rotationDailyDraws: 51 },
    { otherBannerDailyDraws: -10 },
    { selectorEveryDraws: 0.5 },
  ])
    expect(() =>
      parseRecruitmentPolicy({ ...recruitmentPolicy(), ...invalid }),
    ).toThrow();
});

it("retains immutable version-one choices and maps every legendary cohort to its exact box", () => {
  const catalog = rotationSelectorCatalog();
  const versionOne = catalog.definitions.filter(({ version }) => version === 1);
  expect(versionOne).toHaveLength(52);
  expect(catalog.request([8, 10, 46, 4, 1], 1).choice).toEqual([1, 201, 1, 4, 1]);
  expect(catalog.request([8, 10, 46, 4, 1], 2).choice).toEqual([1, 203, 1, 4, 1]);
  expect(() => catalog.request([8, 10, 9, 4, 1], 1)).toThrow();
  // Old unopened boxes must not silently acquire different choices in future updates.
  expect(createHash("sha256").update(JSON.stringify(versionOne)).digest("hex")).toBe(
    "9f57171344fa335a3206f3aeca3939ebd2c106acbefd443f5bd66ba555225625",
  );
  for (let cohort = 0; cohort < 26; cohort++) {
    const window = rotation.at(epoch + cohort * week);
    for (const kind of ["character", "weapon"] as const) {
      const pool = window[kind]!;
      const definition = catalog.forLineup(
        kind,
        cohort,
        pool.normalCards.get(4)!.map(({ gdpl }) => gdpl),
      );
      expect(window.manifest[kind]!.selector).toEqual({
        gdpl: [...definition.itemGdpl, 1],
        every: 100,
        progressTask: ROTATION_SELECTION_TASK[kind],
      });
      expect(definition.choices).toEqual(
        pool.normalCards.get(4)!.map(({ gdpl }) => [...gdpl, 1]),
      );
      expect(pool.protectNum).toBe(
        (kind === "character" ? cards : weapons).get(1)!.protectNum,
      );
    }
  }
  expect(
    () =>
      new RotationSelectorCatalog({
        schemaVersion: 1,
        definitions: [versionOne[0], versionOne[0]],
      }),
  ).toThrow();
});

for (const kind of ["character", "weapon"] as const) {
  it(`${kind}: carries paid progress across weeks, opens old boxes, rejects replays and preserves saves`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gcg-selector-"));
    const config = await loadConfig(path.resolve(import.meta.dirname, ".."));
    const filePath = path.join(directory, "state.json");
    const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
    await store.initialize();
    const players = new PlayerRepository({
      store,
      defaults: config.playerDefaults,
      logger,
    });
    const account = "selector-test";
    await players.getOrCreate(account);
    const catalog = kind === "character" ? cards : weapons;
    const first = rotation.at(epoch)[kind]!;
    const next = rotation.at(epoch + week)[kind]!;
    const progress = makeGachaTaskId(ROTATION_SELECTION_TASK[kind]);
    const historical = makeGachaTaskId(kind === "character" ? 3001 + 850 : 1001);
    await store.update((state) => {
      const player = state.players[account]!;
      player.taskValues[historical] = 999;
      for (const [ticket, amount] of [
        [first.costOne!, 3],
        [first.costTen!, 1],
      ] as const) {
        const [genre, detail, particular, templateLevel] = ticket;
        player.inventory.push({
          guid: player.nextItemGuid++,
          genre,
          detail,
          particular,
          templateLevel,
          count: amount,
          enhanceLevel: 0,
          enhanceExp: 0,
          breakLevel: 0,
          lockOn: 0,
          createTime: 1,
        });
      }
      for (const money of player.money) money.count = 0;
    });
    const draw = (pool: GachaPool, ten = false) =>
      players.performGacha(
        account,
        pool,
        ten,
        (player) =>
          catalog.rollPool(
            pool,
            ten,
            { pity: 0, upPity: 0, total: player.taskValues[historical] ?? 0 },
            new Set(),
            [],
            () => 0,
          ),
        false,
        kind === "character" ? "card" : "weapon",
      );
    const clock = vi.spyOn(Date, "now").mockReturnValue(epoch + 2 * week);
    try {
      await players.setTaskValues(account, [{ id: progress, value: 99 }]);
      expect(players.get(account)!.taskValues[progress]).toBeUndefined();
      await draw(first);
      expect(players.get(account)!.taskValues[progress]).toBe(1);
      expect(count(players.get(account), first.selectionMilestone!.item)).toBe(0);
      // Represents 99 genuinely paid draws retained from the preceding window.
      await store.update((state) => {
        state.players[account]!.taskValues[progress] = 99;
      });
      await draw(next);
      expect(players.get(account)!.taskValues[progress]).toBe(100);
      expect(count(players.get(account), next.selectionMilestone!.item)).toBe(1);
      expect(count(players.get(account), first.selectionMilestone!.item)).toBe(0);
      await draw(next, true);
      expect(players.get(account)!.taskValues[progress]).toBe(110);
      await players.setTaskValues(account, [{ id: progress, value: 0 }]);
      expect(players.get(account)!.taskValues[progress]).toBe(110);
      expect(count(players.get(account), next.selectionMilestone!.item)).toBe(1);
      const beforeFailed = store.snapshot();
      await expect(draw(next, true)).rejects.toThrow("Insufficient currency");
      expect(store.snapshot()).toEqual(beforeFailed);
      const earned = rotationSelectorCatalog().forLineup(
        kind,
        1,
        next.normalCards.get(4)!.map(({ gdpl }) => gdpl),
      );
      expect(rotation.at(epoch + 2 * week).manifest[kind]!.selector!.gdpl).not.toEqual([
        ...earned.itemGdpl,
        1,
      ]);
      const beforeItemCount = count(players.get(account), earned.choices[0]!);
      const opened = await Promise.allSettled([
        players.openRotationSelector(account, [...earned.itemGdpl, 1], 1),
        players.openRotationSelector(account, [...earned.itemGdpl, 1], 1),
      ]);
      expect(opened.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
      const selected = opened[0] as PromiseFulfilledResult<
        Awaited<ReturnType<PlayerRepository["openRotationSelector"]>>
      >;
      expect(selected.value.awards[0]!.slice(0, 5)).toEqual(earned.choices[0]);
      expect(count(players.get(account), earned.choices[0]!)).toBe(beforeItemCount + 1);
      expect(count(players.get(account), earned.itemGdpl)).toBe(0);
      expect(players.get(account)!.taskValues[progress]).toBe(110);
      await store.update((state) => {
        state.players[account]!.taskValues[progress] = 199;
      });
      await draw(next);
      expect(players.get(account)!.taskValues[progress]).toBe(200);
      expect(count(players.get(account), earned.itemGdpl)).toBe(1);
      const duplicate = await players.openRotationSelector(
        account,
        [...earned.itemGdpl, 1],
        1,
      );
      expect(count(players.get(account), earned.choices[0]!)).toBe(beforeItemCount + 2);
      if (kind === "character") expect(duplicate.awards[0]![7]).toBe(true);
      // Two already-earned boxes may be consumed together, choosing two copies.
      await store.update((state) => {
        const box = state.players[account]!.inventory.find(
          (item) =>
            [item.genre, item.detail, item.particular, item.templateLevel].join(":") ===
            earned.itemGdpl.join(":"),
        )!;
        box.count = 2;
      });
      const beforeBatch = store.snapshot();
      await expect(
        players.openRotationSelector(account, [...earned.itemGdpl, 3], 1),
      ).rejects.toThrow();
      await expect(
        players.openRotationSelector(account, [...earned.itemGdpl, 11], 1),
      ).rejects.toThrow();
      expect(store.snapshot()).toEqual(beforeBatch);
      const batch = await players.openRotationSelector(
        account,
        [...earned.itemGdpl, 2],
        1,
      );
      expect(batch.awards[0]!.slice(0, 5)).toEqual([
        ...earned.choices[0]!.slice(0, 4),
        2,
      ]);
      expect(count(players.get(account), earned.itemGdpl)).toBe(0);
      expect(count(players.get(account), earned.choices[0]!)).toBe(beforeItemCount + 4);
      expect(players.get(account)!.taskValues[progress]).toBe(200);
      const consumed = store.snapshot();
      for (const [gdpln, index] of [
        [[...earned.itemGdpl, 1], 0],
        [[...earned.itemGdpl, 1], 999],
        [[...earned.itemGdpl, 1.5], 1],
        [[8, 10, 9, 4, 1], 1],
      ] as const)
        await expect(
          players.openRotationSelector(account, gdpln, index),
        ).rejects.toThrow();
      expect(store.snapshot()).toEqual(consumed);
      await store.flush();
      const reopened = new JsonStore({
        filePath,
        initialState: makeInitialState(),
        logger,
      });
      await reopened.initialize();
      expect(reopened.snapshot().players[account]).toEqual(players.get(account));
    } finally {
      clock.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
