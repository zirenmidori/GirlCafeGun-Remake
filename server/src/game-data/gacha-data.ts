import { randomInt } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type Gdpl = [genre: number, detail: number, particular: number, level: number];

export type Gdpln = [...Gdpl, count: number];

export interface GachaCard {
  id: number;
  gdpl: Gdpl;
  rarity: number;
  rate: number;
  isPreview: boolean;
  upFlag: number;
  sort: number;
}

export interface GachaPool {
  id: number;
  name: string;
  cashType: number;
  costOne: Gdpln | null;
  costTen: Gdpln | null;
  moneyCostOne: number;
  moneyCostTen: number;
  judgeType: number;
  hideTenButton: number;
  setUpNum: number;
  protectNum: number;
  protectUpNum: number;
  upBoxNum: number;
  upBox: Gdpln | null;
  hedgeSeedId: number;
  starSeedId: number;
  getItem: Gdpln | null;
  canUseFreeDiamond: boolean;
  exchangeRate: number;
  rotateVersion: number;
  normalCards: ReadonlyMap<number, readonly GachaCard[]>;
  hedgeCards: ReadonlyMap<number, readonly GachaCard[]>;
}

export interface GachaAward {
  tbGDPL: Gdpl;
  nId: number;
  nTimes: number;
  isUp: boolean;
  nUpTimes: number;
  nTotalTimes: number;
  bFirstGet: boolean;
  bHasCard: boolean;
}

export interface GachaCounters {
  pity: number;
  upPity: number;
  total: number;
}

export interface GachaRollResult {
  awards: GachaAward[];
  counters: GachaCounters;
}

export type RandomBelow = (ceiling: number) => number;

interface ThresholdWeight {
  until: number;
  weight: number;
}

interface HedgeSeed {
  starWeights: ReadonlyMap<number, readonly ThresholdWeight[]>;
  poolName: string;
}

interface ParsedPoolRow {
  id: number;
  name: string;
  cashType: number;
  costOne: Gdpln | null;
  costTen: Gdpln | null;
  moneyCostOne: number;
  moneyCostTen: number;
  judgeType: number;
  hideTenButton: number;
  timeStart: number;
  poolName: string;
  setUpNum: number;
  protectNum: number;
  protectUpNum: number;
  upBoxNum: number;
  upBox: Gdpln | null;
  hedgeSeedId: number;
  starSeedId: number;
  getItem: Gdpln | null;
  canUseFreeDiamond: boolean;
  exchangeRate: number;
  rotateVersion: number;
}

function integer(value: string | undefined): number {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

function rows(contents: string): Record<string, string>[] {
  const lines = contents.split(/\r?\n/);
  const headers = lines[2]?.split("\t") ?? [];
  return lines.slice(3).flatMap((line) => {
    if (!line.trim()) return [];
    const values = line.split("\t");
    return [
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    ];
  });
}

export function parseGdpln(value: string | undefined): Gdpln | null {
  const match = value?.match(/\[([0-9-]+)\]/);
  if (!match) return null;
  const parts = match[1]!.split("-").map(Number);
  if (
    parts.length < 4 ||
    !parts.slice(0, 5).every((part) => Number.isSafeInteger(part))
  ) {
    return null;
  }
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!, parts[4] ?? 1];
}

