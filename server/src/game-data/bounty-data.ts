import { createHash } from "node:crypto";

import type { Award, BaseAward } from "./chapter-config.js";

export const LUA_COMMAND_BOUNTY_JOIN = 50;
export const LUA_COMMAND_BOUNTY_PASS = 51;
export const LUA_COMMAND_BOUNTY_FAIL = 52;
export const BOUNTY_TASK_GROUP = 9;
export const BOUNTY_DAILY_REWARD_COUNT = 2;

export type BountyEventType = 1 | 2 | 4 | 5;

export interface BountyLevelConfig {
  activityId: number;
  eventType: BountyEventType;
  difficulty: number;
  name: string;
  mapId: number;
  energyCost: number;
  recommendedPower: number;
  masterExp: number;
  fixedAwards: BaseAward[];
  dailyAwards: BaseAward[];
}

export interface BountyThiefDrop {
  monId: number;
  tbDrop: Array<{ dropId: number; dropCount: number }>;
}

export interface BountyRun {
  level: BountyLevelConfig;
  awards: Award[];
  dailyBonusApplied: boolean;
  thiefDrops: BountyThiefDrop[];
  maximumGold: number;
}

interface ActivityDefinition {
  eventType: BountyEventType;
  label: string;
  attribute: number | null;
  openDays: readonly number[];
}

const DIFFICULTY_NAMES = ["Easy", "Normal", "Hard", "Nightmare", "Hell", "Purgatory"] as const;
const ENERGY_COSTS = [10, 15, 20, 25, 30, 30] as const;
const COMMON_POWER = [3_980, 4_940, 8_710, 11_860, 14_850, 17_600] as const;
const BREAK_POWER = [6_690, 8_950, 10_900, 13_670, 17_410, 19_000] as const;
const MAP_IDS: Readonly<Record<number, readonly number[]>> = {
  1: [1000, 1010, 1011, 1012, 1030, 1066],
  2: [1036, 1037, 1038, 1039, 1040, 1068],
  3: [1002, 1016, 1017, 1018, 1032, 1069],
  4: [1041, 1042, 1043, 1044, 1045, 1070],
  5: [1046, 1047, 1048, 1049, 1050, 1071],
  6: [1051, 1052, 1053, 1054, 1055, 1072],
  7: [1001, 1013, 1014, 1015, 1031, 1067],
  8: [1022, 1023, 1024, 1025, 1033, 1073],
  9: [1003, 1019, 1020, 1021, 1034, 1074],
  10: [1026, 1027, 1028, 1029, 1035, 1075],
  11: [1056, 1057, 1058, 1059, 1060, 1076],
  12: [1061, 1062, 1063, 1064, 1065, 1077],
};

const ACTIVITIES: Readonly<Record<number, ActivityDefinition>> = {
  1: {
    eventType: 1,
    label: "Crystala Hunt",
    attribute: null,
    openDays: [1, 2, 3, 4, 5, 6, 7],
  },
  2: { eventType: 2, label: "Biological Soldier Training", attribute: 1, openDays: [1, 6, 7] },
  3: { eventType: 2, label: "Mechanical Soldier Training", attribute: 3, openDays: [3, 6, 7] },
  4: { eventType: 2, label: "Psionic Soldier Training", attribute: 2, openDays: [2, 6, 7] },
  5: { eventType: 2, label: "Immune Soldier Training", attribute: 5, openDays: [4, 6, 7] },
  6: { eventType: 2, label: "Erosive Soldier Training", attribute: 6, openDays: [5, 6, 7] },
  7: {
    eventType: 4,
    label: "Part Collection",
    attribute: null,
    openDays: [1, 2, 3, 4, 5, 6, 7],
  },
  8: { eventType: 5, label: "Biological Limit Break", attribute: 1, openDays: [1, 6, 7] },
  9: { eventType: 5, label: "Mechanical Limit Break", attribute: 3, openDays: [3, 6, 7] },
  10: { eventType: 5, label: "Psionic Limit Break", attribute: 2, openDays: [2, 6, 7] },
  11: { eventType: 5, label: "Immune Limit Break", attribute: 5, openDays: [4, 6, 7] },
  12: { eventType: 5, label: "Erosive Limit Break", attribute: 6, openDays: [5, 6, 7] },
};

