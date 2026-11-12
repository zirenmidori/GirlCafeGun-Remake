import {
  ActivityEngine,
  ActivityRegistry,
  type ActivityPlayerState,
} from "./activity-engine.js";
import {
  guideMissionActivity,
  type GuideMissionPlayer,
} from "../game-data/guide-mission-data.js";

export type DefaultActivityPlayer = ActivityPlayerState & GuideMissionPlayer;

export function createDefaultActivityEngine(): ActivityEngine<DefaultActivityPlayer> {
  return new ActivityEngine(
    new ActivityRegistry<DefaultActivityPlayer>([guideMissionActivity]),
  );
}
