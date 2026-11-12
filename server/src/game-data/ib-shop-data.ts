import type { BaseAward } from "./chapter-config.js";

// 出处：客户端 LuaCall.lua LuaCall.DoRecharge = 10000；
// IBLogic.lua GROUP=42 / IBSHOP_TASKID=10000 / TYPE_IBSHOP=1。
export const LUA_COMMAND_DO_RECHARGE = 10000;
// LuaCall.lua LuaCall.Pay_Result_Success = 450（支付成功后服务器通知，仅埋点）。
export const LUA_COMMAND_PAY_RESULT_SUCCESS = 450;
export const IB_SHOP_TASK_GROUP = 42;
export const IB_SHOP_TASKID_BASE = 10000;

// Purchase/PurchaseIBShop.txt Id=12「每日少女暖心礼包」：
// tbGDPL=[14,3,5,1,1]，Currency=-2（钻石），Cost=0，LimitType=1（日限购），
// LimitTimes=1。当前仅支持这一个免费礼包。
export const FREE_GIFT_PACK_ID = 12;
export const FREE_GIFT_PACK_AWARD: BaseAward = [14, 3, 5, 1, 1];
export const FREE_GIFT_PACK_DAILY_LIMIT = 1;

// Purchase/PurchaseIB.txt Id=1「月卡」（IBItem，客户端 Type=2）：
// ServerItem1=[14,1,2,1,300]（IBAndroidDiamondAuto，ItemList 中 ExtParam1=1，
// 即每件自动兑换 1 钻石 → 300 钻石）；FirstCharge/NormalCharge=[14,2,1,1,1]
// （IBMonthCardAuto，ExtParam1=30 天）。离线服直接免费发放。
export const MONTH_CARD_ITEM_ID = 1;
export const MONTH_CARD_DIAMONDS = 300;
export const MONTH_CARD_DAYS = 30;
// IBLogic.MONTH_GROUP/MONTH_TASKID/MONTH_LIMIT：任务组 1 task 36 存月卡到期
// 时间（unix 秒），上限 330 天。
export const MONTH_CARD_TASK_GROUP = 1;
export const MONTH_CARD_TASK_ID = 36;
export const MONTH_CARD_LIMIT_DAYS = 330;

// 客户端 IBLogic:ResponseTradeNo 读取的错误码（ui.Error.<code>）。
export const IB_SHOP_ERROR_UNKNOWN_ITEM = 20074;
export const IB_SHOP_ERROR_LIMIT_REACHED = 20075;

export function makeIBShopTaskId(shopId: number): number {
  return (IB_SHOP_TASK_GROUP << 16) | (IB_SHOP_TASKID_BASE + shopId);
}

// IBItem（Type=2）购买计数：group 42，taskId 直接用商品 Id（GetIBTask 的
// TYPE_IBITEM 分支）。
export function makeIBItemTaskId(itemId: number): number {
  return (IB_SHOP_TASK_GROUP << 16) | itemId;
}

export function makeMonthCardTaskId(): number {
  return (MONTH_CARD_TASK_GROUP << 16) | MONTH_CARD_TASK_ID;
}
