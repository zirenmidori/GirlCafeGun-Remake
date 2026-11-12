# 手机通讯与引导回执

## 当前完成度

**MVP。** 当前引导涉及的两封信和引导步骤回执可用，完整手机/BBS 系统未实现。

## 手机通讯

服务端定义：

- topic `10001`，发起人少女 7，可产生一个回复位置；
- topic `1`，发起人 111，无回复选项。

登录时按发起人分组编码 v1 存档中的 `PHONE_MSG_NTF`；1-5 结算会自动加入
topic 10001。

支持 `PhoneMsg`：

- `nCmd=8`：返回空可发布 BBS 列表；
- `nCmd=3`：选择回复并持久化 reply ID；
- `nCmd=10`：删除信件；
- `nCmd=11`：新增已知信件并推送完整通知。

未知 topic 或命令只记录日志。运行记录中 `nCmd=7` 仍未实现。

## 引导与互动

- `LuaCall sCmd=102` 校验并回显 GuideID、StepID、GuideType、Timming；
- `GirlLogic HeadTouched` 的普通互动已实现次数、好感与任务；`nType=2` 保留独立的剧情回执。详见 [Headpats](22-headpats.md)。

引导进度本身主要由客户端任务值维护，服务端没有引导状态机。

## 验证

- `test/phone-message-data.test.ts` 验证回复 ID；
- `test/guide-data.test.ts` 验证引导回执字段；
- `test/protocol.test.ts` 验证手机通知编码；
- `test/persistence.test.ts` 覆盖新增、回复、删除和重载。

## 已知缺口

- 只定义两封信；
- BBS 发布、附件、奖励、未读状态和时间推进未实现；
- 缺少 `nCmd=7` 等客户端已观察命令；
- 没有短信/电话剧情的通用配置加载器；
- 引导日志只回执，不持久化、不分析，也不驱动服务端流程。
