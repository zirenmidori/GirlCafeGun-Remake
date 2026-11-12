import { readFileSync } from "node:fs";
import path from "node:path";

import type { BaseAward } from "./chapter-config.js";

// Exact recovered client Pldge/*.txt + pldgecommon.lua / GirlPromise.lua.
// The spelling and case of wire fields are part of the shipped Lua contract.
export type PromiseTaskType =
  | "ReduceItem"
  | "ReduceMoney"
  | "GreeterTime"
  | "CafeTime"
  | "RestTime"
  | "Training"
  | "ChapterFight"
  | "CardCount"
  | "GiftCount"
  | "FriendLevel"
  | "RecuseCount"
  | "TouchHead"
  | "EventFight"
  | "TowerFight"
  | "PvpFight"
  | "ArbitraryFight";
export type PromiseTaskParameter = number | readonly number[];
export type PromiseStageReward = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface PromiseTaskConfig {
  readonly id: number;
  readonly strtype: PromiseTaskType;
  readonly info: string;
  readonly infoKey: string;
  readonly target: string;
  readonly recount: number;
  readonly girlid: number;
  readonly count: number;
  readonly params: Readonly<Record<string, PromiseTaskParameter>>;
  readonly gdpl?: readonly number[];
  readonly lvpara?: readonly number[];
  readonly infight?: number;
  readonly lvlmt?: number;
  readonly traintype?: number;
  readonly moneytype?: number;
}
export interface PromiseStepConfig {
  readonly girlid: number;
  readonly step: number;
  readonly changecard: number;
  readonly cardgdpl: readonly number[];
  readonly cardbreaklv: number;
  readonly cardlv: number;
  readonly cardskilllv: readonly number[];
  readonly heart: number;
  readonly rewards: readonly PromiseStageReward[];
  readonly l2did: number;
  readonly l2dbgid: number;
  readonly tasklist: readonly number[];
  // Step0 is a release-date string, not a numeric boolean.
  readonly isopen: string;
  readonly simpleCartoon: string;
}
export interface PromiseFragmentConfig {
  readonly id: number;
  readonly FragmentStage: number;
  readonly FragmentIndex: number;
  // These are 1-based positions in a stage tasklist, not task IDs.
  readonly TaskIndexs: readonly number[];
}
export interface PromiseExchangeConfig {
  readonly Id: number;
  readonly LimitNum: number;
  readonly tbSubItem: readonly number[];
  readonly tbMoney: readonly number[];
  readonly tbAwardItem: readonly number[];
}
export interface PromiseCatalogContents {
  steps: string;
  tasks: string;
  fragments: string;
  exchange: string;
}

function integer(value: string | undefined, fallback = 0): number {
  if (value === undefined || value.trim() === "") return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new Error(`Invalid pledge integer: ${value}`);
  return result;
}
function list(value: string | undefined, separator = "-"): readonly number[] {
  const inner = (value ?? "").trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner) return Object.freeze([]);
  // Negative sentinels occur in lvpara (pipe-separated), not GDPL lists.
  return Object.freeze(inner.split(separator).map((part) => integer(part)));
}
function tableRows(contents: string, idKey: string): Record<string, string>[] {
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headers = lines[2]?.split("\t");
  if (!headers?.includes(idKey))
    throw new Error(`Missing pledge table header ${idKey}`);
  return lines
    .slice(3)
    .filter((line) => line.trim())
    .map((line) => {
      const values = line.split("\t");
      return Object.fromEntries(
        headers
          .filter(Boolean)
          .map((name) => [name, values[headers.indexOf(name)] ?? ""]),
      );
    })
    .filter((row) => /^\d+$/.test(row[idKey] ?? ""));
}
function insertUnique<T>(map: Map<number, T>, id: number, value: T): void {
  if (map.has(id)) throw new Error(`Duplicate pledge ID ${id}`);
  map.set(id, value);
}
function releaseTime(value: string): number | null {
  const parts = value.split("-").map(Number);
  if (parts.length !== 5 || parts.some((part) => !Number.isSafeInteger(part)))
    return null;
  const [year, month, day, hour, minute] = parts as [
    number,
    number,
    number,
    number,
    number,
  ];
  return Date.UTC(year, month - 1, day, hour, minute);
}

export class PromiseCatalog {
  readonly #steps = new Map<number, readonly PromiseStepConfig[]>();
  readonly #tasks = new Map<number, PromiseTaskConfig>();
  readonly #fragments: readonly PromiseFragmentConfig[];
  readonly #exchange = new Map<number, PromiseExchangeConfig>();
  readonly girlIds: readonly number[];
  readonly globalOpenDate: string;
  static #shared: PromiseCatalog | null = null;

