import { CARD_EXP_TO_NEXT_LEVEL } from "./card-enhancement-data.js";

export const LUA_COMMAND_CARD_DECOMPOSE = 1;
export const MAX_CARD_DECOMPOSITION_COUNT = 40;

const DECOMPOSITION_EXP_RATE = 0.3;
const BASE_GOLD_BY_RARITY = new Map([
  [1, 500],
  [2, 1_000],
  [3, 2_000],
  [4, 10_000],
  [5, 100],
]);
const TOKEN_COUNT_BY_RARITY = new Map([
  [1, 0],
  [2, 10],
  [3, 40],
  [4, 200],
  [5, 0],
]);

export interface CardDecompositionReward {
  gold: number;
  tokenCount: number;
}

/**
 * Mirrors Game.ItemMgr.GetItemSumExp(level, NeedExp1). The client only prices
 * experience already spent reaching the current level; uncommitted enhanceExp
 * is intentionally not included.
 */
export function cardCumulativeExperience(level: number): number {
  if (!Number.isSafeInteger(level) || level <= 1) return 0;
  return CARD_EXP_TO_NEXT_LEVEL.slice(
    0,
    Math.min(level - 1, CARD_EXP_TO_NEXT_LEVEL.length),
  ).reduce((total, required) => total + required, 0);
}

/**
 * Mirrors CardCommon:GetCardPrice() and GetDecomposeItem() using
 * ItemRarityItem.asset's card decomposition rows.
 */
export function characterCardDecompositionReward(
  level: number,
  rarity: number,
): CardDecompositionReward | null {
  const baseGold = BASE_GOLD_BY_RARITY.get(rarity);
  const tokenCount = TOKEN_COUNT_BY_RARITY.get(rarity);
  if (baseGold === undefined || tokenCount === undefined) return null;
  return {
    gold: Math.floor(
      cardCumulativeExperience(level) * DECOMPOSITION_EXP_RATE + rarity * baseGold,
    ),
    tokenCount,
  };
}

export function parseCardDecompositionRequest(parameters: unknown): number[] | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const envelope = parameters as Record<string, unknown>;
  if (!Array.isArray(envelope.tbParam)) return null;
  if (
    envelope.tbParam.length === 0 ||
    envelope.tbParam.length > MAX_CARD_DECOMPOSITION_COUNT
  ) {
    return null;
  }

  const guids = envelope.tbParam.map(Number);
  if (
    guids.some((guid) => !Number.isSafeInteger(guid) || guid <= 0) ||
    new Set(guids).size !== guids.length
  ) {
    return null;
  }
  return guids;
}