const COIN_FIXED = [6_400, 10_400, 14_400, 18_400, 23_200, 26_400] as const;
const COIN_RANDOM = [1_600, 2_600, 3_600, 4_600, 5_800, 6_600] as const;
const COIN_DAILY = [10_000, 15_000, 20_000, 25_000, 35_000, 40_000] as const;

const TRAIN_FIXED = [
  [7, 0, 0],
  [4, 2, 0],
  [2, 4, 0],
  [4, 5, 0],
  [0, 3, 1],
  [0, 2, 2],
] as const;
const TRAIN_DAILY = [
  [8, 0, 0],
  [4, 2, 0],
  [3, 4, 0],
  [3, 6, 0],
  [0, 4, 1],
  [0, 1, 2],
] as const;
const WEAPON_FIXED = [
  [8, 0, 0],
  [4, 2, 0],
  [2, 4, 0],
  [4, 5, 0],
  [0, 3, 1],
  [0, 2, 2],
] as const;
const WEAPON_DAILY = [
  [7, 0, 0],
  [4, 2, 0],
  [3, 4, 0],
  [3, 6, 0],
  [0, 4, 1],
  [0, 1, 2],
] as const;
const BREAK_FIXED = [
  [4, 1, 0],
  [6, 2, 0],
  [10, 3, 1],
  [14, 5, 2],
  [18, 6, 3],
  [20, 7, 3],
] as const;
const BREAK_DAILY = [
  [3, 1, 0],
  [5, 1, 0],
  [9, 2, 0],
  [12, 4, 1],
  [16, 5, 2],
  [20, 7, 3],
] as const;

function rewards(
  genre: number,
  detail: number,
  particular: number,
  counts: readonly number[],
): BaseAward[] {
  return counts.flatMap((count, index) =>
    count > 0
      ? ([[genre, detail, particular, index + 1, count]] satisfies BaseAward[])
      : [],
  );
}

function makeLevel(activityId: number, difficulty: number): BountyLevelConfig {
  const activity = ACTIVITIES[activityId]!;
  const index = difficulty - 1;
  let fixedAwards: BaseAward[];
  let dailyAwards: BaseAward[];
  if (activity.eventType === 1) {
    fixedAwards = [[15, 1, 1, 1, COIN_FIXED[index]!]];
    dailyAwards = [[15, 1, 1, 1, COIN_DAILY[index]!]];
  } else if (activity.eventType === 2) {
    fixedAwards = rewards(7, 1, activity.attribute!, TRAIN_FIXED[index]!);
    dailyAwards = rewards(7, 1, activity.attribute!, TRAIN_DAILY[index]!);
  } else if (activity.eventType === 4) {
    fixedAwards = rewards(7, 3, 1, WEAPON_FIXED[index]!);
    dailyAwards = rewards(7, 3, 1, WEAPON_DAILY[index]!);
  } else {
    fixedAwards = rewards(7, 2, activity.attribute!, BREAK_FIXED[index]!);
    dailyAwards = rewards(7, 2, activity.attribute!, BREAK_DAILY[index]!);
  }
  return {
    activityId,
    eventType: activity.eventType,
    difficulty,
    name: `${activity.label}-${DIFFICULTY_NAMES[index]}`,
    mapId: MAP_IDS[activityId]![index]!,
    energyCost: ENERGY_COSTS[index]!,
    recommendedPower:
      activity.eventType === 5 ? BREAK_POWER[index]! : COMMON_POWER[index]!,
    masterExp: ENERGY_COSTS[index]!,
    fixedAwards,
    dailyAwards,
  };
}

const LEVELS = new Map<string, BountyLevelConfig>();
for (const activityId of Object.keys(ACTIVITIES).map(Number)) {
  for (let difficulty = 1; difficulty <= 6; difficulty += 1) {
    LEVELS.set(`${activityId}:${difficulty}`, makeLevel(activityId, difficulty));
  }
}

