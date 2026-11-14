import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACHIEVEMENT_TASK_GROUP,
  ACTIVITY_ACHIEVEMENT_TASK_GROUP,
  ActivityAchievementCatalog,
} from "../src/game-data/activity-achievement-data.js";
import {
  AutoUseItemCatalog,
  CHAT_BUBBLE_TASK_GROUP,
  HEAD_FRAME_TASK_GROUP,
  PLAYER_LIST_SKIN_TASK_GROUP,
  RIKI_TASK_GROUP,
  VISITING_CARD_TASK_GROUP,
} from "../src/game-data/auto-use-item-data.js";

const catalog = AutoUseItemCatalog.loadDefault();

describe("auto-use item rules", () => {
  it("keeps the ItemList selection as recorded", () => {
    const root = path.resolve(process.cwd(), "resources/item");
    const provenance = JSON.parse(
      readFileSync(path.join(root, "provenance.json"), "utf8"),
    ) as { files: Record<string, { sha256: string; bytes: number }> };
    const expected = provenance.files["autouse.txt"]!;
    const bytes = readFileSync(path.join(root, "autouse.txt"));
    expect(bytes.length).toBe(expected.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);
  });

  it("pays coin items into the wallet that ExtParam2 names", () => {
    expect(catalog.effect(15, 6, 1, 1)).toEqual({
      kind: "money",
      moneyId: 5,
      perItem: 1,
    });
    expect(catalog.effect(15, 128, 1, 1)).toEqual({
      kind: "money",
      moneyId: 88,
      perItem: 1,
    });
    // ItemMixTowerCoinAuto.
    expect(catalog.effect(15, 54, 1, 1)).toEqual({
      kind: "money",
      moneyId: 29,
      perItem: 1,
    });
    // ItemGiftCoffeeCoinAuto -> coffee coins (MoneyDef 7).
    expect(catalog.effect(14, 1, 4, 1)).toEqual({
      kind: "money",
      moneyId: 7,
      perItem: 1,
    });
  });

  it("unlocks profile decorations through their task group", () => {
    const unlock = (group: number, id: number) => ({
      kind: "unlock-time",
      taskIds: [(group << 16) | id],
    });
    expect(catalog.effect(6, 28, 8, 4)).toEqual(unlock(HEAD_FRAME_TASK_GROUP, 9));
    expect(catalog.effect(6, 21, 3, 4)).toEqual(unlock(VISITING_CARD_TASK_GROUP, 3));
    expect(catalog.effect(6, 22, 3, 4)).toEqual(unlock(PLAYER_LIST_SKIN_TASK_GROUP, 3));
    expect(catalog.effect(6, 23, 104, 4)).toEqual(unlock(CHAT_BUBBLE_TASK_GROUP, 104));
  });

  it("unlocks gallery entries through Riki.txt", () => {
    expect(catalog.effect(16, 3, 5, 1)).toEqual({
      kind: "unlock-flag",
      taskIds: [(RIKI_TASK_GROUP << 16) | 3_058],
    });
    expect(catalog.effect(17, 2, 1, 1)).toEqual({
      kind: "unlock-flag",
      taskIds: [(RIKI_TASK_GROUP << 16) | 8_038],
    });
  });

  it("separates stacks, items without a rule and ordinary items", () => {
    expect(catalog.effect(11, 5, 15, 2)).toEqual({ kind: "stack" });
    expect(catalog.effect(8, 17, 1, 2)).toEqual({
      kind: "none",
      className: "ItemBoxAuto",
    });
    expect(catalog.effect(15, 40, 1, 1)).toEqual({
      kind: "none",
      className: "ItemEatChickenScoreAuto",
    });
    // Materials are not AutoUse.
    expect(catalog.effect(7, 3, 1, 1)).toBeNull();
    expect(catalog.effect(9, 12, 1, 1)).toBeNull();
  });

  it("leaves exactly nine award items of the achievement tables without a rule", () => {
    const achievements = ActivityAchievementCatalog.loadDefault();
    const wallets = new Set(["15-1", "15-2", "15-4", "15-10", "15-11", "15-20"]);
    const withoutRule = (group: number): string[] => {
      const found = new Set<string>();
      for (const { awards } of achievements.achievements(group)) {
        for (const [genre, detail, particular, level] of awards ?? []) {
          if (wallets.has(`${genre}-${detail}`)) continue;
          const effect = catalog.effect(genre, detail, particular, level);
          if (effect?.kind === "none") {
            found.add(`${genre}-${detail}-${particular}-${level} ${effect.className}`);
          }
        }
      }
      return [...found].sort();
    };
    // Every award of the achievement panel can be paid.
    expect(withoutRule(ACHIEVEMENT_TASK_GROUP)).toEqual([]);
    // A box with random content and eight scores of events that have ended.
    expect(withoutRule(ACTIVITY_ACHIEVEMENT_TASK_GROUP)).toEqual(
      [
        "8-17-1-2 ItemBoxAuto",
        "15-30-1-1 ItemAbsorbPeakScoreAuto",
        "15-35-1-1 ItemEighthTowerScoreAuto",
        "15-37-1-1 ItemNewyearFuAuto",
        "15-40-1-1 ItemEatChickenScoreAuto",
        "15-41-1-1 ItemReturnMissionActivePointAuto",
        "15-45-1-1 ItemCoopEventScoreAuto",
        "15-52-1-1 ItemBattlePassExpAuto",
        "15-96-1-1 ItemMonopolyPointAuto",
      ].sort(),
    );
  });
});
