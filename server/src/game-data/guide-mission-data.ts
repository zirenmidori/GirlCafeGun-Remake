import type { ActivityHandler } from "../activities/activity-engine.js";
import type { DomainEvent } from "../activities/domain-events.js";
import type { BaseAward } from "./chapter-config.js";
import {
  chapterStarAward,
  chapterStarTaskProgress,
  hasClaimedChapterStarAward,
  makeChapterStarTaskId,
} from "./chapter-star-award-data.js";

export const GUIDE_MISSION_ACTIVITY_ID = "guide-mission";
export const GUIDE_MISSION_TASK_GROUP = 5;
export const GUIDE_PROGRESS_TASK_ID = 41_001;

interface LevelCondition {
  chapter: number;
  index: number;
  difficulty: number;
}

export interface GuideMissionDefinition {
  id: number;
  prerequisiteId: number;
  target: number;
  awards: readonly BaseAward[];
  level?: LevelCondition;
}

export interface GuideProgressAwardDefinition {
  id: number;
  requiredCompleted: number;
  awards: readonly BaseAward[];
}

export interface GuideMissionPlayer {
  taskValues: Record<string, number>;
  levels: readonly { id: number; star: number }[];
  inventory: readonly { genre: number; enhanceLevel: number }[];
  formations: readonly {
    fightCards: readonly { weaponGuid: number }[];
  }[];
  fightPower: number;
}

export const GUIDE_MISSIONS: readonly GuideMissionDefinition[] = [
  {
    id: 40_001,
    prerequisiteId: 0,
    target: 1,
    awards: [
      [15, 1, 1, 1, 2_000],
      [7, 3, 1, 1, 1],
    ],
    level: { chapter: 1, index: 1, difficulty: 1 },
  },
  {
    id: 40_002,
    prerequisiteId: 40_001,
    target: 1,
    awards: [
      [15, 1, 1, 1, 2_000],
      [7, 3, 1, 1, 1],
    ],
    level: { chapter: 1, index: 2, difficulty: 1 },
  },
  {
    id: 40_003,
    prerequisiteId: 40_002,
    target: 1,
    awards: [
      [15, 1, 1, 1, 2_000],
      [7, 3, 1, 1, 1],
    ],
    level: { chapter: 1, index: 3, difficulty: 1 },
  },
  {
    id: 40_004,
    prerequisiteId: 40_003,
    target: 1,
    awards: [
      [5, 2, 1, 1, 5],
      [7, 3, 1, 1, 1],
    ],
    level: { chapter: 1, index: 6, difficulty: 1 },
  },
  {
    id: 40_005,
    prerequisiteId: 40_004,
    target: 1,
    awards: [
      [15, 1, 1, 1, 2_000],
      [7, 3, 1, 1, 1],
    ],
    level: { chapter: 2, index: 6, difficulty: 1 },
  },
  {
    id: 40_006,
    prerequisiteId: 40_005,
    target: 1,
    awards: [
      [15, 1, 1, 1, 2_000],
      [7, 3, 1, 1, 1],
    ],
    level: { chapter: 3, index: 6, difficulty: 1 },
  },
  {
    id: 40_014,
    prerequisiteId: 40_004,
    target: 4,
    awards: [[10, 1, 1, 1, 1]],
  },
  {
    id: 40_008,
    prerequisiteId: 40_004,
    target: 10,
    awards: [
      [10, 1, 1, 1, 1],
      [7, 3, 1, 1, 1],
    ],
  },
  {
    id: 40_021,
    prerequisiteId: 40_005,
    target: 1,
    awards: [
      [15, 1, 1, 1, 2_000],
      [7, 3, 1, 1, 1],
    ],
  },
  {
    id: 40_025,
    prerequisiteId: 40_005,
    target: 1,
    awards: [
      [7, 7, 1, 4, 1],
      [7, 3, 1, 1, 1],
    ],
    level: { chapter: 1, index: 1, difficulty: 2 },
  },
  {
    id: 40_022,
    prerequisiteId: 40_004,
    target: 3_900,
    awards: [[15, 2, 1, 1, 20]],
  },
  {
    id: 40_026,
    prerequisiteId: 40_004,
    target: 1,
    awards: [
      [15, 1, 1, 1, 2_000],
      [7, 3, 1, 1, 1],
    ],
  },
  {
    id: 40_027,
    prerequisiteId: 40_004,
    target: 1,
    awards: [[10, 1, 1, 1, 1]],
  },
  {
    id: 40_017,
    prerequisiteId: 40_003,
    target: 80,
    awards: [
      [7, 1, 4, 1, 1],
      [7, 3, 1, 1, 1],
    ],
  },
  {
    id: 40_018,
    prerequisiteId: 40_004,
    target: 1,
    awards: [
      [7, 1, 4, 1, 1],
      [7, 3, 1, 1, 1],
    ],
  },
];

export const GUIDE_PROGRESS_AWARDS: readonly GuideProgressAwardDefinition[] = [
  { id: 1, requiredCompleted: 3, awards: [[7, 1, 4, 1, 5]] },
  { id: 2, requiredCompleted: 6, awards: [[7, 7, 1, 4, 1]] },
  { id: 3, requiredCompleted: 9, awards: [[7, 3, 1, 3, 1]] },
  { id: 4, requiredCompleted: 12, awards: [[8, 5, 2, 3, 1]] },
  { id: 5, requiredCompleted: 15, awards: [[7, 10, 1, 4, 1]] },
];

const GUIDE_MISSIONS_BY_ID = new Map(
  GUIDE_MISSIONS.map((mission) => [mission.id, mission]),
);
const GUIDE_PROGRESS_AWARDS_BY_ID = new Map(
  GUIDE_PROGRESS_AWARDS.map((award) => [award.id, award]),
);

