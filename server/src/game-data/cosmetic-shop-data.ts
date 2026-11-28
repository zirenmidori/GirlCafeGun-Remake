/**
 * Profile cosmetics of the dress shop's third tab (UI_ShopNew label 102, IBLogic.LABELGIFT):
 * ID-card skins, head frames, player-list marks and chat bubbles, each for Diamonds.
 *
 * Sources: the client tables of the 0.1.3 release (setting.u):
 * - Player/Skin.txt (ID-card skins), HeadFrame.txt, Board.txt (player-list marks) and
 *   Babble.txt (chat bubbles): Type 1 = permanent, Type 2 = timed (LimitTime seconds);
 *   Coverage empty or containing 1 (zh_CN), so every row shows in the client.
 * - resources/item/autouse.txt: the one AutoUse item of the class ItemVisitingCardAuto,
 *   ItemHeadFrameAuto, ItemPlayerListSkinAuto or ItemChatBubbleAuto whose ExtParam1 is the
 *   cosmetic id. Its GDPL is the row's GDPL in PurchaseIBShop (the client draws that item's
 *   small icon), and the owner task group comes from auto-use-item-data.ts.
 *
 * Ids 3001 upward: ID-card skins, head frames, list marks, chat bubbles, each by cosmetic
 * id. Id 0 (the default of every kind) and head frame 1 (granted at login) are not sold.
 *
 * [INFER] Prices (Diamonds): ID-card skin 120, head frame 60, list mark 40, chat bubble 40.
 * No client or capture holds a price for these; they are this build's own numbers.
 *
 * A purchase is permanent. The client treats a Type 2 cosmetic as owned only while
 * `task value + LimitTime > now` (UI_HeadPortrait / UI_SkinSelected IsUnlock), so the server
 * stores `2147483647 - LimitTime` for it (valid until 2038) and the time of purchase for Type 1.
 */

export interface CosmeticShopConfig {
  /** PurchaseIBShop Id; the client sends it as DoRecharge Type 1 Id. */
  readonly id: number;
  /** Diamonds. */
  readonly cost: number;
  readonly kind: "visitingCard" | "headFrame" | "listMark" | "chatBubble";
  /** Skin.txt, HeadFrame.txt, Board.txt or Babble.txt id. */
  readonly cosmeticId: number;
  /** Owner task group: 76, 11, 77 or 78. The task is (group << 16) | cosmeticId. */
  readonly group: number;
  /** 1 = permanent, 2 = timed in the client table. */
  readonly type: 1 | 2;
  /** Seconds of a Type 2 cosmetic, 0 for Type 1. */
  readonly limitTime: number;
  /** The AutoUse item [g, d, p, l] that the shop row sells. */
  readonly item: readonly [number, number, number, number];
}

/** Value of the owner task of a bought Type 2 cosmetic: never expires before 2038. */
export const COSMETIC_NEVER_EXPIRES = 2147483647;

