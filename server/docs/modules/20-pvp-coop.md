# 联机协同作战（PVP 合作）

## 当前完成度

**MVP。** 以走通客户端链路为目标：建队、AI 机器人队友、开战握手和战斗通道
保活可用；战斗过程完全由客户端本地模拟，服务器不参与战斗逻辑，结算奖励
尚未下发。

## 协议结构

联机协议族为 pvpproto（dump.cs 第 6493 号类型起），分两条通道：

1. **管理通道（16xx）**：复用主网关 TCP 连接，处理组队/匹配/房间管理；
2. **战斗通道（17xx）**：客户端收到 1652 `NotifyConnectToPvp` 后向其中
   的 ip:port 新建 TCP 连接，由独立的 `pvp-fight-server` 监听
   （`config.pvp.fightPort`，默认 30402）。

字段编号经 libil2cpp.so 各消息 `Parse` 方法反汇编逐一确认（tag 比较指令即
`字段号<<3|wire`）：绝大多数消息按声明顺序 1..N 编号；**例外 PlayerInfo
字段 3 被删除/保留**（index#1 name#2 camp#4 solution#5 roleId#6 code#7
serverid#8 level#9）。编解码集中在 `src/protocol/pvp-messages.ts`。

## 链路实现

- 1627 创建队伍：客户端请求**不携带 roleId/PlayerBaseInfo**（实机抓包
  `0881801420a51f280130003801`，仅 mapId/solutionId/isPublic/activityId/
  isReady），自己的房间资料由服务器从存档构建——`src/game-data/
pvp-solution.ts` 把 FormationState+背包投影为 EquipSolution（卡牌/武器
  gdpl 与等级、战力、头像少女），无卡组时战力压到 8000 以下，规避 nType==1
  地图客户端按空卡组均分战力的除零分支。1628 回包携带完整 Team（队长=
  玩家本人，其余为 `roleId>=200000000` 的机器人，客户端按机器人渲染，
  机器人编队复用玩家本人的 solution），随后推 1654 就绪数据；
- 1635 队伍就绪（房主"开始战斗"也是这条）→ 回 1636，房主 ready=true 时
  创建房间并推 1652（ip 取 `gateway.advertisedHost`，端口为战斗通道）。
  服务器重启后客户端可能仍停在房间界面直接重发 1635（无会话），此时按
  请求 mapId 现场重建队伍再推 1652，保证链路可恢复；
- 1623 匹配入口 → 回 1624 ret=0，0.5s 后推 1653 队伍数据、1.5s 后推
  1652，直接伪装匹配成功，避开 UI_OnlineMatch 的 120 秒超时；
- 1629 退出队伍 / 1639 拉取队伍 / 1631 刷新编队（按存档重建 solution 后
  重推 1653）/ 1637 房间公开开关（推 1655）/ 1642 心跳 / 1732 检查房间 /
  1720 表情（回推 1721）/ 1723 点赞 / 1729 踢人（仅允许踢机器人）均已应答；
- 所有请求的 roleId 一律以登录会话为准，不信任请求字段（多数请求客户端
  根本不发送该字段）；
- 会话状态为内存态（`src/game-data/pvp-session.ts`），连接断开即销毁，
  不持久化。

## 战斗通道行为

`src/servers/pvp-fight-server.ts` 同时在 `config.pvp.fightPort` 监听 TCP 与
UDP。实机验证确认客户端战斗房间传输层为 **UDP**（dump.cs `UDPClient :
FSocketClient` 由 `ClientRoom.InitSocket` 创建；房间为帧同步模型）。

Online 房间协议（UDP）格式经 libil2cpp `Parse`/`ProcessMsg`/`SendToClient`
反汇编确认：

- 客户端→服务器：7 字节头（`Frame.ClientMsgHeadLength`）+ 命令块序列，
  块为 `[u16 len][u8 cmd][payload]`，len 含自身 2 字节；
- 服务器→客户端：**u16 数据报总长前缀**（`UDPClient.ReceiveMessage` 校验
  `datagramLen - 2 == 首 u16`，即 Frame server HeadLength=2）+ 命令块序列，
  块为 `[u16 len][u8 playerIndex][u8 cmd][payload]`，len 含 4 字节头
  （`ClientRoom.ProcessMsg` 逐块解析）；
- cmd 枚举为 `Online.Command`：Ready=1、Loading=2、LoadingEnd=3、
  LoadingEndRsp=4、ApplyPlayerIndex=29、NotifyPlayerIndex=30、
  NotifyOtherPlayerIndex=31 等。

已实现握手：收到 ApplyPlayerIndex（29）→ 回 NotifyPlayerIndex（30）+ 每个
机器人的 NotifyOtherPlayerIndex（31），随后按正服 `ProcessReady` 行为追加
MessageLoading（2，payload=mapId u32 LE）通知进入加载阶段；收到
LoadingEnd（3）→ 立即回 LoadingEndRsp（4）触发客户端 `fightStartCall`
开战（机器人视为瞬时加载完成）；Breath（10）心跳原样回显保活。
**房间协议序号从 1 开始**：客户端按 `players[index-1]` 查找消息
目标（反汇编确认 0 会被直接丢弃），本机玩家固定 1，机器人依次 2..N+1。
战斗 UDP 无登录上下文，房间信息经共享的 `PvpSessionManager.
latestRoomSession()` 获取（离线单玩家假设）。未知命令记 debug 日志
（`pvp.fight.room_cmd`），格式非法记 `pvp.fight.udp_bad_datagram`。

TCP 侧保留 1700→1701 回显、1712→1713(frame+1)、1702→1703、1705→1706、
1715→1716、1717 日志应答，作为双协议兜底。

## 已知缺口

- 战斗内帧同步内容（CastSkill/NotifyDeath/NotifyStatus 等 Online.Command
  消息）一律只记日志不应答，机器人不会行动，战斗内部分事件（救援、
  状态同步）表现可能与正服不同；
- 战斗结束奖励（LuaCall 221 `SetOnlineReward`）、新人奖励（222）未下发，
  `UI_PVPSuccess` 可能显示空奖励；
- 1652 的 ip 写死为 `gateway.advertisedHost`，跨网段/模拟器需配置
  `GCG_GAME_HOST`；
- `closeTime` 固定取 `config.pvp.roomCloseSeconds`（默认 3600），到期由
  客户端自行退出，服务器不主动解散；
- 邀请、好友列表（LuaCall 210-212）、战斗内同步帧内容、断线重连房间
  （1611/1704）未实现；
- 字段编号已对已实现消息全部经反汇编确认（PlayerInfo 有字段 3 断层）；
  未实现消息如需扩展应按同样方式确认后再编码。

## 验证

`test/pvp-messages.test.ts` 覆盖真实抓包的 1627 解码、Team/PlayerBaseInfo/
PlayerList 嵌套编码、1652/1654 编码、1635/1712 解码、存档→EquipSolution
投影（含空编队战力封顶）、会话管理器生命周期，以及房间 UDP 协议的真实
抓包（ApplyPlayerIndex）解码与服务端命令块编码。
