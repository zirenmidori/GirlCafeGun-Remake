# 角色卡与武器强化、锁定和分解

## 当前完成度

**核心可用。** 强化、锁定以及角色卡/武器分解的协议、奖励和存档闭环已实现；
Weapon passive skills synchronize with item instances. Normal weapon breakthrough and its linked passive-skill increments are now implemented; reset and skill reroll remain incomplete.

## 实例锁定

支持通用 `LockItem`：

- 接收 `nGuid` 和 `nLockOn=0/1`，可用于角色卡、武器等实例物品；
- 锁状态写入统一背包存档；
- `ItemInfo` 的 Protobuf field 13 同步 `lockon`；
- 修改成功后发送 `ITEM_UPDATE_NTF`。

旧存档没有 `lockOn` 时会在加载时补为 0。

## 角色卡强化

支持 `LuaCall sCmd=5 / Card_LevelUpCommon`：

- 解析客户端材料索引与数量；
- 校验客户端等级和服务端等级一致；
- 使用客户端 `ItemList` 的经验与金币值；
- 同属性/通用经验材料应用客户端 1.5 倍经验规则；
- 原子扣除材料和金币，跨多级结算剩余经验；
- 同步目标卡、消耗材料和金币。

客户端提交的技能等级只用于请求结构校验，目前不进行技能升级。

## 角色卡分解

支持 `LuaCall sCmd=1 / Card_Decompose`：

- 单次接收 1～40 个不重复角色卡 GUID；
- 禁止分解锁定卡、任意已保存编队中的主卡/副卡/使用卡以及 `P=17` 的誓约卡；
- 先完整校验全部卡牌，再在同一事务内删除实例并发放奖励；
- 返回 `itemlist` 和 `goldnum`，同时发送删除物品与货币增量通知；
- 角色卡分解代币 `[15,11,1,1]` 记入 `Money ID 10`。

## 武器强化

支持 `WeaponLogicMsg nCmd=1`：

- 识别经验材料或作为素材的其他武器；
- 使用客户端材料经验、金币和献祭武器公式；
- 已装备武器不能作为素材；
- 根据稀有度和突破等级计算 40～80 级上限；
- 在突破上限保留受限溢出经验；
- 原子扣除素材和金币并同步更新；
- 发布 `weapon.enhanced`，推进指引日程的 10 级任务。

## 武器分解

支持 `WeaponLogicMsg nCmd=2`：

- 单次接收 1～40 个不重复武器 GUID；
- 禁止分解锁定武器和任意已保存编队中装备的武器；
- 先完整校验全部武器，再原子删除实例并发放奖励；
- 成功回调为 `tbParam=[金币, 道具列表]`，并同步物品删除和货币变化；
- 武器分解代币 `[15,20,1,1]` 记入 `Money ID 16`。

## 武器技能展示

武器检视页（`UI_WeaponInfo`）的技能区读取实例的 `passiveskill` /
`passiveskilllevel`，由客户端 `EquipManager.AddWeapon` 从
`gsproto.ItemInfo.skillinfo`（Protobuf field 11，repeated `MiniSkill`）
填充：

- `skilltype=1` → `MainSkillLevel`（战斗用，当前不下发）；
- `skilltype=2` → 固定被动技能槽（检视页展示的内容）；
- `skilltype=4` → 重铸技能槽（重铸未实现，不下发）。

服务端在 `makeItemInfo` 中为武器（genre 2）按模板表
`resources/weapon/weapons.txt` 下发 `PassiveSkill1`/`PassiveSkill2`
（`skilltype=2`），技能等级 = 突破等级 + 1（客户端
`WeaponCommon:GetMaxSkillLevel` 与游戏内提示“武器的技能在「突破」时会相应
提升1级”）。模板表提取自客户端 `setting.u` 的
`Assets/_Game/SettingGen/Item/Weapon.asset`（无 typetree 的
`FileWeaponItemBaseInfo` MonoBehaviour，按
`docs/girl-gift-implementation.md` 第 2/4 节的 BundleEncrypt 变换 +
手工布局解析导出，共 138 把武器、113 条固定被动技能）；技能名/描述文本
由客户端语言表按 `_SkillDesInfo.<skillId>.Name/Desc*` 键展示，服务端无需
下发。

