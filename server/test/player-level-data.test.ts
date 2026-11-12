import { describe, expect, it } from "vitest";

import {
  addPlayerExperience,
  getPlayerLevelConfig,
  MAX_PLAYER_LEVEL,
} from "../src/game-data/player-level-data.js";

describe("player level data", () => {
  it("matches the early PlayerExp rows used by the client UI", () => {
    expect(MAX_PLAYER_LEVEL).toBe(300);
    expect(getPlayerLevelConfig(1)).toEqual({
      level: 1,
      experience: 10,
      vigourRecovery: 15,
    });
    expect(getPlayerLevelConfig(2)?.experience).toBe(10);
    expect(getPlayerLevelConfig(3)?.experience).toBe(12);
    expect(getPlayerLevelConfig(4)?.experience).toBe(13);
    expect(getPlayerLevelConfig(300)?.experience).toBe(0);
  });

  it("rolls residual experience across every crossed level", () => {
    expect(addPlayerExperience(1, 0, 36)).toEqual({
      level: 4,
      experience: 4,
      levelsGained: 3,
      vigourRecovery: 50,
    });
    expect(addPlayerExperience(1, 9, 1)).toEqual({
      level: 2,
      experience: 0,
      levelsGained: 1,
      vigourRecovery: 15,
    });
  });

  it("clears residual experience at the configured level cap", () => {
    expect(addPlayerExperience(299, 0, 5_982)).toEqual({
      level: 300,
      experience: 0,
      levelsGained: 1,
      vigourRecovery: 150,
    });
    expect(addPlayerExperience(300, 99_999, 1)).toEqual({
      level: 300,
      experience: 0,
      levelsGained: 0,
      vigourRecovery: 0,
    });
  });
});