export function getBountyLevel(
  activityId: number,
  difficulty: number,
): BountyLevelConfig | null {
  return LEVELS.get(`${activityId}:${difficulty}`) ?? null;
}

export function effectiveBountyEnergyCost(
  level: BountyLevelConfig,
  playerLevel: number,
): number {
  return playerLevel < 35 ? Math.ceil(level.energyCost / 2) : level.energyCost;
}

export function makeBountyPassTaskId(activityId: number): number {
  return (BOUNTY_TASK_GROUP << 16) | (100 + activityId);
}

export function makeBountyDailyTaskId(eventType: BountyEventType): number {
  return (BOUNTY_TASK_GROUP << 16) | (4_000 + eventType);
}

export function bountyOperationalDate(now = Date.now()): string {
  const shifted = new Date(now - 4 * 60 * 60 * 1_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

function shanghaiWeekday(now: number): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(new Date(now));
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday) + 1;
}

export function isBountyOpen(activityId: number, now = Date.now()): boolean {
  return ACTIVITIES[activityId]?.openDays.includes(shanghaiWeekday(now)) ?? false;
}

function deterministicRoll(seed: string, sequence: number, ceiling: number): number {
  const digest = createHash("sha256").update(`${seed}:${sequence}`).digest();
  return ceiling > 0 ? digest.readUInt32LE(0) % ceiling : 0;
}

function randomExtra(level: BountyLevelConfig, seed: string): BaseAward[] {
  const index = level.difficulty - 1;
  const roll = deterministicRoll(seed, 1, 10_000);
  if (level.eventType === 1) {
    return [[15, 1, 1, 1, COIN_RANDOM[index]!]];
  }
  if (level.eventType === 2 || level.eventType === 4) {
    const detail = level.eventType === 2 ? 1 : 3;
    const particular =
      level.eventType === 2 ? ACTIVITIES[level.activityId]!.attribute! : 1;
    const choices: readonly BaseAward[][] = [
      [],
      [[7, detail, particular, 1, 1]],
      [[7, detail, particular, 2, 1]],
      [[7, detail, particular, 2, 1 + (roll % 2)]],
      [[7, detail, particular, 2, 1 + (roll % 3)]],
      roll < 4_000
        ? [[7, detail, particular, 1, 5]]
        : [[7, detail, particular, 2, 1 + (roll % 3)]],
    ];
    return choices[index]!.map((award) => [...award] as BaseAward);
  }

  if (level.difficulty === 1) return [];
  if (level.difficulty === 2) {
    return [[7, 2, ACTIVITIES[level.activityId]!.attribute!, 1, 1]];
  }
  const tier4Chance = [0, 0, 1_000, 1_500, 2_500, 4_000][index]!;
  if (roll < tier4Chance) return [[7, 2, 4, 4, 1]];
  const tierRoll = deterministicRoll(seed, 2, 100);
  const tier = tierRoll < 50 ? 1 : tierRoll < 82 ? 2 : 3;
  return [[7, 2, ACTIVITIES[level.activityId]!.attribute!, tier, 1]];
}

const BLUE_GIFT_DROP_IDS = [
  18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 43, 45, 59, 61,
] as const;
const PURPLE_GIFT_DROP_IDS = [
  19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 44, 46, 60, 62,
] as const;

