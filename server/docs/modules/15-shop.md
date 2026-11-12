# 商店

## 当前完成度

**普通商店核心可用。** 商品列表、随机货架、五种限购、阶梯价、折扣、手动刷新
与购买闭环均已按客户端配置表实现并持久化；IB 礼包商店保留了免费礼包
（Id 12）与月卡（Id 1）的免费发放闭环。

## 配置来源

- `resources/shop/goods.txt`、`resources/shop/shoptabs.txt`：从设备
  `setting.u` 提取的客户端 `Shop/GoodsList.txt` 与 `Shop/ShopTabList.txt`
  原文（提取管线见 `asset-tools`）。服务端与客户端读同一份表，商品选品、
  价格、限购、折扣、上下架窗口均以它为准；自定义商品即编辑这两张表。
- 客户端自身也用这两张表渲染商店（名称/图标/价格展示），服务端货架只下发
  `goodsid`、各限购计数与折扣，商品必须存在于客户端表中，否则客户端提示
  `ui.shop.badgoodsId`。

## 已实现

### 商品列表（`LuaCall sCmd=11`）

请求 `{shopid}`，响应
`{shopid, isopen, refreshcount, goodslist, endtime}`：

- `isopen`：栏目 `OnOff=1` 且在 `Begin`/`End` 窗口内；未知或关闭的商店回
  `isopen=0` + 空列表（咖啡馆探测任意 shopid 也不会卡住）；
- 非随机货架商店（RefreshRule 2/3/4/5）上架全部在售商品；RefreshRule=1 的
  常驻商店（20001/20002）按 `Weight` 不放回随机抽取 `Columns` 个组成货架；
- 货架按 `RefreshTime` 自动槽位（如 04:00/18:00）重掷，货架 key 为
  `运营日@槽位序号`，手动刷新后追加 `#m{次数}`；
- 每个货架商品按 `DiscountList` 的权重掷折扣，随 `discount` 字段下发；非
  货架商品下发配置第一条折扣（无配置时 100）。**所有商品都必须显式下发
  `discount`**：客户端对缺失字段回退到 `DiscountList` 第一条，而该列为空时
  客户端解析结果是 0（显示免费），会导致客户端价格与服务端扣费不一致；
- goodslist 条目按配置带 `buynum`（累计）与对应限购计数
  （`refreshbuynum`/`dailybuynum`/`weekbuynum`/`totalbuynum`/`shelfbuynum`），
  客户端 `GoodsLogicC:IsInStock` 据此显示售罄；
- `endtime` 为栏目 `End`（unix 秒），供活动商店倒计时。

### 手动刷新（`LuaCall sCmd=12`）

请求 `{shopid}`。校验 `refreshcount < RefreshLimits`，按 `RefreshFee` 阶梯
（第 `refreshcount+1` 档、封顶末档）扣 `MoneyType` 货币，重掷货架并回最新
列表。刷新次数按运营日重置。超过上限或货币不足回 `{errorKey}`。

### 购买（`LuaCall sCmd=13`）

请求 `{shopid, goodsid, buynum}`（1–99）。服务端事务依次：

1. 校验商店开放、商品在售窗口内、货架商品（rule 1）必须在当前货架上；
2. 校验全部适用限购（含 buynum 批量）；
3. 按客户端 `_getNextPriceIdx` 同款优先级（货架期 > 活动期 > 每周 > 每日 >
   单次刷新 > 累计）取阶梯价，`ceil(price × discount / 100) × buynum`；
4. 扣费：钻石（免费 3 + 付费 12）与金币（免费 2 + 付费 17）按客户端
   `CheckDiamond`/`CheckGold` 语义合并扣（免费优先），其它货币单 id 扣；
5. 发货：`[G,D,P,L,GoodsNum×buynum]` 走 `grantAwards`（genre 15 已知货币
   直接入钱包，其余入背包；实例 genre 1/2/3/4 逐件入库）；
6. 计数落库。

回包顺序：`ITEM_UPDATE_NTF → MONEY_UPDATE_NTF → sCmd=13 回显
{shopid, goodsid, buynum}`（客户端用本地配置弹 `UI_RewardNormal`）→ 追加
sCmd=11 推送最新列表让客户端计数同步。失败回
`{shopid, goodsid:0, buynum:0, errorKey}`，客户端静默忽略（
`GoodsLogicC:OnReqBuyGoods` 不处理 errorKey）。

### 限购与状态持久化

`player.shops[shopId]`：`refreshCount`（运营日重置）、`counters`（每商品
daily/week/total/shelf）、`shelfKey` + `shelf`（货架商品、折扣、本货架已购）。
重置口径：运营日 UTC+8 凌晨 4 点（与悬赏/签到一致）；运营周为周一凌晨
4 点；total 永不重置；非货架商店的 ShelfLifeLmt 计数（rule 5 商店
20007/20011）随存档累计、不重置。

错误映射：`limit_reached→Error.20075`、`insufficient_funds→Error.20013`、
其它→`Error.20074`，客户端弹 `ui.Error.<code>`。

实现位置：`src/game-data/shop-data.ts`（表解析、货架/折扣/阶梯价纯函数）、
`player-repository.ts`（`getShopGoodsList`/`refreshShop`/`buyShopGoods`、
`ShopState`、`ShopError`）、`gateway-server.ts` 三个 LuaCall 分支。

### IB 礼包商店免费礼包（`LuaCall sCmd=10000`，`LuaCall.DoRecharge`）

