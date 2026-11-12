import type { Gdpl } from "./gacha-data.js";

/**
 * Mirrors the shipped client data for girl gifting:
 *
 * - Gift experience: `Item/ItemList.txt` ExtParam1 for every genre-5 entry.
 * - Favorite gifts: `Girl/Secret.txt` FitItem (secret 11/12 for girls 1-16,
 *   secret 5 for link girls 201-204).
 * - Affinity curves: `Girl/Friendliness.txt` Exp/LinkExp columns. An entry is
 *   the residual experience required to leave that level; the final level has
 *   a 0 entry and acts purely as the cap.
 * - Level-gated secrets: `Girl/Secret.txt` FitLove thresholds.
 * - Activity gifts: `NormalActivity/HandWorkActivity.txt` id 120 plus its
 *   `ActivityList` window, used by `HandWorkLogic:GiftState`.
 */

export const GIRL_GIFT_GENRE = 5;

export const LINK_GIRL_MIN_ID = 201;
export const LINK_GIRL_MAX_ID = 204;

export const GIRL_AFFECTION_MAX_LEVEL = 100;
export const LINK_GIRL_AFFECTION_MAX_LEVEL = 50;

const FAVORITE_GIFT_SCALE = 1.25;
const LINK_FAVORITE_GIFT_SCALE = 2;

export function isLinkGirl(girlId: number): boolean {
  return girlId >= LINK_GIRL_MIN_ID && girlId <= LINK_GIRL_MAX_ID;
}

export function girlAffectionMaxLevel(girlId: number): number {
  return isLinkGirl(girlId) ? LINK_GIRL_AFFECTION_MAX_LEVEL : GIRL_AFFECTION_MAX_LEVEL;
}

function gdplKey(gdpl: readonly [number, number, number, number]): string {
  return gdpl.join("-");
}

/**
 * ExtParam1 experience per single gift, keyed by G-D-P-L.
 * Girls 1-16 each own a 60-exp (L=2) and a 300-exp (L=4) favorite gift under
 * detail 1; link girls 201-204 own a single 500-exp (L=4) favorite gift.
 * Detail 2 holds the generic gifts; particular 5/6 double as the handwork
 * activity gifts.
 */
export const GIRL_GIFT_EXPERIENCE: ReadonlyMap<string, number> = new Map([
  ...Array.from({ length: 16 }, (_, index) => index + 1).flatMap(
    (girlId): [string, number][] => [
      [gdplKey([5, 1, girlId, 2]), 60],
      [gdplKey([5, 1, girlId, 4]), 300],
    ],
  ),
  ...[201, 202, 203, 204].map((girlId): [string, number] => [
    gdplKey([5, 1, girlId, 4]),
    500,
  ]),
  [gdplKey([5, 2, 1, 1]), 30],
  [gdplKey([5, 2, 1, 2]), 60],
  [gdplKey([5, 2, 1, 3]), 150],
  [gdplKey([5, 2, 1, 4]), 300],
  [gdplKey([5, 2, 1, 5]), 150],
  [gdplKey([5, 2, 1, 6]), 300],
  [gdplKey([5, 2, 1, 7]), 300],
  [gdplKey([5, 2, 1, 8]), 300],
] as [string, number][]);

export function girlGiftBaseExperience(gdpl: Gdpl): number | null {
  return GIRL_GIFT_EXPERIENCE.get(gdplKey(gdpl)) ?? null;
}

/** Favorite gifts per girl, from Secret.txt FitItem rows. */
export const GIRL_FAVORITE_GIFTS: ReadonlyMap<number, readonly Gdpl[]> = new Map([
  ...Array.from({ length: 16 }, (_, index) => index + 1).map(
    (girlId): [number, readonly Gdpl[]] => [
      girlId,
      [
        [5, 1, girlId, 2],
        [5, 1, girlId, 4],
      ],
    ],
  ),
  ...[201, 202, 203, 204].map((girlId): [number, readonly Gdpl[]] => [
    girlId,
    [[5, 1, girlId, 4]],
  ]),
]);

