import { readFileSync } from "node:fs";
import path from "node:path";

import { customCardTemplates } from "./custom-card-data.js";
import type { GachaCard, GachaPool, Gdpl } from "./gacha-data.js";
import {
  recruitmentPolicy,
  RECRUITMENT_ROTATION_POOL_ID,
  ROTATION_SELECTION_TASK,
} from "./recruitment-policy.js";
import {
  rotationSelectorCatalog,
  type SelectionKind,
} from "./rotation-selector-data.js";

export const DEFAULT_GACHA_ROTATION_DAYS = 7;
export const MAX_GACHA_ROTATION_DAYS = 14;
export const GACHA_ROTATION_COHORTS = 26;
export const ROTATING_GACHA_POOL_ID = RECRUITMENT_ROTATION_POOL_ID;
export const RAILGUN_GACHA_POOL_ID = 46;
const STANDARD_POOL_ID = 1;
const DAY_SECONDS = 86_400;
// Monday 04:00 in the game's UTC+8 operational timezone.
const EPOCH_SECONDS = Date.UTC(2026, 10, 8, 20) / 1_000;

export function activeGachaBannerIds(
  now = Date.now(),
  rotationDays = DEFAULT_GACHA_ROTATION_DAYS,
): { character: number[]; weapon: number[] } {
  // Final regular-ticket windows from Gacha/gacha.txt. Special banners require
  // their own tickets and are conditional on ownership, rather than daily pools.
  const character =
    now >= Date.UTC(2022, 4, 18) && now < Date.UTC(2077, 0, 1)
      ? [STANDARD_POOL_ID]
      : [];
  // The restored collaboration uses ordinary recruitment tickets and remains
  // available independently of the optional rotation.
  character.push(RAILGUN_GACHA_POOL_ID);
  const weapon =
    now >= Date.UTC(2022, 1, 23) && now < Date.UTC(2077, 2, 1, 15, 59)
      ? [STANDARD_POOL_ID]
      : [];
  if (rotationDays > 0) {
    character.push(ROTATING_GACHA_POOL_ID);
    weapon.push(ROTATING_GACHA_POOL_ID);
  }
  return { character, weapon };
}

interface RotationBanner {
  id: number;
  basePoolId: number;
  rows: readonly GachaCard[];
  selector?: {
    gdpl: [number, number, number, number, number];
    every: number;
    progressTask: number;
  };
}

interface RotationManifest {
  revision: number;
  startsAt: number;
  endsAt: number;
  intervalDays: number;
  character?: RotationBanner;
  weapon?: RotationBanner;
}

interface RotationPool {
  pool: GachaPool;
  rows: readonly GachaCard[];
}

interface RotationWindow {
  manifest: RotationManifest;
  character: GachaPool | null;
  weapon: GachaPool | null;
}

function roster(contents: string): Record<"character" | "weapon", GachaCard[]> {
  const result = { character: [] as GachaCard[], weapon: [] as GachaCard[] };
  const seen = new Set<string>();
  const customRarities = new Map(
    customCardTemplates().map(({ gdpl, rarity }) => [gdpl.join(":"), rarity]),
  );
  for (const line of contents.split(/\r?\n/).slice(3)) {
    if (!line.trim()) continue;
    const columns = line.split("\t");
    const gdpl = columns.slice(0, 4).map(Number) as Gdpl;
    const rarity = Number(columns[4]);
    const kind = gdpl[0] === 1 ? "character" : gdpl[0] === 2 ? "weapon" : null;
    const key = gdpl.join(":");
    const customRarity = customRarities.get(key);
    if (
      columns.length !== 6 ||
      !kind ||
      gdpl.some((part) => !Number.isSafeInteger(part) || part <= 0) ||
      !Number.isInteger(rarity) ||
      rarity < 1 ||
      rarity > 5 ||
      (kind === "character" &&
        (customRarity !== undefined
          ? rarity !== customRarity
          : Math.min(rarity, 4) !== Math.min(gdpl[3], 4))) ||
      seen.has(key)
    ) {
      throw new Error("Invalid rotation roster row: " + line);
    }
    seen.add(key);
    if (columns[5]) continue;
    const id = result[kind].length + 1;
    result[kind].push({
      id,
      gdpl,
      rarity,
      rate: 1,
      isPreview: rarity >= 4,
      upFlag: 0,
      sort: id,
    });
  }
  return result;
}

