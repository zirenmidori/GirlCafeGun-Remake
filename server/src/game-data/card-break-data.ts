import { readFileSync } from "node:fs";
import path from "node:path";
import { CARD_MAXIMUM_ENHANCE_LEVEL } from "./card-enhancement-data.js";

export const LUA_COMMAND_CARD_BREAK = 6;

export interface CardBreakItem {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  count: number;
}

export interface CardBreakStage {
  breakLevel: number;
  items: readonly CardBreakItem[];
  currencyId: number;
  currencyCount: number;
  maximumLevel: number;
}

export interface CardBreakRow {
  type: number;
  initialMaximumLevel: number;
  stages: readonly CardBreakStage[];
}

function parseItems(text: string): CardBreakItem[] {
  const body = text.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!body) return [];
  return body.split(",").map((entry) => {
    const [genre, detail, particular, templateLevel, count, ...rest] = entry
      .split("-")
      .map(Number);
    if (
      rest.length > 0 ||
      ![genre, detail, particular, templateLevel, count].every(
        (value) => Number.isSafeInteger(value) && value! > 0,
      )
    )
      throw new Error("Invalid card break item");
    return {
      genre: genre!,
      detail: detail!,
      particular: particular!,
      templateLevel: templateLevel!,
      count: count!,
    };
  });
}

/** Exact Item/CharacterCardBreak.txt rows, cached once rather than parsed per operation. */
export class CardBreakCatalog {
  readonly #rows = new Map<number, CardBreakRow>();
  private constructor() {}

  static load(text: string): CardBreakCatalog {
    const result = new CardBreakCatalog();
    for (const line of text.split(/\r?\n/).slice(3)) {
      if (!line.trim()) continue;
      const values = line.split("\t");
      const type = Number(values[0]);
      const initialMaximumLevel = Number(values[1]);
      if (!Number.isSafeInteger(type) || !Number.isSafeInteger(initialMaximumLevel))
        throw new Error("Invalid card break row");
      if (result.#rows.has(type)) throw new Error("Duplicate card break row");
      const stages: CardBreakStage[] = [];
      for (let step = 0; 2 + step * 4 < values.length; step++) {
        const columns = values.slice(2 + step * 4, 6 + step * 4);
        if (columns.every((value) => !value.trim())) break;
        const currencyId = Number(columns[1]);
        const currencyCount = Number(columns[2]);
        const maximumLevel = Number(columns[3]);
        if (
          columns.length !== 4 ||
          ![currencyId, currencyCount, maximumLevel].every(
            (n) => Number.isSafeInteger(n) && n > 0,
          )
        )
          throw new Error("Invalid card break stage");
        stages.push({
          breakLevel: step + 1,
          items: parseItems(columns[0]!),
          currencyId,
          currencyCount,
          maximumLevel,
        });
      }
      result.#rows.set(type, { type, initialMaximumLevel, stages });
    }
    return result;
  }

  static loadDefault(): CardBreakCatalog {
    return (defaultCatalog ??= CardBreakCatalog.load(
      readFileSync(path.resolve("resources/card/charactercardbreak.txt"), "utf8"),
    ));
  }

  row(breakType: number): CardBreakRow | null {
    return this.#rows.get(breakType) ?? null;
  }

  stage(breakType: number, breakLevel: number): CardBreakStage | null {
    if (breakLevel < 1) return null;
    return this.#rows.get(breakType)?.stages[breakLevel - 1] ?? null;
  }
}
let defaultCatalog: CardBreakCatalog | null = null;

/**
 * Mirrors CardTable.MaxLevelFor / CardCommon:GetMaxLevel: MaxLevel0 before any
 * break, then the MaxLevel of the last step reached. A card whose break type
 * has no row keeps the global card level cap.
 */
export function cardMaximumLevel(breakType: number, breakLevel: number): number {
  const row = CardBreakCatalog.loadDefault().row(breakType);
  if (!row) return CARD_MAXIMUM_ENHANCE_LEVEL;
  if (breakLevel <= 0 || row.stages.length === 0)
    return row.initialMaximumLevel > 0
      ? row.initialMaximumLevel
      : CARD_MAXIMUM_ENHANCE_LEVEL;
  return (
    row.stages[Math.min(breakLevel, row.stages.length) - 1]?.maximumLevel ??
    row.initialMaximumLevel
  );
}

export function parseCardBreakRequest(parameters: unknown): { guid: number } | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const envelope = parameters as Record<string, unknown>;
  const value =
    typeof envelope.tbParam === "object" && envelope.tbParam !== null
      ? (envelope.tbParam as Record<string, unknown>)
      : envelope;
  const guid = Number(value.guid);
  if (!Number.isSafeInteger(guid) || guid <= 0) return null;
  return { guid };
}

export class CardBreakError extends Error {
  constructor(
    readonly reason: string,
    readonly errorKey: string,
    readonly guid = 0,
  ) {
    super(`Card break rejected: ${reason}`);
    this.name = "CardBreakError";
  }
}
