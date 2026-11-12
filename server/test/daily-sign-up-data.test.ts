import { describe, expect, it } from "vitest";

import {
  dailySignUpOperationalDate,
  dailySignUpReward,
  daysInOperationalMonth,
} from "../src/game-data/daily-sign-up-data.js";

describe("daily sign-up data", () => {
  it("rolls the operational day over at 04:00 Asia/Shanghai", () => {
    expect(dailySignUpOperationalDate(Date.parse("2026-07-27T19:59:59Z"))).toBe(
      "2026-07-27",
    );
    expect(dailySignUpOperationalDate(Date.parse("2026-07-27T20:00:00Z"))).toBe(
      "2026-07-28",
    );
  });

  it("uses the original cumulative monthly reward table", () => {
    expect(dailySignUpReward(0, "2026-07-28")).toEqual([15, 1, 1, 1, 5_000]);
    expect(dailySignUpReward(6, "2026-07-28")).toEqual([15, 2, 1, 1, 50]);
    expect(dailySignUpReward(30, "2026-07-28")).toEqual([9, 12, 1, 1, 1]);
    expect(dailySignUpReward(29, "2026-02-01")).toBeNull();
    expect(daysInOperationalMonth("2024-02-01")).toBe(29);
  });
});
