import type { BaseAward } from "./chapter-config.js";
import { dailySignUpOperationalDate } from "./daily-sign-up-data.js";

export const DAILY_MISSION_TASK_GROUP = 5;
export const DAILY_MISSION_ACTIVE_POINT_TASK_ID = 30_000;
export const DAILY_MISSION_ACTIVE_AWARD_TASK_ID = 30_001;
export const DAILY_MISSION_ACTIVE_POINT_MAX = 100;

export interface DailyMissionDefinition {
  id: number;
  target: number;
  activePoints: number;
}

export interface DailyMissionActiveAwardDefinition {
  id: number;
  requiredPoints: number;
  awards: readonly BaseAward[];
}

export interface DailyMissionState {
  operationalDate: string;
  revision?: number;
}

export interface DailyMissionPlayer {
  taskValues: Record<string, number>;
  dailyMissions?: DailyMissionState;
}

export const DAILY_MISSIONS: readonly DailyMissionDefinition[] = [
  { id: 101, target: 5, activePoints: 20 },
  { id: 102, target: 2, activePoints: 10 },
  { id: 103, target: 2, activePoints: 10 },
  { id: 104, target: 1, activePoints: 15 },
  { id: 105, target: 5, activePoints: 15 },
  { id: 106, target: 1, activePoints: 15 },
  { id: 107, target: 1, activePoints: 10 },
  { id: 108, target: 1, activePoints: 20 },
  { id: 109, target: 100, activePoints: 20 },
  { id: 110, target: 1, activePoints: 15 },
];

export const DAILY_MISSION_ACTIVE_AWARDS: readonly DailyMissionActiveAwardDefinition[] =
  [
    {
      id: 1,
      requiredPoints: 10,
      awards: [
        [15, 1, 1, 1, 10_000],
        [9, 16, 1, 1, 1],
        [15, 52, 1, 1, 100],
      ],
    },
    {
      id: 2,
      requiredPoints: 25,
      awards: [
        [15, 1, 1, 1, 10_000],
        [7, 1, 4, 3, 1],
        [7, 3, 1, 3, 1],
        [15, 52, 1, 1, 200],
      ],
    },
    {
      id: 3,
      requiredPoints: 50,
      awards: [
        [15, 1, 1, 1, 20_000],
        [5, 2, 1, 3, 1],
        [15, 10, 1, 1, 200],
        [15, 52, 1, 1, 300],
      ],
    },
    {
      id: 4,
      requiredPoints: 75,
      awards: [
        [15, 1, 1, 1, 20_000],
        [7, 7, 1, 4, 1],
        [15, 4, 1, 1, 60],
        [15, 52, 1, 1, 400],
      ],
    },
    {
      id: 5,
      requiredPoints: 100,
      awards: [
        [15, 1, 1, 1, 50_000],
        [15, 20, 1, 1, 20],
        [15, 2, 1, 1, 50],
        [15, 52, 1, 1, 600],
      ],
    },
  ];

const DAILY_MISSIONS_BY_ID = new Map(
  DAILY_MISSIONS.map((mission) => [mission.id, mission]),
);
const DAILY_ACTIVE_AWARDS_BY_ID = new Map(
  DAILY_MISSION_ACTIVE_AWARDS.map((award) => [award.id, award]),
);
const DAILY_MISSION_STATE_REVISION = 1;

export function dailyMissionOperationalDate(now = Date.now()): string {
  return dailySignUpOperationalDate(now);
}

export function makeDailyMissionTaskId(taskId: number): number {
  return (DAILY_MISSION_TASK_GROUP << 16) | taskId;
}

function makeLegacyDailyMissionTaskId(taskId: number): number {
  return (taskId << 16) | DAILY_MISSION_TASK_GROUP;
}

export function dailyMission(missionId: number): DailyMissionDefinition | null {
  return DAILY_MISSIONS_BY_ID.get(missionId) ?? null;
}

export function dailyMissionActiveAward(
  awardId: number,
): DailyMissionActiveAwardDefinition | null {
  return DAILY_ACTIVE_AWARDS_BY_ID.get(awardId) ?? null;
}

export function dailyMissionProgress(taskValue: number): number {
  return Math.max(0, Math.trunc(taskValue / 2));
}

export function hasClaimedDailyMission(taskValue: number): boolean {
  return (taskValue & 1) === 1;
}

export function makeDailyMissionTaskValue(progress: number, claimed: boolean): number {
  const safeProgress = Math.max(0, Math.min(0x3fffffff, Math.trunc(progress)));
  return safeProgress * 2 + (claimed ? 1 : 0);
}

