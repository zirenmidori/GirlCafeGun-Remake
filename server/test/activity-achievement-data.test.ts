import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACHIEVEMENT_TASK_GROUP,
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  ActivityAchievementCatalog,
  achievementProgress,
  activityAchievementActivity,
  countActivityAchievements,
  countedAchievementIncrement,
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
import { CafeCatalog } from "../src/game-data/cafe-catalog.js";
import { cafeComfort } from "../src/game-data/cafe-runtime.js";
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
    expect(Object.keys(provenance.files)).toHaveLength(11);
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
      girls: [
        { girlId: 1, level: 12 },
        { girlId: 2, level: 10 },
        { girlId: 3, level: 3 },
      ],
      inventory: [
        { genre: 1, detail: 1, enhanceLevel: 40, breakLevel: 1 },
        { genre: 1, detail: 1, enhanceLevel: 5, breakLevel: 0 },
        { genre: 2, detail: 1, enhanceLevel: 20, breakLevel: 0 },
        { genre: 2, detail: 1, enhanceLevel: 9, breakLevel: 0 },
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

  it("derives the secondary cards equipped in team 1 (type 59)", () => {
    const player = makePlayer({
      formations: [
        {
          fightCards: [
            { mainCardGuid: 1, usedCardGuid: 2 },
            { mainCardGuid: 3, usedCardGuid: 3 },
            { mainCardGuid: 4, usedCardGuid: 0 },
            { mainCardGuid: 5, usedCardGuid: 6 },
          ],
        },
        {
          fightCards: [
            { mainCardGuid: 7, usedCardGuid: 8 },
            { mainCardGuid: 9, usedCardGuid: 10 },
          ],
        },
      ],
    });
    expect(derivedAchievementProgress(player, other(34))).toBe(2); // type 59
    expect(derivedAchievementProgress(makePlayer({ formations: [] }), other(34))).toBe(
      0,
    );

    // A team change moves the progress at once, without a new login.
    expect(activityAchievementActivity.subscriptions).toContain("formation.updated");
    activityAchievementActivity.onEvent?.(
      player,
      { type: "formation.updated", formationId: 1, hasEquippedWeapon: false },
      { now, emit() {} },
    );
    const taskId = String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 34));
    expect(achievementProgress(player.taskValues[taskId] ?? 0)).toBe(2);
  });

  it("derives the cafe comfort (type 75)", () => {
    const sources = { cafeComfort: () => 750 };
    expect(derivedAchievementProgress(makePlayer(), other(67), sources)).toBe(750);
    expect(derivedAchievementProgress(makePlayer(), other(98), sources)).toBe(750);
    // Without a comfort source the stored progress is left alone.
    expect(derivedAchievementProgress(makePlayer(), other(67))).toBeNull();
  });

  it("projects the comfort of the placed furniture when the layout changes (type 75)", () => {
    const cafe = CafeCatalog.loadDefault();
    const player = makePlayer({
      cafe: {
        level: 30,
        furniture: [
          { roomId: 1, templateId: 101 },
          { roomId: 0, templateId: 102 },
        ],
      },
    });
    const comfort = cafeComfort({ cafe: player.cafe! }, cafe);
    expect(comfort).toBeGreaterThan(0);
    expect(activityAchievementActivity.subscriptions).toContain("cafe.comfort_changed");
    activityAchievementActivity.onEvent?.(
      player,
      { type: "cafe.comfort_changed", comfort },
      { now, emit() {} },
    );
    const task = (id: number): number =>
      achievementProgress(
        player.taskValues[
          String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, id))
        ] ?? 0,
      );
    expect(task(67)).toBe(comfort); // activity 16
    expect(task(98)).toBe(comfort); // activity 20
    // A player without a cafe gets no value and no error.
    const empty = makePlayer();
    activityAchievementActivity.reconcile?.(empty, { now, emit() {} });
    expect(
      empty.taskValues[
        String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 67))
      ],
    ).toBeUndefined();
  });

  it("never lowers stored progress and keeps the claim mark", () => {
    const taskId = String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 45));
    const player = makePlayer({
      girls: [{ girlId: 1, level: 4 }],
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

describe("counted event page achievements", () => {
  const level = (difficulty: number, story = false) =>
    ({
      type: "level.cleared",
      chapter: 1,
      index: 1,
      difficulty,
      stars: 0b111,
      firstClear: false,
      story,
    }) as const;

  it("adds what each event means to the matching achievement type", () => {
    const gift = { type: "girl.gift_sent", girlId: 7, count: 4 } as const;
    expect(countedAchievementIncrement(other(55), gift)).toBe(4); // type 18
    expect(countedAchievementIncrement(other(31), level(1))).toBe(1); // type 22 [20,1]
    expect(countedAchievementIncrement(other(31), level(2))).toBe(0);
    expect(countedAchievementIncrement(other(31), level(1, true))).toBe(0);
    expect(
      countedAchievementIncrement(other(97), { type: "vigour.spent", amount: 6 }),
    ).toBe(6); // type 24
    expect(
      countedAchievementIncrement(other(58), {
        type: "girl.training_finished",
        girlId: 7,
      }),
    ).toBe(1); // type 29
    expect(
      countedAchievementIncrement(other(305), {
        type: "weapon.broken",
        guid: 1,
        breakLevel: 1,
      }),
    ).toBe(1); // type 40
    expect(
      countedAchievementIncrement(other(36), {
        type: "bounty.cleared",
        activityId: 1,
        difficulty: 1,
      }),
    ).toBe(1); // type 42
    expect(
      countedAchievementIncrement(other(61), { type: "coffee.sold", count: 3 }),
    ).toBe(3); // type 76
    // An event never counts toward another type.
    expect(countedAchievementIncrement(other(61), gift)).toBe(0);
    expect(countedAchievementIncrement(other(100), level(1))).toBe(0); // type 1
  });

  it("counts each shown achievement once and keeps the claim mark", () => {
    const claimed = String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, 56));
    const player = makePlayer({
      taskValues: { [claimed]: makeAchievementTaskValue(20, true) },
    });
    countActivityAchievements(
      player,
      catalog,
      { type: "girl.gift_sent", girlId: 7, count: 2 },
      now,
    );
    const task = (id: number): number | undefined =>
      player.taskValues[
        String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, id))
      ];
    expect(task(55)).toBe(makeAchievementTaskValue(2, false));
    expect(task(56)).toBe(makeAchievementTaskValue(22, true));
    expect(task(57)).toBe(makeAchievementTaskValue(2, false));
    // Only gift achievements moved: three on the event pages, the rest on the panel.
    const moved = Object.keys(player.taskValues).map(Number);
    expect(moved.filter((id) => id >>> 16 === ACTIVITY_ACHIEVEMENT_TASK_GROUP)).toHaveLength(
      3,
    );
    for (const id of moved.filter((key) => key >>> 16 === ACHIEVEMENT_TASK_GROUP)) {
      expect(catalog.achievement(ACHIEVEMENT_TASK_GROUP, id & 0xffff)?.type).toBe(18);
    }
  });

  it("counts every furniture piece bought (type 137)", () => {
    const bought = { type: "cafe.furniture_bought", count: 3 } as const;
    expect(countedAchievementIncrement(other(64), bought)).toBe(3);
    expect(countedAchievementIncrement(other(67), bought)).toBe(0);
    expect(activityAchievementActivity.subscriptions).toContain(
      "cafe.furniture_bought",
    );
    const player = makePlayer();
    activityAchievementActivity.onEvent?.(player, bought, { now, emit() {} });
    const task = (id: number): number | undefined =>
      player.taskValues[
        String(makeAchievementTaskId(ACTIVITY_ACHIEVEMENT_TASK_GROUP, id))
      ];
    expect(task(64)).toBe(makeAchievementTaskValue(3, false));
    expect(task(65)).toBe(makeAchievementTaskValue(3, false));
    expect(task(66)).toBe(makeAchievementTaskValue(3, false));
  });

  it("derives the cafe level (type 79)", () => {
    expect(derivedAchievementProgress(makePlayer(), other(95))).toBe(1);
    expect(
      derivedAchievementProgress(makePlayer({ cafe: { level: 3 } }), other(95)),
    ).toBe(3);
  });
});

