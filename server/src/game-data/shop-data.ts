import path from "node:path";
import { readFileSync } from "node:fs";

import { bountyOperationalDate } from "./bounty-data.js";

export const LUA_COMMAND_SHOP_GOODS_LIST = 11;
export const LUA_COMMAND_SHOP_REFRESH_GOODS_LIST = 12;
export const LUA_COMMAND_SHOP_BUY_GOODS = 13;

export const SHOP_ERROR_UNKNOWN = "Error.20074";
export const SHOP_ERROR_LIMIT = "Error.20075";
export const SHOP_ERROR_INSUFFICIENT_FUNDS = "Error.20013";

export interface ShopTabConfig {
  shopId: number;
  onOff: number;
  columns: number;
  refreshRule: number;
  refreshTimes: number[];
  refreshFees: number[];
  refreshMoneyType: number;
  refreshLimits: number;
  begin: number | null;
  end: number | null;
}

export interface DiscountEntry {
  weight: number;
  discount: number;
}

export interface GoodsConfig {
  shopType: number;
  shopId: number;
  goodsId: number;
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  goodsNum: number;
  group: string;
  weight: number;
  moneyType: number;
  sellingPrice: number[];
  refreshLimitNum: number | null;
  dailyLimitNum: number | null;
  weekLimitNum: number | null;
  totalLimitNum: number | null;
  shelfLifeLmt: number | null;
  promotion: number;
  discountList: DiscountEntry[];
  begin: number | null;
  end: number | null;
  dayIndex: number;
  needCafeLevel: number;
}

function splitRows(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .slice(3)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
}

function parseIntOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseShanghaiTime(value: string | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 12) return null;
  const year = Number.parseInt(digits.slice(0, 4), 10);
  const month = Number.parseInt(digits.slice(4, 6), 10);
  const day = Number.parseInt(digits.slice(6, 8), 10);
  const hour = Number.parseInt(digits.slice(8, 10), 10);
  const minute = Number.parseInt(digits.slice(10, 12), 10);
  const second = digits.length >= 14 ? Number.parseInt(digits.slice(12, 14), 10) : 0;
  if ([year, month, day, hour, minute, second].some((part) => !Number.isFinite(part))) {
    return null;
  }
  return Math.floor(Date.UTC(year, month - 1, day, hour - 8, minute, second) / 1_000);
}