function thiefDrops(difficulty: number, seed: string): BountyThiefDrop[] {
  if (deterministicRoll(seed, 20, 10_000) >= 1_000) return [];
  const typeRoll = deterministicRoll(seed, 21, 1_000);
  const type =
    difficulty === 1
      ? 1
      : difficulty === 2
        ? typeRoll < 700
          ? 1
          : 2
        : difficulty === 3
          ? typeRoll < 300
            ? 1
            : 2
          : difficulty === 4
            ? 2
            : typeRoll < 900
              ? 2
              : 3;
  const monId = type === 1 ? 1309 : type === 2 ? 1311 : 1310;
  const drawCount = type === 1 ? 1 : type === 2 ? 3 : 5;
  const pool =
    type === 3
      ? [...BLUE_GIFT_DROP_IDS, ...PURPLE_GIFT_DROP_IDS, 42]
      : [...BLUE_GIFT_DROP_IDS, 42];
  const dustWeight = type === 3 ? 1_008 : 992;
  const giftWeight = type === 3 ? 281 : 563;
  const totalWeight = giftWeight * (pool.length - 1) + dustWeight;
  const counts = new Map<number, number>();
  for (let draw = 0; draw < drawCount; draw += 1) {
    let roll = deterministicRoll(seed, 22 + draw, totalWeight);
    let selected = 42;
    for (const dropId of pool) {
      const weight = dropId === 42 ? dustWeight : giftWeight;
      if (roll < weight) {
        selected = dropId;
        break;
      }
      roll -= weight;
    }
    counts.set(selected, (counts.get(selected) ?? 0) + 1);
  }
  return [
    {
      monId,
      tbDrop: [...counts].map(([dropId, dropCount]) => ({ dropId, dropCount })),
    },
  ];
}

export function rollBountyRun(
  level: BountyLevelConfig,
  seed: string,
  dailyRewardRemaining: number,
): BountyRun {
  const dailyBonusApplied = dailyRewardRemaining > 0;
  const awards: Award[] = [
    ...level.fixedAwards.map((award) => [...award, 100] as Award),
    ...randomExtra(level, seed).map((award) => [...award, 7] as Award),
    ...(dailyBonusApplied
      ? level.dailyAwards.map((award) => [...award, 100] as Award)
      : []),
  ];
  return {
    level,
    awards,
    dailyBonusApplied,
    thiefDrops: thiefDrops(level.difficulty, seed),
    maximumGold: awards
      .filter(([genre, detail]) => genre === 15 && detail === 1)
      .reduce((total, award) => total + award[4], 0),
  };
}

const DROP_ITEM_GDPL: Readonly<
  Record<number, readonly [number, number, number, number]>
> = {
  18: [5, 1, 1, 2],
  19: [5, 1, 1, 4],
  20: [5, 1, 2, 2],
  21: [5, 1, 2, 4],
  22: [5, 1, 3, 2],
  23: [5, 1, 3, 4],
  24: [5, 1, 4, 2],
  25: [5, 1, 4, 4],
  26: [5, 1, 5, 2],
  27: [5, 1, 5, 4],
  28: [5, 1, 6, 2],
  29: [5, 1, 6, 4],
  30: [5, 1, 7, 2],
  31: [5, 1, 7, 4],
  32: [5, 1, 8, 2],
  33: [5, 1, 8, 4],
  34: [5, 1, 9, 2],
  35: [5, 1, 9, 4],
  36: [5, 1, 10, 2],
  37: [5, 1, 10, 4],
  38: [5, 1, 11, 2],
  39: [5, 1, 11, 4],
  40: [5, 1, 12, 2],
  41: [5, 1, 12, 4],
  42: [9, 16, 1, 1],
  43: [5, 1, 14, 2],
  44: [5, 1, 14, 4],
  45: [5, 1, 15, 2],
  46: [5, 1, 15, 4],
  59: [5, 1, 13, 2],
  60: [5, 1, 13, 4],
  61: [5, 1, 16, 2],
  62: [5, 1, 16, 4],
};

export function thiefAwards(thiefDropsForRun: readonly BountyThiefDrop[]): Award[] {
  return thiefDropsForRun.flatMap(({ tbDrop }) =>
    tbDrop.flatMap(({ dropId, dropCount }) => {
      const gdpl = DROP_ITEM_GDPL[dropId];
      return gdpl ? [[...gdpl, dropCount, 10] as Award] : [];
    }),
  );
}

export function bountyKeyItem(
  eventType: BountyEventType,
  keyType: number,
): BaseAward | null {
  if (keyType !== 1 && keyType !== 2) return null;
  if (eventType === 2) return keyType === 1 ? [9, 4, 1, 3, 1] : [9, 4, 2, 4, 1];
  if (eventType === 5) return keyType === 1 ? [9, 4, 3, 3, 1] : [9, 4, 4, 4, 1];
  return null;
}
