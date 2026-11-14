/**
 * Items that ItemList marks AutoUse: the original server used them up when
 * they arrived and changed player state instead of keeping a stack.
 *
 * resources/item/autouse.txt is the AutoUse selection of the client's ItemList.
 * Each rule below names the client code that reads the resulting state:
 *
 * - ItemNormalCoinAuto, ItemMixTowerCoinAuto, ItemBattlePassCoinAuto: ExtParam2
 *   is the money id (ItemLogic.lua tbItemCoinItem, UI_Player.lua GetMoney).
 * - ItemHeadFrameAuto: ExtParam1 is the head frame id; owned when task 11/id
 *   holds the time it was received (CardCommon:CheckHaveHeadFrame).
 * - ItemVisitingCardAuto, ItemPlayerListSkinAuto, ItemChatBubbleAuto: ExtParam1
 *   is the Skin.txt, Board.txt or Babble.txt id; owned when task 76, 77 or
 *   78/id holds the time it was received (UI_SkinSelected:IsUnlock).
 * - RikiItem: Guide/Riki.txt lists the item's GDPL; task 53/Id is 1 when the
 *   entry is unlocked (Riki.lua).
 * - ItemGiftCoffeeCoinAuto: coffee coins. Inferred: it shares description and
 *   icon with ItemCoffeeCoinAuto, and its genre 14 siblings are the diamond
 *   items that pay ExtParam1 diamonds each.
 * - CafeItemAuto: furniture. This server keeps it as a stack that the cafe
 *   uses up when it places the furniture.
 *
 * Every other AutoUse class has no rule here (boxes, event scores, gift
 * packs). Wallet currencies of genre 15 are handled before this lookup.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const HEAD_FRAME_TASK_GROUP = 11;
export const VISITING_CARD_TASK_GROUP = 76;
export const PLAYER_LIST_SKIN_TASK_GROUP = 77;
export const CHAT_BUBBLE_TASK_GROUP = 78;
export const RIKI_TASK_GROUP = 53;
/** MoneyDef.txt id 7. */
const COFFEE_COIN_MONEY_ID = 7;

export type AutoUseEffect =
  /** Adds count * perItem to a wallet. */
  | { kind: "money"; moneyId: number; perItem: number }
  /** Stores the time of receipt in each task. */
  | { kind: "unlock-time"; taskIds: readonly number[] }
  /** Sets each task to 1. */
  | { kind: "unlock-flag"; taskIds: readonly number[] }
  /** Kept as an inventory stack on purpose. */
  | { kind: "stack" }
  /** AutoUse, but this server has no rule for it. */
  | { kind: "none"; className: string };

const COIN_CLASSES = new Set([
  "ItemNormalCoinAuto",
  "ItemMixTowerCoinAuto",
  "ItemBattlePassCoinAuto",
]);
const UNLOCK_TIME_GROUPS = new Map([
  ["ItemHeadFrameAuto", HEAD_FRAME_TASK_GROUP],
  ["ItemVisitingCardAuto", VISITING_CARD_TASK_GROUP],
  ["ItemPlayerListSkinAuto", PLAYER_LIST_SKIN_TASK_GROUP],
  ["ItemChatBubbleAuto", CHAT_BUBBLE_TASK_GROUP],
]);

type Row = Record<string, string>;

function parseTable(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const columns = (lines[2] ?? "").split("\t");
  const rows: Row[] = [];
  for (const line of lines.slice(3)) {
    if (line.trim() === "") continue;
    const cells = line.split("\t");
    const row: Row = {};
    columns.forEach((column, index) => {
      if (column) row[column] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function positiveInteger(text: string | undefined): number | null {
  const value = Number((text ?? "").trim());
  return (text ?? "").trim() !== "" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function itemKey(
  genre: number,
  detail: number,
  particular: number,
  level: number,
): string {
  return `${genre}-${detail}-${particular}-${level}`;
}

function makeTaskId(group: number, taskId: number): number {
  return (group << 16) | taskId;
}

export class AutoUseItemCatalog {
  static #default: AutoUseItemCatalog | undefined;

  readonly #effects = new Map<string, AutoUseEffect>();

  /**
   * @param autoUseTable resources/item/autouse.txt
   * @param rikiTable Guide/Riki.txt (resources/cafe/riki.txt)
   */
  constructor(autoUseTable: string, rikiTable: string) {
    const rikiTaskIds = new Map<string, number[]>();
    for (const row of parseTable(rikiTable)) {
      const id = positiveInteger(row.Id);
      const gdpl = [row.G, row.D, row.P, row.L].map(positiveInteger);
      if (id === null || id > 0xffff || gdpl.some((part) => part === null)) continue;
      const key = gdpl.join("-");
      const taskIds = rikiTaskIds.get(key) ?? [];
      taskIds.push(makeTaskId(RIKI_TASK_GROUP, id));
      rikiTaskIds.set(key, taskIds);
    }

    for (const row of parseTable(autoUseTable)) {
      const gdpl = [row.Genre, row.Detail, row.Particular, row.Level].map(
        positiveInteger,
      );
      if (gdpl.some((part) => part === null)) continue;
      const key = gdpl.join("-");
      const className = row.ClassName ?? "";
      const first = positiveInteger(row.ExtParam1);
      const second = positiveInteger(row.ExtParam2);
      const unlockTimeGroup = UNLOCK_TIME_GROUPS.get(className);
      let effect: AutoUseEffect = { kind: "none", className };
      if (COIN_CLASSES.has(className) && first !== null && second !== null) {
        effect = { kind: "money", moneyId: second, perItem: first };
      } else if (className === "ItemGiftCoffeeCoinAuto" && first !== null) {
        effect = { kind: "money", moneyId: COFFEE_COIN_MONEY_ID, perItem: first };
      } else if (unlockTimeGroup !== undefined && first !== null && first <= 0xffff) {
        effect = { kind: "unlock-time", taskIds: [makeTaskId(unlockTimeGroup, first)] };
      } else if (className === "RikiItem" && rikiTaskIds.has(key)) {
        effect = { kind: "unlock-flag", taskIds: rikiTaskIds.get(key)! };
      } else if (className === "CafeItemAuto") {
        effect = { kind: "stack" };
      }
      this.#effects.set(key, effect);
    }
  }

  static loadDefault(): AutoUseItemCatalog {
    if (AutoUseItemCatalog.#default) return AutoUseItemCatalog.#default;
    const read = (file: string): string =>
      readFileSync(path.resolve(process.cwd(), "resources", file), "utf8");
    AutoUseItemCatalog.#default = new AutoUseItemCatalog(
      read("item/autouse.txt"),
      read("cafe/riki.txt"),
    );
    return AutoUseItemCatalog.#default;
  }

  /** The rule for an AutoUse item, or null when ItemList does not mark it AutoUse. */
  effect(
    genre: number,
    detail: number,
    particular: number,
    level: number,
  ): AutoUseEffect | null {
    return this.#effects.get(itemKey(genre, detail, particular, level)) ?? null;
  }
}
