import type { BaseAward } from "./chapter-config.js";

export const CHAPTER_STAR_TASK_GROUP = 14;

export interface ChapterStarAward {
  chapter: number;
  difficulty: number;
  position: number;
  requiredStars: number;
  awards: readonly BaseAward[];
}

export interface ChapterLevelStars {
  id: number;
  star: number;
}

function validCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Mirrors Map/StarAward.txt bundled with the restored client.
 *
 * Chapters 1-3 contain six normal/hard stages. From chapter 4 onward the
 * chapters contain twelve stages, so their three thresholds are doubled.
 */
export function chapterStarAward(
  chapter: number,
  difficulty: number,
  position: number,
): ChapterStarAward | null {
  if (
    !validCoordinate(chapter) ||
    chapter > 16 ||
    (difficulty !== 1 && difficulty !== 2) ||
    !validCoordinate(position) ||
    position > 3
  ) {
    return null;
  }

  const longChapter = chapter >= 4;
  const requiredStars = (longChapter ? 12 : 6) * position;
  const diamondCount = (longChapter ? 20 : 10) * position;
  const goldCount =
    position === 1
      ? difficulty === 1 && !longChapter
        ? 1_500
        : 3_000
      : position === 2
        ? difficulty === 1 && !longChapter
          ? 2_000
          : 4_000
        : difficulty === 1 && !longChapter
          ? 3_000
          : 6_000;
  const material: BaseAward =
    difficulty === 1
      ? [7, 1, 4, longChapter ? 2 : 1, 1]
      : [7, 3, 1, longChapter ? 3 : 2, longChapter ? 1 : 2];

  return {
    chapter,
    difficulty,
    position,
    requiredStars,
    awards: [[15, 2, 1, 1, diamondCount], [15, 1, 1, 1, goldCount], material],
  };
}

export function makeChapterStarTaskId(chapter: number, difficulty: number): number {
  const taskId = difficulty | (chapter << 8);
  return (CHAPTER_STAR_TASK_GROUP << 16) | taskId;
}

export function completedStarCount(starValue: number): number {
  const mask = starValue & 0b111;
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
}

export function chapterTotalStars(
  levels: readonly ChapterLevelStars[],
  chapter: number,
  difficulty: number,
): number {
  return levels.reduce((total, level) => {
    const levelChapter = level.id >>> 16;
    const levelDifficulty = level.id & 0xff;
    if (levelChapter !== chapter || levelDifficulty !== difficulty) return total;
    return total + completedStarCount(level.star);
  }, 0);
}

export function chapterStarTaskValue(totalStars: number, claimedMask: number): number {
  return (Math.max(0, totalStars) << 8) | (claimedMask & 0xff);
}

export function chapterStarTaskProgress(taskValue: number): number {
  return taskValue >>> 8;
}

export function chapterStarClaimedMask(taskValue: number): number {
  return taskValue & 0xff;
}

export function hasClaimedChapterStarAward(
  taskValue: number,
  position: number,
): boolean {
  return (chapterStarClaimedMask(taskValue) & (1 << (position - 1))) !== 0;
}

export function markChapterStarAwardClaimed(
  taskValue: number,
  position: number,
): number {
  return taskValue | (1 << (position - 1));
}
