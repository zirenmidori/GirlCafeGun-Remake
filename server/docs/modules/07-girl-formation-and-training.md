# 少女、编队与特训

## 当前完成度

外观、编队和送礼为**核心可用**，少女特训为**MVP**。

## 少女与外观

支持 `GirlLogic`：

- `SetMainGirl`：校验已拥有少女并持久化主少女任务值；
- `ChangeCloth`：校验服装任务位，更新 model ID 并清除“新获得”状态；
- `SetModelInFight`：持久化战斗模型开关；
- `HeadTouched`：保存摸头次数、好感度、每日任务与誓约进度；详见 [Headpats](22-headpats.md)。

角色卡到少女、服装和主少女的自动投影见物品模块文档。

## 送礼

完整考据与实现过程见 [GirlGift 服务端补全全记录](../girl-gift-implementation.md)。

支持 `GirlLogic GirlGift {nId, tbItem=[G,D,P,L], ItemNum}`（`ItemNum` 缺省为 1）：

- 礼物经验完全取自客户端 `Item/ItemList.txt` 的 ExtParam1：1～16 号少女各有
  60/300 的专属礼物（`5-1-N-2/4`），联动少女 201～204 各有一个 500 的
  （`5-1-N-4`），通用礼物为 `5-2-1-1..8`（30/60/150/300/150/300/300/300）；
- 喜爱礼物按 `UI_GirlGift` 的规则加成 1.25 倍（联动少女 2 倍），向下取整；
- 好感升级完整复刻原服务端 `GirlCommon:Add`：按 `Girl/Friendliness.txt` 的
  Exp/LinkExp 曲线逐级扣减，普通少女上限 100 级、联动少女 50 级，溢出经验
  丢弃而不是结转；
- 成功时依次发送 `GIRL_UPDATE_NTF`（新等级与经验）、`ITEM_UPDATE_NTF`
  （消耗后的礼物堆叠）、解锁秘密时的 `TASK_VALUE_RSP`，最后是
  `GirlLogic GirlGift` 回调，字段与客户端 `OnGirlGift` 一一对应
  （`bLove/nIsMaxlevel/nAddExp/nOldExp/nNewExp/nOldLevel/nNewLevel/bAct/bSp`）；
- `bAct/bSp` 复刻 `HandWorkLogic:GiftState`：手作教室（活动 120，
  2021-07-30 ～ 2021-08-20）窗口已过，两个标志恒为 false，窗口判断保留；
- 秘密解锁：送出喜爱礼物解锁对应 `Secret` 任务位（1～16 号为 11/12，联动
  少女为 5）；升级跨过 `Secret.txt` 的 FitLove 阈值（10/20/30…100）时解锁
  对应秘密位；
- 错误码：`1` 参数非法、`2` 礼物未知或数量不足、`3` 少女未拥有、`4` 已满级
  （客户端 `OnGirlGiftError` 只对 4 弹“好感度已满级”）。

支持 `GirlLogic LevelAward {nId, nLevel}`：好感每跨 10 级客户端会调用一次，
服务端把 `LevelAward` 任务位（组 3，`(girlId-1)*2000+500+index-1`，联动少女
走组 90）标记为 1 并原样回调。该命令只是领取标记，配置中每 10 级的奖励
（`FriendlinessUnlock.txt`）没有实物，客户端奖励界面由本地数据驱动。

## 羁绊剧情（圆形支线节点）

羁绊界面（`UI_GirlLove`）的圆形支线节点是二级解锁：好感等级达标只是第一道
门，第二道门是服务端写入的好感事件任务位 `ELevel`（组 3，
`(girlId-1)*2000+300+index-1`，1=已解锁未读，2=已读）。节点配置来自
`resources/girl/fetter.txt`（客户端 `Girl/Fetter.txt`），由
`src/game-data/girl-fetter-data.ts` 解析出每个节点的好感等级、`SubAward`
奖励与 `SubCond` 附加条件。

`SubCond` 的格式为 `[类型,参数1,参数2,参数3,描述key]`：

- `[]`：无附加条件，等级达标即解锁；
- `[-1]`：官方未开放，永不解锁；
- `[1,章节,关卡,难度,描述key]`：必须通关指定主线关卡（存档 `levels` 中对应
  `makeLevelId(章节,关卡,难度)` 的 `star > 0`），描述文本只用于客户端提示。

解锁评估（`reconcileGirlFetterUnlocks`）在四个时机触发：建号与登录兜底、
送礼升级、特训结算、关卡通关（`settleLevel`）。新增解锁后通过既有的
`TASK_VALUE_RSP` 全量同步给客户端。

观看剧情 `GirlLogic ViewStory {nId, nType, nStoryId}`：校验节点存在且任务位
≥1（0 时拒绝，`nError: 1`），首次观看（位=1）按 `SubAward` 发奖（货币/道具
走通用 `grantAwards`），随后把任务位置 2 并回包 `{sCmd:'ViewStory', nId,
nType, nStoryId}` 触发客户端奖励弹窗；重复观看幂等不重发奖励。`nType=3`
（相册卡面剧情，`ECard` 偏移 400）只标记已读不发奖。

