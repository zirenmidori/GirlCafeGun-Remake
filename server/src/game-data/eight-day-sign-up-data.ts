import type { BaseAward } from "./chapter-config.js";

export const EIGHT_DAY_SIGN_UP_ACTIVITY_ID = 29;
export const EIGHT_DAY_SIGN_UP_TASK_GROUP = 18;

export interface EightDaySignUpReward {
  achievementId: number;
  requiredDays: number;
  awards: readonly BaseAward[];
}

export const EIGHT_DAY_SIGN_UP_REWARDS: readonly EightDaySignUpReward[] = [
  {
    achievementId: 23,
    requiredDays: 1,
    awards: [[15, 2, 1, 1, 30]],
  },
  {
    achievementId: 24,
    requiredDays: 2,
    awards: [[1, 2, 4, 3, 1]],
  },
  {
    achievementId: 25,
    requiredDays: 3,
    awards: [[2, 2, 8, 1, 1]],
  },
  {
    achievementId: 26,
    requiredDays: 4,
    awards: [[10, 1, 1, 3, 1]],
  },
  {
    achievementId: 27,
    requiredDays: 5,
    awards: [
      [5, 2, 1, 2, 3],
      [15, 1, 1, 1, 10_000],
    ],
  },
  {
    achievementId: 28,
    requiredDays: 6,
    awards: [[9, 12, 1, 1, 1]],
  },
  {
    achievementId: 29,
    requiredDays: 7,
    awards: [
      [11, 5, 15, 2, 1],
      [15, 1, 1, 1, 20_000],
    ],
  },
  {
    achievementId: 30,
    requiredDays: 8,
    awards: [[1, 9, 9, 4, 1]],
  },
];

export function eightDaySignUpReward(
  achievementId: number,
): EightDaySignUpReward | null {
  return (
    EIGHT_DAY_SIGN_UP_REWARDS.find(
      (reward) => reward.achievementId === achievementId,
    ) ?? null
  );
}

export function makeEightDaySignUpTaskId(achievementId: number): number {
  return (EIGHT_DAY_SIGN_UP_TASK_GROUP << 16) | achievementId;
}

export function eightDaySignUpProgress(taskValue: number): number {
  return taskValue >>> 1;
}

export function hasClaimedEightDaySignUpReward(taskValue: number): boolean {
  return (taskValue & 1) === 1;
}

export function makeEightDaySignUpTaskValue(
  cumulativeDays: number,
  claimed: boolean,
): number {
  return (Math.max(0, cumulativeDays) << 1) | (claimed ? 1 : 0);
}
