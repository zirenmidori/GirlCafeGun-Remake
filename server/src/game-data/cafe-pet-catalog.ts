import type { BaseAward } from "./chapter-config.js";
import { CafeCatalog, type CafeRawRow } from "./cafe-catalog.js";

/** Immutable indexes over the byte-exact final-CN NPet tables in CafeCatalog. */
export type PetPair = readonly [number, number];
export type PetCondition = readonly [number, number, number];
export interface PetFoodConfig {
  readonly Id: number;
  readonly Type: number;
  readonly GDPL: readonly number[];
  readonly PriceGet: PetPair;
  readonly PricePer: PetPair;
  readonly GetPetRare: readonly PetPair[];
  readonly raw: CafeRawRow;
}
export interface PetTemplateConfig {
  readonly Type: number;
  readonly Id: number;
  readonly Rare: number;
  readonly Paw: number;
  readonly Gender: readonly number[];
  readonly Nature: readonly PetPair[];
  readonly IQ: readonly number[];
  readonly Hobby: readonly number[];
  readonly TourNumEx: number;
  readonly raw: CafeRawRow;
}
export interface PetFoodBoxPrice {
  readonly Index: number;
  readonly Cost: PetPair;
}
export interface PetBuffFoodConfig {
  readonly Id: number;
  readonly PriceGet: PetPair;
  readonly AddPoint: number;
  readonly Energy: number;
  readonly Love: number;
  readonly Rarity: number;
}
export interface PetLoveLevelConfig {
  readonly Level: number;
  readonly Exp: number;
  readonly ExNum: number;
}
export interface PetGiftConfig {
  readonly GDPL: readonly number[];
  readonly Detail: number;
  readonly ExtParam1: number;
}
export interface PetMissionConfig {
  readonly missionId: number;
  readonly preMissionId: number;
  readonly missionMax: readonly number[];
  readonly achieveType: number;
  readonly assistparam: readonly number[];
  readonly awardsList: readonly BaseAward[];
  readonly raw: CafeRawRow;
}
export interface PetTourAreaConfig {
  readonly Index: number;
  readonly Rare: number;
  readonly Hour: number;
  readonly EnergyCost: number;
  readonly ExNum: number;
  readonly Unlock1: readonly number[];
  readonly Unlock2: number;
  readonly Unlock3: readonly number[];
  readonly raw: CafeRawRow;
}
export interface PetTourRewardConfig {
  readonly AwardID: number;
  readonly Rare: number;
  readonly AwardNormal: number;
  readonly Award: BaseAward;
  readonly Pro: number;
}
export interface PetTourConditionConfig {
  readonly MissionID: number;
  readonly Rare: number;
  readonly Index: number;
  readonly Condition: readonly PetCondition[];
  readonly Pro: number;
}
export interface PetRikiAwardConfig {
  readonly Id: number;
  readonly Condition: readonly PetCondition[];
  readonly ItemAward: readonly BaseAward[];
  readonly BuffAward: readonly number[];
  readonly TransAward: number;
}
export interface PetBuffConfig {
  readonly Id: number;
  readonly System: number;
  readonly BuffType: number;
  /** The shipped Lua loader calls BuffType "Type". */
  readonly Type: number;
  readonly Weight: number;
  readonly Param1: number;
  readonly LevelType: readonly number[];
  readonly MemberAtt: readonly number[];
  readonly MemberPro: readonly number[];
  readonly IsCast: number;
  readonly HasRedTip: number;
  readonly raw: CafeRawRow;
}

