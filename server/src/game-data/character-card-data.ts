export const PLAYABLE_GIRL_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 27, 201, 202, 203, 204,
] as const;

const PLAYABLE_GIRL_ID_SET = new Set<number>(PLAYABLE_GIRL_IDS);

/**
 * Most character cards use Particular as their model id. These are the
 * exceptions extracted from the client's CharacterCard table.
 */
const CHARACTER_CARD_MODEL_OVERRIDES = new Map<string, number>([
  ["1:71:4", 7001],
  ["1:81:5", 8001],
  ["2:71:4", 7001],
  ["2:81:5", 8001],
  ["3:71:4", 7001],
  ["3:81:5", 8001],
  ["3:82:5", 8002],
  ["4:81:5", 8001],
  ["5:71:4", 7001],
  ["6:71:4", 7001],
  ["6:81:5", 8001],
  ["7:71:4", 7001],
  ["7:81:5", 8001],
  ["7:82:5", 8002],
  ["8:71:4", 7001],
  ["8:81:5", 8001],
  ["9:71:4", 7001],
  ["9:72:4", 7002],
  ["9:82:5", 8002],
  ["10:71:4", 7001],
  ["10:81:5", 8001],
  ["10:82:5", 8002],
  ["11:71:4", 7001],
  ["11:81:5", 8001],
  ["12:71:3", 7001],
  ["12:72:4", 7002],
  ["12:81:5", 8001],
  ["13:71:4", 7001],
  ["13:81:5", 8001],
  ["14:81:5", 8001],
  ["15:71:4", 7001],
  ["15:81:5", 8001],
  ["16:71:4", 7001],
  ["16:81:5", 8001],
]);

export function isPlayableGirlId(girlId: number): boolean {
  return PLAYABLE_GIRL_ID_SET.has(girlId);
}

export function characterCardModelId(card: {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
}): number | null {
  if (
    card.genre !== 1 ||
    !isPlayableGirlId(card.detail) ||
    !Number.isSafeInteger(card.particular) ||
    card.particular <= 0
  ) {
    return null;
  }
  return (
    CHARACTER_CARD_MODEL_OVERRIDES.get(
      `${card.detail}:${card.particular}:${card.templateLevel}`,
    ) ?? card.particular
  );
}