export function dailyMissionActivePoints(
  player: Pick<DailyMissionPlayer, "taskValues">,
): number {
  return Math.max(
    0,
    Math.min(
      DAILY_MISSION_ACTIVE_POINT_MAX,
      player.taskValues[
        String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_POINT_TASK_ID))
      ] ?? 0,
    ),
  );
}

export function hasClaimedDailyMissionActiveAward(
  player: Pick<DailyMissionPlayer, "taskValues">,
  awardId: number,
): boolean {
  const mask =
    player.taskValues[
      String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_AWARD_TASK_ID))
    ] ?? 0;
  return (mask & (1 << awardId)) !== 0;
}

export function markDailyMissionActiveAwardClaimed(
  player: Pick<DailyMissionPlayer, "taskValues">,
  awardId: number,
): void {
  const taskId = String(makeDailyMissionTaskId(DAILY_MISSION_ACTIVE_AWARD_TASK_ID));
  player.taskValues[taskId] = (player.taskValues[taskId] ?? 0) | (1 << awardId);
}

export function reconcileDailyMissions(
  player: DailyMissionPlayer,
  now = Date.now(),
): boolean {
  const operationalDate = dailyMissionOperationalDate(now);
  const previousState = player.dailyMissions;
  const dailyReset = previousState?.operationalDate !== operationalDate;
  const migrationRequired =
    !dailyReset && previousState?.revision !== DAILY_MISSION_STATE_REVISION;
  if (!dailyReset && !migrationRequired) return false;

  player.dailyMissions = {
    operationalDate,
    revision: DAILY_MISSION_STATE_REVISION,
  };
  const taskIds = [
    ...DAILY_MISSIONS.map(({ id }) => id),
    DAILY_MISSION_ACTIVE_POINT_TASK_ID,
    DAILY_MISSION_ACTIVE_AWARD_TASK_ID,
  ];
  for (const taskId of taskIds) {
    const key = String(makeDailyMissionTaskId(taskId));
    const legacyKey = String(makeLegacyDailyMissionTaskId(taskId));
    player.taskValues[key] = dailyReset
      ? 0
      : (player.taskValues[key] ?? player.taskValues[legacyKey] ?? 0);
    if (legacyKey !== key) delete player.taskValues[legacyKey];
  }
  return true;
}

export function incrementDailyMissionProgress(
  player: DailyMissionPlayer,
  missionId: number,
  amount = 1,
  now = Date.now(),
): boolean {
  reconcileDailyMissions(player, now);
  const mission = dailyMission(missionId);
  if (!mission || !Number.isFinite(amount) || amount <= 0) return false;

  const taskId = String(makeDailyMissionTaskId(mission.id));
  const current = player.taskValues[taskId] ?? 0;
  const progress = dailyMissionProgress(current);
  const nextProgress = Math.min(mission.target, progress + Math.trunc(amount));
  if (nextProgress === progress) return false;
  player.taskValues[taskId] = makeDailyMissionTaskValue(
    nextProgress,
    hasClaimedDailyMission(current),
  );
  return true;
}

export function isDailyMissionTaskValueId(flatTaskId: number): boolean {
  if (!Number.isSafeInteger(flatTaskId)) return false;
  const group = Math.trunc(flatTaskId / 0x10000);
  const taskId = flatTaskId & 0xffff;
  if (group !== DAILY_MISSION_TASK_GROUP) return false;
  return (
    DAILY_MISSIONS_BY_ID.has(taskId) ||
    taskId === DAILY_MISSION_ACTIVE_POINT_TASK_ID ||
    taskId === DAILY_MISSION_ACTIVE_AWARD_TASK_ID
  );
}

export function claimableDailyMissionActiveAwards(
  player: Pick<DailyMissionPlayer, "taskValues">,
): DailyMissionActiveAwardDefinition[] {
  const points = dailyMissionActivePoints(player);
  return DAILY_MISSION_ACTIVE_AWARDS.filter(
    ({ id, requiredPoints }) =>
      points >= requiredPoints && !hasClaimedDailyMissionActiveAward(player, id),
  );
}

export function activeAwardsWithoutBattlePass(
  awards: readonly BaseAward[],
): BaseAward[] {
  return awards.filter(
    ([genre, detail, particular, templateLevel]) =>
      !(genre === 15 && detail === 52 && particular === 1 && templateLevel === 1),
  );
}
