# 持久化、玩家与登录会话

## 当前完成度

**核心可用。** 单机单进程下能够原子保存当前格式的玩家状态。

## 存档模型

当前且唯一支持的存档格式为 `schemaVersion=1`，按账号保存：

- 身份、名称、等级、经验、战力和登录时间；
- 货币、统一背包、少女、编队、关卡；
- `taskValues`；
- 咖啡馆、手机通讯、抽卡暂存；
- 每日签到、八日签到和 Live2D 状态。

`JsonStore.update()` 会复制完整状态、串行执行 mutation、写临时文件后原子重命名。
失败 mutation 不会替换内存状态。Repository 对外返回副本，避免调用方越过事务修改。

## 建号和登录

未知账号创建空名称玩家，但包含可继续引导的初始结构：

- 3 张初始角色卡及对应少女；
- 1 套初始编队；
- 28 电力，金币和钻石为 0；
- 四种基础咖啡学习位；
- 空关卡、咖啡、电话和抽卡暂存。

Verify 根据 `lastLoginAt` 返回是否需要创建角色；Login 记录登录时间，并执行签到、
活动运营日和任务进度同步。这些同步属于 v1 正常运行逻辑，不改变存档结构。

现有账号按完整 v1 结构直接加载。角色奖励和抽卡到账后，服务端会把当前背包内容
投影到少女、服装和任务状态；这属于业务事务的一部分。

## Save safety

- **Daily backup.** `JsonStore.initialize()` copies the bytes it just loaded to
  `<backupDirectory>/state-YYYYMMDD.json` (UTC date) when that day's copy does not
  exist. The copy is made before any mutation of the new run, so it holds the
  state from the end of the previous run. Only the newest `backupCount` copies
  stay (default 7, `0` disables). Other files in the directory are not touched. A
  failed copy is logged as `persistence.backup_failed` and does not stop the
  server.
- **Moved clock.** Retention keeps today's copy first, then earlier days, and only
  then copies dated after today (`rankBackups`). A device clock that was set
  forward and back therefore cannot make every new daily copy the "oldest".
- **Unreadable save.** Invalid JSON, or a document that `assertLoadableState()`
  rejects, is copied to `state.json.corrupt-<UTC time>`. Startup then fails with
  `SaveFileError`, which names that copy and the latest daily backup. The store
  never writes a fresh state over an existing file. A restart loop reuses an
  identical earlier copy.
- **Load check.** `assertLoadableState()` accepts an object root, `schemaVersion`
  absent or `1`, a `players` map, and for each player the `money`, `inventory`,
  `girls`, `formations` and `levels` lists plus `taskValues`. It is a gate against
  loading the wrong file or a newer format, not a full schema. Field repair stays
  in the `reconcile*` functions.

The idea comes from the GirlCafeGun-Offline phone build, which copies its save
once per day before the server starts.

## 验证

`test/persistence.test.ts` 覆盖 v1 建号、登录、任务、咖啡、关卡、电话、编队和原子落盘。
各业务模块另有 Repository 持久化测试。
`test/json-store-backup.test.ts` covers the daily copy, retention, the disabled
state, preserved broken saves, each rejected document shape and a reload of a
repository-written save. `test/config-backup.test.ts` covers the configuration.

## 已知缺口

- 加载时只做文档级校验（见 Save safety），尚未执行完整的 v1 字段 schema 校验；
- 没有校验和、自动恢复（需要手动复制备份）、事务日志或并发进程锁；
- 每次 mutation 都复制并重写完整 JSON，规模增大后性能有限；
- 账号身份由客户端字符串决定，不具备安全认证能力；
- `PlayerRepository` 体积过大，仍混合多个领域职责。
