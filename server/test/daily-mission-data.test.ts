import { describe, expect, it } from "vitest";

import {
  dailyMissionOperationalDate,
  dailyMissionProgress,
  incrementDailyMissionProgress,
  makeDailyMissionTaskId,
  reconcileDailyMissions,
  DAILY_MISSION_ACTIVE_AWARD_TASK_ID,
  DAILY_MISSION_ACTIVE_POINT_TASK_ID,
  type DailyMissionPlayer,
} from "../src/game-data/daily-mission-data.js";

describe("daily mission data", () => {
  it("uses the 04:00 Asia/Shanghai operational boundary", () => {
    expect(dailyMissionOperationalDate(Date.parse("2026-07-27T19:59:59Z"))).toBe(
      "2026-07-27",
    );
    expect(dailyMissionOperationalDate(Date.parse("2026-07-27T20:00:00Z"))).toBe(
      "2026-07-28",
    );
  });

  it("packs progress above the claim bit and caps it at the configured target", () => {
    const player: DailyMissionPlayer = { taskValues: {} };
    const now = Date.parse("2026-07-29T12:00:00Z");

    expect(makeDailyMissionTaskId(101)).toBe(327_781);
    expect(incrementDailyMissionProgress(player, 101, 3, now)).toBe(true);
    expect(incrementDailyMissionProgress(player, 101, 10, now)).toBe(true);
    expect(
      dailyMissionProgress(player.taskValues[String(makeDailyMissionTaskId(101))]!),
    ).toBe(5);
    expect(incrementDailyMissionProgress(player, 101, 1, now)).toBe(false);
  });

  it("clears task progress, active points and chest flags on a new day", () => {
    const firstDay = Date.parse("2026-07-29T12:00:00Z");
    const nextDay = Date.parse("2026-07-30T12:00:00Z");
    const player: DailyMissionPlayer = { taskValues: {} };
    reconcileDailyMissions(player, firstDay);
    incrementDailyMissionProgress(player, 105, 4, firstDay);
    player.taskValues[
      String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_POINT_TASK_ID))
    ] = 75;
    player.taskValues[
      String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_AWARD_TASK_ID))
    ] = 14;

    expect(reconcileDailyMissions(player, nextDay)).toBe(true);
    expect(player.taskValues[String(makeDailyMissionTaskId(105))]).toBe(0);
    expect(
      player.taskValues[
        String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_POINT_TASK_ID))
      ],
    ).toBe(0);
    expect(
      player.taskValues[
        String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_AWARD_TASK_ID))
      ],
    ).toBe(0);
  });

  it("migrates values written with the reversed legacy task key", () => {
    const now = Date.parse("2026-07-29T12:00:00Z");
    const player: DailyMissionPlayer = {
      dailyMissions: { operationalDate: "2026-07-29" },
      taskValues: {
        [(101 << 16) | 5]: 2,
        [(DAILY_MISSION_ACTIVE_POINT_TASK_ID << 16) | 5]: 20,
      },
    };

    expect(reconcileDailyMissions(player, now)).toBe(true);
    expect(player.taskValues[String(makeDailyMissionTaskId(101))]).toBe(2);
    expect(
      player.taskValues[
        String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_POINT_TASK_ID))
      ],
    ).toBe(20);
    expect(player.taskValues[String((101 << 16) | 5)]).toBeUndefined();
  });
});
