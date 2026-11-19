import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { mkdtemp } from "./helpers/temp.js";
import {
  currentEnergyWindow,
  energyActivityTaskId,
} from "../src/game-data/energy-activity-data.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
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
const defaults = {
  name: "",
  level: 1,
  exp: 0,
  fightPower: 0,
  serverZone: 8,
  firstLevelComplete: false,
};
const at = (day: number, hour: number, minute = 0) =>
  Date.UTC(2026, 10, day, hour - 8, minute);
const balance = (players: PlayerRepository) =>
  players.get("energy")!.money.find((money) => money.id === 1)!.count;
async function fixture(
  run: (
    players: PlayerRepository,
    reload: () => Promise<PlayerRepository>,
    store: JsonStore<ReturnType<typeof makeInitialState>>,
  ) => Promise<void>,
) {
  const root = path.resolve(
    import.meta.dirname,
    "../../release/work/cafe-power-20261117/tests",
  );
  const directory = await mkdtemp(path.join(root, "energy-"));
  if (!directory.startsWith(root + path.sep)) throw new Error("Unsafe test directory");
  const filePath = path.join(directory, "state.json");
  const store = new JsonStore({ filePath, initialState: makeInitialState(), logger });
  await store.initialize();
  const create = (state: typeof store) =>
    new PlayerRepository({ store: state, defaults, logger });
  const players = create(store);
  await players.getOrCreate("energy", at(17, 10));
  try {
    await run(
      players,
      async () => {
        await store.flush();
        const next = new JsonStore({
          filePath,
          initialState: makeInitialState(),
          logger,
        });
        await next.initialize();
        return create(next);
      },
      store,
    );
  } finally {
    await store.flush();
    await rm(directory, { recursive: true, force: true });
  }
}

it("credits each real free-power window once, including concurrent taps, restart and missed days", async () => {
  await fixture(async (players, reload) => {
    const before = balance(players);
    const results = await Promise.all([
      players.claimEnergyActivity("energy", at(17, 11)),
      players.claimEnergyActivity("energy", at(17, 11)),
    ]);
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(balance(players)).toBe(before + 30);
    const restarted = await reload();
    expect(
      (await restarted.claimEnergyActivity("energy", at(17, 13, 59))).claimed,
    ).toBe(false);
    expect((await restarted.claimEnergyActivity("energy", at(17, 18))).energy).toBe(30);
    expect(balance(restarted)).toBe(before + 60);
    expect((await restarted.claimEnergyActivity("energy", at(20, 11))).energy).toBe(30);
    expect(balance(restarted)).toBe(before + 90); // Missed windows are not invented.
    expect((await restarted.claimEnergyActivity("energy", at(19, 18))).reason).toBe(
      "clock_reversed",
    );
    expect(balance(restarted)).toBe(before + 90);
  });
});

it("uses the exact client windows and half-open boundaries in server time", async () => {
  expect(currentEnergyWindow(at(17, 10, 59))).toBeUndefined();
  expect(currentEnergyWindow(at(17, 11))?.id).toBe(1);
  expect(currentEnergyWindow(at(17, 14))).toBeUndefined();
  expect(currentEnergyWindow(at(17, 18))?.id).toBe(2);
  expect(currentEnergyWindow(at(17, 20))).toBeUndefined();
  await fixture(async (players) => {
    const before = balance(players);
    expect((await players.claimEnergyActivity("energy", at(17, 10, 59))).reason).toBe(
      "not_open",
    );
    expect(balance(players)).toBe(before);
    expect((await players.claimEnergyActivity("energy", at(17, 11))).claimed).toBe(
      true,
    );
  });
});

it("protects claim receipts from client task edits and resets them at the daily rollover without granting power", async () => {
  await fixture(async (players) => {
    await players.claimEnergyActivity("energy", at(17, 11));
    const id = energyActivityTaskId(1);
    await players.setTaskValues("energy", [{ id, value: 0 }]);
    expect((await players.claimEnergyActivity("energy", at(17, 12))).reason).toBe(
      "already_claimed",
    );
    const before = balance(players);
    const prior = await players.updateMailbox(
      "energy",
      { kind: "list" },
      [],
      at(18, 3, 59),
    );
    expect(prior.player.taskValues[String(id)]).toBe(1);
    const reset = await players.updateMailbox(
      "energy",
      { kind: "list" },
      [],
      at(18, 4),
    );
    expect(reset.taskValuesChanged).toBe(true);
    expect(reset.player.taskValues[String(id)]).toBe(0);
    expect(balance(players)).toBe(before);
  });
});

it("keeps today's claim flags of a save made by the earlier phone build", async () => {
  await fixture(async (players, _reload, store) => {
    await players.claimEnergyActivity("energy", at(17, 11));
    const id = String(energyActivityTaskId(1));
    // Old shape: { lastDate } in local time instead of { operationalDate }.
    await store.update((state) => {
      state.players.energy!.energyActivity = { lastDate: "2026-11-17" } as never;
    });
    await players.getOrCreate("energy", at(17, 12));
    expect(players.get("energy")!.energyActivity).toEqual({
      operationalDate: "2026-11-17",
    });
    expect(players.get("energy")!.taskValues[id]).toBe(1);
    expect((await players.claimEnergyActivity("energy", at(17, 12))).reason).toBe(
      "already_claimed",
    );
    // A stale old-shape save resets the flags.
    await store.update((state) => {
      state.players.energy!.energyActivity = { lastDate: "2026-11-10" } as never;
    });
    await players.getOrCreate("energy", at(17, 12));
    expect(players.get("energy")!.taskValues[id]).toBe(0);
  });
});