describe("achievement panel progress (task group 6)", () => {
  const panel = (id: number) => {
    const config = catalog.achievement(ACHIEVEMENT_TASK_GROUP, id);
    if (!config) throw new Error(`Missing Achievement ${id}`);
    return config;
  };
  const task = (player: ActivityAchievementPlayer, id: number): number | undefined =>
    player.taskValues[String(makeAchievementTaskId(ACHIEVEMENT_TASK_GROUP, id))];

  it("projects the commander level into the panel at reconcile (type 1)", () => {
    // Achievement 1 "Reach Commander Lv.5": a level 31 save showed 0/5 because
    // nothing ever wrote task (6, 1).
    expect(panel(1).type).toBe(1);
    const player = makePlayer({ level: 31 });
    activityAchievementActivity.reconcile?.(player, { now, emit() {} });
    expect(task(player, 1)).toBe(makeAchievementTaskValue(31, false));
    expect(achievementProgress(task(player, 1) ?? 0)).toBeGreaterThanOrEqual(
      requiredAchievementCount(panel(1)),
    );
  });

  it("keeps the panel claim mark and never lowers panel progress", () => {
    const key = String(makeAchievementTaskId(ACHIEVEMENT_TASK_GROUP, 1));
    const player = makePlayer({
      level: 6,
      taskValues: { [key]: makeAchievementTaskValue(40, true) },
    });
    reconcileActivityAchievements(player, catalog, now);
    expect(player.taskValues[key]).toBe(makeAchievementTaskValue(40, true));
  });

  it("derives one girl's affection level (type 135)", () => {
    const rococo = panel(2200); // [50, 1]
    expect(rococo.type).toBe(135);
    const player = makePlayer({
      girls: [
        { girlId: 1, level: 50 },
        { girlId: 2, level: 20 },
      ],
    });
    expect(derivedAchievementProgress(player, rococo)).toBe(50);
    expect(derivedAchievementProgress(player, panel(2201))).toBe(20); // girl 2
    expect(derivedAchievementProgress(player, panel(2202))).toBe(0); // girl 3 missing
    reconcileActivityAchievements(player, catalog, now);
    expect(achievementProgress(task(player, 2200) ?? 0)).toBe(
      requiredAchievementCount(rococo),
    );
  });

  it("derives the best card level of one girl (type 83)", () => {
    const irene = panel(1000); // [15, 7]
    expect(irene.type).toBe(83);
    const player = makePlayer({
      inventory: [
        { genre: 1, detail: 7, enhanceLevel: 18, breakLevel: 0 },
        { genre: 1, detail: 7, enhanceLevel: 9, breakLevel: 0 },
        { genre: 1, detail: 3, enhanceLevel: 60, breakLevel: 0 },
        { genre: 2, detail: 7, enhanceLevel: 70, breakLevel: 0 },
      ],
    });
    expect(derivedAchievementProgress(player, irene)).toBe(18);
    expect(derivedAchievementProgress(makePlayer(), irene)).toBe(0);
  });

  it("counts panel counters from events (type 18 gifts)", () => {
    const gifts = catalog
      .achievements(ACHIEVEMENT_TASK_GROUP)
      .filter(({ type }) => type === 18);
    expect(gifts.length).toBeGreaterThan(0);
    const player = makePlayer();
    activityAchievementActivity.onEvent?.(
      player,
      { type: "girl.gift_sent", girlId: 7, count: 5 },
      { now, emit() {} },
    );
    for (const config of gifts) {
      expect(achievementProgress(task(player, config.id) ?? 0)).toBe(5);
    }
  });
});
