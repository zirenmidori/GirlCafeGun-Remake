import { readFileSync } from "node:fs";
import path from "node:path";

import type { BaseAward } from "./chapter-config.js";

// 出处：客户端 Girl/Fetter.txt + GirlConfig.lua LoadFetter / UI_GirlLove.lua。
// 圆形支线节点是二级解锁：好感等级达标只是第一道门，第二道门是服务端写入的
// 好感事件任务位（组 3，ELevel 偏移 300+index-1，1=已解锁未读，2=已读）。
export const GIRL_FETTER_EVENT_OFFSET = 300;
// GirlCommon.lua RegisterGirlVar('ECard', 400, 100)：卡面剧情已读位
// （UI_GirlLoveAlbum，ViewStory nType=3）。
export const GIRL_CARD_STORY_EVENT_OFFSET = 400;

export interface GirlFetterCond {
  chapter: number;
  index: number;
  difficulty: number;
}

export interface GirlFetterNode {
  index: number;
  requiredLevel: number;
  // SubCond[1] == -1 表示官方未开放，永不解锁。
  unavailable: boolean;
  cond: GirlFetterCond | null;
  awards: BaseAward[];
}

function integer(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

// FetterItem: [index,框体id,图标,剧情名,剧情简介,汇总,图标X,图标Y,卡图]
function parseNodeIndex(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/^\[(\d+),/);
  return match ? integer(match[1]) : 0;
}

// Award: [G-D-P-L-N,G-D-P-L-N,...]
function parseAwards(value: string | undefined): BaseAward[] {
  if (!value) return [];
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((part) => part.split("-").map(Number))
    .filter(
      (values): values is number[] =>
        values.length >= 5 &&
        values.slice(0, 5).every((part) => Number.isSafeInteger(part)),
    )
    .map((values) => [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!]);
}

// SubCond: [-1]（未开放）/ [1,章节,关卡,难度,描述key] / []（无附加条件）
function parseCond(value: string | undefined): {
  unavailable: boolean;
  cond: GirlFetterCond | null;
} {
  if (!value) return { unavailable: false, cond: null };
  const inner = value.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return { unavailable: false, cond: null };
  const parts = inner.split(",");
  if (parts[0] === "-1") return { unavailable: true, cond: null };
  if (parts.length !== 5 || parts[0] !== "1") return { unavailable: false, cond: null };
  return {
    unavailable: false,
    cond: {
      chapter: integer(parts[1]),
      index: integer(parts[2]),
      difficulty: integer(parts[3]),
    },
  };
}

export class GirlFetterCatalog {
  readonly #nodes = new Map<number, GirlFetterNode[]>();

  constructor(contents: string) {
    const lines = contents.split(/\r?\n/);
    for (const line of lines.slice(3)) {
      if (!line.trim()) continue;
      const values = line.split("\t");
      const girlId = integer(values[0]);
      const rowLevel = integer(values[1]);
      if (girlId <= 0 || rowLevel <= 0) continue;

      const nodes: GirlFetterNode[] = [];
      const mainIndex = parseNodeIndex(values[2]);
      if (mainIndex > 0) {
        nodes.push({
          index: mainIndex,
          requiredLevel: rowLevel,
          unavailable: false,
          cond: null,
          awards: parseAwards(values[3]),
        });
      }
      for (let sub = 1; sub <= 4; sub += 1) {
        const subIndex = parseNodeIndex(values[4 + (sub - 1) * 4]);
        if (subIndex <= 0) continue;
        const requiredLevel = integer(values[4 + (sub - 1) * 4 + 1]) || rowLevel;
        const { unavailable, cond } = parseCond(values[4 + (sub - 1) * 4 + 3]);
        nodes.push({
          index: subIndex,
          requiredLevel,
          unavailable,
          cond,
          awards: parseAwards(values[4 + (sub - 1) * 4 + 2]),
        });
      }

      const existing = this.#nodes.get(girlId) ?? [];
      this.#nodes.set(girlId, [...existing, ...nodes]);
    }
  }

  static loadDefault(): GirlFetterCatalog {
    const filePath = path.resolve(process.cwd(), "resources/girl/fetter.txt");
    return new GirlFetterCatalog(readFileSync(filePath, "utf8"));
  }

  nodes(girlId: number): readonly GirlFetterNode[] {
    return this.#nodes.get(girlId) ?? [];
  }

  node(girlId: number, index: number): GirlFetterNode | null {
    return this.nodes(girlId).find((node) => node.index === index) ?? null;
  }

  get size(): number {
    return this.#nodes.size;
  }
}

let sharedCatalog: GirlFetterCatalog | null = null;

export function defaultGirlFetterCatalog(): GirlFetterCatalog {
  if (!sharedCatalog) sharedCatalog = GirlFetterCatalog.loadDefault();
  return sharedCatalog;
}
