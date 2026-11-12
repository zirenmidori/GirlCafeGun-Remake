/**
 * MOD rules adapted from SssjServer RuneFeature/RuneTable (MIT, 2025 luoxiadesu).
 * See LICENSES/SssjServer-MIT.txt. Revise uses the client's real pending channel,
 * rather than upstream's immediate replacement; all mutations commit in JsonStore.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { InventoryEntryState, Player } from "../persistence/player-repository.js";

type Award = [number, number, number, number, number];
interface RuneConfig {
  gdpl: [number, number, number, number];
  rarity: number;
  breakConfigId: number;
  recastMoney: [number, number];
  recastItems: Award[];
}
interface BreakStep {
  maxLevel: number;
  money: [number, number];
  items: Award[];
}
interface ProgressionData {
  schemaVersion: number;
  templates: RuneConfig[];
  breaks: Record<string, { initialMaxLevel: number; steps: BreakStep[] }>;
  costs: Record<string, number[]>;
  skills: { id: number; rarity: number; weight: number }[];
}
export type RuneRequest =
  | { command: 31; guid: number }
  | { command: 35; guid: number; materials: { guid: number; count: number }[] }
  | { command: 33; guid: number }
  | { command: 34; guid: number; useNew: boolean };

export class RuneOperationError extends Error {
  constructor(
    readonly reason: string,
    readonly clientError = 1,
  ) {
    super(`MOD operation rejected: ${reason}`);
    this.name = "RuneOperationError";
  }
}
const key = (item: InventoryEntryState) =>
  [item.genre, item.detail, item.particular, item.templateLevel].join(":");
const validGuid = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 0xffff_ffff;

export function parseRuneRequest(command: number, parameters: unknown): RuneRequest {
  if (!parameters || typeof parameters !== "object")
    throw new RuneOperationError("invalid_request");
  const envelope = parameters as Record<string, unknown>;
  const p = (envelope.tbParam ?? envelope) as Record<string, unknown>;
  if (!p || typeof p !== "object" || ![31, 33, 34, 35].includes(command))
    throw new RuneOperationError("invalid_request");
  const guid = command === 31 || command === 35 ? p.nGuid : p.rune;
  if (!validGuid(guid)) throw new RuneOperationError("invalid_guid");
  if (command === 31 || command === 33) return { command, guid };
  if (command === 34) {
    if (typeof p.usenew !== "boolean")
      throw new RuneOperationError("invalid_selection");
    return { command, guid, useNew: p.usenew };
  }
  if (!Array.isArray(p.tbGuid) || p.tbGuid.length > 20)
    throw new RuneOperationError("invalid_materials");
  const seen = new Set<number>();
  const materials = p.tbGuid.map((row: unknown) => {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      !validGuid(row[0]) ||
      !validGuid(row[1]) ||
      seen.has(row[0])
    )
      throw new RuneOperationError("invalid_materials");
    seen.add(row[0]);
    return { guid: row[0], count: row[1] };
  });
  return { command: 35, guid, materials };
}

export class RuneProgressionCatalog {
  readonly data: ProgressionData;
  constructor(data: ProgressionData) {
    if (
      data.schemaVersion !== 1 ||
      data.templates.length !== 80 ||
      data.skills.length !== 24
    )
      throw new Error("Invalid MOD progression catalog");
    const templates = new Set(data.templates.map((row) => row.gdpl.join(":")));
    if (
      templates.size !== 80 ||
      new Set(data.skills.map((s) => s.id)).size !== 24 ||
      data.skills.some(
        (s) =>
          !Number.isSafeInteger(s.weight) ||
          s.weight <= 0 ||
          s.rarity < 1 ||
          s.rarity > 4,
      )
    )
      throw new Error("Duplicate or invalid MOD progression definition");
    for (const row of data.templates) {
      if (!data.breaks[row.breakConfigId] || row.rarity < 1 || row.rarity > 4)
        throw new Error("Unknown MOD breakthrough definition");
    }
    for (let level = 1; level <= 29; level++)
      if (
        data.costs[level]?.length !== 4 ||
        data.costs[level]!.some((v) => !Number.isSafeInteger(v) || v <= 0)
      )
        throw new Error("Missing MOD enhancement cost");
    this.data = data;
  }
  template(item: InventoryEntryState): RuneConfig | undefined {
    return this.data.templates.find((row) => row.gdpl.join(":") === key(item));
  }
  maxLevel(player: Player, item: InventoryEntryState, row: RuneConfig): number {
    const passed = (chapter: number) =>
      player.levels.some(
        (level) => level.id === ((chapter << 16) | (12 << 8) | 1) && level.star > 0,
      );
    if (!passed(6)) return passed(5) ? 10 : 5;
    const config = this.data.breaks[row.breakConfigId]!;
    return item.breakLevel === 0
      ? config.initialMaxLevel
      : (config.steps[item.breakLevel - 1]?.maxLevel ?? config.initialMaxLevel);
  }
  roll(
    rarity: number,
    count: number,
    excluded: readonly number[] = [],
    random = Math.random,
  ): number[] {
    const pool = this.data.skills.filter(
      (s) => s.rarity === rarity && !excluded.includes(s.id),
    );
    const picked: number[] = [];
    while (picked.length < count) {
      const total = pool.reduce((sum, s) => sum + s.weight, 0);
      if (total <= 0) throw new RuneOperationError("invalid_skill_pool");
      let value = Math.max(0, Math.min(1 - Number.EPSILON, random())) * total;
      const index = pool.findIndex((s) => (value -= s.weight) < 0);
      picked.push(pool.splice(index, 1)[0]!.id);
    }
    return picked;
  }
}
let cached: RuneProgressionCatalog | undefined;
export function runeProgressionCatalog(): RuneProgressionCatalog {
  return (cached ??= new RuneProgressionCatalog(
    JSON.parse(
      readFileSync(path.resolve("resources/rune/progression.json"), "utf8"),
    ) as ProgressionData,
  ));
}

/** Initialize unlocked skills once, preserving every already rolled skill. */
export function reconcileRuneSkills(player: Player, random = Math.random): void {
  const catalog = runeProgressionCatalog();
  for (const item of player.inventory) {
    if (item.genre !== 3 || item.count <= 0) continue;
    const row = catalog.template(item);
    if (!row) continue;
    const count = Math.min(3, Math.floor(item.enhanceLevel / 5));
    const active = (item.runeSkills ??= []);
    if (active.length < count)
      active.push(...catalog.roll(row.rarity, count - active.length, active, random));
  }
}

