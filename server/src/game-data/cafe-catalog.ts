import { readFileSync } from "node:fs";
import path from "node:path";

import type { BaseAward } from "./chapter-config.js";

/** Exact recovered NCafe/NPet text tables. Parsed once; no per-request disk I/O. */
export type CafeRawRow = Readonly<Record<string, string>>;
export type CafeCatalogContents = Readonly<Record<string, string>>;
export interface CafeLevelConfig {
  Level: number;
  MaxCafeItem: number;
  MaxRestItem: number;
  MaxDormItem: number;
  SlotEat: number;
  SlotCoffee: number;
  MaxCoffee: number;
  Customer: number;
  DailyLmtGold: number;
  DailyLmtCoffeeCoin: number;
  TotalHot: number;
  DailyLmtItemClick: number;
  MaxQSize: number;
  NeedLevel: number;
  NeedHot: number;
  NeedGold: number;
  CoffeeCoinMax: number;
  OpenRest: number;
  OpenDorm: number;
  OpenShop: number;
  OpenGirlMission: number;
  OpenRandomMission: number;
  OpenTrain: number;
  CafeUnlockNum: number;
  RestUnlockNum: number;
  DormUnlockNum: number;
  MaxDianli: number;
  MaxGuestTypes: number;
  Type1Num: number;
  Type2Num: number;
  OtherTypeNum: number;
  ReduceVigor: number;
  AddVigor: number;
  LevelAwards: readonly BaseAward[];
}
export interface CafeCoffeeConfig {
  Id: number;
  NameIndex: string;
  IconId: string;
  star: number;
  Sweet: number;
  Appearance: number;
  Concentration: number;
  Flavor: number;
  Time: number;
  Cost: number;
  Price: number;
  Max: number;
  AwardA: number;
  RateA: number;
  AwardB: number;
  RateB: number;
  AwardC: number;
  RateC: number;
  Cond1: readonly number[];
  Cond2: readonly number[];
  Cond3: number;
  UnlockCostItem: readonly number[];
  LearnCostPoint: number;
  LearnCostCash: number;
  PrevCoffee: number;
  Level: number;
}
export type CafeCoffeeProperty = "Sweet" | "Appearance" | "Concentration" | "Flavor";
export interface CafeCustomerConfig {
  Id: number;
  Type: number;
  Name: string;
  Prefer: CafeCoffeeProperty;
  Preferfactor: number;
  Rate1: number;
  Rate2: number;
  Rate3: number;
  NeedLv: number;
  WeightMin: number;
  WeightMax: number;
  Weight: number;
  WaitTime1: number;
  WaitTime2: number;
  NeedCoffee: number;
}
export interface CafeComfortConfig {
  Id: number;
  Low: number;
  High: number;
  AddEarn_Coin: number;
  AddEarn_Coffee: number;
  AddVigor: number;
}
export interface CafeStaffConfig {
  GirlId: number;
  AttriType: string;
  AttriNum: number;
  GuestId: readonly number[];
  AttriGuestType: string;
  AttriPlus: number;
}
export interface CafeFurnitureConfig {
  Id: number;
  Type: number;
  Parent: number;
  Level: number;
  AddScore: number;
  SellPrice: number;
  AddCustomerType: number;
  AddCustomerValue: number;
  CoinGainRate: number;
  GoodsId: number;
  OwnMax: number;
  SeatType: number;
  ClickCD: number;
  Rate: number;
  ItemInfo: readonly number[];
  DicPlace: readonly number[];
  DicArea: readonly number[];
  AwardID: readonly BaseAward[];
  raw: CafeRawRow;
}
export interface CafeThemePose {
  templateId: number;
  parentTemplateId: number;
  posX: number;
  posY: number;
  rotate: number;
}
export interface CafeThemeConfig {
  Id: number;
  ThemeType: string;
  Area: number;
  CanSell: number;
  AddComfort: number;
  CoinGainRate: number;
  poses: readonly CafeThemePose[];
  raw: CafeRawRow;
}
export interface CafeMusicConfig {
  Id: number;
  Type: number;
  G: number;
  D: number;
  P: number;
  L: number;
  Extension1: number;
  IsIgnoreLock: number;
  UnLockTime: string;
  IgnoreList: string;
}
export interface CafeShopConfig {
  Id: number;
  ItemId: number;
  Limit: number;
  Count: number;
  MoneyType: number;
  Money: number;
  IsNew: number;
  NeedLevel: number;
}
export interface CafeVisitMissionConfig {
  MissionId: number;
  Awards: readonly BaseAward[];
  Action: string;
}
export interface CafeVisitAwardConfig {
  Id: number;
  Point: number;
  awards: readonly BaseAward[];
}