## 编队

支持数字命令 `21/22/23` 的编队保存。服务端解析主卡、副卡、使用卡、武器和模块，
校验所有 GUID 属于玩家，随后新增或替换编队并发送增量通知。装备武器会发布活动
事件，推进指引日程。

模块采用客户端 `FightCard.runeitem` 的四个固定位置，解析和回传都会保留中间的
零值。例如 `[攻击模块,0,0,护盾模块]` 不再被压缩。服务端按客户端模板规则强制：

- 槽 0/1/2/3 只能放 `Detail` 1/2/3/4 的攻击/防御/生命/护盾模块；
- 模块 GUID 必须指向玩家拥有的 genre 3 实例和已知客户端模板；
- 武器槽必须是 genre 2，避免普通物品或模块进入武器槽；
- 登录时会把旧存档中被压缩的模块按 `Detail` 恢复到正确位置，并把历史等级 0
  模块迁移为未强化等级 1。

本阶段不实现模块命令 `30～35`。当前实际编队界面的一键装配先在客户端本地修改
CardGroup，再通过命令 `21/22/23` 的编队保存落盘，因此最小装配链路不依赖命令
30；独立的少女模块界面若触发 `Rune_Equip=30`，仍属于未实现范围。

当前不限制人数、同卡重复、职业搭配或一件装备被多编队复用。

## 特训

支持 `GirlLogic StartTrain`：

- 四种原始训练时长：1/2/4/8 小时；
- 每种三个位置，总并发上限 4；
- 校验少女、位置占用和少女是否已在训练；
- 将位置、结束时间、户外区域写入少女任务值；
- 同一少女重复提交相同位置时幂等返回。

支持 `GirlLogic EndTrain {nId}` 的结算：

- 校验少女在训且到达结束时间（`now >= TrainTime`，客户端也只在此刻放行）；
- 按 `TrainingGirl.txt` 发放好感经验（60/120/240/480，走与送礼相同的
  `GirlCommon:Add` 升级曲线，满级少女加 0 并原样回调）和金币
  （`15-1-1-1-N` → 1000/1800/3200/5000）；
- 升级跨过 FitLove 阈值时解锁对应 Secret 任务位（与送礼共用）；
- 清空位置、结束时间和户外区域任务位；
- 依次发送 `GIRL_UPDATE_NTF`、`MONEY_UPDATE_NTF`、`TASK_VALUE_RSP`，回调
  `{sCmd:'EndTrain', nId, nMoney:[15,1,1,1,N], AddExpInfo:[add,oldExp,newExp,oldLevel,newLevel]}`，
  与客户端 `OnEndTrain` 的读取一致（含一键特训的多次调用）。

`InterruptTrain`（打断特训）和调试用的 `TestEndTrain` 尚未实现，日志出现时
再补。

## 验证

- `test/girl-training-data.test.ts` 覆盖训练配置和非法位置；
- `test/girl-training-end-persistence.test.ts` 覆盖特训结算、升级秘密解锁、
  满级零收益和未在训/未完成的拒绝路径；
- `test/girl-gift-data.test.ts` 覆盖礼物经验、好感曲线、升级截断和
  手作活动窗口；
- `test/girl-gift-persistence.test.ts` 覆盖送礼扣减、喜爱加成、秘密解锁、
  满级与参数错误、联动少女和 `LevelAward` 幂等；
- `test/persistence.test.ts` 覆盖少女外观、特训和编队持久化；
- `test/girl-fetter-data.test.ts` 覆盖羁绊配置解析（节点等级、章节条件、
  奖励）；
- `test/girl-fetter-persistence.test.ts` 覆盖羁绊解锁评估（等级门槛、章节
  通关条件、幂等、登录兜底、送礼触发）和 `ViewStory`（首次发奖、已读位、
  错误路径、相册已读）；
- `test/protocol.test.ts` 覆盖少女、编队通知编码。
- `test/rune-data.test.ts` 覆盖客户端 80 个模板、主属性/阵营映射和固定槽位解析；
- `test/rune-persistence.test.ts` 覆盖未强化等级 1、错误槽位拒绝和正确槽位保存；
- `test/protocol.test.ts` 额外覆盖四槽含零值的原位回传。

## 已知缺口

- `InterruptTrain` / `TestEndTrain` 尚未实现，运行日志中可能出现未处理请求；
- 指引任务“安排四种不同特训”没有接入事件；
- 好感升级的配套系统（升级触发的私信事件 `PhoneEventCheck(3)`、成就
  `OnAddFriendLevel`）未接入；
- 少女疲劳恢复和咖啡馆派驻未形成完整玩法；
- 编队战力没有计算，`fightPower` 也不会随编队变化；
- 支援/助战配置任务没有实现。
