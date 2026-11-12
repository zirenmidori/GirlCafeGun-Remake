import type { CafeCatalog, CafeFurnitureConfig } from "./cafe-catalog.js";
import { nextCafeFurnitureObjectId } from "./cafe-furniture-data.js";
import {
  CafeOperationError,
  cafeComfort,
  type CafeRuntimeHooks,
  type CafeRuntimeResult,
} from "./cafe-runtime.js";
import type { HouseThemeState } from "./house-data.js";
import { isNativeFixedHouseObjectId } from "./house-data.js";
import {
  ShopCatalog,
  isGoodsInWindow,
  nextPriceIndex,
  shopOperationalDate,
  shopOperationalWeek,
  unitPrice,
} from "./shop-data.js";
import type {
  CafeFurnitureState,
  Player,
  ShopState,
} from "../persistence/player-repository.js";

export const CAFE_FURNITURE_SHOP_ID = 40_001;
export const CAFE_FURNITURE_CAPACITY = 2_000; // CoffeeCommon.STORE_CAPACITY
const MAX_BATCH = 100;
let defaultShop: ShopCatalog | undefined;
function shops(): ShopCatalog {
  return (defaultShop ??= ShopCatalog.loadDefault());
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function request(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function key(gdpl: readonly number[]): string {
  return gdpl.slice(0, 4).join("-");
}
function ownedItems(player: Player): CafeFurnitureState[] {
  return (player.cafe.furniture ?? []).filter(
    (item) => !isNativeFixedHouseObjectId(item.objId),
  );
}
function itemStock(player: Player, gdpl: readonly number[]): number {
  return player.inventory
    .filter(
      (item) =>
        key([item.genre, item.detail, item.particular, item.templateLevel]) ===
        key(gdpl),
    )
    .reduce((sum, item) => sum + item.count, 0);
}
function furnitureConfig(
  catalog: CafeCatalog,
  id: number,
  command: number,
): CafeFurnitureConfig {
  const config = catalog.furniture(id);
  if (
    !positive(id) ||
    !config ||
    config.ItemInfo.length !== 4 ||
    config.ItemInfo[0] !== 11 ||
    config.OwnMax <= 0
  )
    throw new CafeOperationError("furniture_not_acquirable", command);
  return config;
}
function planFurniture(
  player: Player,
  templateIds: readonly number[],
  catalog: CafeCatalog,
  command: number,
): Map<number, number> {
  if (templateIds.length === 0 || templateIds.length > CAFE_FURNITURE_CAPACITY)
    throw new CafeOperationError("invalid_furniture_count", command);
  const counts = new Map<number, number>();
  for (const id of templateIds) {
    furnitureConfig(catalog, id, command);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const owned = ownedItems(player);
  if (owned.length + templateIds.length > CAFE_FURNITURE_CAPACITY)
    throw new CafeOperationError("furniture_capacity", command);
  for (const [id, count] of counts) {
    const config = furnitureConfig(catalog, id, command);
    if (owned.filter((item) => item.templateId === id).length + count > config.OwnMax)
      throw new CafeOperationError("furniture_own_limit", command);
  }
  return counts;
}

/**
 * Convert already-owned genre11 acquisition items into physical house objects.
 * The caller supplies an atomic player draft and its inventory hooks. Neither a
 * template ID nor a repeated native request grants free furniture.
 */
export function materializeCafeFurniture(
  player: Player,
  templateIds: readonly number[],
  catalog: CafeCatalog,
  hooks: Pick<CafeRuntimeHooks, "consumeItem">,
): CafeFurnitureState[] {
  const counts = planFurniture(player, templateIds, catalog, 1050);
  const needed = new Map<string, { gdpl: readonly number[]; count: number }>();
  for (const [id, count] of counts) {
    const gdpl = furnitureConfig(catalog, id, 1050).ItemInfo,
      k = key(gdpl),
      row = needed.get(k);
    if (row) row.count += count;
    else needed.set(k, { gdpl, count });
  }
  for (const row of needed.values())
    if (itemStock(player, row.gdpl) < row.count)
      throw new CafeOperationError("furniture_item_not_owned", 1050);
  const all = (player.cafe.furniture ??= []);
  let next = nextCafeFurnitureObjectId(all);
  if (next + templateIds.length - 1 > 0xffff_ffff)
    throw new CafeOperationError("furniture_id_exhausted", 1050);
  for (const row of needed.values()) hooks.consumeItem(row.gdpl, row.count);
  const result = templateIds.map((templateId): CafeFurnitureState => ({
    templateId,
    objId: next++,
    parentId: 0,
    roomId: 0,
    pose: { templateId, parentTemplateId: 0, place: 0, posX: 0, posY: 0, rotate: 0 },
    status: 0,
    isNew: true,
    bizcount: 0,
  }));
  all.push(...result);
  return result;
}

/**
 * Only the fixed café furniture shop is handled here. Other shops keep their
 * existing purchase path. Prices and limits come from the exact shared tables;
 * OnOff2 means café shop in ShopTabLogicC, rather than a disabled tab.
 */
export class CafeFurnitureCommerce {
  readonly updatedFurniture: CafeFurnitureState[] = [];
  readonly updatedThemes: HouseThemeState[] = [];
  readonly now: number;
  constructor(
    readonly player: Player,
    readonly catalog: CafeCatalog,
    readonly nowMs: number,
    readonly hooks: CafeRuntimeHooks,
    readonly shop: ShopCatalog = shops(),
  ) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0)
      throw new CafeOperationError("invalid_clock", 14);
    this.now = Math.floor(nowMs / 1_000);
  }
  private byItem(gdpl: readonly number[]): CafeFurnitureConfig {
    const matches = this.catalog
      .furnitureItems()
      .filter((row) => row.ItemInfo.length === 4 && key(row.ItemInfo) === key(gdpl));
    if (matches.length !== 1)
      throw new CafeOperationError("ambiguous_furniture_item", 14);
    return furnitureConfig(this.catalog, matches[0]!.Id, 14);
  }
  private purchase(
    values: readonly unknown[],
  ): { ret: true; shopid: number; goodsid: number; buynum: number }[] {
    if (values.length === 0 || values.length > MAX_BATCH)
      throw new CafeOperationError("invalid_furniture_batch", 14);
    const tab = this.shop.getTab(CAFE_FURNITURE_SHOP_ID);
    if (
      !tab ||
      ![1, 2].includes(tab.onOff) ||
      tab.refreshRule === 1 ||
      (tab.begin !== null && this.now < tab.begin) ||
      (tab.end !== null && this.now > tab.end)
    )
      throw new CafeOperationError("furniture_shop_closed", 14);
    const period = shopOperationalDate(this.nowMs),
      week = shopOperationalWeek(this.nowMs);
    const state: ShopState = structuredClone(
      this.player.shops?.[String(CAFE_FURNITURE_SHOP_ID)] ?? {
        operationalDate: period,
        weekId: week,
        refreshCount: 0,
        shelfKey: null,
        shelf: [],
        counters: {},
      },
    );
    if (state.operationalDate !== period) {
      state.operationalDate = period;
      state.refreshCount = 0;
      for (const c of Object.values(state.counters)) c.daily = 0;
    }
    if (state.weekId !== week) {
      state.weekId = week;
      for (const c of Object.values(state.counters)) c.week = 0;
    }
    const plans: {
      config: CafeFurnitureConfig;
      gdpl: [number, number, number, number, number];
      count: number;
    }[] = [];
    const costs = new Map<number, number>(),
      response: { ret: true; shopid: number; goodsid: number; buynum: number }[] = [];
    const ids: number[] = [];
    for (const value of values) {
      const row = request(value),
        goodsId = row.goodsid,
        buy = row.buynum;
      if (
        row.shopid !== CAFE_FURNITURE_SHOP_ID ||
        !positive(goodsId) ||
        !positive(buy) ||
        buy > 99
      )
        throw new CafeOperationError("invalid_furniture_purchase", 14);
      const goods = this.shop.getGoods(goodsId);
      if (
        !goods ||
        goods.shopId !== CAFE_FURNITURE_SHOP_ID ||
        goods.genre !== 11 ||
        !isGoodsInWindow(goods, this.now) ||
        !positive(goods.goodsNum)
      )
        throw new CafeOperationError("invalid_furniture_goods", 14);
      const config = this.byItem([
        goods.genre,
        goods.detail,
        goods.particular,
        goods.templateLevel,
      ]);
      const counters = (state.counters[String(goodsId)] ??= {
        daily: 0,
        week: 0,
        total: 0,
        shelf: 0,
      });
      if (goods.refreshLimitNum !== null)
        throw new CafeOperationError("unsupported_furniture_shelf", 14);
      for (const [limit, used] of [
        [goods.dailyLimitNum, counters.daily],
        [goods.weekLimitNum, counters.week],
        [goods.totalLimitNum, counters.total],
        [goods.shelfLifeLmt, counters.shelf],
      ] as const)
        if (limit !== null && used + buy > limit)
          throw new CafeOperationError("furniture_purchase_limit", 14);
      const priceIndex = nextPriceIndex(goods, {
        shelfBuyNum: goods.shelfLifeLmt ? counters.shelf : undefined,
        totalBuyNum: goods.totalLimitNum ? counters.total : undefined,
        weekBuyNum: goods.weekLimitNum ? counters.week : undefined,
        dailyBuyNum: goods.dailyLimitNum ? counters.daily : undefined,
        buyNum: counters.total,
      });
      const cost =
          unitPrice(goods, priceIndex, goods.discountList[0]?.discount ?? 100) * buy,
        count = goods.goodsNum * buy;
      if (!Number.isSafeInteger(cost) || cost < 0 || !positive(count))
        throw new CafeOperationError("invalid_furniture_price", 14);
      costs.set(goods.moneyType, (costs.get(goods.moneyType) ?? 0) + cost);
      ids.push(...Array.from({ length: count }, () => config.Id));
      if (ids.length > CAFE_FURNITURE_CAPACITY)
        throw new CafeOperationError("furniture_capacity", 14);
      plans.push({
        config,
        gdpl: [goods.genre, goods.detail, goods.particular, goods.templateLevel, count],
        count,
      });
      counters.daily += buy;
      counters.week += buy;
      counters.total += buy;
      counters.shelf += buy;
      response.push({
        ret: true,
        shopid: CAFE_FURNITURE_SHOP_ID,
        goodsid: goodsId,
        buynum: buy,
      });
    }
    planFurniture(this.player, ids, this.catalog, 14);
    for (const [money, cost] of costs)
      if (cost > 0) this.hooks.chargeMoney(money, cost);
    this.hooks.grant(plans.map((plan) => plan.gdpl));
    this.updatedFurniture.push(
      ...materializeCafeFurniture(this.player, ids, this.catalog, this.hooks),
    );
    this.player.shops ??= {};
    this.player.shops[String(CAFE_FURNITURE_SHOP_ID)] = state;
    return response;
  }
  buyPredefinedTheme(
    templateThemeId: number,
    clientTemplateIds?: readonly number[],
  ): { theme: HouseThemeState; furniture: CafeFurnitureState[] } {
    const existing = this.player.cafe.themes?.find(
      (theme) => theme.templateThemeId === templateThemeId,
    );
    if (existing) return { theme: existing, furniture: [] };
    const config = this.catalog.theme(templateThemeId);
    if (
      !positive(templateThemeId) ||
      !config ||
      config.CanSell !== 1 ||
      ![1, 2, 6].includes(config.Area)
    )
      throw new CafeOperationError("theme_not_for_sale", 126);
    const required = new Map<number, number>();
    for (const pose of config.poses) {
      furnitureConfig(this.catalog, pose.templateId, 126);
      required.set(pose.templateId, (required.get(pose.templateId) ?? 0) + 1);
    }
    if (
      clientTemplateIds !== undefined &&
      (clientTemplateIds.length > CAFE_FURNITURE_CAPACITY ||
        clientTemplateIds.some((id) => !required.has(id)))
    )
      throw new CafeOperationError("invalid_theme_furniture", 126);
    const before = this.updatedFurniture.length,
      purchases: unknown[] = [],
      tokens: number[] = [];
    for (const [id, count] of required) {
      const missing = Math.max(
        0,
        count - ownedItems(this.player).filter((item) => item.templateId === id).length,
      );
      if (!missing) continue;
      const item = furnitureConfig(this.catalog, id, 126),
        ownedTokens = Math.min(missing, itemStock(this.player, item.ItemInfo));
      tokens.push(...Array.from({ length: ownedTokens }, () => id));
      const buy = missing - ownedTokens;
      if (!buy) continue;
      const goods = this.shop
        .goodsForShop(CAFE_FURNITURE_SHOP_ID)
        .find(
          (goods) =>
            goods.genre === 11 &&
            key([goods.genre, goods.detail, goods.particular, goods.templateLevel]) ===
              key(item.ItemInfo) &&
            goods.goodsNum === 1 &&
            isGoodsInWindow(goods, this.now),
        );
      if (!goods) throw new CafeOperationError("theme_furniture_not_for_sale", 126);
      purchases.push({
        shopid: CAFE_FURNITURE_SHOP_ID,
        goodsid: goods.goodsId,
        buynum: buy,
      });
    }
    if (purchases.length) this.purchase(purchases);
    if (tokens.length)
      this.updatedFurniture.push(
        ...materializeCafeFurniture(this.player, tokens, this.catalog, this.hooks),
      );
    const themes = (this.player.cafe.themes ??= []);
    if (themes.length >= 100) throw new CafeOperationError("theme_capacity", 126);
    const themeId = Math.max(0, ...themes.map((theme) => theme.themeId)) + 1;
    if (!positive(themeId) || themeId > 0xffff_ffff)
      throw new CafeOperationError("theme_id_exhausted", 126);
    const theme: HouseThemeState = {
      themeId,
      templateThemeId,
      name: config.raw.Name ?? "",
      poses: config.poses.map((pose) => ({ ...pose, place: 0 })),
      newGenerate: true,
      roomtype: config.Area,
      createtime: this.now,
    };
    themes.push(theme);
    this.updatedThemes.push(theme);
    return { theme, furniture: this.updatedFurniture.slice(before) };
  }
  operate(command: number, parameters: unknown): CafeRuntimeResult | null {
    let response: unknown;
    if (command === 14) {
      if (!Array.isArray(parameters) || parameters.length === 0)
        throw new CafeOperationError("invalid_furniture_batch", command);
      if (parameters.every((row) => request(row).shopid !== CAFE_FURNITURE_SHOP_ID))
        return null;
      response = this.purchase(parameters);
    } else if (command === 126) {
      const row = request(parameters);
      if (!positive(row.themeid))
        throw new CafeOperationError("invalid_theme", command);
      if (
        row.furidlist !== undefined &&
        (!Array.isArray(row.furidlist) || row.furidlist.some((id) => !positive(id)))
      )
        throw new CafeOperationError("invalid_theme_furniture", command);
      this.buyPredefinedTheme(row.themeid, row.furidlist as number[] | undefined);
      response = "buy_theme_succeed";
    } else if (command === 127) {
      const id = request(parameters).themeID;
      if (!positive(id) || !this.catalog.theme(id))
        throw new CafeOperationError("invalid_theme", command);
      response = this.player.cafe.themes?.some((theme) => theme.templateThemeId === id)
        ? "true"
        : "false";
    } else if (command === 137) {
      const ids = request(parameters).objIds;
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.length > 40 ||
        ids.some((id) => !positive(id)) ||
        new Set(ids).size !== ids.length
      )
        throw new CafeOperationError("invalid_recycle_list", command);
      const all = this.player.cafe.furniture ?? [],
        selected = all.filter((item) => ids.includes(item.objId));
      if (
        selected.length !== ids.length ||
        selected.some(
          (item) =>
            isNativeFixedHouseObjectId(item.objId) ||
            item.roomId !== 0 ||
            item.parentId !== 0 ||
            item.pose.parentTemplateId !== 0 ||
            all.some((child) => child.parentId === item.objId) ||
            (this.catalog.furniture(item.templateId)?.SellPrice ?? 0) <= 0,
        )
      )
        throw new CafeOperationError("furniture_not_recyclable", command);
      const amount = selected.reduce(
        (sum, item) => sum + this.catalog.furniture(item.templateId)!.SellPrice,
        0,
      );
      if (!Number.isSafeInteger(amount))
        throw new CafeOperationError("invalid_recycle_value", command);
      this.hooks.grant([[15, 10, 1, 1, amount]]); // ItemCoffeeCoinAuto -> wallet7
      this.player.cafe.furniture = all.filter((item) => !ids.includes(item.objId));
      response = { objId: ids, comfort: cafeComfort(this.player, this.catalog) };
    } else return null;
    return { response, notifications: [] };
  }
}