const TABLES = [
  "ncafelevels",
  "coffeelist",
  "coffeereset",
  "ncafeguests",
  "comforteff",
  "vigorattribute",
  "ncafeitems",
  "ncafethemes",
  "ncafeshop",
  "visitmission",
  "visitaward",
  "playerexp",
  "riki",
  "npet/petfoodinfo",
  "npet/petinfo",
  "npet/foodboxs",
  "npet/bufffood",
  "npet/lovelevel",
  "npet/areaunlock",
  "npet/giveback",
  "npet/tourmission",
  "npet/tourarea",
  "npet/tourreward",
  "npet/petrikiaward",
  "npet/bufflist",
  "npet/petgacha",
  "npet/petspeed",
  "npet/petgifts",
  "npet/achievementother",
] as const;

function numeric(row: CafeRawRow, key: string): number {
  const value = (row[key] ?? "").trim();
  if (!value) return 0;
  const n = Number(value);
  if (!Number.isFinite(n))
    throw new Error(`Invalid café numeric field ${key}: ${value}`);
  return n;
}
function numbers(value = "", separator = "-"): readonly number[] {
  const text = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!text) return Object.freeze([]);
  const parsed = text.split(separator).map(Number);
  if (parsed.some((n) => !Number.isFinite(n)))
    throw new Error(`Invalid café numeric list: ${value}`);
  return Object.freeze(parsed);
}
function awards(value = ""): readonly BaseAward[] {
  if (!value.trim()) return Object.freeze([]);
  const result: BaseAward[] = [];
  for (const group of value.matchAll(/\[([^\]]+)\]/g))
    for (const part of group[1]!.split(",")) {
      const row = numbers(part);
      if (row.length !== 5 || row.some((n) => !Number.isSafeInteger(n) || n < 0))
        throw new Error(`Invalid café award ${part}`);
      result.push([row[0]!, row[1]!, row[2]!, row[3]!, row[4]!]);
    }
  if (result.length === 0) throw new Error(`Invalid café awards: ${value}`);
  return Object.freeze(result);
}
function tableRows(contents: string): readonly CafeRawRow[] {
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headers = lines[2]?.split("\t");
  if (
    !headers?.some(
      (h) =>
        h === "Id" ||
        h === "ID" ||
        h === "Level" ||
        h === "GirlId" ||
        h === "MissionId" ||
        h === "Index" ||
        h === "Count" ||
        h === "MissionID" ||
        h === "AwardID" ||
        h === "GachaId" ||
        h === "Type" ||
        h === "Mission" ||
        h === "missionId",
    )
  )
    throw new Error("Missing café table header");
  return Object.freeze(
    lines
      .slice(3)
      .filter(
        (line) =>
          /^\d+\t/.test(line) || (headers[0] === "Mission" && /^\t\d+/.test(line)),
      )
      .map((line) => {
        const values = line.split("\t");
        return Object.freeze(
          Object.fromEntries(
            headers
              .map((name, i) => [name, values[i] ?? ""])
              .filter(([name]) => name !== ""),
          ),
        );
      }),
  );
}
function unique<T>(map: Map<number, T>, id: number, row: T): void {
  if (!Number.isSafeInteger(id) || map.has(id))
    throw new Error(`Invalid or duplicate café ID ${id}`);
  map.set(id, Object.freeze(row));
}
function numericFields<K extends string>(
  row: CafeRawRow,
  names: readonly K[],
): Record<K, number> {
  return Object.fromEntries(names.map((key) => [key, numeric(row, key)])) as Record<
    K,
    number
  >;
}

