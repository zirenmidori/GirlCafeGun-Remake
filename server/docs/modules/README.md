# 服务端功能模块总览

更新时间：2026-11-06

本目录依据当前源码、配置、61 个测试文件和实际 `schemaVersion=1` 存档走查整理。
完成度采用以下口径：

- **闭环**：核心状态持久化，正常/重复/失败路径基本完整，并有自动化验证；
- **核心可用**：主要玩法可执行，但仍缺少部分规则、命令或客户端验证；
- **MVP**：足以解除当前流程阻塞，只模拟了最小状态；
- **占位**：仅返回客户端可接受的空结构，没有对应玩法。

完成度不是代码质量评分，也不代表原服全部行为已经复刻。

| 模块                                                       | 当前级别                 | 摘要                                                                            |
| ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| [运行、配置与日志](01-runtime-config-and-logging.md)       | 核心可用                 | TS、pnpm、热重载、配置校验、双写轮转日志                                        |
| [HTTP 渠道服务](02-http-server-list.md)                    | MVP                      | 渠道列表、服务器状态、健康检查                                                  |
| [TCP 协议与网关](03-protocol-and-gateway.md)               | 核心可用                 | 拆包、基础 Protobuf、串行请求与 Lua RPC 路由                                    |
| [持久化、玩家与登录](04-persistence-player-and-session.md) | 核心可用                 | 原子 JSON v1 存档、建号和登录同步                                               |
| [物品、奖励与少女名册](05-inventory-rewards-and-roster.md) | 核心可用                 | 统一背包、锁定、分解奖励和少女状态投影                                          |
| [关卡与玩家成长](06-chapter-and-progression.md)            | 核心可用                 | 528 关配置、体力、掉落、星级、经验和活动事件                                    |
| [少女、编队与特训](07-girl-formation-and-training.md)      | MVP/核心可用             | 外观、模块编队、送礼、特训与羁绊剧情解锁可用                                    |
| [角色卡与武器强化](08-card-and-weapon-enhancement.md)      | 核心可用                 | 强化、武器突破、实例锁定、武器技能展示、角色卡和武器分解                                  |
| [角色与武器抽卡](09-gacha.md)                              | 核心可用                 | 原概率表、保底、UP、自选、暂存和成本结算                                        |
| [任务与活动引擎](10-task-and-activity-engine.md)           | 核心可用                 | 领域事件、指引日程与服务端权威日常任务                                          |
| [每日与八日签到](11-sign-in-activities.md)                 | 闭环/核心可用            | 04:00 日界、月重置、累计登录和幂等奖励                                          |
| [指引日程](12-guide-mission.md)                            | 核心可用                 | 15 项配置和领奖完整，部分进度来源仍缺失                                         |
| [Cafe and house](13-cafe-and-house.md)                     | Core; phone playtest passed | Saved layouts, furniture commerce, staff, coffee, NPC sales and offline reports |
| [手机通讯与引导回执](14-phone-and-guide.md)                | MVP                      | 两封引导信、回复/新增/删除和引导日志回执                                        |
| [商店](15-shop.md)                                         | 核心可用                 | 普通商店列表/随机货架/限购/阶梯价/折扣/刷新/购买闭环 + 免费礼包与月卡免费发放   |
| [Live2D 状态](16-live2d-state.md)                          | MVP                      | 登录同步开放等级和 HX 开关                                                      |
| [外围系统空状态兼容](17-background-compatibility.md)       | 占位                     | 好友、社团、助战等六类空响应                                                    |
| [悬赏战斗](18-bounty-battle.md)                            | 核心可用                 | 72 关、轮换、每日加成、盗宝娘和通关结算                                         |
| [日常任务与活跃奖励](19-daily-mission.md)                  | 核心可用                 | 04:00 重置、十项进度、任务/宝箱/一键领奖                                        |
| [联机协同作战](20-pvp-coop.md)                             | MVP                      | 建队、AI 队友、开战握手与战斗通道保活                                           |

| [Fantasy Oath](21-fantasy-oath.md) | Core implementation; phone playtest passed | Saved activation, objectives, card stages, rewards and exchanges |

| [Headpats](22-headpats.md) | Implemented; phone playtest passed | Shared charges, refill, affection, daily and oath progress |

| [Local web pages](23-offline-web-pages.md) | Implemented; not seen on a device | Notice page, notice lists and server-error page for the web windows |

## 自动化验证现状

`pnpm check` 会运行格式检查、ESLint、TypeScript 严格类型检查、Vitest 和生产
构建。当前共有 61 个测试文件、161 项测试。数据算法和 Repository 的覆盖较好，
但 HTTP/TCP 服务器没有端到端 socket 测试，很多 Lua 回调只经过设备日志验证。

## 当前最重要的共性缺口

1. Gateway 和 `PlayerRepository` 仍是大型路由/领域文件，需要逐步拆分应用服务。
2. 存档加载没有 v1 Zod 校验或自动备份，格式错误的失败反馈不够明确。
3. 活动引擎只有指引日程一个 handler，尚未承载两百多个活动。
4. 客户端 `TASK_CHANGE_REQ` 仍可覆盖多数兼容任务值；普通日常任务及其活跃字段
   已改为服务端保护，但其他任务仍属于研究阶段的信任模型。
5. 多数外围系统是空状态兼容，不应被视为玩法已经实现。

## 本次走查发现的具体实现债

- 自选 UP 的“读取旧计数、再写新值”不是单个 Repository 事务，多连接并发时存在
  丢失更新风险；
- 关卡重复结算缓存只存在于当前连接，断线重连后的业务幂等仍需补强。
