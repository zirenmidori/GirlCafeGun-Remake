import { describe, expect, it } from "vitest";

import { getGirlTrainingConfig } from "../src/game-data/girl-training-data.js";

describe("girl training configuration", () => {
  it("matches the four original client training rows", () => {
    expect(getGirlTrainingConfig(11)).toMatchObject({
      durationSeconds: 3_600,
      loveReward: 60,
      crystalReward: 1_000,
      vigorCost: 0,
    });
    expect(getGirlTrainingConfig(21)).toMatchObject({
      durationSeconds: 7_200,
      loveReward: 120,
      crystalReward: 1_800,
      vigorCost: 0,
    });
    expect(getGirlTrainingConfig(31)).toMatchObject({
      durationSeconds: 14_400,
      loveReward: 240,
      crystalReward: 3_200,
      vigorCost: 0,
    });
    expect(getGirlTrainingConfig(41)).toMatchObject({
      durationSeconds: 28_800,
      loveReward: 480,
      crystalReward: 5_000,
      vigorCost: 0,
    });
  });

  it("rejects positions not present in the original TrainPos table", () => {
    expect(getGirlTrainingConfig(20)).toBeNull();
    expect(getGirlTrainingConfig(24)).toBeNull();
    expect(getGirlTrainingConfig(51)).toBeNull();
  });
});