export class CafeCatalog {
  static #shared: CafeCatalog | undefined;
  readonly #raw = new Map<string, readonly CafeRawRow[]>();
  readonly #levels = new Map<number, CafeLevelConfig>();
  readonly #coffees = new Map<number, CafeCoffeeConfig>();
  readonly #customers = new Map<number, CafeCustomerConfig>();
  readonly #comfort: readonly CafeComfortConfig[];
  readonly #staff = new Map<number, CafeStaffConfig>();
  readonly #furniture = new Map<number, CafeFurnitureConfig>();
  readonly #themes = new Map<number, CafeThemeConfig>();
  readonly #shop = new Map<number, CafeShopConfig>();
  readonly #visitMissions = new Map<number, CafeVisitMissionConfig>();
  readonly #visitAwards = new Map<number, CafeVisitAwardConfig>();
  readonly #reset = new Map<number, number>();
  readonly #coffeePoints = new Map<number, number>();
  readonly #music = new Map<number, CafeMusicConfig>();
  readonly maxLevel: number;

  constructor(contents: CafeCatalogContents) {
    for (const name of TABLES) {
      const body = contents[name];
      if (body !== undefined) this.#raw.set(name, tableRows(body));
    }
    for (const name of TABLES.slice(0, 12))
      if (!this.#raw.has(name)) throw new Error(`Missing café table ${name}`);
    for (const row of this.table("ncafelevels")) {
      const config = {
        ...numericFields(row, [
          "Level",
          "MaxCafeItem",
          "MaxRestItem",
          "MaxDormItem",
          "SlotEat",
          "SlotCoffee",
          "MaxCoffee",
          "Customer",
          "DailyLmtGold",
          "DailyLmtCoffeeCoin",
          "TotalHot",
          "DailyLmtItemClick",
          "MaxQSize",
          "NeedLevel",
          "NeedHot",
          "NeedGold",
          "CoffeeCoinMax",
          "OpenRest",
          "OpenDorm",
          "OpenShop",
          "OpenGirlMission",
          "OpenRandomMission",
          "OpenTrain",
          "CafeUnlockNum",
          "RestUnlockNum",
          "DormUnlockNum",
          "MaxDianli",
          "MaxGuestTypes",
          "Type1Num",
          "Type2Num",
          "OtherTypeNum",
          "ReduceVigor",
          "AddVigor",
        ] as const),
        LevelAwards: awards(row.LevelAwards),
      };
      unique(this.#levels, config.Level, config);
    }
    this.maxLevel = Math.max(...[...this.#levels.keys()].filter((id) => id < 10_000));
    for (const row of this.table("coffeelist")) {
      const config: CafeCoffeeConfig = {
        ...numericFields(row, [
          "Id",
          "star",
          "Sweet",
          "Appearance",
          "Concentration",
          "Flavor",
          "Time",
          "Cost",
          "Price",
          "Max",
          "AwardA",
          "RateA",
          "AwardB",
          "RateB",
          "AwardC",
          "RateC",
          "Cond3",
          "LearnCostPoint",
          "LearnCostCash",
          "PrevCoffee",
          "Level",
        ] as const),
        NameIndex: row.NameIndex ?? "",
        IconId: row.IconId ?? "",
        Cond1: numbers(row.Cond1),
        Cond2: numbers(row.Cond2),
        UnlockCostItem: numbers(row.UnlockCostItem),
      };
      if (config.Time <= 0 || config.Cost < 0 || config.Price < 0 || config.Max <= 0)
        throw new Error(`Invalid coffee ${config.Id}`);
      unique(this.#coffees, config.Id, config);
    }
    for (const row of this.table("ncafeguests")) {
      const prefer = row.Prefer;
      if (!["Sweet", "Appearance", "Concentration", "Flavor"].includes(prefer ?? ""))
        throw new Error(`Invalid café preference ${prefer}`);
      const config: CafeCustomerConfig = {
        ...numericFields(row, [
          "Id",
          "Type",
          "Preferfactor",
          "Rate1",
          "Rate2",
          "Rate3",
          "NeedLv",
          "WeightMin",
          "WeightMax",
          "Weight",
          "WaitTime1",
          "WaitTime2",
          "NeedCoffee",
        ] as const),
        Name: row.Name ?? "",
        Prefer: prefer as CafeCoffeeProperty,
      };
      unique(this.#customers, config.Id, config);
    }
    this.#comfort = Object.freeze(
      this.table("comforteff")
        .map((row) =>
          Object.freeze(
            numericFields(row, [
              "Id",
              "Low",
              "High",
              "AddEarn_Coin",
              "AddEarn_Coffee",
              "AddVigor",
            ] as const),
          ),
        )
        .sort((a, b) => a.Low - b.Low),
    );
    for (const row of this.table("vigorattribute")) {
      const config: CafeStaffConfig = {
        ...numericFields(row, ["GirlId", "AttriNum", "AttriPlus"] as const),
        AttriType: row.AttriType ?? "",
        GuestId: numbers(row.GuestId),
        AttriGuestType: row.AttriGuestType ?? "",
      };
      unique(this.#staff, config.GirlId, config);
    }
    for (const row of this.table("coffeereset"))
      unique(this.#reset, numeric(row, "Count"), numeric(row, "Diamond"));
    for (const row of this.table("ncafeitems")) {
      const config: CafeFurnitureConfig = {
        ...numericFields(row, [
          "Id",
          "Type",
          "Parent",
          "Level",
          "AddScore",
          "SellPrice",
          "AddCustomerType",
          "AddCustomerValue",
          "CoinGainRate",
          "GoodsId",
          "OwnMax",
          "SeatType",
          "ClickCD",
          "Rate",
        ] as const),
        ItemInfo: numbers(row.ItemInfo),
        DicPlace: numbers(row.DicPlace, ","),
        DicArea: numbers(row.DicArea, ","),
        AwardID: awards(row.AwardID),
        raw: row,
      };
      unique(this.#furniture, config.Id, config);
    }
    for (const row of this.table("ncafethemes")) {
      const poses: CafeThemePose[] = [];
      for (let i = 0; row[`Item${i}`]; i++) {
        const values = numbers(row[`Item${i}`], ",");
        if (values.length !== 5)
          throw new Error(`Invalid café theme pose ${row.Id}:${i}`);
        poses.push(
          Object.freeze({
            templateId: values[0]!,
            parentTemplateId: values[1]!,
            posX: values[2]!,
            posY: values[3]!,
            rotate: values[4]!,
          }),
        );
      }
      const config: CafeThemeConfig = {
        ...numericFields(row, [
          "Id",
          "Area",
          "CanSell",
          "AddComfort",
          "CoinGainRate",
        ] as const),
        ThemeType: row.ThemeType ?? "",
        poses: Object.freeze(poses),
        raw: row,
      };
      unique(this.#themes, config.Id, config);
    }
    for (const row of this.table("ncafeshop")) {
      const config = numericFields(row, [
        "Id",
        "ItemId",
        "Limit",
        "Count",
        "MoneyType",
        "Money",
        "IsNew",
        "NeedLevel",
      ] as const);
      unique(this.#shop, config.Id, config);
    }
    for (const row of this.table("visitmission")) {
      const config = {
        MissionId: numeric(row, "MissionId"),
        Awards: awards(row.Awards),
        Action: row.Action ?? "",
      };
      unique(this.#visitMissions, config.MissionId, config);
    }
    for (const row of this.table("visitaward")) {
      const config = {
        Id: numeric(row, "Id"),
        Point: numeric(row, "Point"),
        awards: Object.freeze(
          [1, 2, 3, 4, 5].flatMap((i) => [...awards(row[`Item${i}`])]),
        ),
      };
      unique(this.#visitAwards, config.Id, config);
    }
    for (const row of this.table("riki")) {
      if (numeric(row, "Type") !== 8) continue;
      const entry: CafeMusicConfig = {
        ...numericFields(row, [
          "Id",
          "Type",
          "G",
          "D",
          "P",
          "L",
          "Extension1",
          "IsIgnoreLock",
        ] as const),
        UnLockTime: row.UnLockTime ?? "",
        IgnoreList: row.IgnoreList ?? "",
      };
      unique(this.#music, entry.Id, entry);
    }
    for (const row of this.table("playerexp"))
      unique(this.#coffeePoints, numeric(row, "Level"), numeric(row, "Coffee"));
  }
  static loadDefault(): CafeCatalog {
    if (!this.#shared)
      this.#shared = new CafeCatalog(
        Object.fromEntries(
          TABLES.map((name) => [
            name,
            readFileSync(
              path.resolve(process.cwd(), "resources/cafe", `${name}.txt`),
              "utf8",
            ),
          ]),
        ),
      );
    return this.#shared;
  }
  table(name: string): readonly CafeRawRow[] {
    return this.#raw.get(name) ?? [];
  }
  level(id: number): CafeLevelConfig | null {
    return this.#levels.get(id) ?? null;
  }
  levels(): readonly CafeLevelConfig[] {
    return [...this.#levels.values()];
  }
  coffee(id: number): CafeCoffeeConfig | null {
    return this.#coffees.get(id) ?? null;
  }
  coffees(): readonly CafeCoffeeConfig[] {
    return [...this.#coffees.values()];
  }
  customer(id: number): CafeCustomerConfig | null {
    return this.#customers.get(id) ?? null;
  }
  customers(): readonly CafeCustomerConfig[] {
    return [...this.#customers.values()];
  }
  comfort(score: number): CafeComfortConfig {
    const safe = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
    return (
      this.#comfort.find((row) => row.Low <= safe && row.High >= safe) ??
      this.#comfort.at(-1)!
    );
  }
  staff(id: number): CafeStaffConfig | null {
    return this.#staff.get(id) ?? null;
  }
  staffMembers(): readonly CafeStaffConfig[] {
    return [...this.#staff.values()];
  }
  resetCost(count: number): number {
    return (
      this.#reset.get(count) ?? this.#reset.get(Math.max(...this.#reset.keys())) ?? 0
    );
  }
  furniture(id: number): CafeFurnitureConfig | null {
    return this.#furniture.get(id) ?? null;
  }
  furnitureItems(): readonly CafeFurnitureConfig[] {
    return [...this.#furniture.values()];
  }
  theme(id: number): CafeThemeConfig | null {
    return this.#themes.get(id) ?? null;
  }
  themes(): readonly CafeThemeConfig[] {
    return [...this.#themes.values()];
  }
  shop(id: number): CafeShopConfig | null {
    return this.#shop.get(id) ?? null;
  }
  shopItems(): readonly CafeShopConfig[] {
    return [...this.#shop.values()];
  }
  visitMission(id: number): CafeVisitMissionConfig | null {
    return this.#visitMissions.get(id) ?? null;
  }
  visitAward(id: number): CafeVisitAwardConfig | null {
    return this.#visitAwards.get(id) ?? null;
  }
  visitAwards(): readonly CafeVisitAwardConfig[] {
    return [...this.#visitAwards.values()];
  }
  music(id: number): CafeMusicConfig | null {
    return this.#music.get(id) ?? null;
  }
  musicEntries(): readonly CafeMusicConfig[] {
    return [...this.#music.values()];
  }
  playerCoffeePoints(level: number): number {
    return (
      this.#coffeePoints.get(level) ??
      this.#coffeePoints.get(Math.max(...this.#coffeePoints.keys())) ??
      0
    );
  }
}
