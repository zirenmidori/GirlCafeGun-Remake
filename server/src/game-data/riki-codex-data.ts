/**
 * The codex (UI_RikiMain, "Collection"): which entries are unlocked.
 *
 * What the client reads: Riki.lua UpdateUnLockInfo marks an entry unlocked when
 * its Id is in `me:GetAllRikiState()` or the row has IsIgnoreLock. That list is
 * filled only by two server pushes (0.1.3 client, Game.Player
 * OnRikiListSyncRsp / OnRikiDataSyncRsp, gsproto CMD_RIKI_LIST_RSP = 1112 and
 * CMD_RIKI_DATA_RSP = 1114): RikiList holds every unlocked Id, RikiData one new
 * Id. The client does not read task values for it. Without the pushes the
 * Character, Weapon and Posture tiles show 0 and the CG and music tiles only
 * their IsIgnoreLock rows.
 *
 * Where this server keeps the state: task 53/Id = 1, the layout that Riki.lua
 * describes (TaskGroup 53, `GetTaskValue(TaskGroup, Id) == 1` unlocked). An
 * entry stays unlocked when its card or weapon is used up later.
 *
 * Unlock rules:
 * - Rows whose GDPL the player holds: cards (type 1), weapons (2), CG (3),
 *   L2D cards (4), music (8). Type 1 is the rule of the earlier C# server
 *   (RikiCardTable.cs: Type 1, genre 1). The other types list the GDPL of the
 *   item in the same columns [INFER: same rule]. CG and music arrive as
 *   RikiItem AutoUse items, which auto-use-item-data.ts turns into the task at
 *   once; the GDPL rule covers a stack that stayed in the bag.
 * - Event stories (type 6 with P > 0 and L > 0) that the player unlocks with
 *   Riki coins: UI_RikiStory sends `BuyRikiStory {Id, Name}` after its own
 *   money check (MoneyLogic.eMoneyType_RikiRATDIS = 61) and the price is
 *   RatdisNum; S2C.RspBuyRikiStory then shows the story unlocked. Neither the
 *   client nor the C# server shows the server side [INFER: charge RatdisNum
 *   money 61, set the task, reply {Id}].
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { InventoryEntryState } from "../persistence/player-repository.js";
import { RIKI_TASK_GROUP } from "./auto-use-item-data.js";

/** MoneyDef.txt 61, MoneyLogic.eMoneyType_RikiRATDIS (Riki coins). */
export const RIKI_STORY_MONEY_ID = 61;

/** Riki.txt Type column (header of the table). */
const TYPE_STORY = 6;
const GDPL_TYPES = new Set([1, 2, 3, 4, 8]);

/**
 * Rows that the client table has and resources/cafe/riki.txt (the stock table)
 * does not: release/client/patch_card_display.py appends codex row 12701 for
 * the custom girl Neptune, card 1-27-1-1.
 */
const LOCAL_ROWS: readonly RikiRow[] = [
  { id: 12_701, type: 1, gdpl: [1, 27, 1, 1], storyCost: 0, eventStory: false },
];

export interface RikiRow {
  id: number;
  type: number;
  /** Null when the row has no item (stories, comics). */
  gdpl: readonly [number, number, number, number] | null;
  /** RatdisNum: Riki coins that unlock an event story (0 = not for sale). */
  storyCost: number;
  /** Type 6 with P > 0 and L > 0 (Riki.lua InitChapterStory). */
  eventStory: boolean;
}

function parseRows(text: string): RikiRow[] {
  const lines = text.split(/\r?\n/);
  const columns = (lines[2] ?? "").split("\t");
  const column = (name: string) => columns.indexOf(name);
  const [type, id, g, d, p, l, cost] = [
    "Type",
    "Id",
    "G",
    "D",
    "P",
    "L",
    "RatdisNum",
  ].map(column);
  if ([type, id, g, d, p, l].some((index) => index! < 0))
    throw new Error("Unrecognized Riki.txt header");
  const rows: RikiRow[] = [];
  for (const line of lines.slice(3)) {
    if (line.trim() === "") continue;
    const cells = line.split("\t");
    const number = (index: number | undefined) => {
      const text = (
        index === undefined || index < 0 ? "" : (cells[index] ?? "")
      ).trim();
      const value = Number(text);
      return text !== "" && Number.isSafeInteger(value) ? value : null;
    };
    const rowId = number(id);
    const rowType = number(type);
    if (rowId === null || rowType === null || rowId <= 0 || rowId > 0xffff) continue;
    const parts = [number(g), number(d), number(p), number(l)];
    const gdpl = parts.every((part) => part !== null && part > 0)
      ? (parts as [number, number, number, number])
      : null;
    rows.push({
      id: rowId,
      type: rowType,
      gdpl,
      storyCost: Math.max(0, number(cost) ?? 0),
      eventStory: rowType === TYPE_STORY && (parts[2] ?? 0) > 0 && (parts[3] ?? 0) > 0,
    });
  }
  return rows;
}

