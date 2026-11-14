import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACHIEVEMENT_TASK_GROUP,
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  ActivityAchievementCatalog,
  achievementProgress,
  derivedAchievementProgress,
  hasClaimedAchievement,
  makeAchievementTaskId,
  makeAchievementTaskValue,
  parseActivityDate,
  projectAchievementProgress,
  reconcileActivityAchievements,
  requiredAchievementCount,
  type ActivityAchievementPlayer,
} from "../src/game-data/activity-achievement-data.js";
import { EIGHT_DAY_SIGN_UP_REWARDS } from "../src/game-data/eight-day-sign-up-data.js";

const catalog = ActivityAchievementCatalog.loadDefault();
const now = Date.parse("2026-11-14T12:00:00Z");

function makePlayer(
  overrides: Partial<ActivityAchievementPlayer> = {},
): ActivityAchievementPlayer {
  return {
    taskValues: {},
    level: 1,
    registerTime: Math.floor(now / 1_000),
    levels: [],
    girls: [],
    inventory: [],
    eightDaySignUp: { cumulativeDays: 0 },
    ...overrides,
  };
}

function other(id: number) {
  const config = catalog.achievement(ACTIVITY_ACHIEVEMENT_TASK_GROUP, id);
  if (!config) throw new Error(`Missing AchievementOther ${id}`);
  return config;
}

