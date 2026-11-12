import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export type BaseAward = [
  genre: number,
  detail: number,
  particular: number,
  level: number,
  count: number,
];
export type Award = [...BaseAward, flag: number];

interface WeightedAward {
  award: BaseAward;
  weight: number;
}

export interface ChapterLevelConfig {
  chapter: number;
  index: number;
  difficulty: number;
  name: string;
  storyOnly: boolean;
  preCost: number;
  vigour: number;
  randDropNum: number;
  firstAwards: BaseAward[];
  fixedAwards: WeightedAward[];
  randomAwards: WeightedAward[];
  masterExp: number;
  cardExp: number;
}

function integer(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function parseAwards(value: string | undefined): number[][] {
  if (!value) return [];
  return [...value.matchAll(/\[([0-9-]+)\]/g)]
    .map((match) => match[1]!.split("-").map(Number))
    .filter(
      (values) =>
        values.length >= 5 &&
        values.slice(0, 5).every((part) => Number.isSafeInteger(part)),
    );
}

function baseAward(values: readonly number[]): BaseAward {
  return [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!];
}

export class ChapterCatalog {
  readonly #levels = new Map<string, ChapterLevelConfig>();

  constructor(contents: string) {
    const lines = contents.split(/\r?\n/);
    const headers = lines[2]?.split("\t") ?? [];
    for (const line of lines.slice(3)) {
      if (!line.trim()) continue;
      const values = line.split("\t");
      const row = Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );
      const chapter = integer(row.Chapter);
      const index = integer(row.Index);
      const difficulty = integer(row.Difficult);
      if (chapter <= 0 || index <= 0 || difficulty <= 0) continue;

      const firstAwards = parseAwards(row.FirstAward).map(baseAward);
      const fixedAwards = parseAwards(row.FixedAward).map((award) => ({
        award: baseAward(award),
        weight: award[5] ?? 10_000,
      }));
      const randomAwards = parseAwards(row.RandomAward).map((award) => ({
        award: baseAward(award),
        weight: award[5] ?? 0,
      }));
      const config: ChapterLevelConfig = {
        chapter,
        index,
        difficulty,
        name: row.name ?? "",
        // The final client plays Chapter 16's configured stories in place of combat.
        storyOnly:
          chapter === 16 &&
          integer(row.Type) !== 2 &&
          integer(row.StoryType) > 0 &&
          Boolean(row.StoryID?.trim()),
        preCost: integer(row.PreCost),
        vigour: integer(row.Vigour),
        randDropNum: integer(row.RandDropNum),
        firstAwards,
        fixedAwards,
        randomAwards,
        masterExp: integer(row.MasterExp),
        cardExp: integer(row.CardExp),
      };
      this.#levels.set(ChapterCatalog.key(chapter, index, difficulty), config);
    }
  }

  static loadDefault(): ChapterCatalog {
    const filePath = path.resolve(process.cwd(), "resources/map/chapter.txt");
    return new ChapterCatalog(readFileSync(filePath, "utf8"));
  }

  static key(chapter: number, index: number, difficulty: number): string {
    return `${chapter}:${index}:${difficulty}`;
  }

  get(chapter: number, index: number, difficulty: number): ChapterLevelConfig | null {
    return this.#levels.get(ChapterCatalog.key(chapter, index, difficulty)) ?? null;
  }

  get size(): number {
    return this.#levels.size;
  }
}

function deterministicRoll(seed: string, sequence: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  const digest = createHash("sha256").update(`${seed}:${sequence}`).digest();
  return digest.readUInt32LE(0) % ceiling;
}

export function effectiveEnergyCost(
  level: ChapterLevelConfig,
  playerLevel: number,
): number {
  const baseCost = level.preCost + level.vigour;
  // The bundled CN client applies the permanent low-level support plan shown
  // in the level panel: commanders below level 35 pay half, rounded up.
  return playerLevel < 35 ? Math.ceil(baseCost / 2) : baseCost;
}

export function rollChapterAwards(
  level: ChapterLevelConfig,
  firstClear: boolean,
  seed: string,
): Award[] {
  const result: Award[] = [];
  if (firstClear) {
    result.push(...level.firstAwards.map((award) => [...award, 0] as Award));
  }

  let sequence = 0;
  for (const { award, weight } of level.fixedAwards) {
    if (deterministicRoll(seed, sequence++, 10_000) < weight) {
      result.push([...award, 100] as Award);
    }
  }

  const totalWeight = level.randomAwards.reduce(
    (total, entry) => total + Math.max(0, entry.weight),
    0,
  );
  for (let draw = 0; draw < level.randDropNum && totalWeight > 0; draw++) {
    let roll = deterministicRoll(seed, sequence++, totalWeight);
    for (const entry of level.randomAwards) {
      roll -= Math.max(0, entry.weight);
      if (roll < 0) {
        result.push([...entry.award, 7] as Award);
        break;
      }
    }
  }
  return result;
}
