/**
 * Costume packs of the dress shop (UI_ShopEntry Skin -> UI_ShopNew label 101).
 *
 * Source: the client tables of the 0.1.3 release (setting.u):
 * - Purchase/PurchaseIBShop.txt Id 1001-1035 sell gift boxes 13-x-1-6000..6034;
 *   Ids 1036-1041 are new rows for boxes 6035-6040, which had no shop row.
 * - Item/ItemBoxInfo.txt boxes 6000-6040: every entry is Fix. Each box holds one
 *   costume item 19-1-P-L, and some hold its main-screen background (6-25-x-3,
 *   ItemBackGroundAuto) and a badge (6-22-x-4, ItemPlayerListSkinAuto).
 * - Girl/SpineSuit.txt maps the costume item to girl and model.
 *
 * Cost is in Diamonds (Currency -2 in the patched client row). It is the old
 * Hairpin price of the row (62 Hairpin or 63 FreeHairpin); new rows cost 138.
 * The seven oath costumes 19-2-18..24 are not sold: they are oath rewards
 * (Pldge/steps.txt step 7).
 */
import type { BaseAward } from "./chapter-config.js";

export interface CostumePackConfig {
  /** PurchaseIBShop Id; the client sends it as DoRecharge Type 1 Id. */
  readonly id: number;
  /** Diamonds. */
  readonly cost: number;
  readonly girlId: number;
  readonly modelId: number;
  /** The costume item 19-D-P-L. */
  readonly suit: readonly [number, number, number, number];
  /** Box contents [g, d, p, l, n], granted in this order. */
  readonly contents: readonly BaseAward[];
}