describe("activity achievement tables", () => {
  it("keeps every table a byte-exact copy of the client bundle", () => {
    const root = path.resolve(process.cwd(), "resources/activity");
    const provenance = JSON.parse(
      readFileSync(path.join(root, "provenance.json"), "utf8"),
    ) as { files: Record<string, { sha256: string; bytes: number }> };
    expect(Object.keys(provenance.files)).toHaveLength(10);
    for (const [name, expected] of Object.entries(provenance.files)) {
      const bytes = readFileSync(path.join(root, name));
      expect(bytes.length, name).toBe(expected.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        expected.sha256,
      );
    }
  });

  it("lists exactly the achievement pages the restored client shows", () => {
    // ActivityList rows with Sort != 0 and no end date that have an achievement
    // list: Template2 pages, the Soduku board and the eight-day sign-up.
    expect(catalog.shownActivityIds(now, Math.floor(now / 1_000))).toEqual([
      2, 3, 14, 15, 16, 20, 29, 108,
    ]);
    expect(catalog.activity(2)?.template).toBe(2);
    expect(catalog.activity(20)?.template).toBe(6);
    expect(catalog.activity(29)?.template).toBe(12);
  });

  it("hides a dated page after its end and keeps account-day pages open", () => {
    // Activity 17 (Template2) ended in 2018; the table still lists it.
    expect(catalog.activityAchievementIds(17)).toEqual([70, 71, 72, 73, 74, 75, 76]);
    expect(catalog.shownActivityIds(now, 0)).not.toContain(17);
    // Activities 20 and 29 count days from account creation and have no end.
    expect(catalog.shownActivityIds(now, 1)).toEqual(expect.arrayContaining([20, 29]));
  });

  it("reads each table family's achievement columns", () => {
    expect(catalog.activityAchievementIds(2)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(catalog.activityAchievementIds(29)).toEqual([
      23, 24, 25, 26, 27, 28, 29, 30,
    ]);
    expect([...catalog.activityAchievementIds(20)].sort((a, b) => a - b)).toEqual([
      93, 94, 95, 96, 97, 98, 99, 100, 101,
    ]);
    // WeaponMCGacha "Achievements" and EightDaysSignUp2 "SpIcon" (4th number).
    expect(catalog.activityAchievementIds(54)).toEqual([1017, 1018, 1019, 1020, 1021]);
    expect(catalog.hasActivityAchievement(2, 23)).toBe(false);
    expect(catalog.hasActivityAchievement(9_999, 4)).toBe(false);
  });

  it("pays what AchievementOther lists, equal to the built-in eight-day table", () => {
    expect(other(4).awards).toEqual([
      [15, 2, 1, 1, 20],
      [15, 1, 1, 1, 2_500],
    ]);
    for (const reward of EIGHT_DAY_SIGN_UP_REWARDS) {
      const config = other(reward.achievementId);
      expect(config.awards).toEqual(reward.awards);
      expect(config.type).toBe(43);
      expect(requiredAchievementCount(config)).toBe(reward.requiredDays);
    }
  });

  it("selects the required count with assistparam", () => {
    // [chapter, section, difficulty, times] with assistparam [4].
    expect(other(4).counts).toEqual([1, 6, 1, 1]);
    expect(requiredAchievementCount(other(4))).toBe(1);
    // [cards, break level] with assistparam [1].
    expect(requiredAchievementCount(other(17))).toBe(3);
  });

  it("marks a malformed award tuple instead of guessing it", () => {
    // AchievementOther 1686 lists "[2-2-10000-1]": four numbers.
    expect(other(1686).awards).toBeNull();
  });

  it("loads the achievement panel table into task group 6", () => {
    const config = catalog.achievement(ACHIEVEMENT_TASK_GROUP, 1);
    expect(config?.group).toBe(ACHIEVEMENT_TASK_GROUP);
    expect(config?.awards?.length).toBeGreaterThan(0);
    expect(catalog.achievement(ACHIEVEMENT_TASK_GROUP, 60_000)).toBeNull();
  });

  it("parses table dates as UTC+8 wall clock", () => {
    expect(parseActivityDate("{201901011200}")).toBe(
      Date.parse("2019-01-01T04:00:00Z") / 1_000,
    );
    expect(parseActivityDate("{20201119}")).toBe(
      Date.parse("2020-11-18T16:00:00Z") / 1_000,
    );
    expect(parseActivityDate("")).toBe(0);
    expect(parseActivityDate("0")).toBe(0);
  });
});

describe("activity achievement progress", () => {
  it("encodes progress above the claim bit", () => {
    const value = makeAchievementTaskValue(7, true);
    expect(achievementProgress(value)).toBe(7);
    expect(hasClaimedAchievement(value)).toBe(true);
    expect(makeAchievementTaskId(18, 23)).toBe((18 << 16) | 23);
  });

  it("derives the state conditions and leaves counters alone", () => {
    const player = makePlayer({
      level: 15,
      levels: [{ id: (1 << 16) | (6 << 8) | 1, star: (2 << 3) | 0b111 }],
      girls: [{ level: 12 }, { level: 10 }, { level: 3 }],
      inventory: [
        { genre: 1, enhanceLevel: 40, breakLevel: 1 },
        { genre: 1, enhanceLevel: 5, breakLevel: 0 },
        { genre: 2, enhanceLevel: 20, breakLevel: 0 },
        { genre: 2, enhanceLevel: 9, breakLevel: 0 },
      ],
      eightDaySignUp: { cumulativeDays: 3 },
    });
    expect(derivedAchievementProgress(player, other(100))).toBe(15); // type 1
    expect(derivedAchievementProgress(player, other(4))).toBe(2); // type 2, 1-6 normal
    expect(derivedAchievementProgress(player, other(5))).toBe(0); // type 2, 2-6 normal
    expect(derivedAchievementProgress(player, other(45))).toBe(12); // type 37
    expect(derivedAchievementProgress(player, other(49))).toBe(2); // type 85 [2,10]
    expect(derivedAchievementProgress(player, other(10))).toBe(40); // type 39
    expect(derivedAchievementProgress(player, other(15))).toBe(1); // type 54 [1,1]
    expect(derivedAchievementProgress(player, other(303))).toBe(1); // type 71 [1,20]
    expect(derivedAchievementProgress(player, other(25))).toBe(3); // type 43
    expect(derivedAchievementProgress(player, other(31))).toBeNull(); // type 22 counter
  });

  it("never lowers stored progress and keeps the claim mark", () => {
    const taskId = String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 45));
    const player = makePlayer({
      girls: [{ level: 4 }],
      taskValues: { [taskId]: makeAchievementTaskValue(9, true) },
    });
    projectAchievementProgress(player, other(45));
    expect(player.taskValues[taskId]).toBe(makeAchievementTaskValue(9, true));
  });

  it("projects only the pages the client shows and writes no zero values", () => {
    const player = makePlayer({
      level: 3,
      levels: [{ id: (1 << 16) | (6 << 8) | 1, star: (1 << 3) | 0b001 }],
    });
    reconcileActivityAchievements(player, catalog, now);
    const task = (id: number): number | undefined =>
      player.taskValues[
        String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, id))
      ];
    expect(task(4)).toBe(makeAchievementTaskValue(1, false));
    expect(task(100)).toBe(makeAchievementTaskValue(3, false));
    expect(task(5)).toBeUndefined();
    expect(task(31)).toBeUndefined();
    // Achievement 1 is a type 1 row of no shown page.
    expect(task(1)).toBeUndefined();
    const once = { ...player.taskValues };
    reconcileActivityAchievements(player, catalog, now);
    expect(player.taskValues).toEqual(once);
  });
});
