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

export function addCardExperience(
  level: number,
  currentExperience: number,
  addedExperience: number,
): { level: number; experience: number } {
  let nextLevel = level;
  let experience = currentExperience + addedExperience;
  while (nextLevel <= CARD_EXP_TO_NEXT_LEVEL.length) {
    const required = CARD_EXP_TO_NEXT_LEVEL[nextLevel - 1];
    if (required === undefined || experience < required) break;
    experience -= required;
    nextLevel += 1;
  }
  return { level: nextLevel, experience };
}
