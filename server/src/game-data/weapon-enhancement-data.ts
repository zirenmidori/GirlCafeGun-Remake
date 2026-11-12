import type { InventoryEntryState } from "../persistence/player-repository.js";

export interface WeaponEnhancementMaterial {
  guid: number;
  count: number;
}

export interface WeaponEnhancementRequest {
  guid: number;
  materials: WeaponEnhancementMaterial[];
}

export interface WeaponExperienceMaterialDefinition {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  experience: number;
  coinCost: number;
}

/**
 * Exact ExtParam1/ExtParam2 values from Item/ItemList.asset for genre 7,
 * detail 3. UI_Updatebox uses these values directly for both the experience
 * preview and the displayed crystal-coin cost.
 */
export const WEAPON_EXP_MATERIALS: readonly WeaponExperienceMaterialDefinition[] = [
  500, 2_500, 10_000, 50_000,
].map((value, index) => ({
  genre: 7,
  detail: 3,
  particular: 1,
  templateLevel: index + 1,
  experience: value,
  coinCost: value,
}));

/**
 * Item/ItemExp.txt NeedExp3. Index zero is the experience needed to advance
 * from level 1 to level 2.
 */
const WEAPON_EXP_TO_NEXT_LEVEL = [
  133, 187, 263, 406, 562, 730, 907, 1_092, 1_286, 1_485, 1_691, 1_904, 2_121, 2_345,
  2_573, 2_806, 3_043, 3_285, 3_532, 3_782, 4_035, 4_294, 4_554, 4_820, 5_088, 5_359,
  5_635, 5_912, 6_193, 6_478, 6_764, 7_054, 7_346, 7_641, 7_940, 8_240, 8_542, 8_849,
  9_156, 13_394, 14_165, 14_963, 15_784, 16_630, 17_503, 18_399, 19_321, 20_269, 21_243,
  22_242, 23_267, 24_320, 25_398, 26_502, 27_634, 28_792, 29_977, 31_189, 32_429,
  33_695, 34_990, 36_312, 37_661, 39_040, 40_445, 41_879, 43_341, 44_832, 46_351,
  48_917, 51_109, 53_396, 55_782, 58_271, 60_869, 63_578, 66_405, 69_354, 72_319, 0,
] as const;

const WEAPON_RARITY_EXPERIENCE = new Map([
  [1, 500],
  [2, 2_000],
  [3, 5_000],
  [4, 10_000],
]);

export function parseWeaponEnhancementRequest(
  parameters: unknown,
): WeaponEnhancementRequest | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const value = parameters as Record<string, unknown>;
  const guid = Number(value.nGuid);
  if (!Number.isSafeInteger(guid) || guid <= 0 || !Array.isArray(value.tbGuid)) {
    return null;
  }

  const materials: WeaponEnhancementMaterial[] = [];
  const seen = new Set<number>();
  for (const rawMaterial of value.tbGuid) {
    if (!Array.isArray(rawMaterial) || rawMaterial.length < 2) return null;
    const materialGuid = Number(rawMaterial[0]);
    const count = Number(rawMaterial[1]);
    if (
      !Number.isSafeInteger(materialGuid) ||
      materialGuid <= 0 ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      seen.has(materialGuid)
    ) {
      return null;
    }
    seen.add(materialGuid);
    materials.push({ guid: materialGuid, count });
  }
  return materials.length > 0 ? { guid, materials } : null;
}

export function weaponExperienceMaterial(
  item: Pick<InventoryEntryState, "genre" | "detail" | "particular" | "templateLevel">,
): WeaponExperienceMaterialDefinition | null {
  return (
    WEAPON_EXP_MATERIALS.find(
      (definition) =>
        definition.genre === item.genre &&
        definition.detail === item.detail &&
        definition.particular === item.particular &&
        definition.templateLevel === item.templateLevel,
    ) ?? null
  );
}

export function weaponMaximumLevel(rarity: number, breakLevel: number): number {
  if (![1, 2, 3, 4].includes(rarity)) return 0;
  const maximumBreakLevel = rarity <= 2 ? 3 : 4;
  return 40 + Math.min(Math.max(0, breakLevel), maximumBreakLevel) * 10;
}

export function weaponExperienceBeforeLevel(level: number): number {
  let result = 0;
  for (
    let currentLevel = 1;
    currentLevel < level && currentLevel <= WEAPON_EXP_TO_NEXT_LEVEL.length;
    currentLevel += 1
  ) {
    result += WEAPON_EXP_TO_NEXT_LEVEL[currentLevel - 1] ?? 0;
  }
  return result;
}

/**
 * Mirrors WeaponCommon:GetWeaponGiveExp/GetWeaponGiveGold.
 */
export function sacrificedWeaponValue(
  level: number,
  rarity: number,
): { experience: number; coinCost: number } | null {
  const rarityExperience = WEAPON_RARITY_EXPERIENCE.get(rarity);
  if (!rarityExperience || level <= 0) return null;
  return {
    experience:
      Math.floor(Math.min(weaponExperienceBeforeLevel(level) * 0.3, 150_000)) +
      rarityExperience,
    coinCost: rarityExperience,
  };
}

/**
 * Mirrors Lib.lua GetItemDestLevel. At a breakthrough cap the original UI
 * warns that at most one next-level requirement is retained, so the persisted
 * overflow is capped to that value.
 */
export function addWeaponExperience(
  level: number,
  currentExperience: number,
  addedExperience: number,
  maximumLevel: number,
): { level: number; experience: number } {
  let destinationLevel = level;
  let destinationExperience = currentExperience + addedExperience;
  if (destinationLevel >= maximumLevel) {
    return { level: maximumLevel, experience: destinationExperience };
  }

  while (destinationLevel < maximumLevel) {
    const required = WEAPON_EXP_TO_NEXT_LEVEL[destinationLevel - 1] ?? 0;
    if (required <= 0 || destinationExperience < required) break;
    destinationExperience -= required;
    destinationLevel += 1;
  }

  if (destinationLevel >= maximumLevel) {
    const retainedLimit = WEAPON_EXP_TO_NEXT_LEVEL[maximumLevel - 1] ?? 0;
    destinationExperience = Math.min(destinationExperience, retainedLimit);
  }
  return {
    level: destinationLevel,
    experience: destinationExperience,
  };
}
