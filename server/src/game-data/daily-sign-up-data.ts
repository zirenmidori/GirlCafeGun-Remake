import type { BaseAward } from "./chapter-config.js";

export const DAILY_SIGN_UP_TASK_GROUP = 20;
export const DAILY_SIGN_UP_TODAY_TASK = 11_001;
export const DAILY_SIGN_UP_TOTAL_TASK = 11_002;
// NormalActivityConfig.TID_MONTHSIGN / TID_MONTHSIGN_Energy：月卡每日钻石与
// 体力的签到状态，0 未签 1 已签，4 点随 11001 一起清空。
export const DAILY_SIGN_UP_MONTH_DIAMOND_TASK = 11_004;
export const DAILY_SIGN_UP_MONTH_ENERGY_TASK = 11_005;

// 月卡日奖励数值来自 ItemList 的 IBMonthCardAuto（[14,2,1,1]）：
// ExtParam2=50 → 每日钻石；ExtParam3=30 → 每日体力（genre 15 detail 4 为
// ItemEnergyAuto）。UI_SignActivity 的 monthText 展示的正是 ExtParam2。
export const MONTH_CARD_DAILY_DIAMOND_AWARD: BaseAward = [15, 2, 1, 1, 50];
export const MONTH_CARD_DAILY_ENERGY_AWARD: BaseAward = [15, 4, 1, 1, 30];

export function makeDailySignUpTaskId(taskId: number): number {
  return (DAILY_SIGN_UP_TASK_GROUP << 16) | taskId;
}

/**
 * NormalActivity/SignUpActivity.txt uses the same cumulative reward sequence
 * for every month. The month only controls how many rows are available.
 */
export const DAILY_SIGN_UP_REWARDS: readonly BaseAward[] = [
  [15, 1, 1, 1, 5_000],
  [10, 1, 1, 2, 1],
  [9, 12, 1, 1, 1],
  [7, 1, 4, 3, 5],
  [5, 2, 1, 3, 1],
  [7, 2, 4, 4, 1],
  [15, 2, 1, 1, 50],
  [15, 1, 1, 1, 10_000],
  [10, 1, 1, 2, 1],
  [7, 7, 1, 4, 1],
  [7, 3, 1, 3, 5],
  [5, 2, 1, 3, 1],
  [7, 2, 4, 4, 1],
  [2, 2, 10_000, 1, 1],
  [15, 1, 1, 1, 15_000],
  [10, 1, 1, 2, 1],
  [9, 12, 1, 1, 1],
  [7, 1, 4, 3, 5],
  [5, 2, 1, 3, 1],
  [7, 2, 4, 4, 1],
  [15, 2, 1, 1, 100],
  [15, 1, 1, 1, 20_000],
  [10, 1, 1, 2, 1],
  [7, 7, 1, 4, 1],
  [7, 3, 1, 3, 5],
  [5, 2, 1, 3, 1],
  [7, 2, 4, 4, 1],
  [7, 4, 1, 4, 1],
  [15, 1, 1, 1, 25_000],
  [10, 1, 1, 2, 1],
  [9, 12, 1, 1, 1],
];

/**
 * The client considers a day to start at 04:00 in Asia/Shanghai. Shanghai is
 * UTC+8 without daylight saving time, so the operational date is UTC+4.
 */
export function dailySignUpOperationalDate(now = Date.now()): string {
  return new Date(now + 4 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export function daysInOperationalMonth(operationalDate: string): number {
  const [year, month] = operationalDate.split("-").map(Number);
  if (!year || !month) throw new Error(`Invalid operational date: ${operationalDate}`);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dailySignUpReward(
  cumulativeCount: number,
  operationalDate: string,
): BaseAward | null {
  const availableDays = daysInOperationalMonth(operationalDate);
  if (
    !Number.isSafeInteger(cumulativeCount) ||
    cumulativeCount < 0 ||
    cumulativeCount >= availableDays
  ) {
    return null;
  }
  return DAILY_SIGN_UP_REWARDS[cumulativeCount] ?? null;
}
