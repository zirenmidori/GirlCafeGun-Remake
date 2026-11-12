# 活动与任务引擎

服务端用领域事件驱动任务和活动进度。协议层只负责解析客户端命令和发送通知，
不会直接判断某个活动的完成条件。

## 处理链路

1. Repository 在 `JsonStore.update()` 中执行核心业务。
2. 核心业务产生 `DomainEvent`。
3. `ActivityEngine` 根据静态 `ActivityRegistry` 找到订阅该事件的 handler。
4. 当前活跃的 handler 修改同一份玩家存档草稿。
5. 存档原子提交后，Gateway 根据 Repository 返回值发送任务、物品和货币通知。

handler 不能自行读写 `JsonStore`、发送网络包或保存进程内玩家状态。这样业务状态
和活动进度始终处在同一事务中，服务重启和开发热重载也不会留下重复监听器。

## 文件位置

- `src/activities/domain-events.ts`：稳定的领域事件定义；
- `src/activities/activity-engine.ts`：注册表、活跃判断和事务内事件队列；
- `src/activities/default-activity-engine.ts`：生产环境启用的活动集合；
- `src/game-data/guide-mission-data.ts`：首个完整 handler——指引日程。

## 新增普通活动

优先把活动写成配置驱动的 handler，并复用已有领域事件。只有客户端规则不能用
通用计数、求和、最大值、布尔值或去重集合表达时，才新增专用业务代码。

新增活动的基本步骤：

1. 确认触发条件对应的是业务事实，而不是具体 Lua 方法名；
2. 必要时向 `DomainEvent` 联合类型增加事件；
3. 在完成该业务的 Repository 事务中发布事件；
4. 实现无外部副作用的 `ActivityHandler`；
5. 注册到 `default-activity-engine.ts`；
6. 为实时事件、登录状态投影、重复请求和领奖持久化补测试。

`reconcile` 必须幂等且单调，只能从当前 v1 业务状态投影进度，不能降低进度或清除领奖
标记。每日、每周和活动周期重置应通过明确的周期状态处理，不应借用
`reconcile` 猜测。

## 事件级联

handler 可以通过 `ActivityContext.emit()` 产生后续领域事件。引擎使用队列而非
递归调用，并限制单次事务最多处理 256 个事件，以便尽早发现循环依赖。奖励产生
的道具、货币等后续事件也应进入这个队列。

## 客户端兼容

当前客户端通过 `taskValues` 读取任务状态，因此指引日程仍将结构化进度投影到
任务组 5：

- 任务进度占第 1 至 31 位；
- 第 0 位为任务奖励领取标记；
- `41001` 的第 1 至 5 位为五档累计奖励领取标记。

后续活动可以逐步增加服务端结构化状态，但客户端所需的 `taskValues` 投影必须和
结构化状态在同一事务内更新。
