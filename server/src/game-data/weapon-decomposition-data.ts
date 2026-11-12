import { weaponExperienceBeforeLevel } from "./weapon-enhancement-data.js";

export const WEAPON_LOGIC_COMMAND_DECOMPOSE = 2;
export const MAX_WEAPON_DECOMPOSITION_COUNT = 40;

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
  [2, 5],
  [3, 25],
  [4, 250],
  [5, 0],
]);

export interface WeaponDecompositionReward {
  gold: number;
  tokenCount: number;
}

/**
 * Mirrors WeaponCommon:GetWeaponSellGold() and ItemRarityItem Param2/DisItem2.
 * Like the client, only experience spent reaching the current level is priced;
 * the weapon's uncommitted enhanceExp is not included.
 */
export function weaponDecompositionReward(
  level: number,
  rarity: number,
): WeaponDecompositionReward | null {
  const baseGold = BASE_GOLD_BY_RARITY.get(rarity);
  const tokenCount = TOKEN_COUNT_BY_RARITY.get(rarity);
  if (baseGold === undefined || tokenCount === undefined) return null;
  return {
    gold: Math.floor(
      weaponExperienceBeforeLevel(level) * DECOMPOSITION_EXP_RATE + rarity * baseGold,
    ),
    tokenCount,
  };
}

export function parseWeaponDecompositionRequest(parameters: unknown): number[] | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const value = parameters as Record<string, unknown>;
  if (!Array.isArray(value.tbGuid)) return null;
  if (
    value.tbGuid.length === 0 ||
    value.tbGuid.length > MAX_WEAPON_DECOMPOSITION_COUNT
  ) {
    return null;
  }

  const guids = value.tbGuid.map(Number);
  if (
    guids.some((guid) => !Number.isSafeInteger(guid) || guid <= 0) ||
    new Set(guids).size !== guids.length
  ) {
    return null;
  }
  return guids;
}
