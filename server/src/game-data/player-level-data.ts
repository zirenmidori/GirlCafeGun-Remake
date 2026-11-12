export interface PlayerLevelConfig {
  level: number;
  experience: number;
  vigourRecovery: number;
}

export interface PlayerExperienceResult {
  level: number;
  experience: number;
  levelsGained: number;
  vigourRecovery: number;
}

/**
 * Exact Exp column from Player/PlayerExp.txt in the shipped client.
 * An entry is the residual experience required to leave that level.
 */
const PLAYER_EXP_TO_NEXT_LEVEL: readonly number[] = [
  10, 10, 12, 13, 15, 18, 21, 24, 28, 32, 36, 41, 46, 52, 58, 64, 70, 77, 84, 91, 99,
  107, 115, 124, 132, 142, 151, 160, 170, 181, 191, 202, 213, 224, 235, 247, 259, 271,
  284, 296, 309, 323, 336, 350, 364, 378, 392, 407, 422, 429, 437, 444, 460, 475, 491,
  507, 524, 540, 557, 574, 592, 609, 627, 645, 663, 682, 700, 719, 739, 758, 778, 797,
  817, 838, 858, 879, 900, 921, 943, 964, 986, 1008, 1030, 1053, 1076, 1099, 1122, 1145,
  1169, 1193, 1217, 1241, 1265, 1290, 1315, 1340, 1365, 1391, 1417, 1442, 1528, 1554,
  1580, 1606, 1633, 1659, 1686, 1713, 1740, 1767, 1795, 1823, 1850, 1878, 1907, 1935,
  1964, 1992, 2021, 2097, 2125, 2153, 2181, 2210, 2239, 2268, 2296, 2326, 2355, 2419,
  2447, 2475, 2503, 2532, 2560, 2589, 2617, 2646, 2675, 2704, 2733, 2762, 2792, 2821,
  2851, 2880, 2910, 2940, 2970, 3000, 3030, 3063, 3091, 3118, 3144, 3170, 3195, 3219,
  3244, 3268, 3291, 3315, 3338, 3361, 3384, 3406, 3429, 3451, 3473, 3495, 3517, 3539,
  3561, 3583, 3604, 3626, 3647, 3668, 3690, 3711, 3732, 3753, 3774, 3795, 3816, 3836,
  3857, 3878, 3898, 3919, 3939, 3960, 3980, 4001, 4021, 4041, 4061, 4081, 4102, 4122,
  4142, 4162, 4182, 4201, 4221, 4241, 4261, 4281, 4300, 4320, 4340, 4359, 4379, 4399,
  4418, 4438, 4457, 4477, 4496, 4515, 4535, 4554, 4573, 4593, 4612, 4631, 4650, 4670,
  4689, 4708, 4727, 4746, 4765, 4784, 4803, 4822, 4841, 4860, 4879, 4898, 4917, 4936,
  4954, 4973, 4992, 5011, 5030, 5048, 5067, 5086, 5104, 5123, 5142, 5160, 5179, 5198,
  5216, 5235, 5253, 5272, 5290, 5309, 5327, 5346, 5364, 5382, 5401, 5419, 5438, 5456,
  5474, 5493, 5511, 5529, 5547, 5566, 5584, 5602, 5620, 5639, 5657, 5675, 5693, 5711,
  5729, 5748, 5766, 5784, 5802, 5820, 5838, 5856, 5874, 5892, 5910, 5928, 5946, 5964,
  5982, 0,
];

/**
 * Exact SpiritRecover column. From level 90 onward the value is 150.
 * The client adds the departed level's value for every level crossed.
 */
const PLAYER_VIGOUR_RECOVERY: readonly number[] = [
  15,
  17,
  18,
  19,
  20,
  21,
  21,
  22,
  23,
  31,
  33,
  34,
  35,
  36,
  37,
  39,
  40,
  41,
  42,
  66,
  67,
  69,
  71,
  73,
  75,
  76,
  78,
  80,
  82,
  84,
  86,
  87,
  89,
  91,
  93,
  95,
  96,
  98,
  100,
  102,
  104,
  106,
  107,
  109,
  111,
  113,
  115,
  117,
  120,
  121,
  122,
  123,
  124,
  125,
  126,
  127,
  128,
  129,
  130,
  131,
  132,
  133,
  134,
  135,
  136,
  137,
  138,
  139,
  140,
  140,
  141,
  141,
  142,
  142,
  143,
  143,
  144,
  144,
  145,
  145,
  146,
  146,
  147,
  147,
  148,
  148,
  149,
  149,
  ...Array<number>(212).fill(150),
];

export const MAX_PLAYER_LEVEL = PLAYER_EXP_TO_NEXT_LEVEL.length;

if (MAX_PLAYER_LEVEL !== 300 || PLAYER_VIGOUR_RECOVERY.length !== MAX_PLAYER_LEVEL) {
  throw new Error("Invalid embedded PlayerExp configuration");
}

export function getPlayerLevelConfig(level: number): PlayerLevelConfig | null {
  if (!Number.isSafeInteger(level) || level < 1 || level > MAX_PLAYER_LEVEL) {
    return null;
  }
  return {
    level,
    experience: PLAYER_EXP_TO_NEXT_LEVEL[level - 1]!,
    vigourRecovery: PLAYER_VIGOUR_RECOVERY[level - 1]!,
  };
}

/**
 * Applies experience using the client's residual-exp model. Excess experience
 * rolls over repeatedly, while reaching the configured cap clears the bar.
 */
export function addPlayerExperience(
  currentLevel: number,
  currentExperience: number,
  addedExperience: number,
): PlayerExperienceResult {
  let level = Math.min(
    MAX_PLAYER_LEVEL,
    Math.max(1, Number.isSafeInteger(currentLevel) ? currentLevel : 1),
  );
  let experience =
    Math.max(0, Number.isSafeInteger(currentExperience) ? currentExperience : 0) +
    Math.max(0, Number.isSafeInteger(addedExperience) ? addedExperience : 0);
  let levelsGained = 0;
  let vigourRecovery = 0;

  while (level < MAX_PLAYER_LEVEL) {
    const config = getPlayerLevelConfig(level)!;
    if (config.experience <= 0 || experience < config.experience) break;
    experience -= config.experience;
    vigourRecovery += config.vigourRecovery;
    level += 1;
    levelsGained += 1;
  }

  if (level === MAX_PLAYER_LEVEL) experience = 0;
  return { level, experience, levelsGained, vigourRecovery };
}
