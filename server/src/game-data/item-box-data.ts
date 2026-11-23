import { readFileSync } from "node:fs";
import path from "node:path";
import type { BaseAward } from "./chapter-config.js";

export const LUA_COMMAND_ITEM_BOX_OPEN = 75;
export const LUA_COMMAND_ITEM_BOX_OPEN_MANUAL = 76;
export const ITEM_BOX_MAX_OPEN_PER_REQUEST = 10;
/**
 * Select boxes opened one at a time even when the request asks for more.
 * Boxes 213 (item 8-5-16-4) and 215 (8-5-18-4) are the one-time rewards of
 * Activity/AchievementOther rows 1640 and 1665 ("100 pulls on limited weapon
 * banner 516 / 520"): pick one of that banner's two featured weapons.
 */
export const ITEM_BOX_SELECT_ONCE_IDS = new Set([213, 215]);

export type ItemBoxObtainType = "Fix" | "Random" | "Prob" | "Select";

export interface ItemBoxEntry {
  award: BaseAward;
  obtainType: ItemBoxObtainType;
  weight: number;
}

export interface ItemBoxOpenRequest {
  gdpl: [number, number, number, number];
  times: number;
  select: number;
}

export class ItemBoxError extends Error {
  constructor(
    readonly reason: "invalid_request" | "unknown_box" | "not_owned" | "empty_roll",
  ) {
    super("Item box: " + reason);
  }
}

type TableRow = Record<string, string>;