export function isFavoriteGift(girlId: number, gdpl: Gdpl): boolean {
  const favorites = GIRL_FAVORITE_GIFTS.get(girlId);
  return favorites?.some((favorite) => gdplKey(favorite) === gdplKey(gdpl)) ?? false;
}

/**
 * Per-gift experience after the favorite-gift multiplier, matching
 * UI_GirlGift:GetNeedGiftMaxNum (1.25x, or 2x for link girls).
 */
export function girlGiftExperience(girlId: number, gdpl: Gdpl): number | null {
  const base = girlGiftBaseExperience(gdpl);
  if (base === null) return null;
  if (!isFavoriteGift(girlId, gdpl)) return base;
  return Math.floor(
    base * (isLinkGirl(girlId) ? LINK_FAVORITE_GIFT_SCALE : FAVORITE_GIFT_SCALE),
  );
}

/** Secret.txt rows whose FitItem matches a favorite gift: secretId per girl. */
export function favoriteGiftSecretIds(
  girlId: number,
): readonly { secretId: number; gdpl: Gdpl }[] {
  if (girlId >= 1 && girlId <= 16) {
    return [
      { secretId: 11, gdpl: [5, 1, girlId, 2] },
      { secretId: 12, gdpl: [5, 1, girlId, 4] },
    ];
  }
  if (isLinkGirl(girlId)) {
    return [{ secretId: 5, gdpl: [5, 1, girlId, 4] }];
  }
  return [];
}

/** Secret.txt FitLove thresholds for girls 1-16 (link girls have none). */
export const FIT_LOVE_SECRET_LEVELS: readonly { secretId: number; level: number }[] = [
  { secretId: 8, level: 10 },
  { secretId: 9, level: 10 },
  { secretId: 10, level: 20 },
  { secretId: 13, level: 30 },
  { secretId: 14, level: 40 },
  { secretId: 15, level: 50 },
  { secretId: 16, level: 60 },
  { secretId: 17, level: 70 },
  { secretId: 18, level: 80 },
  { secretId: 19, level: 90 },
  { secretId: 20, level: 100 },
];

/**
 * Exact Exp column from Girl/Friendliness.txt. Index is the level being
 * departed (element 0 is unused). Level 100 has Exp 0 and only serves as the
 * cap marker.
 */
const GIRL_EXP_TO_NEXT_LEVEL: readonly number[] = [
  0, 100, 105, 109, 116, 123, 132, 142, 153, 165, 178, 192, 207, 224, 241, 259, 278,
  298, 319, 341, 364, 387, 412, 437, 463, 490, 518, 547, 577, 607, 638, 670, 703, 736,
  771, 806, 842, 878, 916, 954, 993, 1_032, 1_073, 1_114, 1_156, 1_198, 1_242, 1_286,
  1_331, 1_376, 1_422, 1_469, 1_517, 1_565, 1_614, 1_664, 1_714, 1_765, 1_817, 1_869,
  1_923, 1_976, 2_031, 2_086, 2_142, 2_198, 2_255, 2_313, 2_372, 2_431, 2_491, 2_551,
  2_612, 2_674, 2_736, 2_799, 2_863, 2_927, 2_992, 3_058, 3_124, 3_191, 3_258, 3_326,
  3_395, 3_464, 3_534, 3_605, 3_676, 3_748, 3_821, 3_894, 3_967, 4_042, 4_116, 4_192,
  4_268, 4_345, 4_422, 4_500, 0,
];

