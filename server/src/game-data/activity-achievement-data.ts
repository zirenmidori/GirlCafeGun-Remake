/**
 * Event page achievements: which activity lists which achievement, what a
 * claim pays and how far the player is.
 *
 * The activity-to-achievement map and the claim gate are adapted from
 * SssjServer ActivityAchieveTable/ActivityAchieveFeature (MIT, 2025 luoxiadesu)
 * as extended by the GCG2-Offline contributors (MIT). See
 * LICENSES/SssjServer-MIT.txt. Progress is projected from the v1 player state
 * inside the JsonStore transaction instead of upstream's counter store.
 *
 * Client contract (MissionManager.lua): achievements of Mission/Achievement.txt
 * use task group 6, those of Mission/AchievementOther.txt task group 18. Bit 0
 * of the task value is the claim mark, bits 1-31 the progress. The required
 * count is missionMax[assistparam[1]].
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  ActivityHandler,
  ActivityPlayerState,
} from "../activities/activity-engine.js";
import type { BaseAward } from "./chapter-config.js";

export const ACHIEVEMENT_TASK_GROUP = 6;
export const ACTIVITY_ACHIEVEMENT_TASK_GROUP = 18;
export const ACTIVITY_ACHIEVEMENT_ACTIVITY_ID = "activity-achievements";
/** UI_NormalActivity:GetAchieveAward sends nType = 1 for an achievement claim. */
export const NORMAL_ACTIVITY_ACHIEVEMENT_AWARD_TYPE = 1;

const MAX_PROGRESS = 0x3fffffff;
const SECONDS_PER_DAY = 86_400;
/** The tables carry wall-clock dates of the original service (UTC+8). */
const TABLE_UTC_OFFSET_SECONDS = 8 * 3_600;

export interface AchievementConfig {
  group: number;
  id: number;
  previousId: number;
  type: number;
  counts: readonly number[];
  assist: readonly number[];
  /** null when a tuple of awardsList is not genre-detail-particular-level-count. */
  awards: readonly BaseAward[] | null;
}

export interface ActivityListEntry {
  id: number;
  template: number;
  sort: number;
  /** 0: BeginTime/EndTime are dates. 1: they are days after account creation. */
  timeMode: number;
  showBeginTime: number;
  endTime: number;
  minimumCreateTime: number;
}

export interface ActivityAchievementTables {
  achievement: string;
  achievementOther: string;
  activityList: string;
  /** Lower-case file name of a NormalActivity table to its text. */
  activityAchievements: Readonly<Record<string, string>>;
}

/**
 * The columns that hold achievement ids, per NormalActivity table, as the
 * NormalActivityConfig.lua loaders read them. ActivityTemplate5's
 * DailyAchievementTask holds task ids, so it is not listed.
 */
export const ACTIVITY_ACHIEVEMENT_COLUMNS: Readonly<Record<string, readonly string[]>> =
  {
    "activitytemplate2.txt": ["AchievementList"],
    "activitytemplate4.txt": ["AchievementList"],
    "activitytemplate5.txt": ["AchievementList", "DailyAchievementList"],
    "eightdayssignup.txt": [
      "RewardList1Achievements",
      "RewardList2Achievements",
      "RewardList3Achievements",
    ],
    "eightdayssignup2.txt": ["RewardList1Achievements", "RewardList2Achievements"],
    "sodukuactivity.txt": ["AchievementList"],
    "weaponmcgacha.txt": ["Achievements"],
  };

type Row = Record<string, string>;

