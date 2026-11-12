export const DEFAULT_TRAINING_OUTDOOR_ID = 72;
export const MAX_CONCURRENT_GIRL_TRAINING = 4;

export interface GirlTrainingConfig {
  type: number;
  durationSeconds: number;
  loveReward: number;
  crystalReward: number;
  maximumPositions: number;
  vigorCost: number;
}

const GIRL_TRAINING_CONFIGS = new Map<number, GirlTrainingConfig>([
  [
    1,
    {
      type: 1,
      durationSeconds: 3_600,
      loveReward: 60,
      crystalReward: 1_000,
      maximumPositions: 3,
      vigorCost: 0,
    },
  ],
  [
    2,
    {
      type: 2,
      durationSeconds: 7_200,
      loveReward: 120,
      crystalReward: 1_800,
      maximumPositions: 3,
      vigorCost: 0,
    },
  ],
  [
    3,
    {
      type: 3,
      durationSeconds: 14_400,
      loveReward: 240,
      crystalReward: 3_200,
      maximumPositions: 3,
      vigorCost: 0,
    },
  ],
  [
    4,
    {
      type: 4,
      durationSeconds: 28_800,
      loveReward: 480,
      crystalReward: 5_000,
      maximumPositions: 3,
      vigorCost: 0,
    },
  ],
]);

export function getGirlTrainingConfig(position: number): GirlTrainingConfig | null {
  if (!Number.isSafeInteger(position) || position <= 0) return null;
  const type = Math.floor(position / 10);
  const slot = position % 10;
  const config = GIRL_TRAINING_CONFIGS.get(type);
  if (!config || slot < 1 || slot > config.maximumPositions) return null;
  return config;
}
