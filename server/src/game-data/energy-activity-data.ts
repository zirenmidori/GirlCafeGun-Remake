import { readFileSync } from "node:fs";
import path from "node:path";
import { dailySignUpOperationalDate } from "./daily-sign-up-data.js";
import type { Player } from "../persistence/player-repository.js";

export const ENERGY_ACTIVITY_ID = 8;
export interface EnergyActivityState {
  operationalDate: string;
}
export interface EnergyWindow {
  id: number;
  beginMinute: number;
  endMinute: number;
  energy: number;
}
let cached: readonly EnergyWindow[] | undefined;

/** Exact NormalActivity/EnergyActivity table used by UI_EnergyGet. */
export function energyActivityWindows(): readonly EnergyWindow[] {
  if (cached) return cached;
  const lines = readFileSync(
    path.resolve(process.cwd(), "resources/activity/energyactivity.txt"),
    "utf8",
  ).split(/\r?\n/);
  const columns = lines[2]!.split("\t");
  const minute = (value: string): number => {
    const hhmm = Number(value);
    if (!Number.isInteger(hhmm) || hhmm < 0 || hhmm > 2400 || hhmm % 100 >= 60)
      throw new Error("Invalid energy activity time");
    return Math.floor(hhmm / 100) * 60 + (hhmm % 100);
  };
  const rows = lines
    .slice(3)
    .filter((line) => line.trim())
    .map((line) => {
      const cells = line.split("\t");
      const row = Object.fromEntries(
        columns.map((column, index) => [column, cells[index]!]),
      );
      return {
        id: Number(row.Id),
        beginMinute: minute(row.BeginTime!),
        endMinute: minute(row.EndTime!),
        energy: Number(row.Energy),
      };
    });
  if (
    !rows.length ||
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    rows.some(
      (row) =>
        !Number.isSafeInteger(row.id) ||
        row.id <= 0 ||
        row.id > 100 ||
        !Number.isSafeInteger(row.energy) ||
        row.energy <= 0 ||
        row.beginMinute === row.endMinute,
    )
  )
    throw new Error("Invalid energy activity table");
  return (cached = Object.freeze(rows.map((row) => Object.freeze(row))));
}
export function energyActivityTaskId(id: number): number {
  return (20 << 16) | (10_000 + id);
}
export function isEnergyActivityTaskId(id: number): boolean {
  return energyActivityWindows().some(
    (window) => energyActivityTaskId(window.id) === id,
  );
}
export function reconcileEnergyActivity(player: Player, now: number): boolean {
  const date = dailySignUpOperationalDate(now);
  if (!player.energyActivity) {
    player.energyActivity = { operationalDate: date };
    return false; // Preserve any legitimate legacy claim flags for this day.
  }
  if (typeof player.energyActivity.operationalDate !== "string") {
    // Save made by the earlier phone build: { lastDate } in local time. Keep
    // the claim flags only when that day is still the current operational day.
    const legacy = player.energyActivity as { lastDate?: string | null };
    player.energyActivity.operationalDate = legacy.lastDate === date ? date : "";
    delete legacy.lastDate;
  }
  if (player.energyActivity.operationalDate >= date) return false;
  player.energyActivity.operationalDate = date;
  let changed = false;
  for (const window of energyActivityWindows()) {
    const key = String(energyActivityTaskId(window.id));
    changed ||= (player.taskValues[key] ?? 0) !== 0;
    player.taskValues[key] = 0;
  }
  return changed;
}
export function currentEnergyWindow(now: number): EnergyWindow | undefined {
  const local = new Date(now + 8 * 3_600_000); // Native server zone is UTC+8.
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return energyActivityWindows().find((window) =>
    window.beginMinute < window.endMinute
      ? minute >= window.beginMinute && minute < window.endMinute
      : minute >= window.beginMinute || minute < window.endMinute,
  );
}