function parseGdpl(value: string | undefined): Gdpl | null {
  const match = value?.match(/\[([0-9-]+)\]/);
  if (!match) return null;
  const parts = match[1]!.split("-").map(Number);
  if (
    parts.length < 4 ||
    !parts.slice(0, 4).every((part) => Number.isSafeInteger(part))
  ) {
    return null;
  }
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

function thresholdWeights(value: string | undefined): ThresholdWeight[] {
  if (!value) return [];
  return [...value.matchAll(/\[(\d+),(\d+)\]/g)].map((match) => ({
    until: Number(match[1]),
    weight: Number(match[2]),
  }));
}

function atPull(
  values: readonly ThresholdWeight[] | undefined,
  pullNumber: number,
): number {
  if (!values) return 0;
  return (
    values.find(({ until }) => pullNumber <= until)?.weight ??
    values.at(-1)?.weight ??
    0
  );
}

function weightedPick<T>(
  values: readonly T[],
  weight: (value: T) => number,
  randomBelow: RandomBelow,
): T {
  const total = values.reduce((sum, value) => sum + Math.max(0, weight(value)), 0);
  if (total <= 0) throw new Error("Cannot choose from an empty weighted set");
  let roll = randomBelow(total);
  if (!Number.isSafeInteger(roll) || roll < 0 || roll >= total) {
    throw new Error(`Random source returned ${roll} outside [0, ${total})`);
  }
  for (const value of values) {
    roll -= Math.max(0, weight(value));
    if (roll < 0) return value;
  }
  return values.at(-1)!;
}

function cardStar(card: GachaCard): number {
  return card.rarity >= 4 ? 4 : card.rarity;
}

function groupCards(cards: readonly GachaCard[]): Map<number, GachaCard[]> {
  const grouped = new Map<number, GachaCard[]>();
  for (const card of cards) {
    const star = cardStar(card);
    const list = grouped.get(star) ?? [];
    list.push(card);
    grouped.set(star, list);
  }
  return grouped;
}

function parseCards(contents: string): GachaCard[] {
  return rows(contents).flatMap((row) => {
    const gdpl = parseGdpl(row.GDPLN);
    const rate = integer(row.Rate);
    if (!gdpl || rate <= 0) return [];
    return [
      {
        id: integer(row.ID),
        gdpl,
        rarity: integer(row.Rarity) || gdpl[3],
        rate,
        isPreview: integer(row.IsPreview) === 1,
        upFlag: integer(row.UpFlag),
        sort: integer(row.Sort),
      },
    ];
  });
}

function parseStartTime(value: string | undefined): number {
  const match = value?.match(/\{(\d+)/);
  return match ? Number(match[1]) : 0;
}

function normalizeCustomUp(
  cardsByStar: ReadonlyMap<number, readonly GachaCard[]>,
  selectedIds: readonly number[],
): ReadonlyMap<number, readonly GachaCard[]> {
  if (selectedIds.length === 0) return cardsByStar;
  const selected = new Set(selectedIds);
  const result = new Map<number, readonly GachaCard[]>(cardsByStar);
  const fourStar = [...(cardsByStar.get(4) ?? [])];
  if (fourStar.length === 0) return result;
  const chosen = fourStar.filter((card) => selected.has(card.id));
  const others = fourStar.filter((card) => !selected.has(card.id));
  if (chosen.length === 0) return result;

  // This is the exact client-side SetCustomUp rule: two selected cards split
  // 50% of the four-star layer, while all remaining cards split the other 50%.
  // Integer-equivalent form of 0.5/chosenCount versus 0.5/otherCount.
  // It avoids introducing floating-point drift into the weighted picker.
  const chosenWeight = Math.max(1, others.length);
  const otherWeight = chosen.length;
  result.set(
    4,
    fourStar.map((card) => ({
      ...card,
      rate: selected.has(card.id) ? chosenWeight : otherWeight,
      upFlag: selected.has(card.id) ? 1 : 0,
    })),
  );
  return result;
}

export class GachaCatalog {
  readonly #pools = new Map<number, GachaPool>();
  readonly #rarities = new Map<string, number>();
  readonly #starSeeds = new Map<
    number,
    ReadonlyMap<number, readonly ThresholdWeight[]>
  >();
  readonly #hedgeSeeds = new Map<number, HedgeSeed>();

  constructor(
    gachaContents: string,
    starSeedContents: string,
    hedgeSeedContents: string,
    poolFiles: ReadonlyMap<string, string>,
    poolType = 1,
  ) {
    for (const row of rows(starSeedContents)) {
      const byStar = new Map<number, readonly ThresholdWeight[]>();
      for (let star = 1; star <= 4; star++) {
        byStar.set(star, thresholdWeights(row[`${star}StarCardSeed`]));
      }
      this.#starSeeds.set(integer(row.ID), byStar);
    }

    for (const row of rows(hedgeSeedContents)) {
      this.#hedgeSeeds.set(integer(row.ID), {
        starWeights: new Map([
          [3, thresholdWeights(row["3StarCardSeed"])],
          [4, thresholdWeights(row["4StarCardSeed"])],
        ]),
        poolName: row.HedgePool ?? "",
      });
    }

    const latestRows = new Map<number, ParsedPoolRow>();
    for (const row of rows(gachaContents)) {
      if (integer(row.Type) !== poolType) continue;
      const parsed: ParsedPoolRow = {
        id: integer(row.ID),
        name: row.Name ?? "",
        cashType: integer(row.CashType),
        costOne: parseGdpln(row.CostOne),
        costTen: parseGdpln(row.CostTen),
        moneyCostOne: integer(row.CostOne),
        moneyCostTen: integer(row.CostTen),
        judgeType: integer(row.JudgeType),
        hideTenButton: integer(row.HideTenBtn),
        timeStart: parseStartTime(row.Time),
        poolName: row.Pool ?? "",
        setUpNum: integer(row.SetUpNum),
        protectNum: integer(row.ProtectNum),
        protectUpNum: integer(row.ProtectUpNum),
        upBoxNum: integer(row.UpBoxNum),
        upBox: parseGdpln(row.UpBox),
        hedgeSeedId: integer(row.HedgeCardStarSeed),
        starSeedId: integer(row.CardStarSeed),
        getItem: parseGdpln(row.GetItem),
        canUseFreeDiamond: integer(row.CanUseFreeDiamond) === 1,
        exchangeRate: integer(row.ExchangeRate),
        rotateVersion: integer(row.RotateVersion),
      };
      const old = latestRows.get(parsed.id);
      if (!old || parsed.timeStart >= old.timeStart) {
        latestRows.set(parsed.id, parsed);
      }
    }

    for (const row of latestRows.values()) {
      const normalContents = poolFiles.get(row.poolName.toLowerCase());
      if (!normalContents) {
        throw new Error(`Missing gacha pool file: ${row.poolName}`);
      }
      const hedge = this.#hedgeSeeds.get(row.hedgeSeedId);
      const hedgeContents = hedge
        ? poolFiles.get(hedge.poolName.toLowerCase())
        : undefined;
      const normalCards = groupCards(parseCards(normalContents));
      const hedgeCards = hedgeContents
        ? groupCards(parseCards(hedgeContents))
        : new Map<number, GachaCard[]>();
      for (const cards of [...normalCards.values(), ...hedgeCards.values()]) {
        for (const card of cards) {
          this.#rarities.set(card.gdpl.join(":"), card.rarity);
        }
      }
      this.#pools.set(row.id, {
        ...row,
        normalCards,
        hedgeCards,
      });
    }
  }

  static loadDefault(poolType = 1): GachaCatalog {
    const root = path.resolve(process.cwd(), "resources/gacha");
    const poolsRoot = path.join(root, "pools");
    const poolFiles = new Map(
      readdirSync(poolsRoot)
        .filter((file) => file.toLowerCase().endsWith(".txt"))
        .map((file) => [
          file.slice(0, -4).toLowerCase(),
          readFileSync(path.join(poolsRoot, file), "utf8"),
        ]),
    );
    return new GachaCatalog(
      readFileSync(path.join(root, "gacha.txt"), "utf8"),
      readFileSync(path.join(root, "cardstarseed.txt"), "utf8"),
      readFileSync(path.join(root, "hedgecardseed.txt"), "utf8"),
      poolFiles,
      poolType,
    );
  }

  get(id: number): GachaPool | null {
    return this.#pools.get(id) ?? null;
  }

  get size(): number {
    return this.#pools.size;
  }

  rarityOf(gdpl: Gdpl): number | null {
    return this.#rarities.get(gdpl.join(":")) ?? null;
  }

  get ids(): number[] {
    return [...this.#pools.keys()].sort((left, right) => left - right);
  }

  publishedStarWeights(poolId: number, pullNumber: number): number[] {
    const pool = this.get(poolId);
    if (!pool) return [];
    const seed = this.#starSeeds.get(pool.starSeedId);
    return [1, 2, 3, 4].map((star) => atPull(seed?.get(star), pullNumber));
  }

  publishedCardRates(
    poolId: number,
    pullNumber: number,
  ): Array<{ card: GachaCard; probability: number }> {
    const pool = this.get(poolId);
    if (!pool) return [];
    const starWeights = this.publishedStarWeights(poolId, pullNumber);
    const totalStarWeight = starWeights.reduce((sum, weight) => sum + weight, 0);
    if (totalStarWeight <= 0) return [];
    return [...pool.normalCards.entries()].flatMap(([star, cards]) => {
      const totalCardWeight = cards.reduce(
        (sum, card) => sum + Math.max(0, card.rate),
        0,
      );
      if (totalCardWeight <= 0) return [];
      return cards.map((card) => ({
        card,
        probability:
          (starWeights[star - 1]! / totalStarWeight) * (card.rate / totalCardWeight),
      }));
    });
  }

  roll(
    poolId: number,
    ten: boolean,
    counters: GachaCounters,
    ownedCards: ReadonlySet<string>,
    selectedUpIds: readonly number[] = [],
    randomBelow: RandomBelow = randomInt,
  ): GachaRollResult {
    const pool = this.get(poolId);
    if (!pool) throw new Error(`Unknown gacha pool: ${poolId}`);
    return this.rollPool(pool, ten, counters, ownedCards, selectedUpIds, randomBelow);
  }

  rollPool(
    pool: GachaPool,
    ten: boolean,
    counters: GachaCounters,
    ownedCards: ReadonlySet<string>,
    selectedUpIds: readonly number[] = [],
    randomBelow: RandomBelow = randomInt,
  ): GachaRollResult {
    const starSeed = this.#starSeeds.get(pool.starSeedId);
    if (!starSeed) throw new Error(`Missing CardStarSeed ${pool.starSeedId}`);
    const normalCards =
      pool.judgeType === 3 || (pool.judgeType === 1 && selectedUpIds.length > 0)
        ? normalizeCustomUp(pool.normalCards, selectedUpIds)
        : pool.normalCards;
    const hedgeSeed = this.#hedgeSeeds.get(pool.hedgeSeedId);
    const count = ten ? 10 : 1;
    const awards: GachaAward[] = [];
    const seenCards = new Set(ownedCards);
    let pity = Math.max(0, counters.pity);
    let upPity = counters.upPity;
    let total = Math.max(0, counters.total);

    for (let index = 0; index < count; index++) {
      const pullNumber = pity + 1;
      const totalPullNumber = total + 1;
      const upPullNumber = pool.protectUpNum > 0 ? (upPity < 0 ? -1 : upPity + 1) : 0;
      const forceFourStar = pool.protectNum > 0 && pullNumber >= pool.protectNum;
      const forceUp =
        pool.protectUpNum > 0 &&
        upPullNumber >= pool.protectUpNum &&
        [...(normalCards.get(4) ?? [])].some((card) => card.upFlag === 1);
      const forceCustomCard =
        pool.judgeType === 4 &&
        selectedUpIds.length > 0 &&
        [...(normalCards.get(4) ?? [])].some((card) => card.id === selectedUpIds[0]);
      const useHedge =
        ten &&
        index === count - 1 &&
        !forceFourStar &&
        !forceUp &&
        hedgeSeed !== undefined &&
        pool.hedgeCards.size > 0;

      let star: number;
      let cardSet: ReadonlyMap<number, readonly GachaCard[]>;
      if (forceFourStar || forceUp || forceCustomCard) {
        star = 4;
        cardSet = normalCards;
      } else if (useHedge) {
        const candidates = [3, 4].filter(
          (candidate) =>
            atPull(hedgeSeed.starWeights.get(candidate), pullNumber) > 0 &&
            (pool.hedgeCards.get(candidate)?.length ?? 0) > 0,
        );
        star = weightedPick(
          candidates,
          (candidate) => atPull(hedgeSeed.starWeights.get(candidate), pullNumber),
          randomBelow,
        );
        cardSet = pool.hedgeCards;
      } else {
        const candidates = [1, 2, 3, 4].filter(
          (candidate) =>
            atPull(starSeed.get(candidate), pullNumber) > 0 &&
            (normalCards.get(candidate)?.length ?? 0) > 0,
        );
        star = weightedPick(
          candidates,
          (candidate) => atPull(starSeed.get(candidate), pullNumber),
          randomBelow,
        );
        cardSet = normalCards;
      }

      let cards = cardSet.get(star) ?? [];
      if (forceUp) {
        cards = cards.filter((card) => card.upFlag === 1);
      } else if (forceCustomCard) {
        cards = cards.filter((card) => card.id === selectedUpIds[0]);
      }
      const card = weightedPick(cards, (candidate) => candidate.rate, randomBelow);
      const isUp = card.upFlag === 1;
      const key = card.gdpl.join(":");
      const firstGet = !seenCards.has(key);
      seenCards.add(key);

      total = totalPullNumber;
      pity = star === 4 ? 0 : pullNumber;
      if (pool.protectUpNum > 0 && upPity >= 0) {
        if (star === 4 && isUp) {
          upPity = -1;
        } else {
          upPity = upPullNumber;
        }
      }
      awards.push({
        tbGDPL: card.gdpl,
        nId: card.id,
        nTimes: pullNumber,
        isUp,
        nUpTimes: upPullNumber,
        nTotalTimes: total,
        bFirstGet: firstGet,
        bHasCard: !firstGet,
      });
    }

    return { awards, counters: { pity, upPity, total } };
  }
}