/** Exact LinkExp column; link girls cap at level 50. */
const LINK_GIRL_EXP_TO_NEXT_LEVEL: readonly number[] = [
  0, 300, 315, 330, 345, 360, 375, 390, 410, 430, 450, 470, 490, 510, 535, 560, 585,
  610, 635, 665, 695, 725, 755, 790, 825, 860, 895, 935, 975, 1_015, 1_060, 1_105,
  1_150, 1_200, 1_250, 1_300, 1_355, 1_410, 1_470, 1_530, 1_595, 1_660, 1_730, 1_800,
  1_875, 1_950, 2_030, 2_115, 2_200, 2_290, 0,
];

export interface GirlAffectionGain {
  addedExperience: number;
  oldExperience: number;
  newExperience: number;
  oldLevel: number;
  newLevel: number;
  reachedMaxLevel: boolean;
}

/**
 * Faithful port of the original server-side `GirlCommon:Add`, including its
 * overflow discard: when a gain crosses the cap, the excess experience is
 * removed from `addedExperience` instead of carrying over.
 *
 * Returns null when the girl is already at her maximum level.
 */
export function addGirlAffection(
  girlId: number,
  level: number,
  experience: number,
  value: number,
): GirlAffectionGain | null {
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  const maxLevel = girlAffectionMaxLevel(girlId);
  if (level >= maxLevel) return null;

  const table = isLinkGirl(girlId)
    ? LINK_GIRL_EXP_TO_NEXT_LEVEL
    : GIRL_EXP_TO_NEXT_LEVEL;

  let total = experience + value;
  let virtualLevel = level;
  let required = table[virtualLevel];
  if (required === undefined) return null;

  while (total >= required) {
    total -= required;
    virtualLevel += 1;

    if (virtualLevel >= maxLevel) {
      value -= total;
      total = 0;
      break;
    }

    required = table[virtualLevel];
    if (required === undefined) return null;
  }

  return {
    addedExperience: value,
    oldExperience: experience,
    newExperience: total,
    oldLevel: level,
    newLevel: virtualLevel,
    reachedMaxLevel: virtualLevel >= maxLevel,
  };
}

/** GirlLogic LevelAward: one slot per ten levels, up to level 200. */
export function girlLevelAwardIndex(level: number): number | null {
  if (!Number.isSafeInteger(level) || level % 10 !== 0) return null;
  const index = Math.floor(level / 10);
  return index >= 1 && index <= 20 ? index : null;
}

interface HandworkActivityConfig {
  activityId: number;
  begin: string;
  end: string;
  specialGift: Gdpl;
  normalGift: Gdpl;
}

/** HandWorkActivity.txt id 120 with its ActivityList.txt window. */
const HANDWORK_ACTIVITIES: readonly HandworkActivityConfig[] = [
  {
    activityId: 120,
    begin: "202107300400",
    end: "202108200400",
    specialGift: [5, 2, 1, 6],
    normalGift: [5, 2, 1, 5],
  },
];

function activityTimestamp(token: string): number {
  const year = Number(token.slice(0, 4));
  const month = Number(token.slice(4, 6)) - 1;
  const day = Number(token.slice(6, 8));
  const hour = Number(token.slice(8, 10));
  const minute = Number(token.slice(10, 12));
  return new Date(year, month, day, hour, minute).getTime();
}

export interface HandworkGiftState {
  active: boolean;
  special: boolean;
}

/**
 * Port of `HandWorkLogic:GiftState`: the handwork activity ran
 * 2021-07-30 04:00 to 2021-08-20 04:00, so both flags are false today; the
 * window check stays for fidelity.
 */
export function handworkGiftState(gdpl: Gdpl, now = Date.now()): HandworkGiftState {
  for (const activity of HANDWORK_ACTIVITIES) {
    if (
      now < activityTimestamp(activity.begin) ||
      now >= activityTimestamp(activity.end)
    ) {
      continue;
    }
    if (gdplKey(gdpl) === gdplKey(activity.specialGift)) {
      return { active: true, special: true };
    }
    if (gdplKey(gdpl) === gdplKey(activity.normalGift)) {
      return { active: true, special: false };
    }
    return { active: false, special: false };
  }
  return { active: false, special: false };
}
