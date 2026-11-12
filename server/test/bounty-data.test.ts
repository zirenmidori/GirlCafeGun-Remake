import { describe, expect, it } from "vitest";

import {
  bountyOperationalDate,
  effectiveBountyEnergyCost,
  getBountyLevel,
  isBountyOpen,
  makeBountyDailyTaskId,
  makeBountyPassTaskId,
  rollBountyRun,
} from "../src/game-data/bounty-data.js";

describe("bounty battle configuration", () => {
  it("reconstructs all 12 activities and six difficulties", () => {
    for (let activityId = 1; activityId <= 12; activityId += 1) {
      for (let difficulty = 1; difficulty <= 6; difficulty += 1) {
        expect(getBountyLevel(activityId, difficulty)).not.toBeNull();
      }
    }
    expect(getBountyLevel(1, 1)).toMatchObject({
      name: "Crystala Hunt-Easy",
      mapId: 1000,
      energyCost: 10,
      recommendedPower: 3_980,
      fixedAwards: [[15, 1, 1, 1, 6_400]],
      dailyAwards: [[15, 1, 1, 1, 10_000]],
    });
    expect(getBountyLevel(8, 6)).toMatchObject({
      name: "Biological Limit Break-Purgatory",
      mapId: 1073,
      energyCost: 30,
      recommendedPower: 19_000,
      fixedAwards: [
        [7, 2, 1, 1, 20],
        [7, 2, 1, 2, 7],
        [7, 2, 1, 3, 3],
      ],
    });
  });

  it("applies the daily bonus only while a daily count remains", () => {
    const level = getBountyLevel(1, 1)!;
    const first = rollBountyRun(level, "same-run", 2);
    const retry = rollBountyRun(level, "same-run", 2);
    const exhausted = rollBountyRun(level, "same-run", 0);

    expect(first).toEqual(retry);
    expect(first.maximumGold).toBe(18_000);
    expect(exhausted.maximumGold).toBe(8_000);
    expect(exhausted.dailyBonusApplied).toBe(false);
  });

  it("halves all bounty energy costs before manager level 35", () => {
    expect(effectiveBountyEnergyCost(getBountyLevel(1, 1)!, 34)).toBe(5);
    expect(effectiveBountyEnergyCost(getBountyLevel(1, 2)!, 34)).toBe(8);
    expect(effectiveBountyEnergyCost(getBountyLevel(1, 2)!, 35)).toBe(15);
  });

  it("uses the client task IDs and the 04:00 Shanghai reset boundary", () => {
    expect(makeBountyPassTaskId(1)).toBe((9 << 16) | 101);
    expect(makeBountyDailyTaskId(5)).toBe((9 << 16) | 4_005);
    expect(bountyOperationalDate(Date.parse("2026-07-28T19:59:59Z"))).toBe(
      "2026-07-28",
    );
    expect(bountyOperationalDate(Date.parse("2026-07-28T20:00:00Z"))).toBe(
      "2026-07-29",
    );
  });

  it("opens rotated attributes on their weekday and all of them on weekends", () => {
    const mondayNoon = Date.parse("2026-07-27T04:00:00Z");
    const tuesdayNoon = Date.parse("2026-07-28T04:00:00Z");
    const saturdayNoon = Date.parse("2026-08-01T04:00:00Z");

    expect(isBountyOpen(2, mondayNoon)).toBe(true);
    expect(isBountyOpen(4, mondayNoon)).toBe(false);
    expect(isBountyOpen(4, tuesdayNoon)).toBe(true);
    expect(isBountyOpen(2, saturdayNoon)).toBe(true);
    expect(isBountyOpen(12, saturdayNoon)).toBe(true);
    expect(isBountyOpen(1, tuesdayNoon)).toBe(true);
    expect(isBountyOpen(7, tuesdayNoon)).toBe(true);
  });
});