// One row per line: release/client/test_costume_shop.py reads this table.
// prettier-ignore
export const COSTUME_PACKS: readonly CostumePackConfig[] = Object.freeze([
  // 朱颜藤梦·时无瑕: box 6000
  { id: 1001, cost: 145, girlId: 9, modelId: 7001, suit: [19, 1, 1, 4], contents: [[19, 1, 1, 4, 1], [6, 25, 2, 3, 1]] },
  // 绯服龙晴·伊珂丝: box 6001
  { id: 1002, cost: 75, girlId: 12, modelId: 7001, suit: [19, 1, 2, 3], contents: [[19, 1, 2, 3, 1]] },
  // 生日艾琳·阿贝尔之梦: box 6002
  { id: 1003, cost: 200, girlId: 7, modelId: 7002, suit: [19, 1, 3, 2], contents: [[19, 1, 3, 2, 1]] },
  // 生日小真·摩登波尔卡: box 6003
  { id: 1004, cost: 200, girlId: 5, modelId: 5001, suit: [19, 1, 4, 2], contents: [[19, 1, 4, 2, 1]] },
  // 限定SP·无忧: box 6004
  { id: 1005, cost: 168, girlId: 10, modelId: 7001, suit: [19, 1, 5, 4], contents: [[19, 1, 5, 4, 1], [6, 25, 3, 3, 1], [6, 22, 102, 4, 1]] },
  // 生日朱诺·玩乐俏佳人: box 6005
  { id: 1006, cost: 200, girlId: 3, modelId: 5001, suit: [19, 1, 6, 2], contents: [[19, 1, 6, 2, 1]] },
  // 埃及·丽达: box 6006
  { id: 1007, cost: 138, girlId: 11, modelId: 7001, suit: [19, 1, 7, 4], contents: [[19, 1, 7, 4, 1], [6, 25, 4, 3, 1]] },
  // 限定SP·唯: box 6007
  { id: 1008, cost: 168, girlId: 16, modelId: 7001, suit: [19, 1, 8, 4], contents: [[19, 1, 8, 4, 1], [6, 25, 5, 3, 1], [6, 22, 103, 4, 1]] },
  // 生日无瑕: box 6008
  { id: 1009, cost: 200, girlId: 9, modelId: 5001, suit: [19, 1, 9, 2], contents: [[19, 1, 9, 2, 1]] },
  // 生日可可: box 6009
  { id: 1010, cost: 200, girlId: 1, modelId: 5001, suit: [19, 1, 10, 2], contents: [[19, 1, 10, 2, 1]] },
  // 甜品卡萝: box 6010
  { id: 1011, cost: 138, girlId: 13, modelId: 7001, suit: [19, 1, 11, 4], contents: [[19, 1, 11, 4, 1], [6, 25, 6, 3, 1]] },
  // 生日格兰妮: box 6011
  { id: 1012, cost: 200, girlId: 8, modelId: 5001, suit: [19, 1, 12, 2], contents: [[19, 1, 12, 2, 1]] },
  // 甜品小真: box 6012
  { id: 1013, cost: 138, girlId: 5, modelId: 7001, suit: [19, 1, 13, 4], contents: [[19, 1, 13, 4, 1], [6, 25, 7, 3, 1]] },
  // 生日丽达: box 6013
  { id: 1014, cost: 200, girlId: 11, modelId: 5001, suit: [19, 1, 14, 2], contents: [[19, 1, 14, 2, 1]] },
  // 生日千姬: box 6014
  { id: 1015, cost: 200, girlId: 6, modelId: 5001, suit: [19, 1, 15, 2], contents: [[19, 1, 15, 2, 1]] },
  // 生日诗柔: box 6015
  { id: 1016, cost: 200, girlId: 14, modelId: 5001, suit: [19, 1, 16, 2], contents: [[19, 1, 16, 2, 1]] },
  // 中秋阿妮亚: box 6016
  { id: 1017, cost: 138, girlId: 15, modelId: 7001, suit: [19, 1, 17, 4], contents: [[19, 1, 17, 4, 1], [6, 25, 8, 3, 1]] },
  // 限定SP花嫁·艾琳: box 6017
  { id: 1018, cost: 168, girlId: 7, modelId: 7001, suit: [19, 1, 18, 4], contents: [[19, 1, 18, 4, 1], [6, 25, 9, 3, 1], [6, 22, 15, 4, 1]] },
  // 生日沐恩: box 6018
  { id: 1019, cost: 200, girlId: 4, modelId: 5001, suit: [19, 1, 19, 2], contents: [[19, 1, 19, 2, 1]] },
  // 花嫁朱诺: box 6019
  { id: 1020, cost: 138, girlId: 3, modelId: 7001, suit: [19, 1, 20, 4], contents: [[19, 1, 20, 4, 1], [6, 25, 10, 3, 1]] },
  // 万圣奈乐: box 6020
  { id: 1021, cost: 138, girlId: 2, modelId: 7001, suit: [19, 1, 21, 4], contents: [[19, 1, 21, 4, 1], [6, 25, 11, 3, 1]] },
  // 生日伊珂丝: box 6021
  { id: 1022, cost: 200, girlId: 12, modelId: 5001, suit: [19, 1, 22, 2], contents: [[19, 1, 22, 2, 1]] },
  // 周年庆·千姬(SP）: box 6022
  { id: 1023, cost: 168, girlId: 6, modelId: 7001, suit: [19, 1, 23, 4], contents: [[19, 1, 23, 4, 1], [6, 25, 12, 3, 1], [6, 22, 16, 4, 1]] },
  // 生日时无忧: box 6023
  { id: 1024, cost: 200, girlId: 10, modelId: 5001, suit: [19, 1, 24, 2], contents: [[19, 1, 24, 2, 1]] },
  // 周年洛可可: box 6024
  { id: 1025, cost: 138, girlId: 1, modelId: 7001, suit: [19, 1, 25, 4], contents: [[19, 1, 25, 4, 1], [6, 25, 13, 3, 1]] },
  // 奈乐生日: box 6025
  { id: 1026, cost: 200, girlId: 2, modelId: 5001, suit: [19, 1, 27, 2], contents: [[19, 1, 27, 2, 1]] },
  // 无瑕城市: box 6026
  { id: 1027, cost: 138, girlId: 9, modelId: 7002, suit: [19, 1, 26, 4], contents: [[19, 1, 26, 4, 1], [6, 25, 15, 3, 1]] },
  // 生日艾琳2022: box 6027
  { id: 1028, cost: 200, girlId: 7, modelId: 5001, suit: [19, 1, 28, 2], contents: [[19, 1, 28, 2, 1]] },
  // 城市·伊珂丝(SP）: box 6028
  { id: 1029, cost: 168, girlId: 12, modelId: 7002, suit: [19, 1, 29, 4], contents: [[19, 1, 29, 4, 1], [6, 25, 16, 3, 1], [6, 22, 18, 4, 1]] },
  // 生日小真2022: box 6029
  { id: 1030, cost: 200, girlId: 5, modelId: 5002, suit: [19, 1, 30, 2], contents: [[19, 1, 30, 2, 1]] },
  // 驻唱歌手·格兰尼: box 6030
  { id: 1031, cost: 138, girlId: 8, modelId: 7001, suit: [19, 1, 31, 4], contents: [[19, 1, 31, 4, 1], [6, 25, 18, 3, 1]] },
  // 生日·阿尼娅2022: box 6031
  { id: 1032, cost: 200, girlId: 15, modelId: 5001, suit: [19, 1, 32, 2], contents: [[19, 1, 32, 2, 1]] },
  // 生日朱诺·2022: box 6032
  { id: 1033, cost: 200, girlId: 3, modelId: 5002, suit: [19, 1, 33, 2], contents: [[19, 1, 33, 2, 1]] },
  // 生日无瑕·2022: box 6033
  { id: 1034, cost: 200, girlId: 9, modelId: 5002, suit: [19, 1, 34, 2], contents: [[19, 1, 34, 2, 1]] },
  // 生日卡萝·2022: box 6034
  { id: 1035, cost: 200, girlId: 13, modelId: 5001, suit: [19, 1, 41, 2], contents: [[19, 1, 41, 2, 1]] },
  // 奈乐医护L2D: box 6035
  { id: 1036, cost: 138, girlId: 2, modelId: 7017, suit: [19, 1, 35, 2], contents: [[19, 1, 35, 2, 1]] },
  // 艾琳医护L2D: box 6036
  { id: 1037, cost: 138, girlId: 7, modelId: 7017, suit: [19, 1, 36, 2], contents: [[19, 1, 36, 2, 1]] },
  // 阿尼娅医护L2D: box 6037
  { id: 1038, cost: 138, girlId: 15, modelId: 7017, suit: [19, 1, 37, 2], contents: [[19, 1, 37, 2, 1]] },
  // 奈乐医护spine: box 6038
  { id: 1039, cost: 138, girlId: 2, modelId: 3017, suit: [19, 1, 38, 2], contents: [[19, 1, 38, 2, 1]] },
  // 艾琳医护spine: box 6039
  { id: 1040, cost: 138, girlId: 7, modelId: 3017, suit: [19, 1, 39, 2], contents: [[19, 1, 39, 2, 1]] },
  // 阿尼娅医护spine: box 6040
  { id: 1041, cost: 138, girlId: 15, modelId: 3017, suit: [19, 1, 40, 2], contents: [[19, 1, 40, 2, 1]] },
]);

const BY_ID = new Map(COSTUME_PACKS.map((pack) => [pack.id, pack]));

export function costumePack(id: number): CostumePackConfig | undefined {
  return BY_ID.get(id);
}
