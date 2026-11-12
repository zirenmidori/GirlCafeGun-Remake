# GCG2 离线研究服务器

Release builds merge `config/release.json` into the embedded configuration. They
use one device-local account (`gcg-offline-player-v1`), create a normal tutorial
save, and deliver Neptune plus Astral Covenant through a one-time welcome mail.
The release does not import or copy a playtest save. For a desktop release-profile
run, set `GCG_RELEASE_PROFILE=1`; ordinary desktop configuration remains separate.
Development grant CLIs require `GCG_ENABLE_DEV_TOOLS=1` and refuse the release profile.

这是原版客户端的本地最小服务端。目前包含：

- HTTP 渠道列表与健康检查；
- TCP 游戏网关、登录、玩家快照、任务同步和心跳；
- Lua C2S/S2C 调用链，以及新手剧情的 `GirlLogic.HeadTouched` 回调；
- 领域事件驱动的任务与活动引擎，以及指引日程进度和领奖；
- 悬赏战斗的星期轮换、每日额外奖励、盗宝娘和通关结算；
- 玩家及任务值的 JSON 持久化；
- 同时写入终端和文件的结构化日志。

当前全部功能模块、完成度和已知缺口见
[服务端功能模块总览](docs/modules/README.md)。总览中的“占位”模块只返回合法
空状态，不代表对应玩法已经完成。

## 启动

```sh
cd /Users/yricky/Downloads/Android/fangame-mvp/offline-server
pnpm install
pnpm dev
```

`pnpm dev` 使用 `tsx watch` 运行 TypeScript。修改 `src/` 后会自动热重载；
旧进程先处理 `SIGTERM` 并关闭监听，新进程随后读取原有持久化状态重新启动。

生产构建和启动：

```sh
pnpm build
pnpm start
```

默认监听：

- HTTP：`0.0.0.0:18080`
- TCP 游戏网关：`0.0.0.0:30400`
- 渠道列表向客户端公布：`127.0.0.1:30400`

客户端也使用设备自身的 `127.0.0.1:18080` 请求渠道列表。连接设备后，在电脑
上建立 ADB 反向转发：

```sh
pnpm adb:reverse
```

这会将设备的 `127.0.0.1:18080` 和 `127.0.0.1:30400` 分别转发到电脑上的
同名端口。ADB 连接中断或设备重启后需要重新执行。移除转发可运行
`pnpm adb:reverse:remove`。

HTTP 接口：

- `GET /health`
- `GET /serverlist?...`
- `GET /serverstate/<id>`

## 持久化和日志

- 玩家状态：[data/state.json](data/state.json)
- 运行日志：`logs/server.log`
- 默认配置：[config/default.json](config/default.json)

状态写入采用同目录临时文件加原子重命名。任务变更请求 `1027` 会更新玩家的
`taskValues`，后续登录再通过 `1026` 同步给客户端。

任务与活动的开发约定见
[docs/activity-engine.md](docs/activity-engine.md)。

未知账号首次请求登录时会创建一个结构完整但业务数据为空的玩家：名称为空、
任务列表为空，并在 VerifyRsp 中返回 `createrole=true`。首次 Login 成功后会
记录 `lastLoginAt`；后续登录同一账号时按已有玩家处理。

日志会追加写入，不会在重启时截断。追踪最新日志：

```sh
tail -f logs/server.log
```

默认单个日志文件上限为 20MiB，并保留 5 个历史文件；单个协议包最多记录
4096 字节的十六进制预览。这些值可以在 `config/default.json` 中调整。

## 环境变量

- `GCG_HTTP_HOST`
- `GCG_HTTP_PORT`（兼容旧名 `GCG_PORT`）
- `GCG_GATEWAY_HOST`
- `GCG_GATEWAY_PORT`（兼容旧名 `GCG_GAME_PORT`）
- `GCG_GAME_HOST`：渠道列表向客户端公布的网关地址；ADB 反向转发模式保持
  `127.0.0.1`
- `GCG_LOG_LEVEL`：`debug`、`info`、`warn` 或 `error`

## 检查

```sh
pnpm check
```