function gdplKey(genre: number, detail: number, particular: number, level: number) {
  return `${genre}-${detail}-${particular}-${level}`;
}

export function rikiTaskKey(id: number): string {
  return String((RIKI_TASK_GROUP << 16) | id);
}

export class RikiCodexCatalog {
  static #default: RikiCodexCatalog | undefined;

  readonly #rows = new Map<number, RikiRow>();
  readonly #idsByGdpl = new Map<string, number[]>();

  /** @param rikiTable Guide/Riki.txt (resources/cafe/riki.txt) */
  constructor(rikiTable: string, localRows: readonly RikiRow[] = LOCAL_ROWS) {
    for (const row of [...parseRows(rikiTable), ...localRows]) {
      if (this.#rows.has(row.id)) continue;
      this.#rows.set(row.id, row);
      if (!row.gdpl || !GDPL_TYPES.has(row.type)) continue;
      const key = gdplKey(...row.gdpl);
      const ids = this.#idsByGdpl.get(key) ?? [];
      ids.push(row.id);
      this.#idsByGdpl.set(key, ids);
    }
  }

  static loadDefault(): RikiCodexCatalog {
    if (RikiCodexCatalog.#default) return RikiCodexCatalog.#default;
    RikiCodexCatalog.#default = new RikiCodexCatalog(
      readFileSync(
        path.resolve(process.cwd(), "resources", "cafe", "riki.txt"),
        "utf8",
      ),
    );
    return RikiCodexCatalog.#default;
  }

  row(id: number): RikiRow | null {
    return this.#rows.get(id) ?? null;
  }

  /** Codex ids of the rows whose item is in the bag, ascending. */
  heldIds(inventory: readonly InventoryEntryState[]): number[] {
    const ids = new Set<number>();
    for (const item of inventory) {
      if (item.count <= 0) continue;
      const key = gdplKey(item.genre, item.detail, item.particular, item.templateLevel);
      for (const id of this.#idsByGdpl.get(key) ?? []) ids.add(id);
    }
    return [...ids].sort((left, right) => left - right);
  }

  /** Codex ids of one item GDPL (empty when no row lists it). */
  idsOf(
    genre: number,
    detail: number,
    particular: number,
    level: number,
  ): readonly number[] {
    return this.#idsByGdpl.get(gdplKey(genre, detail, particular, level)) ?? [];
  }
}

/** Sets task 53/Id for the codex rows of an item that enters the bag; returns the ids it set. */
export function markRikiCodex(
  taskValues: Record<string, number>,
  genre: number,
  detail: number,
  particular: number,
  level: number,
  catalog = RikiCodexCatalog.loadDefault(),
): number[] {
  const added: number[] = [];
  for (const id of catalog.idsOf(genre, detail, particular, level)) {
    if ((taskValues[rikiTaskKey(id)] ?? 0) > 0) continue;
    taskValues[rikiTaskKey(id)] = 1;
    added.push(id);
  }
  return added;
}

interface CodexPlayer {
  inventory: readonly InventoryEntryState[];
  taskValues: Record<string, number>;
}

/** Held entries whose task 53/Id is not set yet. */
export function pendingRikiCodexIds(
  player: CodexPlayer,
  catalog = RikiCodexCatalog.loadDefault(),
): number[] {
  return catalog
    .heldIds(player.inventory)
    .filter((id) => (player.taskValues[rikiTaskKey(id)] ?? 0) <= 0);
}

/** Sets task 53/Id for every held entry; returns the ids it set. */
export function reconcileRikiCodex(
  player: CodexPlayer,
  catalog = RikiCodexCatalog.loadDefault(),
): number[] {
  const added = pendingRikiCodexIds(player, catalog);
  for (const id of added) player.taskValues[rikiTaskKey(id)] = 1;
  return added;
}

/** Every unlocked codex id (task 53/Id above 0, or held now), ascending. */
export function unlockedRikiIds(
  player: CodexPlayer,
  catalog = RikiCodexCatalog.loadDefault(),
): number[] {
  const ids = new Set(catalog.heldIds(player.inventory));
  for (const [key, value] of Object.entries(player.taskValues)) {
    const taskId = Number(key);
    if (value > 0 && taskId >>> 16 === RIKI_TASK_GROUP && (taskId & 0xffff) > 0)
      ids.add(taskId & 0xffff);
  }
  return [...ids].sort((left, right) => left - right);
}