function number(row: CafeRawRow, key: string): number {
  const text = (row[key] ?? "").trim();
  const n = text ? Number(text) : 0;
  if (!Number.isFinite(n)) throw new Error(`Invalid pet number ${key}: ${text}`);
  return n;
}
function list(value = "", separator: string | RegExp = ","): readonly number[] {
  const text = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!text) return Object.freeze([]);
  const values = text.split(separator).map((part) => Number(part.trim()));
  if (values.some((n) => !Number.isFinite(n)))
    throw new Error(`Invalid pet list: ${value}`);
  return Object.freeze(values);
}
function tuple(value: string | undefined, count: number, separator = ",") {
  const result = list(value, separator);
  if (result.length !== count)
    throw new Error(`Invalid ${count}-element pet tuple: ${value}`);
  return result;
}
function pair(value: string | undefined): PetPair {
  return tuple(value, 2) as PetPair;
}
function groups<T extends readonly number[]>(
  value: string | undefined,
  count: number,
): readonly T[] {
  const text = (value ?? "").trim();
  if (!text || text === "{}") return Object.freeze([]);
  const result = [...text.matchAll(/\{([^{}]+)\}/g)].map(
    (match) => tuple(match[1], count) as T,
  );
  if (!result.length) throw new Error(`Invalid pet groups: ${value}`);
  return Object.freeze(result);
}
function award(value: string | undefined): BaseAward {
  const result = tuple(value, 5, "-");
  if (result.some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new Error(`Invalid pet reward: ${value}`);
  return result as BaseAward;
}
function awards(value: string | undefined): readonly BaseAward[] {
  if (!value?.trim()) return Object.freeze([]);
  const result = [...value.matchAll(/\[([^\]]+)\]/g)].flatMap((m) =>
    m[1]!.split(",").map((tuple) => award(tuple)),
  );
  if (!result.length) throw new Error(`Invalid pet rewards: ${value}`);
  return Object.freeze(result);
}
function insert<T>(map: Map<number, T>, id: number, config: T): void {
  if (!Number.isSafeInteger(id) || id <= 0 || map.has(id))
    throw new Error(`Invalid or duplicate pet configuration ID ${id}`);
  map.set(id, Object.freeze(config));
}
function indexedLists<T>(
  rows: Iterable<T>,
  key: (row: T) => string | number,
): ReadonlyMap<string | number, readonly T[]> {
  const result = new Map<string | number, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = result.get(k) ?? [];
    list.push(row);
    result.set(k, list);
  }
  for (const rows of result.values()) Object.freeze(rows);
  return result;
}
const EMPTY: readonly never[] = Object.freeze([]);

export class CafePetCatalog {
  static readonly #cached = new WeakMap<CafeCatalog, CafePetCatalog>();
  readonly #foods = new Map<number, PetFoodConfig>();
  readonly #foodItems = new Map<string, PetFoodConfig>();
  readonly #templates = new Map<number, PetTemplateConfig>();
  readonly #foodBoxes = new Map<number, PetFoodBoxPrice>();
  readonly #buffFoods = new Map<number, PetBuffFoodConfig>();
  readonly #loveLevels = new Map<number, PetLoveLevelConfig>();
  readonly #gifts = new Map<string, PetGiftConfig>();
  readonly #missions = new Map<number, PetMissionConfig>();
  readonly #areaCosts = new Map<number, number>();
  readonly #giveBacks = new Map<number, BaseAward>();
  readonly #tourAreas = new Map<number, PetTourAreaConfig>();
  readonly #tours = new Map<number, PetTourConditionConfig>();
  readonly #tourRewards = new Map<number, PetTourRewardConfig>();
  readonly #rikiAwards = new Map<number, PetRikiAwardConfig>();
  readonly #buffs = new Map<number, PetBuffConfig>();
  readonly #templatesByRare;
  readonly #toursByRare;
  readonly #rewardsByKind;
  readonly #allTemplates;
  readonly #allAreas;
  readonly #allTours;
  readonly #allRewards;
  readonly #allRikiAwards;
  readonly #allBuffs;
  readonly #allMissions;
  readonly #missionsByType;
  readonly #giveBackLevels: readonly number[];
  readonly maxPetAreaCount: number;
  readonly foodBoxCount: number;