  constructor(contents: PromiseCatalogContents) {
    for (const row of tableRows(contents.tasks, "id")) {
      const params: Record<string, PromiseTaskParameter> = {};
      for (let index = 1; index <= 10; index += 1) {
        const name = row[`paraname${index}`];
        if (!name) continue;
        const raw = row[`para${index}`];
        params[name] =
          row.strtype === "ReduceItem" && index === 1
            ? list(raw)
            : index === 2 &&
                ["ChapterFight", "EventFight", "TowerFight", "PvpFight"].includes(
                  row.strtype ?? "",
                )
              ? list(raw, "|")
              : integer(raw);
      }
      const config: PromiseTaskConfig = Object.freeze({
        id: integer(row.id),
        strtype: row.strtype as PromiseTaskType,
        info: row.info ?? "",
        infoKey: row.infoKey ?? "",
        target: row.target ?? "",
        recount: integer(row.recount),
        girlid: integer(row.girlid),
        count: integer(row.count),
        params: Object.freeze(params),
        ...params,
      });
      insertUnique(this.#tasks, config.id, config);
    }
    const steps = new Map<number, PromiseStepConfig[]>();
    let globalOpenDate = "";
    for (const row of tableRows(contents.steps, "girlid")) {
      const girlid = integer(row.girlid);
      if (girlid === 0) {
        globalOpenDate = row.isopen ?? "";
        continue;
      }
      const rewards = (row.rewards ?? "")
        .split(",")
        .filter(Boolean)
        .map((part) => {
          const values = list(part);
          if (values.length !== 6)
            throw new Error(`Invalid pledge stage reward: ${part}`);
          return values as PromiseStageReward;
        });
      const config: PromiseStepConfig = Object.freeze({
        girlid,
        step: integer(row.step),
        changecard: integer(row.changecard),
        cardgdpl: list(row.cardgdpl),
        cardbreaklv: integer(row.cardbreaklv),
        cardlv: integer(row.cardlv),
        cardskilllv: list(row.cardskilllv),
        heart: integer(row.heart),
        rewards: Object.freeze(rewards),
        l2did: integer(row.l2did),
        l2dbgid: integer(row.l2dbgid),
        tasklist: list(row.tasklist),
        isopen: row.isopen ?? "",
        simpleCartoon: row.SimpleCartoon ?? "",
      });
      for (const taskId of config.tasklist) {
        if (!this.#tasks.has(taskId))
          throw new Error(`Unknown pledge task ${taskId} for ${girlid}:${config.step}`);
      }
      const current = steps.get(girlid) ?? [];
      if (current.some((step) => step.step === config.step))
        throw new Error(`Duplicate pledge step ${girlid}:${config.step}`);
      current.push(config);
      steps.set(girlid, current);
    }
    for (const [girlid, configs] of steps) {
      configs.sort((a, b) => a.step - b.step);
      if (configs[0]?.step !== 0)
        throw new Error(`Missing pledge activation row for ${girlid}`);
      this.#steps.set(girlid, Object.freeze(configs));
    }
    this.girlIds = Object.freeze([...steps.keys()].sort((a, b) => a - b));
    this.globalOpenDate = globalOpenDate;
    this.#fragments = Object.freeze(
      tableRows(contents.fragments, "id").map((row) =>
        Object.freeze({
          id: integer(row.id),
          FragmentStage: integer(row.FragmentStage),
          FragmentIndex: integer(row.FragmentIndex),
          TaskIndexs: list(row.TaskIndexs),
        }),
      ),
    );
    for (const row of tableRows(contents.exchange, "Id")) {
      const config: PromiseExchangeConfig = Object.freeze({
        Id: integer(row.Id),
        LimitNum: integer(row.LimitNum),
        tbSubItem: list(row.SubItem),
        tbMoney: list(row.MoneyId, ","),
        tbAwardItem: list(row.AwardItem),
      });
      if (config.tbAwardItem.length !== 5 || config.tbAwardItem[4]! <= 0)
        throw new Error(`Invalid pledge exchange ${config.Id}`);
      insertUnique(this.#exchange, config.Id, config);
    }
  }

  static loadDefault(): PromiseCatalog {
    if (!this.#shared) {
      const read = (name: string): string =>
        readFileSync(path.resolve(process.cwd(), "resources/pledge", name), "utf8");
      this.#shared = new PromiseCatalog({
        steps: read("steps.txt"),
        tasks: read("tasks.txt"),
        fragments: read("fragments.txt"),
        exchange: read("exchange.txt"),
      });
    }
    return this.#shared;
  }
  get size(): number {
    return this.#steps.size;
  }
  get taskCount(): number {
    return this.#tasks.size;
  }
  getSteps(girlid: number): readonly PromiseStepConfig[] {
    return this.#steps.get(girlid) ?? [];
  }
  getStep(girlid: number, step: number): PromiseStepConfig | null {
    return this.getSteps(girlid).find((config) => config.step === step) ?? null;
  }
  task(id: number): PromiseTaskConfig | null {
    return this.#tasks.get(id) ?? null;
  }
  tasks(): readonly PromiseTaskConfig[] {
    return [...this.#tasks.values()];
  }
  isSimple(girlid: number): boolean {
    return this.getStep(girlid, 0)?.simpleCartoon === "1";
  }
  maxStep(girlid: number): number {
    return this.getSteps(girlid).at(-1)?.step ?? 0;
  }
  // UTC is the server convention; all recovered release dates precede 2023.
  releasedGirls(now = Date.now()): readonly number[] {
    return this.girlIds.filter((girlid) => {
      const open = releaseTime(this.getStep(girlid, 0)?.isopen ?? "");
      return open !== null && open <= now;
    });
  }
  activationCost(girlid: number): BaseAward | null {
    const task = this.task(this.getStep(girlid, 0)?.tasklist[0] ?? 0);
    if (!task || task.strtype !== "ReduceItem" || task.gdpl?.length !== 4) return null;
    return [task.gdpl[0]!, task.gdpl[1]!, task.gdpl[2]!, task.gdpl[3]!, task.count];
  }
  fragments(stage: number, index?: number): readonly PromiseFragmentConfig[] {
    return this.#fragments.filter(
      (config) =>
        config.FragmentStage === stage &&
        (index === undefined || config.FragmentIndex === index),
    );
  }
  exchange(id: number): PromiseExchangeConfig | null {
    return this.#exchange.get(id) ?? null;
  }
  exchanges(): readonly PromiseExchangeConfig[] {
    return [...this.#exchange.values()];
  }
}

export type PromiseTaskStatus = 0 | 1 | 2;
export interface PromiseTaskData {
  id: number;
  count: number;
  status: PromiseTaskStatus;
}
export interface PromiseGirlData {
  girlid: number;
  step: number;
  cardguid: number;
  rewardstep: number;
  rewardlist: number[];
  taskdatas: PromiseTaskData[];
}
export type PromiseRequest =
  | { command: 228; girlId: number; step: number }
  | { command: 229; Id: number; Num: number }
  | { command: 230 | 231 | 232 }
  | { command: 233 | 235; girlid: number }
  | { command: 234; girlid: number; taskid: number }
  | { command: 239; girlid: number; step: number };
export interface PromiseRewardResponse {
  girlid: number;
  step: number;
  ncompletedtasknum: number;
  errid: number;
  tbaward: BaseAward[];
}
export interface PromiseExchangeResponse {
  Error: number;
  tbAwardItem?: BaseAward[];
}
export type PromiseTaskFinishResponse = PromiseTaskData | { Err: number };
export interface PromiseAvailabilityResponse {
  PromiseIsOpen: boolean;
}
export interface PromiseOpenGirlsResponse {
  OpenGirlList: number[];
}
export interface PromiseTaskCompletedNotification {
  taskId: number;
}

/** Validates actual client request commands only; 236/238 are pushes and 237 has no active handler. */
export function parsePromiseRequest(
  command: number,
  parameters: unknown,
): PromiseRequest | null {
  let value = parameters;
  if (typeof value === "object" && value !== null && "tbParam" in value)
    value = (value as { tbParam: unknown }).tbParam;
  if (typeof value !== "object" || value === null) return null;
  if (command === 230 || command === 231 || command === 232) return { command };
  if (Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const positive = (key: string): number | null =>
    typeof row[key] === "number" && Number.isSafeInteger(row[key]) && row[key] > 0
      ? row[key]
      : null;
  switch (command) {
    case 228: {
      const girlId = positive("girlId"),
        step = positive("step");
      return girlId !== null && step !== null ? { command, girlId, step } : null;
    }
    case 229: {
      const Id = positive("Id"),
        Num = positive("Num");
      return Id !== null && Num !== null ? { command, Id, Num } : null;
    }
    case 233:
    case 235: {
      const girlid = positive("girlid");
      return girlid !== null ? { command, girlid } : null;
    }
    case 234: {
      const girlid = positive("girlid"),
        taskid = positive("taskid");
      return girlid !== null && taskid !== null ? { command, girlid, taskid } : null;
    }
    case 239: {
      const girlid = positive("girlid"),
        step = positive("step");
      return girlid !== null && step !== null ? { command, girlid, step } : null;
    }
    default:
      return null;
  }
}
