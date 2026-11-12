# Live2D 状态同步

## 当前完成度

**MVP。** 只实现登录期的全局功能开关同步，不负责 Live2D 资源或动画播放。

## 已实现

玩家存档包含：

- `live2dEnableLevel`：默认 3；
- `live2dHX`：默认 `false`。

这两个字段是 v1 玩家状态的必填部分。Login 阶段在玩家快照之前发送：

- `LIVE2D_ENABLE_LEVEL_NTF (1036)`；
- `LIVE2D_HX_STATE_NTF (1037)`。

客户端据此决定 Live2D 功能开放等级和 HX 状态。

## 验证

`test/protocol.test.ts` 验证两个通知的 Protobuf 编码。当前真实客户端登录日志确认
通知已发送。

## 已知缺口

- 没有修改这两个字段的业务协议；
- 没有角色 Live2D 选择、解锁、动作或服装状态；
- 不提供 moc、纹理、动作、物理等资源；
- 本项目之外的资源解包、还原、ZIP 播放器和 APK 打包流程不属于该服务端模块；
- 不负责 Unity 中 Live2D 渲染或兼容性修复。