function parseTable(text: string): TableRow[] {
  const lines = text.split(/\r?\n/);
  const columns = (lines[2] ?? "").split("\t");
  const rows: TableRow[] = [];
  for (const line of lines.slice(3)) {
    if (line.trim() === "") continue;
    const cells = line.split("\t");
    const row: TableRow = {};
    columns.forEach((column, index) => {
      if (column) row[column] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function positiveInteger(text: string | undefined): number | null {
  const value = Number((text ?? "").trim());
  return (text ?? "").trim() !== "" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function integer(text: string | undefined): number | null {
  const value = Number((text ?? "").trim());
  return (text ?? "").trim() !== "" && Number.isSafeInteger(value) ? value : null;
}

function itemKey(gdpl: readonly number[]): string {
  return gdpl.slice(0, 4).join(":");
}

function parseGdpln(raw: string | undefined): BaseAward | null {
  const text = (raw ?? "").trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!text) return null;
  const parts = text.split("-");
  if (parts.length < 4) return null;
  const gdpl = parts.slice(0, 4).map((part) => integer(part));
  if (gdpl.some((part) => part === null || part <= 0)) return null;
  const count = parts.length >= 5 ? positiveInteger(parts[4]) : 1;
  return [gdpl[0]!, gdpl[1]!, gdpl[2]!, gdpl[3]!, count ?? 1];
}

function clampRandom(value: number): number {
  return Math.max(0, Math.min(1 - Number.EPSILON, value));
}

export function parseItemBoxOpenRequest(
  gdpln: unknown,
  select: unknown,
): ItemBoxOpenRequest | null {
  if (!Array.isArray(gdpln) || gdpln.length < 4) return null;
  const gdpl = gdpln
    .slice(0, 4)
    .map((part) =>
      typeof part === "number"
        ? part
        : typeof part === "string" &&
            part.trim() !== "" &&
            Number.isSafeInteger(Number(part))
          ? Number(part)
          : NaN,
    );
  if (gdpl.some((part) => !Number.isSafeInteger(part) || part <= 0)) return null;
  const rawTimes = gdpln.length >= 5 ? Number(gdpln[4]) : 1;
  if (!Number.isSafeInteger(rawTimes)) return null;
  const rawSelect = Number(select ?? 0);
  if (!Number.isSafeInteger(rawSelect) || rawSelect < 0) return null;
  return {
    gdpl: gdpl as [number, number, number, number],
    times: Math.max(1, rawTimes),
    select: rawSelect,
  };
}

export class ItemBoxCatalog {
  static #default: ItemBoxCatalog | undefined;

  readonly #boxIdsByItem = new Map<string, number>();
  readonly #entriesByBox = new Map<number, ItemBoxEntry[]>();

  constructor(boxItemsTable: string, boxInfoTable: string) {
    for (const row of parseTable(boxItemsTable)) {
      const gdpl = [row.Genre, row.Detail, row.Particular, row.Level].map(
        positiveInteger,
      );
      if (gdpl.some((part) => part === null)) continue;
      const boxId = positiveInteger(row.ExtParam1);
      if (boxId === null) continue;
      this.#boxIdsByItem.set(itemKey(gdpl as number[]), boxId);
    }

    for (const row of parseTable(boxInfoTable)) {
      const boxId = positiveInteger(row.boxId);
      const award = parseGdpln(row.GDPLN);
      if (boxId === null || !award) continue;
      const obtainType = (row.obtainType ?? "").trim();
      if (
        obtainType !== "Fix" &&
        obtainType !== "Random" &&
        obtainType !== "Prob" &&
        obtainType !== "Select"
      )
        continue;
      const weight = integer(row.Weight) ?? 0;
      const entries = this.#entriesByBox.get(boxId) ?? [];
      entries.push({ award, obtainType, weight });
      this.#entriesByBox.set(boxId, entries);
    }
  }

  static loadDefault(): ItemBoxCatalog {
    if (ItemBoxCatalog.#default) return ItemBoxCatalog.#default;
    const read = (file: string): string =>
      readFileSync(path.resolve(process.cwd(), "resources", file), "utf8");
    ItemBoxCatalog.#default = new ItemBoxCatalog(
      read("item/boxitems.txt"),
      read("item/itemboxinfo.txt"),
    );
    return ItemBoxCatalog.#default;
  }

  boxId(gdpl: readonly number[]): number | null {
    return this.#boxIdsByItem.get(itemKey(gdpl)) ?? null;
  }

  has(boxId: number): boolean {
    return this.#entriesByBox.has(boxId);
  }

  /** True when the item names a box that ItemBoxInfo holds awards for. */
  opens(gdpl: readonly number[]): boolean {
    const boxId = this.boxId(gdpl);
    return boxId !== null && this.has(boxId);
  }

  hasSelect(boxId: number): boolean {
    return (this.#entriesByBox.get(boxId) ?? []).some(
      (entry) => entry.obtainType === "Select",
    );
  }

  roll(
    boxId: number,
    times: number,
    select: number,
    random: () => number = Math.random,
  ): BaseAward[] {
    const entries = this.#entriesByBox.get(boxId);
    if (!entries?.length) return [];
    const result: BaseAward[] = [];
    const add = (award: BaseAward, count: number): void => {
      if (count <= 0) return;
      const existing = result.find(
        (row) =>
          row[0] === award[0] &&
          row[1] === award[1] &&
          row[2] === award[2] &&
          row[3] === award[3],
      );
      if (existing) existing[4] += count;
      else result.push([award[0], award[1], award[2], award[3], count]);
    };

    for (const entry of entries) {
      if (entry.obtainType === "Fix") add(entry.award, entry.award[4] * times);
    }

    const randoms = entries.filter((entry) => entry.obtainType === "Random");
    if (randoms.length) {
      const totalWeight = randoms.reduce(
        (sum, entry) => sum + Math.max(0, entry.weight),
        0,
      );
      for (let index = 0; index < times; index++) {
        let roll = clampRandom(random()) * totalWeight;
        let picked: ItemBoxEntry | undefined;
        if (totalWeight <= 0)
          picked = randoms[Math.floor(clampRandom(random()) * randoms.length)];
        else {
          for (const entry of randoms) {
            roll -= Math.max(0, entry.weight);
            if (roll < 0) {
              picked = entry;
              break;
            }
          }
          picked ??= randoms[randoms.length - 1];
        }
        if (picked) add(picked.award, picked.award[4]);
      }
    }

    for (const entry of entries) {
      if (entry.obtainType !== "Prob") continue;
      for (let index = 0; index < times; index++) {
        if (Math.floor(clampRandom(random()) * 10000) < Math.max(0, entry.weight))
          add(entry.award, entry.award[4]);
      }
    }

    if (select > 0) {
      const selects = entries.filter((entry) => entry.obtainType === "Select");
      if (select <= selects.length) {
        const picked = selects[select - 1]!;
        add(picked.award, picked.award[4] * times);
      }
    }

    return result;
  }
}

export function itemBoxCatalog(): ItemBoxCatalog {
  return ItemBoxCatalog.loadDefault();
}