function parseNumList(value: string | undefined, separator: RegExp): number[] {
  if (!value) return [];
  return value
    .replace(/[[\]{\s]/g, "")
    .split(separator)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function parseSecondsOfDay(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split("|")
    .map((part) => part.replace(/[^0-9]/g, ""))
    .filter((part) => part.length >= 4)
    .map((part) => {
      const padded = part.padStart(6, "0");
      return (
        Number.parseInt(padded.slice(0, 2), 10) * 3_600 +
        Number.parseInt(padded.slice(2, 4), 10) * 60 +
        Number.parseInt(padded.slice(4, 6), 10)
      );
    });
}

function parsePrice(value: string | undefined): {
  moneyType: number;
  prices: number[];
} | null {
  if (!value) return null;
  const cleaned = value.replace(/[[\]\s]/g, "");
  const [moneyPart, pricePart] = cleaned.split("|");
  const moneyType = Number.parseInt(moneyPart ?? "", 10);
  if (!Number.isFinite(moneyType)) return null;
  const prices = (pricePart ?? "")
    .split(",")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  if (prices.length === 0) return null;
  return { moneyType, prices };
}

function parseDiscountList(value: string | undefined): DiscountEntry[] {
  const cleaned = (value ?? "").replace(/[[\]\s]/g, "");
  if (!cleaned) return [{ weight: 100, discount: 100 }];
  const entries = cleaned
    .split(",")
    .map((pair) => {
      const [weight, discount] = pair.split("-");
      return {
        weight: Number.parseInt(weight ?? "", 10),
        discount: Number.parseInt(discount ?? "", 10),
      };
    })
    .filter(
      (entry) =>
        Number.isFinite(entry.weight) &&
        Number.isFinite(entry.discount) &&
        entry.weight > 0,
    );
  return entries.length > 0 ? entries : [{ weight: 100, discount: 100 }];
}

function parseGdplnx(value: string | undefined): {
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  goodsNum: number;
} | null {
  const parts = parseNumList(value, /-/);
  if (parts.length < 5) return null;
  return {
    genre: parts[0]!,
    detail: parts[1]!,
    particular: parts[2]!,
    templateLevel: parts[3]!,
    goodsNum: parts[4]!,
  };
}

export function parseShopTabs(content: string): Map<number, ShopTabConfig> {
  const tabs = new Map<number, ShopTabConfig>();
  for (const columns of splitRows(content)) {
    const shopId = parseIntOrNull(columns[0]);
    if (shopId === null) continue;
    tabs.set(shopId, {
      shopId,
      onOff: parseIntOrNull(columns[3]) ?? 0,
      columns: parseIntOrNull(columns[6]) ?? 0,
      refreshRule: parseIntOrNull(columns[7]) ?? 0,
      refreshTimes: parseSecondsOfDay(columns[8]),
      refreshFees: parseNumList(columns[9], /\|/),
      refreshMoneyType: parseIntOrNull(columns[10]) ?? 3,
      refreshLimits: parseIntOrNull(columns[11]) ?? 0,
      begin: parseShanghaiTime(columns[4]),
      end: parseShanghaiTime(columns[5]),
    });
  }
  return tabs;
}

export function parseGoods(content: string): Map<number, GoodsConfig> {
  const goods = new Map<number, GoodsConfig>();
  for (const columns of splitRows(content)) {
    const goodsId = parseIntOrNull(columns[2]);
    const gdplnx = parseGdplnx(columns[3]);
    const price = parsePrice(columns[7]);
    if (goodsId === null || !gdplnx || !price) continue;
    goods.set(goodsId, {
      shopType: parseIntOrNull(columns[0]) ?? 0,
      shopId: parseIntOrNull(columns[1]) ?? 0,
      goodsId,
      ...gdplnx,
      group: (columns[5] ?? "").replace(/[[\]]/g, ""),
      weight: parseIntOrNull(columns[6]) ?? 0,
      moneyType: price.moneyType,
      sellingPrice: price.prices,
      refreshLimitNum: parseIntOrNull(columns[9]),
      dailyLimitNum: parseIntOrNull(columns[10]),
      weekLimitNum: parseIntOrNull(columns[11]),
      totalLimitNum: parseIntOrNull(columns[12]),
      shelfLifeLmt: parseIntOrNull(columns[13]),
      promotion: parseIntOrNull(columns[14]) ?? 0,
      discountList: parseDiscountList(columns[15]),
      begin: parseShanghaiTime(columns[16]),
      end: parseShanghaiTime(columns[17]),
      dayIndex: parseIntOrNull(columns[18]) ?? 0,
      needCafeLevel: parseIntOrNull(columns[19]) ?? 0,
    });
  }
  return goods;
}

export class ShopCatalog {
  readonly #tabs: Map<number, ShopTabConfig>;
  readonly #goods: Map<number, GoodsConfig>;
  readonly #goodsByShop: Map<number, GoodsConfig[]>;

  constructor(tabs: Map<number, ShopTabConfig>, goods: Map<number, GoodsConfig>) {
    this.#tabs = tabs;
    this.#goods = goods;
    this.#goodsByShop = new Map();
    for (const config of goods.values()) {
      const list = this.#goodsByShop.get(config.shopId) ?? [];
      list.push(config);
      this.#goodsByShop.set(config.shopId, list);
    }
  }

  static loadDefault(): ShopCatalog {
    const root = path.resolve(process.cwd(), "resources/shop");
    return new ShopCatalog(
      parseShopTabs(readFileSync(path.join(root, "shoptabs.txt"), "utf8")),
      parseGoods(readFileSync(path.join(root, "goods.txt"), "utf8")),
    );
  }

  getTab(shopId: number): ShopTabConfig | null {
    return this.#tabs.get(shopId) ?? null;
  }

  getGoods(goodsId: number): GoodsConfig | null {
    return this.#goods.get(goodsId) ?? null;
  }

  goodsForShop(shopId: number): readonly GoodsConfig[] {
    return this.#goodsByShop.get(shopId) ?? [];
  }

  get size(): number {
    return this.#goods.size;
  }
}

export function isShopOpen(tab: ShopTabConfig, nowSeconds: number): boolean {
  // ShopTabLogicC: 1 is an ordinary shop; 2 is the cafe furniture shop.
  if (tab.onOff !== 1 && tab.onOff !== 2) return false;
  if (tab.begin !== null && nowSeconds < tab.begin) return false;
  if (tab.end !== null && nowSeconds > tab.end) return false;
  return true;
}

export function isGoodsInWindow(goods: GoodsConfig, nowSeconds: number): boolean {
  if (goods.begin !== null && nowSeconds < goods.begin) return false;
  if (goods.end !== null && nowSeconds > goods.end) return false;
  return true;
}

/**
 * 手动刷新次数与每日计数按运营日（UTC+8 凌晨 4 点）重置，与悬赏/签到一致。
 */
export function shopOperationalDate(now = Date.now()): string {
  return bountyOperationalDate(now);
}

/**
 * 周限购按运营周重置：周一凌晨 4 点（UTC+8）切周。返回该运营周周一的
 * 运营日期字符串作为周标识。
 */
export function shopOperationalWeek(now = Date.now()): string {
  const shifted = new Date(now - 4 * 3_600_000);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(shifted);
  const mondayOffset = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    weekday,
  );
  const opDate = bountyOperationalDate(now);
  const [year, month, day] = opDate.split("-").map((part) => Number.parseInt(part, 10));
  const monday = new Date(Date.UTC(year!, month! - 1, day!));
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  return monday.toISOString().slice(0, 10);
}

/**
 * 常驻商店（RefreshRule=1）的货架 key：运营日 + 已过的自动刷新槽位数。
 * RefreshTime 是每日自动刷新时间点（秒，UTC+8 当日）；4 点前的槽位属于
 * 当前运营日的末尾。
 */
export function shopShelfKey(tab: ShopTabConfig, now = Date.now()): string {
  const operationalDate = shopOperationalDate(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const part = (type: string): number =>
    Number.parseInt(parts.find((entry) => entry.type === type)?.value ?? "0", 10);
  const secondsOfDay = part("hour") * 3_600 + part("minute") * 60 + part("second");
  const operationalSeconds =
    secondsOfDay >= 4 * 3_600 ? secondsOfDay : secondsOfDay + 86_400;
  const slot = tab.refreshTimes.filter(
    (time) => (time >= 4 * 3_600 ? time : time + 86_400) <= operationalSeconds,
  ).length;
  return `${operationalDate}@${slot}`;
}

export interface ShelfStock {
  goodsId: number;
  discount: number;
}

/** 按 Weight 不放回随机抽取 columns 个商品，并为每个商品按 DiscountList 掷折扣。 */
export function rollShelf(
  pool: readonly GoodsConfig[],
  columns: number,
  random: () => number = Math.random,
): ShelfStock[] {
  const remaining = pool.filter((config) => config.weight > 0);
  const shelf: ShelfStock[] = [];
  const target = columns > 0 ? Math.min(columns, remaining.length) : remaining.length;
  while (shelf.length < target) {
    const totalWeight = remaining.reduce((sum, config) => sum + config.weight, 0);
    let roll = random() * totalWeight;
    let picked = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      roll -= remaining[index]!.weight;
      if (roll < 0) {
        picked = index;
        break;
      }
      picked = index;
    }
    const [config] = remaining.splice(picked, 1);
    shelf.push({
      goodsId: config!.goodsId,
      discount: rollDiscount(config!, random),
    });
  }
  return shelf;
}

export function rollDiscount(
  config: GoodsConfig,
  random: () => number = Math.random,
): number {
  const totalWeight = config.discountList.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * totalWeight;
  for (const entry of config.discountList) {
    roll -= entry.weight;
    if (roll < 0) return entry.discount;
  }
  return config.discountList[config.discountList.length - 1]!.discount;
}

/**
 * 与客户端 GoodsLogicC:_getNextPriceIdx 一致的阶梯价索引（1-based）：
 * 货架期 > 活动期 > 每周 > 每日 > 单次刷新 > 累计。
 */
export function nextPriceIndex(
  config: GoodsConfig,
  counters: {
    shelfBuyNum?: number | undefined;
    totalBuyNum?: number | undefined;
    weekBuyNum?: number | undefined;
    dailyBuyNum?: number | undefined;
    refreshBuyNum?: number | undefined;
    buyNum?: number | undefined;
  },
): number {
  let index = 1;
  if (counters.shelfBuyNum !== undefined && config.shelfLifeLmt) {
    index = counters.shelfBuyNum + 1;
  } else if (counters.totalBuyNum !== undefined && config.totalLimitNum) {
    index = counters.totalBuyNum + 1;
  } else if (counters.weekBuyNum !== undefined && config.weekLimitNum) {
    index = counters.weekBuyNum + 1;
  } else if (counters.dailyBuyNum !== undefined && config.dailyLimitNum) {
    index = counters.dailyBuyNum + 1;
  } else if (counters.refreshBuyNum !== undefined && config.refreshLimitNum) {
    index = counters.refreshBuyNum + 1;
  } else if (counters.buyNum !== undefined) {
    index = counters.buyNum + 1;
  }
  return Math.min(index, config.sellingPrice.length);
}

export function unitPrice(
  config: GoodsConfig,
  priceIndex: number,
  discount: number,
): number {
  const base =
    config.sellingPrice[
      Math.min(Math.max(priceIndex, 1), config.sellingPrice.length) - 1
    ]!;
  return Math.ceil((base * discount) / 100);
}

export function refreshFee(tab: ShopTabConfig, refreshCount: number): number {
  if (tab.refreshFees.length === 0) return 0;
  const next = Math.min(refreshCount + 1, tab.refreshFees.length);
  return tab.refreshFees[next - 1]!;
}

export interface ShopGoodsListTbParam {
  shopid: number;
  isopen: number;
  refreshcount: number;
  goodslist: Record<string, number>[];
  endtime: number;
}

/**
 * GoodsLogicC 需要 shopid/isopen/refreshcount/goodslist 四个字段才接受响应；
 * endtime 供活动商店倒计时（UI_ShopNew.RefreshTimer）。
 */
export function makeShopGoodsListTbParam(result: {
  shopId: number;
  isOpen: boolean;
  refreshCount: number;
  goodsList: Record<string, number>[];
  endTime: number;
}): ShopGoodsListTbParam {
  return {
    shopid: result.shopId,
    isopen: result.isOpen ? 1 : 0,
    refreshcount: result.refreshCount,
    goodslist: result.goodsList,
    endtime: result.endTime,
  };
}