完整检查依次执行 Prettier、ESLint、TypeScript 严格类型检查、Vitest 和生产
构建。单独运行：

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
```

## Local test profile

The development-only grant uses the exact client catalog in
`resources/test-profile-catalog.json`. It is never run automatically on login.
After building, preview an existing account with:

```sh
node dist/tools/grant-test-profile.js --account=TutorialTest:local-only
```

Stop the server before applying. Add `--apply --backup=ABSOLUTE_BACKUP_FILE`
to save a new, exclusive backup and atomically update only the named account.
Restart the server afterward so its cached state reloads. The tool refuses to
apply while the tracked server PID is running. Repeating a grant replenishes
resources without duplicating the catalog items or replacing existing GUIDs.

The grant provides two copies of every playable card, weapon and rune, one
upgraded combat copy and one spare; rune levels remain at the implemented
base level. It also provides ordinary item stacks, currencies within client
caps, valid stage clears, supported appearance entitlements, and one stored
copy of every furniture item. Existing formations and unrelated profiles are
preserved. The recovered client supports affection 100 for normal girls and 50 for
collaboration girls; legacy catalog grants retain their older per-girl caps. Card skill upgrades, unavailable event/social modes,
and cafe placement/business behavior still need implementation; owning items
does not implement these services.

For a separately validated recovered client, `--catalog=ABSOLUTE_PATH` selects
a schema2 grant catalog. It supplies its own affection caps and story counts;
collaboration girls use separate task groups 90/91/92, and their story-read
bitmasks are preserved. A data-only recovery APK and catalog are staged under
`../tools/content-recovery`; the recovered client and catalog are now activated. Keep client
data and server catalog versions matched when changing content.

Cafe furniture instance IDs use a separate range starting at 10000, because
the client reserves low IDs for fixed scene objects. To repair a legacy test
grant without replenishing or resetting anything, preview with
`node dist/tools/grant-test-profile.js --account=TutorialTest:local-only --repair-cafe-ids`.
Stop the server and add the usual `--apply --backup=ABSOLUTE_PATH` to apply.
The repair refuses ambiguous placed/parented furniture and requires a cold
client restart afterward.

## Custom weapon: Astral Covenant

The local extension `resources/custom-weapons.json` adds the rifle GDPL
`[2,2,28,1]`; the recovered 140 weapon definitions and all lottery pools remain
unchanged. It requires the matching Astral Covenant client data/model build.
Do not grant this ID while using an older client that lacks the definition.
The runtime weapon table now has 141 rows; template rarity is authoritative for
enhancement, decomposition, passive skills and formation power, even for
weapons absent from lotteries. The default full test-profile grant merges this
one extension in memory (499 instance templates); explicitly selected older
catalogs retain their original contents.

After building, preview a narrow grant to an existing account:

```sh
node dist/tools/grant-custom-weapon.js --account=NAME:password
```

The default grants enough copies to own **one** active Astral Covenant, at
level 1, breakthrough 0, unlocked. `--copies=N` selects a minimum total of
1–40 active copies, useful for duplicate-based progression tests. Repeating
the same grant adds nothing. Existing instances (including their GUIDs, levels,
EXP, breakthroughs and locks), other inventory, currencies, tasks, formations,
cafe state and other accounts are preserved. It never automatically grants on
login or adds the weapon to a lottery. Preview does not write a save.

Only after installing the matching client and stopping the server, add
`--apply --backup=ABSOLUTE_BACKUP_FILE` to create an exclusive backup and
atomically save only the selected account. Restart the server to reload its
cached state. Applying refuses a running tracked server.

`WeaponLogicMsg` command 3 now implements normal weapon breakthrough, using
the exact recovered `Item/WeaponBreak.txt` (copied to
`resources/weapon/breakthrough.txt`). A four-star weapon consumes 1/2/3/4
matching duplicates or four-star breakthrough materials plus 50,000/100,000/
150,000/200,000 crystal coins, respectively; caps become 50/60/70/80 and
passive levels become 2/3/4/5. Locked, equipped, unowned, wrong-template and
replayed consumed donors are rejected without partial writes. The gateway
sends authoritative inventory/money/task updates before its success callback.

## Offline recruitment rotation

The standard character and weapon banners stay available. The matching offline client adds one rotating character banner and one rotating weapon banner, both with pool ID 850 in their respective categories. Each banner uses the standard ticket costs, rarity probabilities, and ten-pull hedge. The character banner retains its own 50-pull pity across rotations. The rotation leaves standard banner history and pity untouched.

Each of the 26 cohorts lasts seven days by default. Set `gachaRotationDays` in `config/default.json` or set `GCG_GACHA_ROTATION_DAYS` to an integer from 1 through 14. A value of 0 disables the added banners. The schedule advances at 04:00 UTC+8 on the same operational day the server uses for daily rewards. Every eligible template appears once per cycle at minimum. The default cycle is 182 days and the maximum is 364 days.

The schedule includes 221 character cards and 134 weapons, including Astral Covenant. It excludes the 42 Fantasy Oath card stages, exact stock starter instances, reachable campaign first-clear rewards, and equipment from the implemented eight-day and monthly sign-ins. Weapon `2:2:10001:1` remains in the rotation because its shops require currencies this server does not award. The roster records every exclusion in `resources/gacha/rotation-roster.txt`. Regenerate it from the verified catalogs with `python -B ../tools/gacha-rotation/generate_roster.py` from the server directory.

The client requests the active manifest with `GetOfflineGachaRotation`. Its next pool 850 pull must include the current `rotationRevision`. An expired revision returns the new manifest and rejects the pull before spending tickets or updating pity. Existing clients can continue using the original banners.