function buildPools(
  base: GachaPool,
  cards: readonly GachaCard[],
  kind: SelectionKind,
): RotationPool[] {
  const tiers = [1, 2, 3, 4].map((star) =>
    cards.filter(({ rarity }) => Math.min(rarity, 4) === star),
  );
  if (tiers.some((tier) => tier.length === 0))
    throw new Error("Rotation roster must contain all four rarity tiers");

  return Array.from({ length: GACHA_ROTATION_COHORTS }, (_, slot) => {
    const normalCards = new Map<number, readonly GachaCard[]>();
    for (const [index, tier] of tiers.entries()) {
      const assigned = tier.filter((_, i) => i % GACHA_ROTATION_COHORTS === slot);
      // Smaller tiers repeat eligible fillers so tier odds never get redistributed.
      normalCards.set(
        index + 1,
        assigned.length ? assigned : [tier[slot % tier.length]!],
      );
    }
    const hedgeCards = new Map([
      [3, normalCards.get(3)!],
      [4, normalCards.get(4)!],
    ]);
    const selector = rotationSelectorCatalog().forLineup(
      kind,
      slot,
      normalCards.get(4)!.map(({ gdpl }) => gdpl),
    );
    const every = recruitmentPolicy().selectorEveryDraws;
    return {
      pool: {
        ...base,
        id: ROTATING_GACHA_POOL_ID,
        normalCards,
        hedgeCards,
        ...(every > 0
          ? {
              selectionMilestone: {
                every,
                progressTask: ROTATION_SELECTION_TASK[kind],
                item: [...selector.itemGdpl, 1] as [
                  number,
                  number,
                  number,
                  number,
                  number,
                ],
              },
            }
          : {}),
      },
      rows: [...normalCards.values()].flat(),
    };
  });
}

export class GachaRotationCatalog {
  readonly #character: RotationPool[];
  readonly #weapon: RotationPool[];
  readonly #rarities: Map<string, number>;

  constructor(
    contents: string,
    characterBase: GachaPool,
    weaponBase: GachaPool,
    private readonly intervalDays = DEFAULT_GACHA_ROTATION_DAYS,
  ) {
    if (
      !Number.isInteger(intervalDays) ||
      intervalDays < 0 ||
      intervalDays > MAX_GACHA_ROTATION_DAYS
    ) {
      throw new Error("Gacha rotation days must be an integer from 0 to 14");
    }
    const eligible = roster(contents);
    this.#rarities = new Map(
      eligible.character.map(({ gdpl, rarity }) => [gdpl.join(":"), rarity]),
    );
    this.#character = buildPools(characterBase, eligible.character, "character");
    this.#weapon = buildPools(weaponBase, eligible.weapon, "weapon");
  }

  static loadDefault(
    characterBase: GachaPool,
    weaponBase: GachaPool,
    intervalDays?: number,
  ): GachaRotationCatalog {
    const file = path.resolve("resources/gacha/rotation-roster.txt");
    return new GachaRotationCatalog(
      readFileSync(file, "utf8"),
      characterBase,
      weaponBase,
      intervalDays,
    );
  }

  cardRarityOf(gdpl: Gdpl): number | null {
    return this.#rarities.get(gdpl.join(":")) ?? null;
  }

  at(now = Date.now()): RotationWindow {
    if (this.intervalDays === 0) {
      return {
        manifest: { revision: 0, startsAt: 0, endsAt: 0, intervalDays: 0 },
        character: null,
        weapon: null,
      };
    }
    const duration = this.intervalDays * DAY_SECONDS;
    const window = Math.floor((now / 1_000 - EPOCH_SECONDS) / duration);
    const slot =
      ((window % GACHA_ROTATION_COHORTS) + GACHA_ROTATION_COHORTS) %
      GACHA_ROTATION_COHORTS;
    const startsAt = EPOCH_SECONDS + window * duration;
    const character = this.#character[slot]!;
    const weapon = this.#weapon[slot]!;
    return {
      manifest: {
        revision: startsAt,
        startsAt,
        endsAt: startsAt + duration,
        intervalDays: this.intervalDays,
        character: {
          id: ROTATING_GACHA_POOL_ID,
          basePoolId: STANDARD_POOL_ID,
          rows: character.rows,
          ...(character.pool.selectionMilestone
            ? {
                selector: {
                  gdpl: character.pool.selectionMilestone.item,
                  every: character.pool.selectionMilestone.every,
                  progressTask: character.pool.selectionMilestone.progressTask,
                },
              }
            : {}),
        },
        weapon: {
          id: ROTATING_GACHA_POOL_ID,
          basePoolId: STANDARD_POOL_ID,
          rows: weapon.rows,
          ...(weapon.pool.selectionMilestone
            ? {
                selector: {
                  gdpl: weapon.pool.selectionMilestone.item,
                  every: weapon.pool.selectionMilestone.every,
                  progressTask: weapon.pool.selectionMilestone.progressTask,
                },
              }
            : {}),
        },
      },
      character: character.pool,
      weapon: weapon.pool,
    };
  }
}
