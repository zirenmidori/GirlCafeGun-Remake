// Recovered GirlCommon:TouchHeadCount and GirlConfig constants. The task IDs
// are global player values, not per-girl cooldowns. No file I/O is needed.
export const HEADPAT_CHARGE_TASK_ID = (2 << 16) | 101;
export const HEADPAT_REFILL_TASK_ID = (2 << 16) | 102;
export const HEADPAT_MAX_CHARGES = 5;
export const HEADPAT_REFILL_SECONDS = 3_600;
// Reconstructed from GameTeahouse / 知北游 first-hand play report (2019),
// not an absent shipped server constant: https://www.sohu.com/a/363084739_120099888
export const HEADPAT_AFFECTION_EXPERIENCE = 50;
export type HeadpatInteractionType = 0 | 1 | 2;
export interface HeadpatChargeState {
  charges: number;
  refillAt: number;
}
export interface HeadpatResponse {
  sCmd: "HeadTouched";
  nId: number;
  nType: HeadpatInteractionType;
  nIsMaxlevel?: true;
  nAddExp?: number;
  nOldExp?: number;
  nNewExp?: number;
  nOldLevel?: number;
  nNewLevel?: number;
}
export function isHeadpatTaskId(id: number): boolean {
  return id === HEADPAT_CHARGE_TASK_ID || id === HEADPAT_REFILL_TASK_ID;
}
export function isHeadpatInteractionType(
  value: number,
): value is HeadpatInteractionType {
  return Number.isSafeInteger(value) && (value === 0 || value === 1 || value === 2);
}
/** Initializes missing values only. Explicit zero charges/time are legitimate. */
export function reconcileHeadpatCharges(
  taskValues: Record<string, number>,
  nowMs = Date.now(),
): HeadpatChargeState {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0)
    throw new Error("Invalid headpat clock");
  const chargeKey = String(HEADPAT_CHARGE_TASK_ID),
    timeKey = String(HEADPAT_REFILL_TASK_ID);
  const storedCount = taskValues[chargeKey],
    storedTime = taskValues[timeKey];
  let charges =
    storedCount === undefined
      ? HEADPAT_MAX_CHARGES
      : Math.min(HEADPAT_MAX_CHARGES, Math.max(0, Math.floor(storedCount)));
  let refillAt = storedTime === undefined ? 0 : Math.max(0, Math.floor(storedTime));
  if (!Number.isSafeInteger(charges)) charges = 0;
  if (!Number.isSafeInteger(refillAt)) refillAt = 0;
  const now = Math.floor(nowMs / 1_000),
    elapsed = now - refillAt;
  // Deliberately strict: shipped Lua uses nSec > TouchHeadTime.
  if (refillAt !== 0 && elapsed > HEADPAT_REFILL_SECONDS) {
    charges += Math.floor(elapsed / HEADPAT_REFILL_SECONDS);
    if (charges >= HEADPAT_MAX_CHARGES) {
      charges = HEADPAT_MAX_CHARGES;
      refillAt = 0;
    } else refillAt = now - (elapsed % HEADPAT_REFILL_SECONDS);
  }
  taskValues[chargeKey] = charges;
  taskValues[timeKey] = refillAt;
  return { charges, refillAt };
}
/** Returns null without consuming when no charge is available. */
export function consumeHeadpatCharge(
  taskValues: Record<string, number>,
  nowMs = Date.now(),
): HeadpatChargeState | null {
  const current = reconcileHeadpatCharges(taskValues, nowMs);
  if (current.charges <= 0) return null;
  const charges = current.charges - 1;
  const refillAt =
    current.refillAt === 0 ? Math.floor(nowMs / 1_000) : current.refillAt;
  taskValues[String(HEADPAT_CHARGE_TASK_ID)] = charges;
  taskValues[String(HEADPAT_REFILL_TASK_ID)] = refillAt;
  return { charges, refillAt };
}
