# 每日签到与八日签到

## 当前完成度

每日签到为**闭环**；八日签到为**核心可用**。

## 每日签到

支持 `SignUpMsg nType=1`：

- 使用 Asia/Shanghai 04:00 作为运营日界；
- 按自然月维护今日标记和累计次数；
- 月份变化时重置；
- 复刻原始 31 天循环奖励表；
- 每个运营日最多领取一次；
- 在同一事务内发放物品/货币、更新少女名册和任务值；
- 返回 `NormalActivityMsg`。

其他 `nType` 明确返回失败空奖励。

### 月卡每日签到

客户端没有独立的月卡签到命令：签到页只发 `nType=1`，月卡部分由服务端在同一
次签到里完成。月卡激活（任务组 1 task 36 到期时间 ≥ 当前时间）时：

- 组 20 / 11004（`TID_MONTHSIGN`）置 1 并发每日 50 钻石（`[15,2,1,1,50]`）；
- 组 20 / 11005（`TID_MONTHSIGN_Energy`）置 1 并发每日 30 体力
  （`[15,4,1,1,30]`，genre 15 detail 4 = `ItemEnergyAuto`，全局 `grantAwards`
  新增 detail 4 → 体力货币的映射）；
- 数值出自 ItemList 的 `IBMonthCardAuto`（`[14,2,1,1]`）ExtParam2/ExtParam3；
- 两个任务位随 11001 一起在 04:00 运营日界重置；
- **当天已签后再购卡**的边缘情况也会补发月卡部分（`fresh=false` 但
  `tbAward` 含月卡奖励），否则客户端签到按钮常亮、登录弹窗（
  `NormalActivityConfig:ShowPopBanner` / `CheckSignPop`）反复出现。

响应的 `tbAward` 由单奖励改为奖励数组，普通签到与月卡奖励合并下发。

## 八日签到

活动 ID `29`，Achievement ID `23～30`：

- 每个运营日首次登录累计一天，最多 8 天；
- 登录时把累计天数投影到任务组 18；
- `NormalActivityGetAward` 校验完成度和重复领取；
- 发放八档原始奖励并返回 `MissionMgrMsg`；
- 累计天数和最后登录运营日直接保存在 v1 玩家状态中。

## 验证

- `test/daily-sign-up-data.test.ts`：04:00 日界、月天数和奖励表；
- `test/daily-sign-up-persistence.test.ts`：日幂等、跨日和跨月、月卡每日钻石/
  体力随签到发放与重置、先签到后购卡的补签；
- `test/eight-day-sign-up-persistence.test.ts`：累计登录、领奖、重复拦截和落盘。

## 已知缺口

- 只实现每日签到类型 1 和八日签到活动 29；
- 没有补签、VIP 加成、跨时区或管理员校时；
- 月卡补偿（`TID_MONTHSIGN_Energy_Got`=11006，`nSubType=10`）未实现；
- 没有独立活动开放期，八日签到对所有账号永久存在；
- 八日签到仍是专用 Repository 逻辑，尚未迁移到活动引擎；
- Lua 网关没有端到端协议测试。
- 八日签到成功领奖目前会发送两次相同的任务同步，功能无损但需要清理。