  constructor(cafe: CafeCatalog = CafeCatalog.loadDefault()) {
    const rows = (name: string) => {
      const result = cafe.table(`npet/${name}`);
      if (!result.length) throw new Error(`Missing pet table npet/${name}`);
      return result;
    };
    for (const row of rows("petfoodinfo")) {
      const config: PetFoodConfig = {
        Id: number(row, "Id"),
        Type: number(row, "Type"),
        GDPL: tuple(row.GDPL, 4, "-"),
        PriceGet: pair(row.PriceGet),
        PricePer: pair(row.PricePer),
        GetPetRare: groups<PetPair>(row.GetPetRare, 2),
        raw: row,
      };
      insert(this.#foods, config.Id, config);
      const gdpl = config.GDPL.join("-");
      if (this.#foodItems.has(gdpl)) throw new Error(`Duplicate pet food ${gdpl}`);
      this.#foodItems.set(gdpl, config);
    }
    for (const row of rows("petinfo")) {
      const config: PetTemplateConfig = {
        Type: number(row, "Type"),
        Id: number(row, "Id"),
        Rare: number(row, "Rare"),
        Paw: number(row, "Paw"),
        Gender: list(row.Gender),
        Nature: groups<PetPair>(row.Nature, 2),
        IQ: list(row.IQ),
        Hobby: list(row.Hobby),
        TourNumEx: number(row, "TourNumEx"),
        raw: row,
      };
      if (config.Rare < 1 || config.Rare > 3)
        throw new Error(`Invalid pet rarity ${config.Id}`);
      insert(this.#templates, config.Id, config);
    }
    for (const row of rows("foodboxs")) {
      const config = { Index: number(row, "Index"), Cost: pair(row.Cost) };
      insert(this.#foodBoxes, config.Index, config);
    }
    for (const row of rows("bufffood")) {
      const config: PetBuffFoodConfig = {
        Id: number(row, "Id"),
        PriceGet: pair(row.PriceGet),
        AddPoint: number(row, "AddPoint"),
        Energy: number(row, "Energy"),
        Love: number(row, "Love"),
        Rarity: number(row, "Rarity"),
      };
      insert(this.#buffFoods, config.Id, config);
    }
    for (const row of rows("lovelevel")) {
      const config = {
        Level: number(row, "Level"),
        Exp: number(row, "Exp"),
        ExNum: number(row, "ExNum"),
      };
      insert(this.#loveLevels, config.Level, config);
    }
    for (const row of rows("petgifts")) {
      const config: PetGiftConfig = Object.freeze({
        GDPL: Object.freeze(
          ["Genre", "Detail", "Particular", "Level"].map((key) => number(row, key)),
        ),
        Detail: number(row, "Detail"),
        ExtParam1: number(row, "ExtParam1"),
      });
      if (
        config.GDPL[0] !== 22 ||
        ![1, 2].includes(config.Detail) ||
        config.ExtParam1 <= 0
      )
        throw new Error("Invalid pet gift configuration");
      const key = config.GDPL.join("-");
      if (this.#gifts.has(key)) throw new Error(`Duplicate pet gift ${key}`);
      this.#gifts.set(key, config);
    }
    for (const row of rows("achievementother")) {
      const config: PetMissionConfig = {
        missionId: number(row, "missionId"),
        preMissionId: number(row, "preMissionId"),
        missionMax: list(row.missionMax),
        achieveType: number(row, "achieveType"),
        assistparam: list(row.assistparam),
        awardsList: awards(row.awardsList),
        raw: row,
      };
      if (!config.missionMax.length || !config.assistparam.length)
        throw new Error(`Incomplete pet mission ${config.missionId}`);
      insert(this.#missions, config.missionId, config);
    }
    for (const row of rows("areaunlock"))
      insert(this.#areaCosts, number(row, "Index"), number(row, "Cost"));
    for (const row of rows("giveback"))
      insert(this.#giveBacks, number(row, "Index"), award(row.GDPLN));
    for (const row of rows("tourarea")) {
      const config: PetTourAreaConfig = {
        Index: number(row, "Index"),
        Rare: number(row, "Rare"),
        Hour: number(row, "Hour"),
        EnergyCost: number(row, "EnergyCost"),
        ExNum: number(row, "ExNum"),
        Unlock1: list(row.Unlock1),
        Unlock2: number(row, "Unlock2"),
        Unlock3: list(row.Unlock3),
        raw: row,
      };
      insert(this.#tourAreas, config.Index, config);
    }
    for (const row of rows("tourreward")) {
      const config: PetTourRewardConfig = {
        AwardID: number(row, "AwardID"),
        Rare: number(row, "Rare"),
        AwardNormal: number(row, "AwardNormal"),
        Award: award(row.Award),
        Pro: number(row, "Pro"),
      };
      if (config.AwardID > 0x7fff)
        throw new Error(`Pet tour reward exceeds 15-bit ID ${config.AwardID}`);
      insert(this.#tourRewards, config.AwardID, config);
    }
    for (const row of rows("tourmission")) {
      const config: PetTourConditionConfig = {
        MissionID: number(row, "MissionID"),
        Rare: number(row, "Rare"),
        Index: number(row, "Index"),
        Condition: groups<PetCondition>(row.Condition, 3),
        Pro: number(row, "Pro"),
      };
      insert(this.#tours, config.MissionID, config);
    }
    for (const row of rows("petrikiaward")) {
      const config: PetRikiAwardConfig = {
        Id: number(row, "Id"),
        Condition: groups<PetCondition>(row.Condition, 3),
        ItemAward: awards(row.ItemAward),
        BuffAward: list(row.BuffAward),
        TransAward: number(row, "TransAward"),
      };
      insert(this.#rikiAwards, config.Id, config);
    }
    for (const row of rows("bufflist")) {
      const config: PetBuffConfig = {
        Id: number(row, "Id"),
        System: number(row, "System"),
        BuffType: number(row, "BuffType"),
        Type: number(row, "BuffType"),
        Weight: number(row, "Weight"),
        Param1: number(row, "Param1"),
        LevelType: list(row.LevelType),
        MemberAtt: list(row.MemberAtt),
        MemberPro: list(row.MemberPro),
        IsCast: number(row, "IsCast"),
        HasRedTip: number(row, "HasRedTip"),
        raw: row,
      };
      insert(this.#buffs, config.Id, config);
    }
    this.#allTemplates = Object.freeze([...this.#templates.values()]);
    this.#allAreas = Object.freeze([...this.#tourAreas.values()]);
    this.#allTours = Object.freeze([...this.#tours.values()]);
    this.#allRewards = Object.freeze([...this.#tourRewards.values()]);
    this.#allRikiAwards = Object.freeze([...this.#rikiAwards.values()]);
    this.#allBuffs = Object.freeze([...this.#buffs.values()]);
    this.#allMissions = Object.freeze([...this.#missions.values()]);
    this.#missionsByType = indexedLists(this.#allMissions, (row) => row.achieveType);
    this.#templatesByRare = indexedLists(this.#allTemplates, (row) => row.Rare);
    this.#toursByRare = indexedLists(this.#allTours, (row) => row.Rare);
    this.#rewardsByKind = indexedLists(
      this.#allRewards,
      (row) => `${row.Rare}:${row.AwardNormal}`,
    );
    this.#giveBackLevels = Object.freeze(
      [...this.#giveBacks.keys()].sort((a, b) => a - b),
    );
    this.maxPetAreaCount = this.#areaCosts.size;
    this.foodBoxCount = this.#foodBoxes.size;
  }
  static loadDefault(): CafePetCatalog {
    return this.fromCafeCatalog(CafeCatalog.loadDefault());
  }
  static fromCafeCatalog(cafe: CafeCatalog): CafePetCatalog {
    let result = this.#cached.get(cafe);
    if (!result) {
      result = new CafePetCatalog(cafe);
      this.#cached.set(cafe, result);
    }
    return result;
  }
  petFood(id: number): PetFoodConfig | null {
    return this.#foods.get(id) ?? null;
  }
  petFoodByItem(gdpl: readonly number[]): PetFoodConfig | null {
    return this.#foodItems.get(gdpl.slice(0, 4).join("-")) ?? null;
  }
  petTemplate(id: number): PetTemplateConfig | null {
    return this.#templates.get(id) ?? null;
  }
  petTemplates(): readonly PetTemplateConfig[] {
    return this.#allTemplates;
  }
  petTemplatesOfRare(rare: number): readonly PetTemplateConfig[] {
    return this.#templatesByRare.get(rare) ?? EMPTY;
  }
  foodBoxPrice(ordinal: number): PetFoodBoxPrice | null {
    return this.#foodBoxes.get(ordinal) ?? null;
  }
  buffFood(id: number): PetBuffFoodConfig | null {
    return this.#buffFoods.get(id) ?? null;
  }
  petLoveLevel(level: number): PetLoveLevelConfig | null {
    return this.#loveLevels.get(level) ?? null;
  }
  petLoveExp(level: number): number {
    return this.#loveLevels.get(level)?.Exp ?? 1;
  }
  petLoveEx(level: number): number {
    return this.#loveLevels.get(level)?.ExNum ?? 1;
  }
  petGift(gdpl: readonly number[]): PetGiftConfig | null {
    return this.#gifts.get(gdpl.slice(0, 4).join("-")) ?? null;
  }
  petMission(id: number): PetMissionConfig | null {
    return this.#missions.get(id) ?? null;
  }
  petMissions(): readonly PetMissionConfig[] {
    return this.#allMissions;
  }
  petMissionsOfType(type: number): readonly PetMissionConfig[] {
    return this.#missionsByType.get(type) ?? EMPTY;
  }
  petAreaCost(slot: number): number | null {
    return this.#areaCosts.get(slot) ?? null;
  }
  petGiveBack(level: number): BaseAward | null {
    if (!Number.isFinite(level)) return null;
    let low = 0;
    let high = this.#giveBackLevels.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.#giveBackLevels[mid]! <= level) low = mid + 1;
      else high = mid;
    }
    return this.#giveBacks.get(this.#giveBackLevels[low - 1]!) ?? null;
  }
  tourArea(index: number): PetTourAreaConfig | null {
    return this.#tourAreas.get(index) ?? null;
  }
  tourAreas(): readonly PetTourAreaConfig[] {
    return this.#allAreas;
  }
  tourMission(id: number): PetTourConditionConfig | null {
    return this.#tours.get(id) ?? null;
  }
  tourMissions(): readonly PetTourConditionConfig[] {
    return this.#allTours;
  }
  tourMissionsOfRare(rare: number): readonly PetTourConditionConfig[] {
    return this.#toursByRare.get(rare) ?? EMPTY;
  }
  tourReward(id: number): PetTourRewardConfig | null {
    return this.#tourRewards.get(id) ?? null;
  }
  tourRewards(): readonly PetTourRewardConfig[] {
    return this.#allRewards;
  }
  tourRewardsFor(rare: number, kind: number): readonly PetTourRewardConfig[] {
    return this.#rewardsByKind.get(`${rare}:${kind}`) ?? EMPTY;
  }
  petTourCondition(id: number): PetTourConditionConfig | null {
    return this.#tours.get(id) ?? null;
  }
  petRikiAward(id: number): PetRikiAwardConfig | null {
    return this.#rikiAwards.get(id) ?? null;
  }
  petRikiAwards(): readonly PetRikiAwardConfig[] {
    return this.#allRikiAwards;
  }
  petBuff(id: number): PetBuffConfig | null {
    return this.#buffs.get(id) ?? null;
  }
  petBuffs(): readonly PetBuffConfig[] {
    return this.#allBuffs;
  }
  buffs(): readonly PetBuffConfig[] {
    return this.#allBuffs;
  }
}
