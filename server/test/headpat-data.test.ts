import { describe, expect, it } from "vitest";

import {
  consumeHeadpatCharge,
  HEADPAT_CHARGE_TASK_ID,
  HEADPAT_REFILL_TASK_ID,
  isHeadpatInteractionType,
  isHeadpatTaskId,
  reconcileHeadpatCharges,
} from "../src/game-data/headpat-data.js";

const countKey = String(HEADPAT_CHARGE_TASK_ID),
  timeKey = String(HEADPAT_REFILL_TASK_ID);
const START = 1_800_000_000;
function stock(count: number, time: number): Record<string, number> {
  return { [countKey]: count, [timeKey]: time };
}

describe("recovered headpat charge rules", () => {
  it("initializes missing fields without replenishing explicit legitimate zeros", () => {
    const missing: Record<string, number> = {};
    expect(reconcileHeadpatCharges(missing, START * 1_000)).toEqual({
      charges: 5,
      refillAt: 0,
    });
    expect(missing).toEqual(stock(5, 0));
    const empty = stock(0, 0);
    expect(reconcileHeadpatCharges(empty, START * 1_000)).toEqual({
      charges: 0,
      refillAt: 0,
    });
    expect(empty).toEqual(stock(0, 0));
  });

  it("starts a single refill timer when consuming from full and rejects the sixth charge", () => {
    const values: Record<string, number> = {};
    for (let used = 1; used <= 5; used++) {
      expect(consumeHeadpatCharge(values, (START + used) * 1_000)).toEqual({
        charges: 5 - used,
        refillAt: START + 1,
      });
    }
    expect(consumeHeadpatCharge(values, (START + 6) * 1_000)).toBeNull();
    expect(values).toEqual(stock(0, START + 1));
  });

  it("mirrors the client strict greater-than-hour boundary and preserves fractional refill time", () => {
    const values = stock(0, START);
    expect(reconcileHeadpatCharges(values, (START + 3_600) * 1_000)).toEqual({
      charges: 0,
      refillAt: START,
    });
    expect(reconcileHeadpatCharges(values, (START + 3_601) * 1_000)).toEqual({
      charges: 1,
      refillAt: START + 3_600,
    });
    expect(reconcileHeadpatCharges(values, (START + 7_250) * 1_000)).toEqual({
      charges: 2,
      refillAt: START + 7_200,
    });
    expect(consumeHeadpatCharge(values, (START + 7_251) * 1_000)).toEqual({
      charges: 1,
      refillAt: START + 7_200,
    });
  });

  it("clears the timer at capacity and starts a new timer after spending from the refilled stock", () => {
    const values = stock(4, START);
    expect(reconcileHeadpatCharges(values, (START + 7_250) * 1_000)).toEqual({
      charges: 5,
      refillAt: 0,
    });
    expect(consumeHeadpatCharge(values, (START + 7_250) * 1_000)).toEqual({
      charges: 4,
      refillAt: START + 7_250,
    });
  });

  it("does not create free charges after a clock rollback and rejects invalid clocks", () => {
    const values = stock(2, START + 100);
    expect(reconcileHeadpatCharges(values, START * 1_000)).toEqual({
      charges: 2,
      refillAt: START + 100,
    });
    expect(() => reconcileHeadpatCharges(values, Number.NaN)).toThrow(
      "Invalid headpat clock",
    );
    expect(values).toEqual(stock(2, START + 100));
  });

  it("recognizes only authoritative charge fields and the three proven interaction types", () => {
    expect(HEADPAT_CHARGE_TASK_ID).toBe(131_173);
    expect(HEADPAT_REFILL_TASK_ID).toBe(131_174);
    expect(isHeadpatTaskId(131_173)).toBe(true);
    expect(isHeadpatTaskId(131_174)).toBe(true);
    expect(isHeadpatTaskId(131_175)).toBe(false);
    expect([0, 1, 2].every(isHeadpatInteractionType)).toBe(true);
    expect([-1, 3, 0.5, Number.NaN].some(isHeadpatInteractionType)).toBe(false);
  });
});