// One row per line: release/client/test_cosmetic_shop.py reads this table.
// prettier-ignore
export const COSMETIC_SHOP: readonly CosmeticShopConfig[] = Object.freeze([
  { id: 3001, cost: 120, kind: "visitingCard", cosmeticId: 1, group: 76, type: 1, limitTime: 0, item: [6, 21, 1, 4] },
  { id: 3002, cost: 120, kind: "visitingCard", cosmeticId: 3, group: 76, type: 1, limitTime: 0, item: [6, 21, 3, 4] },
  { id: 3003, cost: 120, kind: "visitingCard", cosmeticId: 4, group: 76, type: 1, limitTime: 0, item: [6, 21, 4, 4] },
  { id: 3004, cost: 120, kind: "visitingCard", cosmeticId: 5, group: 76, type: 1, limitTime: 0, item: [6, 21, 5, 4] },
  { id: 3005, cost: 120, kind: "visitingCard", cosmeticId: 6, group: 76, type: 1, limitTime: 0, item: [6, 21, 6, 4] },
  { id: 3006, cost: 120, kind: "visitingCard", cosmeticId: 7, group: 76, type: 1, limitTime: 0, item: [6, 21, 7, 4] },
  { id: 3007, cost: 120, kind: "visitingCard", cosmeticId: 8, group: 76, type: 1, limitTime: 0, item: [6, 21, 8, 4] },
  { id: 3008, cost: 120, kind: "visitingCard", cosmeticId: 9, group: 76, type: 1, limitTime: 0, item: [6, 21, 9, 4] },
  { id: 3009, cost: 120, kind: "visitingCard", cosmeticId: 11, group: 76, type: 1, limitTime: 0, item: [6, 21, 11, 4] },
  { id: 3010, cost: 120, kind: "visitingCard", cosmeticId: 12, group: 76, type: 1, limitTime: 0, item: [6, 21, 12, 4] },
  { id: 3011, cost: 120, kind: "visitingCard", cosmeticId: 13, group: 76, type: 1, limitTime: 0, item: [6, 21, 13, 4] },
  { id: 3012, cost: 120, kind: "visitingCard", cosmeticId: 14, group: 76, type: 1, limitTime: 0, item: [6, 21, 14, 4] },
  { id: 3013, cost: 120, kind: "visitingCard", cosmeticId: 15, group: 76, type: 1, limitTime: 0, item: [6, 21, 15, 4] },
  { id: 3014, cost: 120, kind: "visitingCard", cosmeticId: 16, group: 76, type: 1, limitTime: 0, item: [6, 21, 16, 4] },
  { id: 3015, cost: 120, kind: "visitingCard", cosmeticId: 17, group: 76, type: 1, limitTime: 0, item: [6, 21, 17, 4] },
  { id: 3016, cost: 120, kind: "visitingCard", cosmeticId: 18, group: 76, type: 1, limitTime: 0, item: [6, 21, 18, 4] },
  { id: 3017, cost: 120, kind: "visitingCard", cosmeticId: 19, group: 76, type: 1, limitTime: 0, item: [6, 21, 19, 4] },
  { id: 3018, cost: 120, kind: "visitingCard", cosmeticId: 20, group: 76, type: 1, limitTime: 0, item: [6, 21, 20, 4] },
  { id: 3019, cost: 120, kind: "visitingCard", cosmeticId: 103, group: 76, type: 1, limitTime: 0, item: [6, 21, 103, 4] },
  { id: 3020, cost: 60, kind: "headFrame", cosmeticId: 2, group: 11, type: 1, limitTime: 0, item: [6, 28, 1, 4] },
  { id: 3021, cost: 60, kind: "headFrame", cosmeticId: 3, group: 11, type: 1, limitTime: 0, item: [6, 28, 2, 4] },
  { id: 3022, cost: 60, kind: "headFrame", cosmeticId: 4, group: 11, type: 1, limitTime: 0, item: [6, 28, 3, 4] },
  { id: 3023, cost: 60, kind: "headFrame", cosmeticId: 5, group: 11, type: 1, limitTime: 0, item: [6, 28, 4, 4] },
  { id: 3024, cost: 60, kind: "headFrame", cosmeticId: 6, group: 11, type: 1, limitTime: 0, item: [6, 28, 5, 4] },
  { id: 3025, cost: 60, kind: "headFrame", cosmeticId: 7, group: 11, type: 1, limitTime: 0, item: [6, 28, 6, 4] },
  { id: 3026, cost: 60, kind: "headFrame", cosmeticId: 8, group: 11, type: 1, limitTime: 0, item: [6, 28, 7, 4] },
  { id: 3027, cost: 60, kind: "headFrame", cosmeticId: 9, group: 11, type: 1, limitTime: 0, item: [6, 28, 8, 4] },
  { id: 3028, cost: 60, kind: "headFrame", cosmeticId: 11, group: 11, type: 1, limitTime: 0, item: [6, 28, 12, 4] },
  { id: 3029, cost: 60, kind: "headFrame", cosmeticId: 13, group: 11, type: 1, limitTime: 0, item: [6, 28, 14, 4] },
  { id: 3030, cost: 60, kind: "headFrame", cosmeticId: 14, group: 11, type: 2, limitTime: 604801, item: [6, 28, 15, 4] },
  { id: 3031, cost: 60, kind: "headFrame", cosmeticId: 15, group: 11, type: 1, limitTime: 0, item: [6, 28, 16, 4] },
  { id: 3032, cost: 60, kind: "headFrame", cosmeticId: 20, group: 11, type: 2, limitTime: 1209600, item: [6, 28, 20, 4] },
  { id: 3033, cost: 60, kind: "headFrame", cosmeticId: 21, group: 11, type: 2, limitTime: 1209600, item: [6, 28, 21, 4] },
  { id: 3034, cost: 60, kind: "headFrame", cosmeticId: 22, group: 11, type: 2, limitTime: 1209600, item: [6, 28, 22, 4] },
  { id: 3035, cost: 60, kind: "headFrame", cosmeticId: 23, group: 11, type: 2, limitTime: 1209600, item: [6, 28, 23, 4] },
  { id: 3036, cost: 60, kind: "headFrame", cosmeticId: 24, group: 11, type: 2, limitTime: 1209600, item: [6, 28, 24, 4] },
  { id: 3037, cost: 60, kind: "headFrame", cosmeticId: 25, group: 11, type: 2, limitTime: 1209600, item: [6, 28, 25, 4] },
  { id: 3038, cost: 60, kind: "headFrame", cosmeticId: 30, group: 11, type: 1, limitTime: 0, item: [6, 28, 30, 4] },
  { id: 3039, cost: 60, kind: "headFrame", cosmeticId: 31, group: 11, type: 1, limitTime: 0, item: [6, 28, 31, 4] },
  { id: 3040, cost: 60, kind: "headFrame", cosmeticId: 32, group: 11, type: 1, limitTime: 0, item: [6, 28, 32, 4] },
  { id: 3041, cost: 60, kind: "headFrame", cosmeticId: 33, group: 11, type: 1, limitTime: 0, item: [6, 28, 33, 4] },
  { id: 3042, cost: 60, kind: "headFrame", cosmeticId: 34, group: 11, type: 1, limitTime: 0, item: [6, 28, 34, 4] },
  { id: 3043, cost: 60, kind: "headFrame", cosmeticId: 35, group: 11, type: 1, limitTime: 0, item: [6, 28, 35, 4] },
  { id: 3044, cost: 60, kind: "headFrame", cosmeticId: 36, group: 11, type: 1, limitTime: 0, item: [6, 28, 27, 4] },
  { id: 3045, cost: 60, kind: "headFrame", cosmeticId: 37, group: 11, type: 1, limitTime: 0, item: [6, 28, 37, 4] },
  { id: 3046, cost: 60, kind: "headFrame", cosmeticId: 38, group: 11, type: 1, limitTime: 0, item: [6, 28, 38, 4] },
  { id: 3047, cost: 60, kind: "headFrame", cosmeticId: 39, group: 11, type: 1, limitTime: 0, item: [6, 28, 39, 4] },
  { id: 3048, cost: 60, kind: "headFrame", cosmeticId: 40, group: 11, type: 1, limitTime: 0, item: [6, 28, 40, 4] },
  { id: 3049, cost: 60, kind: "headFrame", cosmeticId: 42, group: 11, type: 1, limitTime: 0, item: [6, 28, 42, 4] },
  { id: 3050, cost: 60, kind: "headFrame", cosmeticId: 43, group: 11, type: 1, limitTime: 0, item: [6, 28, 43, 4] },
  { id: 3051, cost: 60, kind: "headFrame", cosmeticId: 44, group: 11, type: 1, limitTime: 0, item: [6, 28, 44, 4] },
  { id: 3052, cost: 60, kind: "headFrame", cosmeticId: 45, group: 11, type: 1, limitTime: 0, item: [6, 28, 45, 4] },
  { id: 3053, cost: 60, kind: "headFrame", cosmeticId: 46, group: 11, type: 1, limitTime: 0, item: [6, 28, 46, 4] },
  { id: 3054, cost: 60, kind: "headFrame", cosmeticId: 47, group: 11, type: 1, limitTime: 0, item: [6, 28, 47, 4] },
  { id: 3055, cost: 60, kind: "headFrame", cosmeticId: 48, group: 11, type: 1, limitTime: 0, item: [6, 28, 48, 4] },
  { id: 3056, cost: 60, kind: "headFrame", cosmeticId: 49, group: 11, type: 1, limitTime: 0, item: [6, 28, 49, 4] },
  { id: 3057, cost: 60, kind: "headFrame", cosmeticId: 50, group: 11, type: 1, limitTime: 0, item: [6, 28, 50, 4] },
  { id: 3058, cost: 60, kind: "headFrame", cosmeticId: 51, group: 11, type: 1, limitTime: 0, item: [6, 28, 51, 4] },
  { id: 3059, cost: 60, kind: "headFrame", cosmeticId: 52, group: 11, type: 1, limitTime: 0, item: [6, 28, 52, 4] },
  { id: 3060, cost: 60, kind: "headFrame", cosmeticId: 55, group: 11, type: 1, limitTime: 0, item: [6, 28, 55, 4] },
  { id: 3061, cost: 60, kind: "headFrame", cosmeticId: 56, group: 11, type: 2, limitTime: 2592001, item: [6, 28, 56, 4] },
  { id: 3062, cost: 60, kind: "headFrame", cosmeticId: 57, group: 11, type: 2, limitTime: 2592001, item: [6, 28, 57, 4] },
  { id: 3063, cost: 60, kind: "headFrame", cosmeticId: 58, group: 11, type: 2, limitTime: 2592001, item: [6, 28, 58, 4] },
  { id: 3064, cost: 60, kind: "headFrame", cosmeticId: 59, group: 11, type: 1, limitTime: 0, item: [6, 28, 59, 4] },
  { id: 3065, cost: 60, kind: "headFrame", cosmeticId: 61, group: 11, type: 1, limitTime: 0, item: [6, 28, 61, 4] },
  { id: 3066, cost: 60, kind: "headFrame", cosmeticId: 63, group: 11, type: 2, limitTime: 2592001, item: [6, 28, 63, 4] },
  { id: 3067, cost: 60, kind: "headFrame", cosmeticId: 64, group: 11, type: 1, limitTime: 0, item: [6, 28, 64, 4] },
  { id: 3068, cost: 60, kind: "headFrame", cosmeticId: 65, group: 11, type: 1, limitTime: 0, item: [6, 28, 65, 4] },
  { id: 3069, cost: 60, kind: "headFrame", cosmeticId: 67, group: 11, type: 2, limitTime: 5184001, item: [6, 28, 67, 4] },
  { id: 3070, cost: 60, kind: "headFrame", cosmeticId: 68, group: 11, type: 1, limitTime: 0, item: [6, 28, 68, 4] },
  { id: 3071, cost: 60, kind: "headFrame", cosmeticId: 69, group: 11, type: 1, limitTime: 0, item: [6, 28, 69, 4] },
  { id: 3072, cost: 60, kind: "headFrame", cosmeticId: 70, group: 11, type: 1, limitTime: 0, item: [6, 28, 70, 4] },
  { id: 3073, cost: 60, kind: "headFrame", cosmeticId: 71, group: 11, type: 1, limitTime: 0, item: [6, 28, 71, 4] },
  { id: 3074, cost: 60, kind: "headFrame", cosmeticId: 72, group: 11, type: 1, limitTime: 0, item: [6, 28, 72, 4] },
  { id: 3075, cost: 60, kind: "headFrame", cosmeticId: 73, group: 11, type: 1, limitTime: 0, item: [6, 28, 73, 4] },
  { id: 3076, cost: 60, kind: "headFrame", cosmeticId: 74, group: 11, type: 2, limitTime: 2592001, item: [6, 28, 74, 4] },
  { id: 3077, cost: 60, kind: "headFrame", cosmeticId: 75, group: 11, type: 1, limitTime: 0, item: [6, 28, 75, 4] },
  { id: 3078, cost: 60, kind: "headFrame", cosmeticId: 76, group: 11, type: 1, limitTime: 0, item: [6, 28, 76, 4] },
  { id: 3079, cost: 60, kind: "headFrame", cosmeticId: 77, group: 11, type: 2, limitTime: 2592001, item: [6, 28, 77, 4] },
  { id: 3080, cost: 60, kind: "headFrame", cosmeticId: 78, group: 11, type: 1, limitTime: 0, item: [6, 28, 78, 4] },
  { id: 3081, cost: 60, kind: "headFrame", cosmeticId: 79, group: 11, type: 1, limitTime: 0, item: [6, 28, 79, 4] },
  { id: 3082, cost: 60, kind: "headFrame", cosmeticId: 80, group: 11, type: 1, limitTime: 0, item: [6, 28, 80, 4] },
  { id: 3083, cost: 60, kind: "headFrame", cosmeticId: 101, group: 11, type: 2, limitTime: 604801, item: [6, 28, 101, 4] },
  { id: 3084, cost: 60, kind: "headFrame", cosmeticId: 102, group: 11, type: 2, limitTime: 604801, item: [6, 28, 102, 4] },
  { id: 3085, cost: 60, kind: "headFrame", cosmeticId: 103, group: 11, type: 2, limitTime: 604801, item: [6, 28, 103, 4] },
  { id: 3086, cost: 60, kind: "headFrame", cosmeticId: 104, group: 11, type: 2, limitTime: 604801, item: [6, 28, 104, 4] },
  { id: 3087, cost: 60, kind: "headFrame", cosmeticId: 105, group: 11, type: 2, limitTime: 604801, item: [6, 28, 105, 4] },
  { id: 3088, cost: 60, kind: "headFrame", cosmeticId: 106, group: 11, type: 2, limitTime: 604801, item: [6, 28, 106, 4] },
  { id: 3089, cost: 60, kind: "headFrame", cosmeticId: 107, group: 11, type: 2, limitTime: 604801, item: [6, 28, 107, 4] },
  { id: 3090, cost: 60, kind: "headFrame", cosmeticId: 108, group: 11, type: 2, limitTime: 604801, item: [6, 28, 108, 4] },
  { id: 3091, cost: 60, kind: "headFrame", cosmeticId: 109, group: 11, type: 2, limitTime: 604801, item: [6, 28, 109, 4] },
  { id: 3092, cost: 60, kind: "headFrame", cosmeticId: 110, group: 11, type: 2, limitTime: 604801, item: [6, 28, 110, 4] },
  { id: 3093, cost: 60, kind: "headFrame", cosmeticId: 111, group: 11, type: 2, limitTime: 604801, item: [6, 28, 111, 4] },
  { id: 3094, cost: 60, kind: "headFrame", cosmeticId: 112, group: 11, type: 2, limitTime: 604801, item: [6, 28, 112, 4] },
  { id: 3095, cost: 60, kind: "headFrame", cosmeticId: 113, group: 11, type: 2, limitTime: 604801, item: [6, 28, 113, 4] },
  { id: 3096, cost: 60, kind: "headFrame", cosmeticId: 114, group: 11, type: 2, limitTime: 604801, item: [6, 28, 114, 4] },
  { id: 3097, cost: 60, kind: "headFrame", cosmeticId: 115, group: 11, type: 2, limitTime: 604801, item: [6, 28, 115, 4] },
  { id: 3098, cost: 60, kind: "headFrame", cosmeticId: 116, group: 11, type: 2, limitTime: 604801, item: [6, 28, 116, 4] },
  { id: 3099, cost: 60, kind: "headFrame", cosmeticId: 117, group: 11, type: 2, limitTime: 604801, item: [6, 28, 117, 4] },
  { id: 3100, cost: 60, kind: "headFrame", cosmeticId: 118, group: 11, type: 2, limitTime: 604801, item: [6, 28, 118, 4] },
  { id: 3101, cost: 60, kind: "headFrame", cosmeticId: 119, group: 11, type: 2, limitTime: 604801, item: [6, 28, 119, 4] },
  { id: 3102, cost: 60, kind: "headFrame", cosmeticId: 120, group: 11, type: 2, limitTime: 604801, item: [6, 28, 120, 4] },
  { id: 3103, cost: 60, kind: "headFrame", cosmeticId: 121, group: 11, type: 2, limitTime: 604801, item: [6, 28, 121, 4] },
  { id: 3104, cost: 60, kind: "headFrame", cosmeticId: 122, group: 11, type: 2, limitTime: 604801, item: [6, 28, 122, 4] },
  { id: 3105, cost: 60, kind: "headFrame", cosmeticId: 123, group: 11, type: 2, limitTime: 604801, item: [6, 28, 123, 4] },
  { id: 3106, cost: 60, kind: "headFrame", cosmeticId: 124, group: 11, type: 2, limitTime: 604801, item: [6, 28, 124, 4] },
  { id: 3107, cost: 60, kind: "headFrame", cosmeticId: 125, group: 11, type: 2, limitTime: 604801, item: [6, 28, 125, 4] },
  { id: 3108, cost: 60, kind: "headFrame", cosmeticId: 126, group: 11, type: 2, limitTime: 604801, item: [6, 28, 126, 4] },
  { id: 3109, cost: 60, kind: "headFrame", cosmeticId: 127, group: 11, type: 2, limitTime: 604801, item: [6, 28, 127, 4] },
  { id: 3110, cost: 60, kind: "headFrame", cosmeticId: 128, group: 11, type: 2, limitTime: 604801, item: [6, 28, 128, 4] },
  { id: 3111, cost: 60, kind: "headFrame", cosmeticId: 129, group: 11, type: 2, limitTime: 604801, item: [6, 28, 129, 4] },
  { id: 3112, cost: 60, kind: "headFrame", cosmeticId: 130, group: 11, type: 2, limitTime: 604801, item: [6, 28, 130, 4] },
  { id: 3113, cost: 60, kind: "headFrame", cosmeticId: 131, group: 11, type: 2, limitTime: 604801, item: [6, 28, 131, 4] },
  { id: 3114, cost: 60, kind: "headFrame", cosmeticId: 132, group: 11, type: 2, limitTime: 604801, item: [6, 28, 132, 4] },
  { id: 3115, cost: 60, kind: "headFrame", cosmeticId: 133, group: 11, type: 2, limitTime: 604801, item: [6, 28, 133, 4] },
  { id: 3116, cost: 60, kind: "headFrame", cosmeticId: 134, group: 11, type: 2, limitTime: 604801, item: [6, 28, 134, 4] },
  { id: 3117, cost: 60, kind: "headFrame", cosmeticId: 135, group: 11, type: 2, limitTime: 604801, item: [6, 28, 135, 4] },
  { id: 3118, cost: 60, kind: "headFrame", cosmeticId: 136, group: 11, type: 2, limitTime: 604801, item: [6, 28, 136, 4] },
  { id: 3119, cost: 60, kind: "headFrame", cosmeticId: 137, group: 11, type: 2, limitTime: 604801, item: [6, 28, 137, 4] },
  { id: 3120, cost: 60, kind: "headFrame", cosmeticId: 138, group: 11, type: 2, limitTime: 604801, item: [6, 28, 138, 4] },
  { id: 3121, cost: 60, kind: "headFrame", cosmeticId: 139, group: 11, type: 2, limitTime: 604801, item: [6, 28, 139, 4] },
  { id: 3122, cost: 60, kind: "headFrame", cosmeticId: 140, group: 11, type: 2, limitTime: 604801, item: [6, 28, 140, 4] },
  { id: 3123, cost: 60, kind: "headFrame", cosmeticId: 141, group: 11, type: 2, limitTime: 604801, item: [6, 28, 141, 4] },
  { id: 3124, cost: 60, kind: "headFrame", cosmeticId: 142, group: 11, type: 2, limitTime: 604801, item: [6, 28, 142, 4] },
  { id: 3125, cost: 60, kind: "headFrame", cosmeticId: 143, group: 11, type: 2, limitTime: 604801, item: [6, 28, 143, 4] },
  { id: 3126, cost: 60, kind: "headFrame", cosmeticId: 144, group: 11, type: 2, limitTime: 604801, item: [6, 28, 144, 4] },
  { id: 3127, cost: 60, kind: "headFrame", cosmeticId: 145, group: 11, type: 2, limitTime: 604801, item: [6, 28, 145, 4] },
  { id: 3128, cost: 60, kind: "headFrame", cosmeticId: 146, group: 11, type: 2, limitTime: 604801, item: [6, 28, 146, 4] },
  { id: 3129, cost: 60, kind: "headFrame", cosmeticId: 147, group: 11, type: 2, limitTime: 604801, item: [6, 28, 147, 4] },
  { id: 3130, cost: 60, kind: "headFrame", cosmeticId: 148, group: 11, type: 2, limitTime: 604801, item: [6, 28, 148, 4] },
  { id: 3131, cost: 60, kind: "headFrame", cosmeticId: 149, group: 11, type: 2, limitTime: 604801, item: [6, 28, 149, 4] },
  { id: 3132, cost: 60, kind: "headFrame", cosmeticId: 150, group: 11, type: 2, limitTime: 604801, item: [6, 28, 150, 4] },
  { id: 3133, cost: 40, kind: "listMark", cosmeticId: 1, group: 77, type: 1, limitTime: 0, item: [6, 22, 1, 4] },
  { id: 3134, cost: 40, kind: "listMark", cosmeticId: 3, group: 77, type: 1, limitTime: 0, item: [6, 22, 3, 4] },
  { id: 3135, cost: 40, kind: "listMark", cosmeticId: 4, group: 77, type: 1, limitTime: 0, item: [6, 22, 4, 4] },
  { id: 3136, cost: 40, kind: "listMark", cosmeticId: 5, group: 77, type: 1, limitTime: 0, item: [6, 22, 5, 4] },
  { id: 3137, cost: 40, kind: "listMark", cosmeticId: 6, group: 77, type: 1, limitTime: 0, item: [6, 22, 6, 4] },
  { id: 3138, cost: 40, kind: "listMark", cosmeticId: 7, group: 77, type: 1, limitTime: 0, item: [6, 22, 7, 4] },
  { id: 3139, cost: 40, kind: "listMark", cosmeticId: 8, group: 77, type: 2, limitTime: 2592001, item: [6, 22, 8, 4] },
  { id: 3140, cost: 40, kind: "listMark", cosmeticId: 9, group: 77, type: 1, limitTime: 0, item: [6, 22, 9, 4] },
  { id: 3141, cost: 40, kind: "listMark", cosmeticId: 11, group: 77, type: 1, limitTime: 0, item: [6, 22, 11, 4] },
  { id: 3142, cost: 40, kind: "listMark", cosmeticId: 12, group: 77, type: 1, limitTime: 0, item: [6, 22, 12, 4] },
  { id: 3143, cost: 40, kind: "listMark", cosmeticId: 13, group: 77, type: 1, limitTime: 0, item: [6, 22, 13, 4] },
  { id: 3144, cost: 40, kind: "listMark", cosmeticId: 14, group: 77, type: 1, limitTime: 0, item: [6, 22, 14, 4] },
  { id: 3145, cost: 40, kind: "listMark", cosmeticId: 15, group: 77, type: 1, limitTime: 0, item: [6, 22, 15, 4] },
  { id: 3146, cost: 40, kind: "listMark", cosmeticId: 16, group: 77, type: 1, limitTime: 0, item: [6, 22, 16, 4] },
  { id: 3147, cost: 40, kind: "listMark", cosmeticId: 17, group: 77, type: 1, limitTime: 0, item: [6, 22, 17, 4] },
  { id: 3148, cost: 40, kind: "listMark", cosmeticId: 18, group: 77, type: 1, limitTime: 0, item: [6, 22, 18, 4] },
  { id: 3149, cost: 40, kind: "listMark", cosmeticId: 19, group: 77, type: 1, limitTime: 0, item: [6, 22, 19, 4] },
  { id: 3150, cost: 40, kind: "listMark", cosmeticId: 20, group: 77, type: 1, limitTime: 0, item: [6, 22, 20, 4] },
  { id: 3151, cost: 40, kind: "listMark", cosmeticId: 102, group: 77, type: 1, limitTime: 0, item: [6, 22, 102, 4] },
  { id: 3152, cost: 40, kind: "listMark", cosmeticId: 103, group: 77, type: 1, limitTime: 0, item: [6, 22, 103, 4] },
  { id: 3153, cost: 40, kind: "chatBubble", cosmeticId: 1, group: 78, type: 1, limitTime: 0, item: [6, 23, 1, 4] },
  { id: 3154, cost: 40, kind: "chatBubble", cosmeticId: 3, group: 78, type: 1, limitTime: 0, item: [6, 23, 3, 4] },
  { id: 3155, cost: 40, kind: "chatBubble", cosmeticId: 4, group: 78, type: 1, limitTime: 0, item: [6, 23, 4, 4] },
  { id: 3156, cost: 40, kind: "chatBubble", cosmeticId: 5, group: 78, type: 1, limitTime: 0, item: [6, 23, 5, 4] },
  { id: 3157, cost: 40, kind: "chatBubble", cosmeticId: 6, group: 78, type: 1, limitTime: 0, item: [6, 23, 6, 4] },
  { id: 3158, cost: 40, kind: "chatBubble", cosmeticId: 7, group: 78, type: 1, limitTime: 0, item: [6, 23, 7, 4] },
  { id: 3159, cost: 40, kind: "chatBubble", cosmeticId: 8, group: 78, type: 2, limitTime: 1296001, item: [6, 23, 8, 4] },
  { id: 3160, cost: 40, kind: "chatBubble", cosmeticId: 9, group: 78, type: 1, limitTime: 0, item: [6, 23, 9, 4] },
  { id: 3161, cost: 40, kind: "chatBubble", cosmeticId: 11, group: 78, type: 1, limitTime: 0, item: [6, 23, 11, 4] },
  { id: 3162, cost: 40, kind: "chatBubble", cosmeticId: 12, group: 78, type: 1, limitTime: 0, item: [6, 23, 12, 4] },
  { id: 3163, cost: 40, kind: "chatBubble", cosmeticId: 13, group: 78, type: 1, limitTime: 0, item: [6, 23, 13, 4] },
  { id: 3164, cost: 40, kind: "chatBubble", cosmeticId: 14, group: 78, type: 1, limitTime: 0, item: [6, 23, 14, 4] },
  { id: 3165, cost: 40, kind: "chatBubble", cosmeticId: 15, group: 78, type: 1, limitTime: 0, item: [6, 23, 15, 4] },
  { id: 3166, cost: 40, kind: "chatBubble", cosmeticId: 16, group: 78, type: 1, limitTime: 0, item: [6, 23, 16, 4] },
  { id: 3167, cost: 40, kind: "chatBubble", cosmeticId: 17, group: 78, type: 1, limitTime: 0, item: [6, 23, 17, 4] },
  { id: 3168, cost: 40, kind: "chatBubble", cosmeticId: 18, group: 78, type: 1, limitTime: 0, item: [6, 23, 18, 4] },
  { id: 3169, cost: 40, kind: "chatBubble", cosmeticId: 19, group: 78, type: 1, limitTime: 0, item: [6, 23, 19, 4] },
  { id: 3170, cost: 40, kind: "chatBubble", cosmeticId: 20, group: 78, type: 1, limitTime: 0, item: [6, 23, 20, 4] },
  { id: 3171, cost: 40, kind: "chatBubble", cosmeticId: 101, group: 78, type: 2, limitTime: 604801, item: [6, 23, 101, 4] },
  { id: 3172, cost: 40, kind: "chatBubble", cosmeticId: 102, group: 78, type: 1, limitTime: 0, item: [6, 23, 102, 4] },
  { id: 3173, cost: 40, kind: "chatBubble", cosmeticId: 103, group: 78, type: 1, limitTime: 0, item: [6, 23, 103, 4] },
  { id: 3174, cost: 40, kind: "chatBubble", cosmeticId: 104, group: 78, type: 2, limitTime: 2592001, item: [6, 23, 104, 4] },
  { id: 3175, cost: 40, kind: "chatBubble", cosmeticId: 105, group: 78, type: 1, limitTime: 0, item: [6, 23, 105, 4] },
  { id: 3176, cost: 40, kind: "chatBubble", cosmeticId: 106, group: 78, type: 2, limitTime: 2592001, item: [6, 23, 106, 4] },
  { id: 3177, cost: 40, kind: "chatBubble", cosmeticId: 107, group: 78, type: 2, limitTime: 2592001, item: [6, 23, 107, 4] },
  { id: 3178, cost: 40, kind: "chatBubble", cosmeticId: 108, group: 78, type: 1, limitTime: 0, item: [6, 23, 108, 4] },
  { id: 3179, cost: 40, kind: "chatBubble", cosmeticId: 109, group: 78, type: 1, limitTime: 0, item: [6, 23, 109, 4] },
  { id: 3180, cost: 40, kind: "chatBubble", cosmeticId: 110, group: 78, type: 2, limitTime: 2592001, item: [6, 23, 110, 4] },
  { id: 3181, cost: 40, kind: "chatBubble", cosmeticId: 112, group: 78, type: 1, limitTime: 0, item: [6, 23, 112, 4] },
]);

const BY_ID = new Map(COSMETIC_SHOP.map((row) => [row.id, row]));

export function cosmeticShopRow(id: number): CosmeticShopConfig | undefined {
  return BY_ID.get(id);
}
