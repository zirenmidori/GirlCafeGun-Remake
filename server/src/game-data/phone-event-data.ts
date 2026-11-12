import { readFileSync } from "node:fs";

import type { Player } from "../persistence/player-repository.js";

export interface PhoneEvent {
  topicId: number;
  conditions: { type: number; value: string }[];
}

type PhoneEventPlayer = Pick<
  Player,
  | "levels"
  | "girls"
  | "inventory"
  | "phone"
  | "level"
  | "taskValues"
  | "cafe"
  | "fightPower"
>;

const eventCatalogs = new Map<string, readonly PhoneEvent[]>();
const HOUR_MS = 60 * 60 * 1000;

export function normalizePhoneStoryPath(value: string): string {
  const clean = value.trim().replaceAll("\\", "/").toLowerCase();
  const story = clean.endsWith(".txt") ? clean : clean + ".txt";
  // Letter 54 omits its folder in LetterEvent, but this basename is unique in CartoonFileId.
  return story === "girl09_line04.txt" ? "girl09/girl09_line04.txt" : story;
}

export function parsePhoneEvents(contents: string): PhoneEvent[] {
  const lines = contents.split(/\r?\n/);
  const headings = lines[2]?.split("\t") ?? [];
  const eventId = headings.indexOf("ID");
  if (eventId < 0) throw new Error("Phone event table has no ID column");

  const events: PhoneEvent[] = [];
  for (const row of lines.slice(3)) {
    if (!row.trim()) continue;
    const columns = row.split("\t");
    const topicId = Number(columns[eventId]);
    if (!Number.isSafeInteger(topicId) || topicId <= 0) continue;
    const conditions: PhoneEvent["conditions"] = [];
    for (let i = 1; i <= 10; i += 1) {
      const typeColumn = headings.indexOf("LimitType" + i);
      const valueColumn = headings.indexOf("LimitInfo" + i);
      if (typeColumn < 0 || valueColumn < 0) break;
      const rawTypes = columns[typeColumn]?.trim();
      if (!rawTypes) continue;
      const types = rawTypes.split(",");
      const values = (columns[valueColumn] ?? "").split(",");
      if (types.length !== values.length) {
        throw new Error(`Invalid phone event conditions for topic ${topicId}`);
      }
      for (const [index, type] of types.entries()) {
        conditions.push({ type: Number(type), value: values[index]!.trim() });
      }
    }
    if (conditions.length) events.push({ topicId, conditions });
  }
  return events;
}

export function loadPhoneEvents(kind: "letter" | "bbs"): readonly PhoneEvent[] {
  const cached = eventCatalogs.get(kind);
  if (cached) return cached;
  const file = new URL(
    "../../resources/phonemsg/" + kind + "event.txt",
    import.meta.url,
  );
  const events = parsePhoneEvents(readFileSync(file, "utf8"));
  eventCatalogs.set(kind, events);
  return events;
}

function phoneEventTime(value: string): number {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return Number.NaN;
  return (
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
    ) -
    8 * HOUR_MS
  );
}

type PhoneAchievement = { type: number; target: number; values: number[] };
let achievements: Map<number, PhoneAchievement> | undefined;

function achievementCompleted(player: PhoneEventPlayer, id: number): boolean {
  if (!achievements) {
    const file = new URL("../../resources/phonemsg/achievements.txt", import.meta.url);
    achievements = new Map();
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const [id, type, target, values] = line.split("\t");
      achievements.set(Number(id), {
        type: Number(type),
        target: Number(target),
        values: (values ?? "").split(",").map(Number),
      });
    }
  }
  const definition = achievements.get(id);
  if (!definition) return false;
  const { type, target, values } = definition;
  // MissionManager uses group 6, progress in bits 1..31 and the claim flag in bit 0.
  const stored = player.taskValues[String((6 << 16) | id)] ?? 0;
  if ((stored & 1) !== 0 || stored >>> 1 >= target) return true;
  switch (type) {
    case 1:
      return player.level >= target;
    case 79:
      return (player.cafe.level ?? 0) >= target;
    case 83:
      return player.inventory.some(
        ({ genre, detail, enhanceLevel, count }) =>
          genre === 1 && detail === values[1] && enhanceLevel >= target && count > 0,
      );
    case 102:
      return player.fightPower >= target;
    default:
      return false;
  }
}

function secretUnlocked(player: PhoneEventPlayer, key: string): boolean {
  const match = key.match(/^(\d+)\.(\d+)\.TypeDec$/);
  if (!match) return false;
  const girl = Number(match[1]);
  const secret = Number(match[2]);
  const task = (3 << 16) | ((girl - 1) * 2000 + 100 + secret - 1);
  return (player.taskValues[String(task)] ?? 0) > 0;
}

let storyTaskBits: Map<string, { taskId: string; bit: number }> | undefined;

function savedStoryRead(player: PhoneEventPlayer, storyPath: string): boolean {
  if (!storyTaskBits) {
    const file = new URL(
      "../../resources/phonemsg/story-task-bits.txt",
      import.meta.url,
    );
    storyTaskBits = new Map();
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const [story, taskId, bit] = line.split("\t");
      if (story && taskId && bit)
        storyTaskBits.set(story, { taskId, bit: Number(bit) });
    }
  }
  const saved = storyTaskBits.get(storyPath);
  return !!saved && (((player.taskValues[saved.taskId] ?? 0) >>> saved.bit) & 1) === 1;
}

export function eligiblePhoneTopics(
  events: readonly PhoneEvent[],
  player: PhoneEventPlayer,
  npcForTopic: (topicId: number) => number | undefined,
  completedTopicIds: ReadonlySet<number>,
  now = Date.now(),
  previouslyDelivered: ReadonlySet<number> = new Set(),
): number[] {
  const affection = new Map(player.girls.map(({ girlId, level }) => [girlId, level]));
  const totalAffection = player.girls.reduce((sum, { level }) => sum + level, 0);
  const storyPaths = new Set(player.phone.storyPaths ?? []);
  const ownedCards = new Set(
    player.inventory
      .filter(({ genre, count }) => genre === 1 && count > 0)
      .map(({ genre, detail, particular, templateLevel }) =>
        [genre, detail, particular, templateLevel].join("-"),
      ),
  );
  const stages = new Set(
    player.levels
      .filter(({ star }) => star >>> 3 > 0 || (star & 7) > 0)
      .map(({ id }) => [id >>> 16, (id >>> 8) & 0xff, id & 0xff].join("-")),
  );
  return events.flatMap(({ topicId, conditions }) => {
    if (previouslyDelivered.has(topicId)) return [];
    const npcId = npcForTopic(topicId);
    if (npcId === undefined) return [];
    const eligible = conditions.every(({ type, value }) => {
      const args = value.replace(/^\[|\]$/g, "");
      switch (type) {
        case 1: {
          const storyPath = normalizePhoneStoryPath(args);
          return storyPaths.has(storyPath) || savedStoryRead(player, storyPath);
        }
        case 2:
          return completedTopicIds.has(Number(args));
        case 3:
          return (affection.get(npcId) ?? 0) >= Number(args);
        case 4: {
          const [start = "", end = ""] = args.split("-");
          return now >= phoneEventTime(start) && now < phoneEventTime(end);
        }
        case 5:
          return secretUnlocked(player, args);
        case 6:
          return ownedCards.has(args);
        case 7:
          return achievementCompleted(player, Number(args));
        case 8:
          return stages.has(args);
        case 9:
          return totalAffection >= Number(args);
        default:
          return false;
      }
    });
    return eligible ? [topicId] : [];
  });
}
