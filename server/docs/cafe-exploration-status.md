# 咖啡馆系统探索状态

更新时间：2026-07-28

> 本文保留咖啡馆排障过程。当前实现范围和完成度以
> [咖啡馆与住宅模块文档](modules/13-cafe-and-house.md) 为准。

## 当前结论

咖啡馆已从“点击后卡进度条”推进到可正常进入 3D 主场景，并能开始执行强制引导 `107 / cafe1`。此前阻塞流程的两个客户端异常已经定位：

1. `NCafeDataController.Place2Area` 空引用  
   原因是住宅协议没有返回咖啡馆依赖的房间区域。当前 `GET_HOUSEINFO_REQ (1048)` 返回房间 `1、2、6`，分别覆盖 Cafe、Rest、Dorm。
2. `UI/UI_CoffeeList.lua:615 attempt to index nil local UnlockGuest`  
   原因是基础咖啡没有标记为已学习，客户端错误进入“学习咖啡”分支，却找不到对应解锁顾客。当前新玩家及现有测试存档均写入基础咖啡 `1～4` 的学习任务位（任务组 23，bit 8）。

设备侧已确认：

- 咖啡馆加载进度条可以完成；
- 3D 咖啡馆场景可以显示；
- 强制引导 `107` 可以从主界面进入咖啡馆；
- 引导能够进入“咖啡制作”界面；
- 上述两个 Lua 空引用未再出现。

## 已实现并经过客户端验证的接口

| Command / Method               | 用途                 | 当前响应                                                           |
| ------------------------------ | -------------------- | ------------------------------------------------------------------ |
| `1048 GET_HOUSEINFO_REQ`       | 获取住宅/咖啡馆房间  | 返回最小 `HouseCache`，包含房间 `1、2、6`                          |
| `1109 HOUSE_RANDOM_REQ`        | 获取随机住宅访问数据 | 空成功响应                                                         |
| `112 Cafe_DownloadData`        | 下载咖啡馆运行数据   | 返回等级、舒适度、座位、队列、咖啡、少女、宠物等完整字段的最小结构 |
| `241`                          | 查询家具数量         | `{ nRet: 0, nNum: 0 }`                                             |
| `102`                          | 上报引导步骤         | 原样确认引导时间点、引导 ID、步骤 ID 与类型                        |
| `NCafePetLogic/GetCafeFoodNum` | 查询宠物食物         | 方法同名回调                                                       |
| `NCafePetLogic/UpdateFoodBoxs` | 更新食物箱           | 返回空 `param` 列表                                                |
| `124 Cafe_AddGuestWeight`      | 增加顾客权重         | 返回空权重变更列表                                                 |
| `113 Cafe_SetWaiterList`       | 设置服务员           | 回显客户端提交的三组服务员列表                                     |
| `115 Cafe_GenerateCustomer`    | 生成排队顾客         | 返回一个 `customertype=201` 的最小顾客队列                         |

## 已实现但尚未完成客户端验证的接口

| Command                | 用途             | 当前实现                                                                     |
| ---------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `119 Cafe_MakeCoffee`  | 制作咖啡         | 校验 `coffeetype/count`，持久化咖啡库存，并返回完整 `coffeelist`             |
| `11 Shop_ReqGoodsList` | 获取商店商品列表 | 返回客户端要求的 `shopid/isopen/refreshcount/goodslist` 字段，商品列表暂为空 |

这两项是在切换探索方向前根据真实请求和原始 Lua 回调契约完成的，但还没有重新走一遍设备流程，因此不能视为客户端已验证。

## 当前持久化状态

存档结构已加入：

```ts
cafe: {
  coffees: Array<{
    coffeetype: number;
    count: number;
  }>;
}
```

制作咖啡会累加对应种类的数量。再次下载咖啡馆数据时，服务端会把已保存的库存放入 `coffeelist`。当前唯一支持的存档格式为 `schemaVersion=1`，`cafe` 是玩家状态的必填部分。

## 当前模拟的边界

目前咖啡馆仍是“引导可运行的最小实现”，不是完整经营模拟：

- 咖啡馆等级固定为 1；
- 人气、舒适度固定为 0；
- 顾客队列固定生成一名 `201` 类型顾客；
- 座位、顾客入座、饮用完成、离场尚未实现；
- 服务员列表只在本次请求中回显，尚未持久化；
- 宠物、食物箱、来访记录和顾客权重均为空；
- 家具商店只返回合法的空商品列表；
- 咖啡制作暂未扣除货币，也未应用槽位和库存上限；
- 尚未验证 `117/114/116/120` 等后续咖啡馆指令。

## 已观察但暂停追踪的后续指令

根据原始 Lua 和引导配置，继续经营流程预计会遇到：

- `117`：顾客入座/新顾客；
- `114`：上传座位状态；
- `116`：顾客饮用完成；
- `120`：学习咖啡；
- 家具购买、装修保存以及咖啡馆奖励相关指令。

这些接口按当前决定暂停探索。恢复时应从设备实际请求继续，不应仅凭 Lua 名称批量猜测响应。

## 关键参考文件

- `src/game-data/cafe-data.ts`
- `src/game-data/shop-data.ts`
- `src/servers/gateway-server.ts`
- `src/persistence/player-repository.ts`
- `test/cafe-data.test.ts`
- `test/shop-data.test.ts`
- 原始客户端 Lua：`assets/game/luagen/cafe/ncafenet.lua`
- 原始客户端 Lua：`assets/game/luagen/ui/ui_coffeelist.lua`
- 原始引导表：`assets/game/settinggen/guide/uiguide.txt` 中的 `107 / cafe1`
