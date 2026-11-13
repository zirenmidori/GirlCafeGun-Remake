import { readFileSync } from "node:fs";
import path from "node:path";

export const RECRUITMENT_ROTATION_POOL_ID = 850;
export const ROTATION_SELECTION_TASK = { character: 11_000, weapon: 11_001 } as const;
export function isRotationSelectionTaskId(id: number): boolean {
  return (
    id === ((15 << 16) | ROTATION_SELECTION_TASK.character) ||
    id === ((15 << 16) | ROTATION_SELECTION_TASK.weapon)
  );
}

export interface RecruitmentPolicy {
  schemaVersion: 1;
  rotationDailyDraws: number;
  otherBannerDailyDraws: number;
  selectorEveryDraws: number;
}

export function parseRecruitmentPolicy(value: unknown): RecruitmentPolicy {
  if (!value || typeof value !== "object")
    throw new Error("Invalid recruitment policy");
  const policy = value as RecruitmentPolicy;
  if (
    policy.schemaVersion !== 1 ||
    ![policy.rotationDailyDraws, policy.otherBannerDailyDraws].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 10_000 && n % 10 === 0,
    ) ||
    !Number.isSafeInteger(policy.selectorEveryDraws) ||
    policy.selectorEveryDraws < 0 ||
    policy.selectorEveryDraws > 100_000
  )
    throw new Error("Invalid recruitment policy");
  return Object.freeze({ ...policy });
}

let cached: RecruitmentPolicy | undefined;
export function recruitmentPolicy(): RecruitmentPolicy {
  return (cached ??= parseRecruitmentPolicy(
    JSON.parse(
      readFileSync(path.resolve("resources/gacha/recruitment-policy.json"), "utf8"),
    ),
  ));
}