export function makeGuideTaskId(taskId: number): number {
  return (GUIDE_MISSION_TASK_GROUP << 16) | taskId;
}

export function guideMission(missionId: number): GuideMissionDefinition | null {
  return GUIDE_MISSIONS_BY_ID.get(missionId) ?? null;
}

export function guideProgressAward(
  awardId: number,
): GuideProgressAwardDefinition | null {
  return GUIDE_PROGRESS_AWARDS_BY_ID.get(awardId) ?? null;
}

export function guideMissionProgress(taskValue: number): number {
  return taskValue >>> 1;
}

export function hasClaimedGuideMission(taskValue: number): boolean {
  return (taskValue & 1) === 1;
}

export function makeGuideMissionTaskValue(progress: number, claimed: boolean): number {
  const safeProgress = Math.max(0, Math.min(0x7fffffff, Math.trunc(progress)));
  return safeProgress * 2 + (claimed ? 1 : 0);
}

export function setGuideMissionProgress(
  player: GuideMissionPlayer,
  missionId: number,
  progress: number,
): void {
  const mission = guideMission(missionId);
  if (!mission) throw new Error(`Unknown guide mission: ${missionId}`);
  const taskId = String(makeGuideTaskId(missionId));
  const current = player.taskValues[taskId] ?? 0;
  const nextProgress = Math.min(
    mission.target,
    Math.max(guideMissionProgress(current), Math.trunc(progress)),
  );
  if (nextProgress === guideMissionProgress(current)) return;
  player.taskValues[taskId] = makeGuideMissionTaskValue(
    nextProgress,
    hasClaimedGuideMission(current),
  );
}

export function completedGuideMissionCount(
  player: Pick<GuideMissionPlayer, "taskValues">,
): number {
  return GUIDE_MISSIONS.filter((mission) => {
    const value = player.taskValues[String(makeGuideTaskId(mission.id))] ?? 0;
    return guideMissionProgress(value) >= mission.target;
  }).length;
}

export function hasClaimedGuideProgressAward(
  player: Pick<GuideMissionPlayer, "taskValues">,
  awardId: number,
): boolean {
  const value = player.taskValues[String(makeGuideTaskId(GUIDE_PROGRESS_TASK_ID))] ?? 0;
  return (value & (1 << awardId)) !== 0;
}

export function markGuideProgressAwardClaimed(
  player: Pick<GuideMissionPlayer, "taskValues">,
  awardId: number,
): void {
  const taskId = String(makeGuideTaskId(GUIDE_PROGRESS_TASK_ID));
  player.taskValues[taskId] = (player.taskValues[taskId] ?? 0) | (1 << awardId);
}

function makeLevelId(chapter: number, index: number, difficulty: number): number {
  return (chapter << 16) | (index << 8) | difficulty;
}

function hasCompletedLevel(
  player: GuideMissionPlayer,
  condition: LevelCondition,
): boolean {
  const id = makeLevelId(condition.chapter, condition.index, condition.difficulty);
  return player.levels.some((level) => level.id === id && level.star >>> 3 > 0);
}

function reconcileGuideMissions(player: GuideMissionPlayer): void {
  for (const mission of GUIDE_MISSIONS) {
    if (mission.level && hasCompletedLevel(player, mission.level)) {
      setGuideMissionProgress(player, mission.id, mission.target);
    }
  }

  const maximumWeaponLevel = Math.max(
    0,
    ...player.inventory
      .filter(({ genre }) => genre === 2)
      .map(({ enhanceLevel }) => enhanceLevel),
  );
  setGuideMissionProgress(player, 40_008, maximumWeaponLevel);

  const chapterTwoFullStarAward = chapterStarAward(2, 1, 3);
  const chapterTwoStarTask =
    player.taskValues[String(makeChapterStarTaskId(2, 1))] ?? 0;
  if (
    chapterTwoFullStarAward &&
    chapterStarTaskProgress(chapterTwoStarTask) >=
      chapterTwoFullStarAward.requiredStars &&
    hasClaimedChapterStarAward(chapterTwoStarTask, 3)
  ) {
    setGuideMissionProgress(player, 40_021, 1);
  }

  if (
    player.formations.some(({ fightCards }) =>
      fightCards.some(({ weaponGuid }) => weaponGuid > 0),
    )
  ) {
    setGuideMissionProgress(player, 40_027, 1);
  }
  setGuideMissionProgress(player, 40_022, player.fightPower);
}

function handleGuideEvent(player: GuideMissionPlayer, event: DomainEvent): void {
  switch (event.type) {
    case "level.cleared":
      for (const mission of GUIDE_MISSIONS) {
        if (
          mission.level?.chapter === event.chapter &&
          mission.level.index === event.index &&
          mission.level.difficulty === event.difficulty
        ) {
          setGuideMissionProgress(player, mission.id, mission.target);
        }
      }
      break;
    case "weapon.enhanced":
      setGuideMissionProgress(player, 40_008, event.level);
      break;
    case "formation.updated":
      if (event.hasEquippedWeapon) {
        setGuideMissionProgress(player, 40_027, 1);
      }
      break;
    case "fight_power.changed":
      setGuideMissionProgress(player, 40_022, event.value);
      break;
  }
}

export const guideMissionActivity: ActivityHandler<GuideMissionPlayer> = {
  id: GUIDE_MISSION_ACTIVITY_ID,
  revision: 1,
  subscriptions: [
    "level.cleared",
    "weapon.enhanced",
    "formation.updated",
    "fight_power.changed",
  ],
  reconcile(player) {
    reconcileGuideMissions(player);
  },
  onEvent(player, event) {
    handleGuideEvent(player, event);
  },
};
