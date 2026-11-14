# HTTP 渠道与服务器列表

## 当前完成度

**MVP。** 已满足客户端发现本地 TCP 网关的需要，不承担账号、资源或运营 API。

## 已实现接口

| 路径                    | 行为                                             |
| ----------------------- | ------------------------------------------------ |
| `GET /serverlist`       | 返回单个静态区服及网关地址、端口、状态           |
| `GET /serverstate/<id>` | 返回配置中的静态服务器状态                       |
| `GET /health`           | 返回启动时间和进程 uptime                        |
| `GET /notice.html`      | 本地公告网页（见 [23](23-offline-web-pages.md)） |
| `GET /web/<path>`       | `resources/web/` 下的静态网页                    |
| `GET /notice.txt`       | 公告列表 JSON                                    |
| 其他路径                | `404` JSON                                       |

除网页外，所有响应使用 UTF-8 JSON；全部响应使用`no-store` 和 `Connection: close`。每次请求记录方法、
路径和来源地址。ADB reverse 模式下渠道列表发布 `127.0.0.1:30400`。

## 状态来源

区服 ID、名称、状态和网关地址来自 `config/default.json`，运行时不持久化，也不
根据 TCP 服务健康情况自动变化。

## 验证

`test/http-server.test.ts` 通过真实监听端口请求 `/health`、网页和公告路由；
渠道列表主要通过客户端渠道页实际访问验证。

## 已知缺口

- 不校验 HTTP method；
- 没有版本检查、公告、维护窗口、动态区服状态；
- 没有登录 token、鉴权、限流、TLS 或 CORS 策略；
- 不提供资源清单、资源下载或离线资源更新；
- `/serverstate/<id>` 不检查传入的区服 ID。