/** Native AddItem applies type2 and displays type6 without activating it. */
export function runeItemSkills(
  item: InventoryEntryState,
): { skillId: number; skillLevel: number; skillType: number }[] {
  if (item.genre !== 3) return [];
  return [
    ...(item.runeSkills ?? []).map((skillId) => ({
      skillId,
      skillLevel: 1,
      skillType: 2,
    })),
    ...(item.runePendingSkills ?? []).map((skillId) => ({
      skillId,
      skillLevel: 1,
      skillType: 6,
    })),
  ];
}

export function mutateRune(player: Player, request: RuneRequest, random = Math.random) {
  const catalog = runeProgressionCatalog();
  const rune = player.inventory.find(
    (item) => item.guid === request.guid && item.genre === 3 && item.count > 0,
  );
  if (!rune) throw new RuneOperationError("rune_not_owned");
  const row = catalog.template(rune);
  if (!row) throw new RuneOperationError("unknown_rune");
  if (
    !Number.isSafeInteger(rune.enhanceLevel) ||
    rune.enhanceLevel < 1 ||
    rune.enhanceLevel > 30 ||
    !Number.isSafeInteger(rune.breakLevel) ||
    rune.breakLevel < 0 ||
    rune.breakLevel > 4
  )
    throw new RuneOperationError("invalid_rune_state");
  const items = new Set<number>([rune.guid]);
  const money = new Set<number>();
  function charge(id: number, count: number) {
    if (count === 0) return;
    const value = player.money.find((entry) => entry.id === id);
    if (!value || value.count < count)
      throw new RuneOperationError("insufficient_money", id === 2 ? 20012 : 20009);
    value.count -= count;
    money.add(id);
  }
  function consume(award: Award) {
    const [g, d, p, l, n] = award;
    // RecastGDPLN15-20 is a currency award, held as money16, not an item stack.
    if (g === 15 && d === 20) {
      charge(16, n);
      return;
    }
    const stacks = player.inventory.filter(
      (item) => item.count > 0 && key(item) === [g, d, p, l].join(":"),
    );
    if (stacks.reduce((sum, item) => sum + item.count, 0) < n)
      throw new RuneOperationError("insufficient_material", 20009);
    let left = n;
    for (const stack of stacks) {
      const take = Math.min(stack.count, left);
      if (take) {
        stack.count -= take;
        left -= take;
        items.add(stack.guid);
      }
    }
  }
  if (request.command === 31) {
    if (rune.runePendingSkills?.length)
      throw new RuneOperationError("pending_revision");
    if (rune.enhanceLevel >= catalog.maxLevel(player, rune, row))
      throw new RuneOperationError("maximum_level");
    charge(2, catalog.data.costs[rune.enhanceLevel]![row.rarity - 1]!);
    rune.enhanceLevel++;
    reconcileRuneSkills(player, random);
  } else if (request.command === 35) {
    if (rune.runePendingSkills?.length)
      throw new RuneOperationError("pending_revision");
    if (rune.enhanceLevel < 15) throw new RuneOperationError("breakthrough_locked");
    const step = catalog.data.breaks[row.breakConfigId]!.steps[rune.breakLevel];
    if (!step) throw new RuneOperationError("maximum_breakthrough");
    const supplied = new Map<string, number>();
    for (const material of request.materials) {
      const item = player.inventory.find(
        (entry) => entry.guid === material.guid && entry.count >= material.count,
      );
      if (!item || item.guid === rune.guid || item.lockOn || item.genre <= 4)
        throw new RuneOperationError("invalid_material", 20009);
      supplied.set(key(item), (supplied.get(key(item)) ?? 0) + material.count);
    }
    if (
      supplied.size !== step.items.length ||
      step.items.some(([g, d, p, l, n]) => supplied.get([g, d, p, l].join(":")) !== n)
    )
      throw new RuneOperationError("invalid_materials", 20009);
    charge(...step.money);
    for (const material of request.materials) {
      const item = player.inventory.find((entry) => entry.guid === material.guid)!;
      item.count -= material.count;
      items.add(item.guid);
    }
    rune.breakLevel++;
  } else if (request.command === 33) {
    reconcileRuneSkills(player, random);
    if (rune.enhanceLevel < 15 || rune.runeSkills?.length !== 3)
      throw new RuneOperationError("revision_locked");
    if (!rune.runePendingSkills?.length) {
      charge(...row.recastMoney);
      for (const award of row.recastItems) consume(award);
      rune.runePendingSkills = catalog.roll(row.rarity, 3, [], random);
    }
  } else if (rune.runePendingSkills?.length) {
    if (request.useNew) rune.runeSkills = rune.runePendingSkills;
    delete rune.runePendingSkills;
  }
  return { runeGuid: rune.guid, itemGuids: items, moneyIds: money };
}
