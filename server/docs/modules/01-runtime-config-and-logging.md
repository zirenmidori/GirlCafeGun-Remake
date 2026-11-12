# 运行、配置与日志

## 当前完成度

**核心可用。** 本机开发、热重载、生产构建、优雅关闭和文件日志链路均已建立。

## 已实现

- Node.js 22+、TypeScript ESM、pnpm 10；
- `pnpm dev` 使用 `tsx watch`，源码变化后重启进程并重新读取存档；
- `pnpm check` 串联 Prettier、ESLint、严格类型检查、Vitest 和构建；
- Zod 校验 `config/default.json`；
- 支持 HTTP/TCP 地址、日志级别等环境变量覆盖；
- HTTP 和 TCP 服务并行启动；
- `SIGINT/SIGTERM` 时停止监听、等待存档写队列并关闭日志；
- 日志同时输出终端和文件，支持级别过滤、颜色和按大小轮转；
- 未捕获异常与 Promise rejection 会写入结构化日志。

## 配置和文件

- 默认配置：`config/default.json`
- 启动入口：`src/index.ts`
- 配置加载：`src/config.ts`
- 日志实现：`src/logger.ts`
- 默认日志：`logs/server.log`

日志默认单文件 20 MiB、保留 5 份，协议十六进制预览上限 4096 字节。

## 验证

- `test/logger.test.ts` 验证终端颜色与纯文本文件日志；
- 全项目 build/typecheck 间接验证配置类型和启动依赖。

## 已知缺口

- 没有 metrics、trace、管理接口或运行时诊断面板；
- 日志写文件使用同步 I/O，单玩家开发服可接受，不适合高并发；
- 未捕获异常只记录，不强制退出，严重状态损坏后可能继续运行；
- 环境变量覆盖范围有限，服务器列表内容不能全部通过环境变量配置；
- 没有生产部署、守护进程、自动备份与恢复流程。