客户端在 IB 商店点击礼包时发送 `{Type=1, Id}`（`IBLogic:DoBuyBox`）。当前只支
持 `Purchase/PurchaseIBShop.txt` 的 Id 12「每日少女暖心礼包」（`Currency=-2`
钻石、`Cost=0`、日限购 1 次，奖励 `[14,3,5,1,1]` 礼包箱）：

- 购买计数存任务组 42、taskId `10000+Id`（客户端 `IBLogic:GetIBTask` 读取限购
  进度），按运营日（UTC+8，凌晨 4 点切日）重置，重置日期存
  `player.ibShop.operationalDate`；
- 成功时按 `ITEM_UPDATE_NTF → TASK_VALUE_RSP → NTF_S2C_CALL` 顺序回包，
  回调体 `{sCmd=10000, tbParam={Type=1, Id=12, Error=0, tbItem=[[14,3,5,1,1]]}}`，
  客户端 `IBLogic:ResponseTradeNo` 收到后打开 `UI_RewardNormal`；
- 当日已达限购回 `Error=20075`，其它 Type/Id 一律回 `Error=20074`（客户端弹
  `ui.Error.<code>`）。

实现位置：`src/game-data/ib-shop-data.ts`（常量与任务 ID）、
`player-repository.ts` 的 `claimIBShopFreePack` / `claimIBItemFree` /
`IBShopError`、`gateway-server.ts` 的 `parseDoRechargeCall` 与分发分支。

### IB 充值商店月卡（`Type=2`，Id 1）

客户端在充值商店点击商品时发送 `{Type=2, Id}`（`IBLogic:DoRecharge`）。当前只
支持 `Purchase/PurchaseIB.txt` 的 Id 1「月卡」（Type=1 月卡、Cost=30 CNY、
安卓 ServerItem1=`[14,1,2,1,300]`、First/NormalCharge=`[14,2,1,1,1]`），离线服
直接免费发放：

- genre 14 是 `Auto` 类道具，服务端按 ItemList 语义直接折算，不入库：
  `IBAndroidDiamondAuto`（ExtParam1=1）每件 1 钻石 → +300 钻石（money id 3）；
  `IBMonthCardAuto`（ExtParam1=30）→ 月卡到期时间（任务组 1 task 36，unix 秒）
  从 `max(现在, 原到期)` 顺延 30 天，上限 330 天（`IBLogic.MONTH_LIMIT`）；
- 购买计数存任务组 42、taskId = 商品 Id（`GetIBTask` 的 TYPE_IBITEM 分支），
  累计不重置（Id 1 无 MaxBuy 限购）；
- 消息序：`MONEY_UPDATE_NTF → TASK_VALUE_RSP → DoRecharge 回调（伪造
TradeNo=`offline-<毫秒>`，客户端随后调用 XGCharge，离线包中静默失败无副作用）
→ NTF_S2C_CALL `BuyMonth {nType=2, bMonth=1, nId=1}`（客户端弹"充值成功"并
刷新 UI_Charge/UI_ShopNew）→ LuaCall 450 `Pay_Result_Success
  {nAllTimes, nDailyTimes}`（客户端仅埋点）；
- 其它 Type=2 商品一律回 `Error=20074`。

月卡每日 50 钻石 / 30 体力通过每日签到发放（见
[每日签到](11-sign-in-activities.md) 的"月卡每日签到"）；月卡补偿与月卡签到
的补偿分支（`TID_MONTHSIGN_Energy_Got`=11006）未实现。

## 验证

- `test/shop-data.test.ts`：真实表解析（20001 栏目字段、商品 20101 字段、
  两店商品数）、阶梯价/折扣/时间窗解析、价格索引优先级、货架抽取、运营
  日/周/货架 key 计算、tbParam 映射；
- `test/shop-persistence.test.ts`：货架生成与自动槽位重掷、购买扣费发货计数、
  付费钻石补足、日/周限购与跨期重置、货架售罄与未上架拒绝、阶梯价推进、
  手动刷新费用阶梯与上限、错误码映射；
- `test/ib-shop-persistence.test.ts` 覆盖免费礼包（发货+计数、当日限购拒绝、跨运
  营日重置、未知账号）与月卡（钻石+顺延+计数、活跃期顺延、330 天上限、未知商品
  拒绝）。没有设备购买流程或网关集成测试。

## 已知缺口

- 家具商店（40001）批量购买走 `sCmd=14`（`FurShop:ReqBuyGoods`），依赖咖啡馆
  家具库存，未实现；咖啡馆流程只读空列表，不购买；
- 社团商店（20006）的 `pos` 栏位锁由客户端按社团等级判定，服务端不产 `pos`
  字段，离线状态下按普通商品展示；
- 角色卡商店（20005）购买会触发客户端 `UI_GachaGet` 特殊展示流程，发货本身
  已支持（genre 1 实例卡），但展示链路未在设备上验证；
- 货架抽取使用 `Math.random`，不做确定性复现；
- IB 商店只支持 Id 12：没有从 `PurchaseIBShop.txt` 加载完整商品表（该表已
  提取至 `client-resources/extracted/setting/`），不支持付费
  商品（`Currency=-1` 的 TradeNo/XGSDK 流程）、钻石/金币扣费、周/月/总计限购
  （LimitType 2/3/4）、折扣窗口（OffFlag/OffCost）、等级与时间窗校验；
- 发放的 genre 14 礼包箱只做入库，背包开箱（`UI_ItemBox` /
  `Item/ItemBoxInfo.txt` 掉落）未实现；
- IBItem（Type=2）只支持 Id 1 月卡：没有从 `PurchaseIB.txt` 加载完整商品表，
  普通钻石档位、首充双倍（FirstCharge/NormalCharge 当前恒等同）、订阅月卡
  （Type=3）等未实现。