/** LoadTabFile(path, 3): three header rows, the third holds the column names. */
function parseTable(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const columns = (lines[2] ?? "").split("\t");
  const rows: Row[] = [];
  for (const line of lines.slice(3)) {
    if (line.trim() === "") continue;
    const cells = line.split("\t");
    const row: Row = {};
    columns.forEach((column, index) => {
      if (column) row[column] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function integer(text: string | undefined): number {
  const value = Number((text ?? "").trim());
  return Number.isSafeInteger(value) ? value : 0;
}

function integers(text: string | undefined): number[] {
  return ((text ?? "").match(/\d+/g) ?? []).map(Number);
}

function parseAwards(text: string | undefined): BaseAward[] | null {
  const body = (text ?? "").trim().replace(/^\[/, "").replace(/\]$/, "");
  if (body === "") return [];
  const awards: BaseAward[] = [];
  for (const item of body.split(",")) {
    const parts = item.split("-").map((part) => Number(part.trim()));
    if (
      parts.length !== 5 ||
      !parts.every((part) => Number.isSafeInteger(part) && part >= 0)
    ) {
      return null;
    }
    awards.push(parts as BaseAward);
  }
  return awards;
}

function parseAchievements(
  text: string,
  group: number,
): Map<number, AchievementConfig> {
  const achievements = new Map<number, AchievementConfig>();
  for (const row of parseTable(text)) {
    const id = integer(row.missionId);
    if (id <= 0 || id > 0xffff) continue;
    if (achievements.has(id)) throw new Error(`Duplicate achievement ${group}/${id}`);
    achievements.set(id, {
      group,
      id,
      previousId: integer(row.preMissionId),
      type: integer(row.achieveType),
      counts: integers(row.missionMax),
      assist: integers(row.assistparam),
      awards: parseAwards(row.awardsList),
    });
  }
  return achievements;
}

/** Lib.lua GetDate2Time: yyyymmdd plus optional hh, mm and ss, optionally in braces. */
export function parseActivityDate(text: string | undefined): number {
  const digits = (text ?? "").replace(/[{}\-\s]/g, "");
  if (!/^\d+$/.test(digits) || ![8, 10, 12, 14].includes(digits.length)) return 0;
  const part = (start: number, length: number): number =>
    Number(digits.slice(start, start + length) || 0);
  const seconds =
    Date.UTC(
      part(0, 4),
      part(4, 2) - 1,
      part(6, 2),
      part(8, 2),
      part(10, 2),
      part(12, 2),
    ) / 1_000;
  return Number.isFinite(seconds) ? seconds - TABLE_UTC_OFFSET_SECONDS : 0;
}

function parseActivityList(text: string): Map<number, ActivityListEntry> {
  const activities = new Map<number, ActivityListEntry>();
  for (const row of parseTable(text)) {
    const id = integer(row.Id);
    if (id <= 0) continue;
    const timeMode = integer(row.TimeMode);
    activities.set(id, {
      id,
      template: integer(row.Template),
      sort: integer(row.Sort),
      timeMode,
      showBeginTime: parseActivityDate(row.ShowBeginTime),
      endTime:
        timeMode === 1
          ? integer(row.EndTime) * SECONDS_PER_DAY
          : parseActivityDate(row.EndTime),
      minimumCreateTime: parseActivityDate(row.MinimumCreateTime),
    });
  }
  return activities;
}

/** EightDaysSignUp2 SpIcon: "[x,y,scale,achievementId,day];..." */
function specialIconAchievements(text: string | undefined): number[] {
  const ids: number[] = [];
  for (const icon of (text ?? "").split(";")) {
    const parts = icon
      .trim()
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((part) => Number(part.trim()));
    const id = parts[3];
    if (parts.length >= 4 && id !== undefined && Number.isSafeInteger(id) && id > 0) {
      ids.push(id);
    }
  }
  return ids;
}

function parseActivityAchievements(
  tables: Readonly<Record<string, string>>,
): Map<number, number[]> {
  const byActivity = new Map<number, number[]>();
  for (const [file, columns] of Object.entries(ACTIVITY_ACHIEVEMENT_COLUMNS)) {
    const text = tables[file];
    if (text === undefined) continue;
    for (const row of parseTable(text)) {
      const activityId = integer(row.Id);
      if (activityId <= 0) continue;
      const ids = columns.flatMap((column) => integers(row[column]));
      ids.push(...specialIconAchievements(row.SpIcon));
      if (ids.length === 0) continue;
      const known = byActivity.get(activityId) ?? [];
      for (const id of ids) if (!known.includes(id)) known.push(id);
      byActivity.set(activityId, known);
    }
  }
  return byActivity;
}

export class ActivityAchievementCatalog {
  static #default: ActivityAchievementCatalog | undefined;

  readonly #achievements: ReadonlyMap<number, ReadonlyMap<number, AchievementConfig>>;
  readonly #activities: ReadonlyMap<number, ActivityListEntry>;
  readonly #byActivity: ReadonlyMap<number, readonly number[]>;

  constructor(tables: ActivityAchievementTables) {
    this.#achievements = new Map([
      [
        ACHIEVEMENT_TASK_GROUP,
        parseAchievements(tables.achievement, ACHIEVEMENT_TASK_GROUP),
      ],
      [
        ACTIVITY_ACHIEVEMENT_TASK_GROUP,
        parseAchievements(tables.achievementOther, ACTIVITY_ACHIEVEMENT_TASK_GROUP),
      ],
    ]);
    this.#activities = parseActivityList(tables.activityList);
    this.#byActivity = parseActivityAchievements(tables.activityAchievements);
  }

  static loadDefault(): ActivityAchievementCatalog {
    if (ActivityAchievementCatalog.#default) return ActivityAchievementCatalog.#default;
    const read = (name: string): string =>
      readFileSync(path.resolve(process.cwd(), "resources/activity", name), "utf8");
    ActivityAchievementCatalog.#default = new ActivityAchievementCatalog({
      achievement: read("achievement.txt"),
      achievementOther: read("achievementother.txt"),
      activityList: read("activitylist.txt"),
      activityAchievements: Object.fromEntries(
        Object.keys(ACTIVITY_ACHIEVEMENT_COLUMNS).map((name) => [name, read(name)]),
      ),
    });
    return ActivityAchievementCatalog.#default;
  }

  achievement(group: number, id: number): AchievementConfig | null {
    return this.#achievements.get(group)?.get(id) ?? null;
  }

  activity(activityId: number): ActivityListEntry | null {
    return this.#activities.get(activityId) ?? null;
  }

  activityAchievementIds(activityId: number): readonly number[] {
    return this.#byActivity.get(activityId) ?? [];
  }

  hasActivityAchievement(activityId: number, achievementId: number): boolean {
    return this.activityAchievementIds(activityId).includes(achievementId);
  }

  /**
   * The activities with an achievement list that the client shows at this
   * time: NormalActivityConfig:CheckTime with the show time, and Sort not 0.
   */
  shownActivityIds(now: number, registerTime: number): number[] {
    const time = Math.floor(now / 1_000);
    const shown: number[] = [];
    for (const activityId of this.#byActivity.keys()) {
      const entry = this.#activities.get(activityId);
      if (!entry || entry.sort === 0 || time < entry.showBeginTime) continue;
      if (entry.timeMode !== 0 && entry.timeMode !== 1) continue;
      const end =
        entry.endTime === 0 || entry.timeMode === 0
          ? entry.endTime
          : Math.max(registerTime, entry.minimumCreateTime) + entry.endTime;
      if (end === 0 || time < end) shown.push(activityId);
    }
    return shown.sort((left, right) => left - right);
  }
}

export function makeAchievementTaskId(group: number, achievementId: number): number {
  return (group << 16) | achievementId;
}

export function achievementProgress(taskValue: number): number {
  return taskValue >>> 1;
}

export function hasClaimedAchievement(taskValue: number): boolean {
  return (taskValue & 1) === 1;
}

export function makeAchievementTaskValue(progress: number, claimed: boolean): number {
  const safeProgress = Math.max(0, Math.min(MAX_PROGRESS, Math.trunc(progress)));
  return safeProgress * 2 + (claimed ? 1 : 0);
}

/** MissionManager:CheckInfoState: progress must reach missionMax[assistparam[1]]. */
export function requiredAchievementCount(config: AchievementConfig): number {
  const key =
    config.assist[0] !== undefined && config.assist[0] >= 1 ? config.assist[0] : 1;
  return config.counts[key - 1] ?? Number.POSITIVE_INFINITY;
}

export interface ActivityAchievementPlayer extends ActivityPlayerState {
  level: number;
  registerTime: number;
  levels: readonly { id: number; star: number }[];
  girls: readonly { level: number }[];
  inventory: readonly { genre: number; enhanceLevel: number; breakLevel: number }[];
  eightDaySignUp: { cumulativeDays: number };
}

const CARD_GENRE = 1;
const WEAPON_GENRE = 2;

/**
 * The conditions of Mission/AchieveType.txt that the v1 player state answers
 * without a counter. Returns null for every other type: its stored progress is
 * left alone.
 *
 * - 1 commander level [level]
 * - 2 clear a stage [chapter, section, difficulty, times]
 * - 37 highest girl affection level [level]
 * - 39 highest character card level [level]
 * - 43 login days [days, paid sign-in activity]
 * - 54 character cards with limit break N [cards, break level]
 * - 71 weapons at level N [weapons, level]
 * - 85 girls at affection level N [girls, level]
 */
export function derivedAchievementProgress(
  player: ActivityAchievementPlayer,
  config: AchievementConfig,
): number | null {
  const counts = config.counts;
  const second = counts[1];
  switch (config.type) {
    case 1:
      return player.level;
    case 2: {
      const [chapter, index, difficulty] = counts;
      if (chapter === undefined || index === undefined || difficulty === undefined) {
        return null;
      }
      const levelId = (chapter << 16) | (index << 8) | difficulty;
      const level = player.levels.find(({ id }) => id === levelId);
      return level ? level.star >>> 3 : 0;
    }
    case 37:
      return Math.max(0, ...player.girls.map(({ level }) => level));
    case 39:
      return Math.max(
        0,
        ...player.inventory
          .filter(({ genre }) => genre === CARD_GENRE)
          .map(({ enhanceLevel }) => enhanceLevel),
      );
    case 43:
      return player.eightDaySignUp.cumulativeDays;
    case 54:
      if (second === undefined) return null;
      return player.inventory.filter(
        ({ genre, breakLevel }) => genre === CARD_GENRE && breakLevel >= second,
      ).length;
    case 71:
      if (second === undefined) return null;
      return player.inventory.filter(
        ({ genre, enhanceLevel }) => genre === WEAPON_GENRE && enhanceLevel >= second,
      ).length;
    case 85:
      if (second === undefined) return null;
      return player.girls.filter(({ level }) => level >= second).length;
    default:
      return null;
  }
}

/**
 * Raises the stored progress of one achievement to what the player state
 * shows. Never lowers progress and never touches the claim mark.
 */
export function projectAchievementProgress(
  player: ActivityAchievementPlayer,
  config: AchievementConfig,
): number {
  const taskId = String(makeAchievementTaskId(config.group, config.id));
  const current = player.taskValues[taskId] ?? 0;
  const derived = derivedAchievementProgress(player, config) ?? 0;
  const next = makeAchievementTaskValue(
    Math.max(achievementProgress(current), derived),
    hasClaimedAchievement(current),
  );
  if (next !== current) player.taskValues[taskId] = next;
  return next;
}

/** Projects progress for the achievements of every page the client shows now. */
export function reconcileActivityAchievements(
  player: ActivityAchievementPlayer,
  catalog: ActivityAchievementCatalog,
  now: number,
): void {
  for (const activityId of catalog.shownActivityIds(now, player.registerTime)) {
    for (const achievementId of catalog.activityAchievementIds(activityId)) {
      const config = catalog.achievement(
        ACTIVITY_ACHIEVEMENT_TASK_GROUP,
        achievementId,
      );
      if (config) projectAchievementProgress(player, config);
    }
  }
}

export const activityAchievementActivity: ActivityHandler<ActivityAchievementPlayer> = {
  id: ACTIVITY_ACHIEVEMENT_ACTIVITY_ID,
  revision: 1,
  subscriptions: ["level.cleared", "weapon.enhanced"],
  reconcile(player, context) {
    reconcileActivityAchievements(
      player,
      ActivityAchievementCatalog.loadDefault(),
      context.now,
    );
  },
  onEvent(player, _event, context) {
    reconcileActivityAchievements(
      player,
      ActivityAchievementCatalog.loadDefault(),
      context.now,
    );
  },
};
