# 外围系统空状态兼容

## 当前完成度

**占位。** 这些响应只让登录/主界面/出击前置流程继续，不实现对应玩法。

## 当前空状态命令

| sCmd  | 系统     | 响应语义                     |
| ----- | -------- | ---------------------------- |
| 80    | 好友列表 | 保留请求类型，四类列表均为空 |
| 94    | 名片     | 所有装饰 ID 为 0             |
| 170   | 随机事件 | 无活动事件                   |
| 202   | 少女试用 | 未开放                       |
| 250   | 助战列表 | 空数组，允许出击回调继续     |
| 10002 | 社团信息 | 无 `primary`，表示未加入社团 |

`makeBackgroundLuaResponse` 只认领上述命令，其他命令继续进入业务路由或
`lua.unhandled`，避免误吞未知请求。

## 验证

`test/background-lua-data.test.ts` 覆盖好友请求类型、各类安全空值以及“不认领
无关命令”。

## 已知缺口

好友申请、助战配置、社团、少女试用、随机事件和名片均没有状态、协议闭环
或持久化。指引任务 40026 需要的助战配置也因此尚未实现。

这些模块后续应依据实际客户端命令逐个实现，不能在现有空响应上追加猜测字段。

Fantasy Oath commands 228–239 now have a dedicated persisted implementation; see [Fantasy Oath](21-fantasy-oath.md). They must not be claimed by the empty-state compatibility router.
