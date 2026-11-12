import { readFileSync } from "node:fs";
import path from "node:path";
import type { Gdpl } from "./gacha-data.js";

export interface CustomCardTemplate {
  id: string;
  gdpl: Gdpl;
  rarity: number;
  modelId: number;
  outfitModelId: number;
}

let cached: readonly CustomCardTemplate[] | undefined;

/** Local card definitions do not change stock lottery pools or GDPL identity. */
export function customCardTemplates(): readonly CustomCardTemplate[] {
  if (cached) return cached;
  const source = JSON.parse(
    readFileSync(path.resolve("resources/custom-cards.json"), "utf8"),
  ) as { schemaVersion: number; cards: CustomCardTemplate[] };
  if (source.schemaVersion !== 1 || !Array.isArray(source.cards))
    throw new Error("Unrecognized custom card catalog");
  const keys = new Set<string>();
  for (const card of source.cards) {
    if (
      !card.id ||
      card.gdpl.length !== 4 ||
      card.gdpl[0] !== 1 ||
      !card.gdpl.every((n) => Number.isSafeInteger(n) && n > 0) ||
      keys.has(card.gdpl.join(":")) ||
      !Number.isInteger(card.rarity) ||
      card.rarity < 1 ||
      card.rarity > 4 ||
      !Number.isSafeInteger(card.modelId) ||
      card.modelId <= 0 ||
      !Number.isSafeInteger(card.outfitModelId) ||
      card.outfitModelId <= 0
    )
      throw new Error("Invalid custom card definition");
    keys.add(card.gdpl.join(":"));
  }
  cached = source.cards;
  return cached;
}

export function cardRarityOf(
  gdpl: Gdpl,
  stock: (gdpl: Gdpl) => number | null,
): number | null {
  return (
    customCardTemplates().find((card) => card.gdpl.every((n, i) => n === gdpl[i]))
      ?.rarity ?? stock(gdpl)
  );
}