## 分解奖励

金币公式与客户端 `CardCommon:GetCardPrice` /
`WeaponCommon:GetWeaponSellGold` 一致：

```text
floor(达到当前等级所消耗的累计经验 * 0.3 + 稀有度 * 对应基础金币)
```

未结算的当前等级 `enhanceExp` 不参与返还。等级 1 的奖励如下：

| 稀有度 |  金币 | 角色卡代币 | 武器代币 |
| ------ | ----: | ---------: | -------: |
| 1      |   500 |          0 |        0 |
| 2      |  2000 |         10 |        5 |
| 3      |  6000 |         40 |       25 |
| 4      | 40000 |        200 |      250 |
| 5      |   500 |          0 |        0 |

代币数量来自客户端 `ItemRarityItem` 的 `DisItem1/DisItem2`；当前配置的有效产出
概率均为 10000，因此结果是确定的。

## Weapon breakthrough and custom templates (2026-11-06)

`WeaponLogicMsg nCmd=3` accepts `nGuid` plus `tbGuid=[[donorGuid,count],...]`.
The cached `WeaponBreakthroughCatalog` uses the exact recovered `WeaponBreak`
table. Four-star stages consume 1/2/3/4 matching duplicates (or the native
four-star universal weapon material) and 50,000/100,000/150,000/200,000 gold;
the normal level caps become 50/60/70/80. Invalid, consumed, locked, equipped,
self-referenced and repeated donors reject atomically. Item and currency
notifications arrive before the successful Lua callback. Passive skill level
is derived from `breakLevel+1` on the normal item synchronization path.

Weapon rarity now comes first from the full weapon-template catalog, allowing
normal enhancement, decomposition and formation power for non-gacha templates.
Astral Covenant is an explicit additional template `2:2:28:1` in
`resources/custom-weapons.json`; no existing gacha pool is changed. Its matching
client model/icon/settings must be installed before a targeted inventory grant.
The narrow grant tool preserves all prior instances, progression and profiles.

New coverage: `weapon-breakthrough-data.test.ts`,
`custom-weapon-persistence.test.ts`, and `custom-weapon-gateway.test.ts`.
The actual TCP test verifies notification ordering, consumed donor updates,
passive-skill increments and replay rejection. Formation ownership also rejects
count-zero tombstones after consumption. Phone validation of the new artwork
and its held/firing pose remains pending.

## 验证

- `test/card-enhancement-data.test.ts`：请求、材料顺序、经验跨级；
- `test/weapon-enhancement-data.test.ts`：请求、材料、献祭公式、等级上限；
- `test/weapon-enhancement-persistence.test.ts`：武器、材料和金币原子落盘；
- `test/card-decomposition-data.test.ts`：角色卡请求、金币和代币规则；
- `test/card-decomposition-persistence.test.ts`：角色卡锁定、编队限制和原子奖励；
- `test/weapon-decomposition-data.test.ts`：武器请求、金币和代币规则；
- `test/weapon-decomposition-persistence.test.ts`：武器锁定、装备限制和原子奖励；
- `test/weapon-skill-data.test.ts`：模板表加载、`skillinfo` 编码与突破等级映射；
- `test/protocol.test.ts`：`ItemInfo.lockon` 编码；
- `test/persistence.test.ts` 间接覆盖角色卡强化。

## 已知缺口

- 角色卡没有按稀有度、突破或玩家等级限制最大等级；
- 角色卡技能升级、觉醒、突破和副卡强化未实现；
- Weapon reset is not implemented; normal breakthrough and linked passive-skill increments are implemented.
- 武器重铸技能（`skillinfo` skilltype 4）未实现；
- 普通物品、物资、符文、武器模块和武器零件的出售/分解仍未实现；
- 武器强化失败统一返回通用错误，客户端错误码没有细分；
- 角色卡强化尚未发布活动领域事件。
- 角色卡/武器强化后会重新计算已保存编队的历史最大练度，并立即同步相关指引任务；
