export const LUA_COMMAND_CARD_LEVEL_UP_COMMON = 5;

export interface CardEnhancementMaterial {
  kind: number;
  reference: number;
  count: number;
}

export interface CardEnhancementRequest {
  guid: number;
  clientLevel: number;
  clientSkillLevel: number;
  materials: CardEnhancementMaterial[];
}

export interface ExpMaterialDefinition {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  experience: number;
  coinCost: number;
}

export interface SkillMaterialDefinition {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  coinCost: number;
}

const EXP_CARD_PARTICULARS = [1, 2, 3, 5, 6, 4] as const;
const EXP_CARD_BASE_EXPERIENCE = [500, 2_500, 10_000, 50_000] as const;
const CLIENT_SELECTABLE_EXP_RATE = 1.5;

/**
 * Mirrors ItemList.asset ExtParam1 and CardCommon:GetItemExp().
 *
 * The shipped UI only exposes same-attribute and generic experience materials.
 * Both use CardCommon.SameAttrEXPRate (1.5), so these are the exact experience
 * values shown in the client before it sends Card_LevelUpCommon. ItemList's
 * ExtParam2 is the per-material coin cost and is not affected by that rate.
 */
export const CARD_EXP_MATERIALS: ReadonlyMap<number, ExpMaterialDefinition> = new Map(
  EXP_CARD_BASE_EXPERIENCE.flatMap((baseExperience, tierIndex) =>
    EXP_CARD_PARTICULARS.map((particular, particularIndex) => [
      tierIndex * EXP_CARD_PARTICULARS.length + particularIndex + 1,
      {
        genre: 7,
        detail: 1,
        particular,
        templateLevel: tierIndex + 1,
        experience: Math.floor(baseExperience * CLIENT_SELECTABLE_EXP_RATE),
        coinCost: baseExperience,
      },
    ]),
  ),
);

/**
 * CardCommon.tbExpCard has 24 entries; the two indexes after them are the
 * skill items 7-4-1-3 and 7-4-1-4 (CardCommon:GetEnhanceCardGDPL). Each item
 * raises one skill level and costs its ItemList ExtParam2 in gold.
 */
export const CARD_SKILL_MATERIALS: ReadonlyMap<number, SkillMaterialDefinition> =
  new Map([
    [
      CARD_EXP_MATERIALS.size + 1,
      { genre: 7, detail: 4, particular: 1, templateLevel: 3, coinCost: 1_500 },
    ],
    [
      CARD_EXP_MATERIALS.size + 2,
      { genre: 7, detail: 4, particular: 1, templateLevel: 4, coinCost: 3_500 },
    ],
  ]);

export const CARD_EXP_TO_NEXT_LEVEL = [
  133, 187, 263, 406, 562, 730, 907, 1_092, 1_286, 1_485, 1_691, 1_904, 2_121, 2_345,
  2_573, 2_806, 3_043, 3_285, 3_532, 3_782, 4_035, 4_294, 4_554, 4_820, 5_088, 5_359,
  5_635, 5_912, 6_193, 6_478, 6_764, 7_054, 7_346, 7_641, 7_940, 8_240, 8_542, 8_849,
  9_156, 13_394, 14_165, 14_963, 15_784, 16_630, 17_503, 18_399, 19_321, 20_269, 21_243,
  22_242, 23_267, 24_320, 25_398, 26_502, 27_634, 28_792, 29_977, 31_189, 32_429,
  33_695, 34_990, 36_312, 37_661, 39_040, 40_445, 41_879, 43_341, 44_832, 46_351,
] as const;

export function parseCardEnhancementRequest(
  parameters: unknown,
): CardEnhancementRequest | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const envelope = parameters as Record<string, unknown>;
  const value =
    typeof envelope.tbParam === "object" && envelope.tbParam !== null
      ? (envelope.tbParam as Record<string, unknown>)
      : envelope;
  const guid = Number(value.guid);
  const clientLevel = Number(value.clientlv);
  const clientSkillLevel = Number(value.clientSkillLv);
  if (
    !Number.isSafeInteger(guid) ||
    guid <= 0 ||
    !Number.isSafeInteger(clientLevel) ||
    clientLevel <= 0 ||
    !Number.isSafeInteger(clientSkillLevel) ||
    clientSkillLevel < 0 ||
    !Array.isArray(value.items)
  ) {
    return null;
  }

  const materials: CardEnhancementMaterial[] = [];
  for (const rawMaterial of value.items) {
    if (!Array.isArray(rawMaterial) || rawMaterial.length < 3) return null;
    const kind = Number(rawMaterial[0]);
    const reference = Number(rawMaterial[1]);
    const count = Number(rawMaterial[2]);
    if (
      !Number.isSafeInteger(kind) ||
      !Number.isSafeInteger(reference) ||
      !Number.isSafeInteger(count) ||
      kind <= 0 ||
      reference <= 0 ||
      count <= 0
    ) {
      return null;
    }
    materials.push({ kind, reference, count });
  }
  if (materials.length === 0) return null;

  return { guid, clientLevel, clientSkillLevel, materials };
}

/** The last row of the experience table; break rows lower the cap per card. */
export const CARD_MAXIMUM_ENHANCE_LEVEL = CARD_EXP_TO_NEXT_LEVEL.length + 1;

/**
 * Adds experience up to maximumLevel. A card already at or above the cap keeps
 * its level and gets no more experience; of the experience left over when the
 * cap is reached, at most one next-level requirement stays on the card.
 */
export function addCardExperience(
  level: number,
  currentExperience: number,
  addedExperience: number,
  maximumLevel: number = CARD_MAXIMUM_ENHANCE_LEVEL,
): { level: number; experience: number } {
  if (level >= maximumLevel) return { level, experience: currentExperience };
  let nextLevel = level;
  let experience = currentExperience + addedExperience;
  while (nextLevel < maximumLevel) {
    const required = CARD_EXP_TO_NEXT_LEVEL[nextLevel - 1];
    if (required === undefined || experience < required) break;
    experience -= required;
    nextLevel += 1;
  }
  if (nextLevel >= maximumLevel) {
    // UI_CardMain keeps at most one next-level requirement at the cap
    // (keepExp = min(overflow, need(cap -> cap+1))), as weapons do.
    experience = Math.min(experience, CARD_EXP_TO_NEXT_LEVEL[maximumLevel - 1] ?? 0);
  }
  return { level: nextLevel, experience };
}

/** Error keys are looked up as ui.<key> in the text table. */
export const CARD_ERROR_GENERIC = "Error.1";
export const CARD_ERROR_NOT_ENOUGH = "UI_WeaponStrong.NotEnough";
export const CARD_ERROR_NOT_ENOUGH_BREAK_ITEMS = "Error.20011";
export const CARD_ERROR_NOT_ENOUGH_BREAK_GOLD = "UI_WeaponStrong.GetGold";
export const CARD_ERROR_IN_FORMATION = "Card.Tip01";
export const CARD_ERROR_LOCKED = "Card.Tip02";
export const CARD_ERROR_SKILL_MAXED = "UI_Card.fullskill";
export const CARD_ERROR_MAXIMUM_LEVEL = "UI_Card.MaxLevel";
export const CARD_ERROR_MAXIMUM_BREAK = "Error.breaktime";

export class CardEnhancementError extends Error {
  constructor(
    readonly reason: string,
    readonly errorKey: string,
    readonly guid = 0,
  ) {
    super(`Card enhancement rejected: ${reason}`);
    this.name = "CardEnhancementError";
  }
}
