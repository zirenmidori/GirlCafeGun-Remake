# 物品、奖励与少女名册

## 当前完成度

**核心可用。** 已为关卡、抽卡、签到和任务提供统一入账基础，但不是完整背包系统。

## 统一物品模型

背包项目包含 GUID、GDPL、数量、创建时间、强化等级/经验、突破等级和锁状态。
genre `1/2/3/4` 视为实例物品，每份奖励创建独立 GUID、数量固定为 1；其他物品按
GDPL 堆叠。旧版 `cards/items` 会迁移到统一 `inventory`。

genre `3` 的模块按客户端实例语义从等级 1 开始；这代表“未强化”，不是等级 0。
客户端 `setting.u` 中的 `FileRuneTemplateInfo`（原始来源 `Item/Rune.txt`）已导出为
`resources/rune/runes.txt`，覆盖当前版本的 80 个基础模板。GDPL 映射为：

- `Detail` 1/2/3/4：攻击、防御、生命、护盾，同时也是四个编队模块槽；
- `Particular` 1～4：模块稀有度；
- `Level` 1～5：生物、机械、幽能、防疫、侵蚀阵营；
- 模板的 `AttributeType` 0～4 是对应的客户端战斗阵营枚举。

客户端 `RuneItem` 会以实例的 `enhancelevel=1` 查询模板主属性数组的等级 1 项，
因此最小实现不需要额外持久化主属性，也不需要通过 `ItemInfo.attrlist` 重复下发。
服务端的编队战力也从同一模板读取模块稀有度，不再把 GDPL 的阵营 `Level` 误作
稀有度。

奖励中的 `15-1`、`15-2`、`15-11` 和 `15-20` 分别映射金币、免费钻石、
角色卡分解代币和武器分解代币；其他奖励进入背包。奖励入账被关卡、抽卡、签到、
指引日程和分解功能复用。

## 锁定与分解

`LockItem` 会持久化实例物品的 `lockOn` 并发送增量通知。角色卡和武器分解会先
校验整批 GUID、锁状态及编队占用，再在同一个 JSON Store 事务中删除实例并发放
金币和对应代币。详细公式和协议见
[角色卡与武器强化、锁定和分解](08-card-and-weapon-enhancement.md)。

## 少女名册投影

获得角色卡后会：

- 根据客户端角色卡表识别可玩少女和特殊 model ID；
- 创建缺失的少女状态；
- 维护角色卡拥有数量、服装拥有/新获得任务位；
- 修正当前服装和主少女；
- 向客户端发送新增/变化的少女通知。

联动角色 `201～204` 使用独立任务组映射。

## 验证

- `test/character-card-data.test.ts` 覆盖全部可玩少女和特殊模型映射；
- `test/persistence.test.ts` 覆盖初始背包和名册；
- 抽卡、签到和关卡测试间接覆盖奖励入账。

## 已知缺口

- 没有背包容量、通用出售、符文/普通物品分解、过期和邮件附件；
- 没有通用的公开 RewardService，奖励逻辑仍位于 Repository；
- 只特殊识别金币、免费钻石和两种分解代币，其他货币依赖背包或专用路径；
- 重复角色卡按独立实例保存，没有完整碎片/重复转换规则；
- 装备、符文和材料的全部客户端语义尚未建模。
- MOD enhancement (31), limit break (35), and two-step revision (33/34) now use
  the recovered client tables. Revision previews preserve both active and
  proposed skills across restarts; accepting or discarding commits atomically.
  Skills unlock at levels 5/10/15. Separate equip/sell commands remain unimplemented.
