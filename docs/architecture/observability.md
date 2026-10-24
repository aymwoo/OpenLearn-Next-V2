# 可观测性架构（Observability）

本文以当前代码为唯一真源，描述 OpenLearn V2 已经落地的日志、审计、错误上报、探针和指标。核对范围：`packages/core/observability/`、`server/routes/health.ts`、`server/middleware/request-observability.ts`、`server/routes/client-errors.ts`、`server/utils/logger.ts`、`server/utils/error-handler.ts`、`packages/core/kernel/index.ts`、`packages/core/ai-capability/logging/capability-logger.ts`、`docker-compose.yml`、`Dockerfile`。

没有分布式追踪。Prometheus 文本只包含下面 §4 列出的序列。进程内计数器随进程重启归零。

---

## 1. 模块清单

`packages/core/observability/` 没有 `index.ts`。调用方按文件路径深导入。

| 文件                                                  | 职责                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `packages/core/observability/logger.ts`               | 平台 pino 单例 `logger` 与 `createLogger(component)` |
| `packages/core/observability/redaction.ts`            | pino 字段路径脱敏（`buildRedactOptions`）            |
| `packages/core/observability/rotating-file-stream.ts` | 访问日志与审计日志的按大小轮转                       |
| `packages/core/observability/sanitize.ts`             | 即将离开进程的错误载荷和审计字段的递归脱敏           |
| `packages/core/observability/request-context.ts`      | 当前 HTTP 请求的 `requestId`（`AsyncLocalStorage`）  |
| `packages/core/observability/audit-log.ts`            | 安全审计，写入 `audit.log`                           |
| `packages/core/observability/error-reporter.ts`       | 脱敏后的错误事件；配置 DSN 时再转发                  |
| `packages/core/observability/health.ts`               | 就绪判定，以及存活 / 就绪的公开 JSON                 |
| `packages/core/observability/metrics.ts`              | Prometheus 文本                                      |

HTTP 入口不在这个目录里：

| 入口                                               | 文件                                         |
| -------------------------------------------------- | -------------------------------------------- |
| `GET /health`、`GET /health/ready`、`GET /metrics` | `server/routes/health.ts`                    |
| 访问日志、状态类计数、403/429 审计、未捕获的 5xx   | `server/middleware/request-observability.ts` |
| `POST /api/client-errors`                          | `server/routes/client-errors.ts`             |
| 路由 `sendSafeError` 的 5xx                        | `server/utils/error-handler.ts`              |
| 进程级 `uncaughtException` / `unhandledRejection`  | `server.ts`                                  |

`server/utils/logger.ts` 只 re-export `logger` 与 `createLogger`。生产代码直接 import `packages/core/observability/logger.ts`。`packages/core/__tests__/layering.test.ts` 禁止 `packages/core` 再去 import `server/`。

`packages/core/di/token.ts` 没有日志 Token。插件日志是上下文属性，见 §6。

下面这些载体彼此不合并成一条链路：平台日志文件、安全审计文件、SQLite `events` 表、AI 能力内存日志、Prometheus 计数器。HTTP 的 `requestId` 会出现在访问日志、审计记录和错误上报里；它不是 `events.correlationId`。

---

## 2. 存活与就绪

`server/routes/health.ts` 的 `registerHealthRoutes` 在 `server.ts` 里注册。两个探针都不要求登录。

### 2.1 `GET /health`

存活。响应体由 `livenessBody` 生成，只有：

```json
{ "status": "ok", "uptime": 0, "version": "0.6.1" }
```

`uptime` 是自本次注册探针以来的整秒数。`version` 默认取 `packages/core/version.ts` 的 `PLATFORM_VERSION`。

`Dockerfile` 与 `docker-compose.yml` 的 `HEALTHCHECK` 用 wget 访问 `http://127.0.0.1:9000/health`。这个探针不检查数据库。

### 2.2 `GET /health/ready`

就绪。`checkReadiness` 按顺序做三件事，任何一步失败就停：

1. `pingDatabase`：默认 `SELECT 1`。
2. `probeStorageWritable`：在存储目录写一个探针文件再删掉。存储目录来自 `getStorageDir()`。
3. `migrationsComplete`：读 `migrations/` 里每个 `.sql` 的文件名（去掉扩展名），要求这些名字都出现在 `_migrations.name` 里。目录缺失、没有 `.sql`，或查询已应用名单失败，都视为未就绪。

成功时 HTTP 200，体为 `{ "status": "ready" }`。失败时 HTTP 503，体为 `{ "status": "not_ready" }`。`readinessBody` 不返回数据库路径、错误文本、待应用名单或备份信息。失败原因（`database`、`storage`、`migrations`）和待应用文件名只出现在进程的警告日志里。

磁盘上的迁移文件都已应用时，库里多出来的迁移名不会让这次检查失败。

---

## 3. 访问日志与请求 ID

`requestObservability` 挂在路由之前。

- 请求头 `x-request-id` 若匹配 8–64 位的字母、数字、`.`、`_`、`:`、`-`，就沿用；否则生成 UUID。响应头回写同一个值。
- 该 ID 放进 `requestLogContext`，同一条异步调用链里的 `recordSecurityAudit` 可以读到它，不必改命令载荷。
- 响应结束时 `recordHttpResponse(status)`，并在判定需要记录时写一条 `http.request`。字段只有 `requestId`、`userId`、`method`、`path`、`status`、`durationMs`。不写查询串，不写请求体。
- `userId` 来自已挂上的会话，否则从会话 cookie 解析；没有则是 `anonymous`。截断到 64 字符。
- **静默白名单 (`isQuietRequest`)**：公共入口（`/`、`/index.html`、`/favicon.ico`、`/robots.txt`）、探活（`/health`、`/health/ready`）以及开发环境 Vite 内部资源（`/@vite/`、`/src/` 等）在状态码小于 400 时不写 `http.request`。它们仍然计入 §4 的状态类计数。`/metrics` 不在静默名单里。通过环境变量 `HTTP_ACCESS_LOG_IGNORE` 可配置额外的逗号分隔前缀名单（如 `/api/vfs,/api/classroom/sessions/`）以静默特定高频接口。
- **访问日志分级与降噪 (`HTTP_ACCESS_LOG`)**：
  - 默认模式 `HTTP_ACCESS_LOG=errors`（未配置且 `LOG_LEVEL` 不是 `debug`/`trace` 时）：正常的成功请求（`< 400` 且未超出慢请求阈值）默认静默，彻底消除前端轮询刷屏；
  - `status >= 500` 时以 `error` 级别输出；
  - `status >= 400` 或耗时 `durationMs >= HTTP_SLOW_MS`（默认 1000ms）时以 `warn` 级别输出；
  - 排障模式 `HTTP_ACCESS_LOG=all`（或显式设置 `LOG_LEVEL=debug`）：成功请求降为 `debug` 级别输出；
  - 关闭模式 `HTTP_ACCESS_LOG=off`：完全不写 `http.request` 日志。
- **解耦保证**：指标计数（§4）、403/429 安全审计与 5xx 错误捕获不受 `HTTP_ACCESS_LOG` 开关影响。

状态码 403（路径不是 `/api/auth/login`）写审计事件 `auth.forbidden`。状态码 429 写 `rate_limit.triggered`。状态码大于等于 500，且 `sendSafeError` 尚未标记 `errorCaptured` 时，再记一条 `source: http` 的错误上报。

---

## 4. `GET /metrics`

`packages/core/observability/metrics.ts` 渲染进程内计数，另有三条运维 gauge 由 `server/routes/health.ts` 的采样器注入（读不到时为 `-1`，样本进程内缓存 15 秒）。路由层决定谁能看：

- 环境变量 `METRICS_TOKEN` 非空，且 `Authorization` 精确等于 `Bearer <该值>` 时放行。
- 否则走 `server/middleware/auth.ts` 的 `requireAuth('administrator')`。未配置 token 时，只有管理员会话可以访问。

响应 `Content-Type` 为 `text/plain; version=0.0.4; charset=utf-8`，`Cache-Control: no-store`。

当前文本只有这些序列：

| 名称                                      | 类型    | 含义                                                         |
| ----------------------------------------- | ------- | ------------------------------------------------------------ |
| `openlearn_up`                            | gauge   | 常量 `1`，表示渲染函数在跑                                   |
| `openlearn_process_uptime_seconds`        | gauge   | 自 `metrics.ts` 被加载以来的秒数，三位小数                   |
| `openlearn_process_resident_memory_bytes` | gauge   | `process.memoryUsage().rss`                                  |
| `openlearn_http_responses_total`          | counter | 标签 `status_class` 为 `2xx`、`3xx`、`4xx`、`5xx` 或 `other` |
| `openlearn_migrations_pending`            | gauge   | 磁盘上尚未记入 `_migrations` 的迁移个数；读不到时为 `-1`     |
| `openlearn_backup_age_seconds`            | gauge   | 备份目录里最新文件的年龄（秒）；没有文件时为 `-1`            |
| `openlearn_events_rows`                   | gauge   | `events` 表当前行数；查询失败时为 `-1`                       |

### 4.1 按插件维度的指标（Issue #150）

同一份 `/metrics` 文本在进程级序列之后追加按插件维度的计数（`packages/core/observability/plugin-metrics.ts`）。没有任何插件指标时这一段为空，不产生空样本。

| 名称                                                         | 类型    | 含义                                                  |
| ------------------------------------------------------------ | ------- | ----------------------------------------------------- |
| `openlearn_plugin_commands_total{plugin,result}`             | counter | 命令派发次数；`result` 为 `ok` / `error`              |
| `openlearn_plugin_command_duration_seconds_sum{plugin}`      | counter | 命令派发累计耗时（秒）                                |
| `openlearn_plugin_command_duration_seconds_count{plugin}`    | counter | 参与计时的命令数，与 sum 配对求平均                   |
| `openlearn_plugin_events_total{plugin}`                      | counter | 插件发出的事件数（`event.source = plugin:<id>`）      |
| `openlearn_plugin_http_requests_total{plugin,status}`        | counter | 插件 REST 网关请求数；`status` 为状态类 `2xx`…`other` |
| `openlearn_plugin_http_request_duration_seconds_sum{plugin}` | counter | 网关派发累计耗时（秒）                                |
| `openlearn_plugin_worker_crashes_total{plugin}`              | counter | Worker 非零退出次数（含激活期崩溃）                   |
| `openlearn_plugin_worker_restarts_total{plugin}`             | counter | 看门狗排定的重启次数（熔断后不再增加）                |

归因规则：`actorId` 以 `plugin:` 开头时取 manifest id；否则看命令命名空间，**只有内核能解析到已安装插件**（`PluginHost.findByManifestId`）时才归因，避免把核心命令算到插件头上。`plugin` 标签值会做 Prometheus 转义与长度截断；登记条目超过 200 个后落到 `plugin="__overflow__"`，防止安装/卸载反复产生新 id 把基数拖爆。

查询示例：

```promql
# 最近 5 分钟错误率最高的插件
topk(5, sum by (plugin) (rate(openlearn_plugin_commands_total{result="error"}[5m])))
# 平均耗时（秒）
sum by (plugin) (rate(openlearn_plugin_command_duration_seconds_sum[5m]))
  / sum by (plugin) (rate(openlearn_plugin_command_duration_seconds_count[5m]))
```

状态类由 `statusClassOf` 划分。计数在响应 `finish` 时加一，包括探针自己的响应。文本里没有路径、用户、查询串或错误字符串。行为由 `packages/core/observability/__tests__/readiness.test.ts` 锁住。三条运维 gauge 的样本 15 秒内复用同一份（`OPERATIONAL_GAUGE_CACHE_MS`，路由选项可覆盖，`0` 表示每次抓取都重新查询）。

---

## 5. 平台日志

### 5.1 出口

`packages/core/observability/logger.ts` 在 import 时创建 pino 单例。级别是 `LOG_LEVEL`，否则生产为 `info`、非生产为 `debug`。改环境变量后要重启。

| 路     | 去向                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 控制台 | 生产：`stdout` 上的 JSON 行。非生产：`pino-pretty`（`package.json` 的 devDependency）。pretty 加载失败时退回 `stdout`，进程仍能启动 |
| 文件   | 目录可写时，`RotatingFileStream` 写 `<LOG_DIR>/openlearn.log`。默认目录是进程 cwd 下的 `logs/`。目录不可写时只留控制台              |

两路默认使用同一个级别；亦可通过 `LOG_CONSOLE_LEVEL` 针对控制台独立设置日志级别（例如控制台设为 `warn` 保持清爽，文件保留 `debug` 全量记录）。脱敏发生在分发之前，所以控制台和文件看到的是同一份已脱敏记录。

`docker-compose.yml` 与 `Dockerfile` 把 `LOG_DIR` 设为 `/data/logs`。该路径在数据卷 `openlearn_data`（挂载点 `/data`）里面，容器重建后日志还在这个卷上。`ecosystem.config.cjs` 把 `LOG_LEVEL` 设为 `info`。

### 5.2 轮转

`packages/core/observability/rotating-file-stream.ts` 用同步 `fs.writeSync`，不引入额外 npm 包。写入前若超出上限，先删最旧的一份，再把 `.1` … `.N` 依次后移；rename 前先 unlink 目标，避免 Windows 不能覆盖已存在文件。首次写入才打开文件。模块级只注册一个 `process.on('exit')` 去 `dispose()`。

| 变量                | 默认                      | 作用于                                                         |
| ------------------- | ------------------------- | -------------------------------------------------------------- |
| `LOG_DIR`           | `<cwd>/logs`              | 访问日志与审计日志的目录                                       |
| `LOG_MAX_SIZE_MB`   | 10                        | `openlearn.log`                                                |
| `LOG_MAX_FILES`     | 5                         | `openlearn.log` 的历史份数                                     |
| `LOG_LEVEL`         | 生产 `info`，否则 `debug` | 平台 logger 与文件日志级别；审计 logger 的 pino 级别同样读取它 |
| `LOG_CONSOLE_LEVEL` | 继承 `LOG_LEVEL`          | 控制台单独级别（可选）                                         |
| `LOG_REDACT`        | 开启                      | 设为 `false`、`0`、`off`、`no` 时关闭 pino 字段脱敏            |

非法的大小或份数回退到默认值并告警一次。

### 5.3 字段脱敏

`packages/core/observability/redaction.ts` 按字段名替换为 `***REDACTED***`。pino 10 自带的 fast-redact 不支持双星号递归通配符：写成递归路径会静默匹配不到任何字段。实现改为每个字段名展开裸名，再加上 1 到 10 层单星前缀（`MAX_REDACT_DEPTH`）。`packages/core/observability/__tests__/redaction.test.ts` 覆盖这个行为。

当前名单：`apiKey`、`api_key`、`password`、`passwordHash`、`password_hash`、`authorization`、`Authorization`、`cookie`、`Cookie`、`sessionToken`、`passcode`、`class_passcode`、`classPasscode`、`requestPayload`、`responsePayload`、`secret`、`newPassword`、`oldPassword`、`currentPassword`、`confirmPassword`、`textContent`、`text_content`、`studentAnswer`、`student_answer`、`answer`、`answers`、`session_data`、`edu_os_token`、`set-cookie`、`Set-Cookie`。

pino 路径**刻意不**脱敏 `token`。仓库里大量 `token` 是依赖注入 Token，不是会话凭据。会话凭据走 `cookie`、`sessionToken`、`edu_os_token`。

挡不住的情况：

- 拼进字符串的秘密，例如消息文本里的密钥，或 `error.message` 里的 URL。
- 嵌套深于 10 层，或字段名不在名单里。
- 不经过 pino 的 `console.*`。
- SQLite `events` 表与 `CapabilityLogger` 不走这份 pino 配置。事件表入库前另有口令字段处理，见 §8。

### 5.4 离开进程之前的递归脱敏

`packages/core/observability/sanitize.ts` 的 `sanitizeValue` / `scrubString` 用在审计记录和错误上报上，与 pino 路径互补。它按字段名整值替换，并在字符串里遮住 `olenc1:` 密文、`token_` 前缀、`Bearer` 和 bcrypt 哈希。深度上限 8，数组只保留前 20 项，字符串截断到 4000 字符。

这一层额外遮住 pino 名单里没有的 `token`、`content`、`correct_answer`、`headers`、`body`、`req`、`request`、`socket`。它仍然不理解自由文本里的学生作文。

---

## 6. 安全审计

`recordSecurityAudit`（`packages/core/observability/audit-log.ts`）与访问日志分开轮转，方便单独保留。

- 文件：`<LOG_DIR>/audit.log`。`AUDIT_LOG_MAX_SIZE_MB` 默认 20，`AUDIT_LOG_MAX_FILES` 默认 20。超出份数的最旧文件删除，没有按天切割，也没有外发。
- 非测试环境始终写 stdout。目录不可写时只有 stdout。测试环境（`NODE_ENV=test` 或设置了 `VITEST`）使用 silent logger，不写文件。
- 同一条记录再写进平台 logger。记录经过 `sanitizeValue`。
- 每条都带 `audit: true` 和 `event`。未显式传入 `requestId` 时，从 `requestLogContext` 补上。

当前写入的事件：

| `event`                        | 调用位置                                                  | 记录什么                                                                             |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `auth.login_failed`            | `server/routes/roster.ts` 的登录处理                      | `reason`、`entrance`、截断后的 `account`。不写口令                                   |
| `auth.forbidden`               | `server/middleware/request-observability.ts`              | 响应 403，且路径不是登录接口。带 `requestId`、`userId`、`method`、`path`             |
| `rate_limit.triggered`         | 同上                                                      | 响应 429。字段同上                                                                   |
| `plugin.installed`             | `packages/plugins/builtin.ts`、`server/routes/plugins.ts` | `actorId`、插件标识，以及 `via`（`source`、`zip`、`url`、`zip-raw`）。不写压缩包字节 |
| `plugin.enabled`               | `packages/plugins/builtin.ts`                             | `actorId`、`pluginId`                                                                |
| `plugin.public_route_approved` | `server/routes/plugins.ts`                                | `actorId`、`pluginId`、`manifestId`、获准的路由列表                                  |

这张表不是总线事件表。领域事件仍进 §8 的 `events`。

---

## 7. 错误上报

`packages/core/observability/error-reporter.ts` 的 `captureError` 先 `sanitizeErrorReport`：去掉 path 上的查询串，消息、名称、堆栈按 §5.4 擦洗并截断。

未配置 DSN 时，非测试环境只写一条平台日志 `error.captured`，字段在 `errorReport` 下。配置 `SENTRY_DSN` 或 `OPENLEARN_ERROR_DSN` 时，再向 Sentry 兼容的 Envelope 地址 POST（自建 Sentry 或 GlitchTip）。DSN 形如 `https://<key>@<host>/<projectId>`，项目 ID 必须是数字。POST 超时 3 秒，失败被吞掉，不影响请求。

`source` 可以是 `uncaught`、`unhandledRejection`、`http`、`client`、`runtime`、`promise`。

| 来源                            | 位置                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------- |
| 未处理的 rejection / 未捕获异常 | `server.ts` 调用 `captureUnknownError`                                          |
| HTTP 5xx                        | `server/utils/error-handler.ts` 与 `server/middleware/request-observability.ts` |
| 浏览器                          | `POST /api/client-errors`（`server/routes/client-errors.ts`）                   |

浏览器入口不要求登录，响应恒为 204，不回显正文。`Content-Length` 大于 16 KiB、没有 `message`，或 body 不是对象时直接丢掉。`source` 只接受 `client`、`runtime`、`promise`，其余按 `client`。

---

## 8. 插件日志

日志不是 DI Token。`packages/core/plugin-host/context-builder.ts` 调用 `createLogger`，组件名是 `Plugin:` 加上 manifest id，再包成 `packages/core/plugin-host/types.ts` 里的 `IPluginLogger`（`debug` / `info` / `warn` / `error`）。`meta` 落在 JSON 的 `meta` 字段，消息落在 `msg`。`component` 绑定为 `Plugin:<id>`。时间戳是 pino 自己的 `time`。

Worker 里的 `ctx.log` 由 `packages/core/worker-runtime/bootstrap/sections/message-handler.ts` 转到 `console.*`。`packages/core/worker-runtime/worker-manager.ts` 把 worker 的 stdout 以 `info`、stderr 以 `error` 送进同一个 `Plugin:<id>` 子 logger。因此 Worker 里的 `console.log` / `ctx.log` 会进入平台日志文件。inline 插件的 `ctx.log` 直接打 pino；它自己的裸 `console.*` 不进文件。

---

## 9. 另外两套不进 pino 的记录

### 9.1 事件表

`packages/core/kernel/index.ts` 的 `initAuditLog` 订阅事件总线的 `*`，把每条事件插入 SQLite `events`。列是 `id`、`type`、`source`、`payload`、`timestamp`、`correlationId`，以及存在时的 `lesson_id`（`migrations/006_classroom_event_bus.sql`）。首次写入时用 `PRAGMA table_info(events)` 在带 `lesson_id` 与不带该列的 INSERT 之间选一次。

`payload` 入库前经过 `packages/core/db/class-passcode-crypto.ts` 的 `redactPasscodeMaterial`：口令字段换成占位符，字符串里的 `olenc1:` 密文被擦掉。这不是 pino 脱敏，也不写入 `audit.log`。

### 9.2 AI 能力内存日志

`packages/core/ai-capability/logging/capability-logger.ts` 的 `CapabilityLogger` 是进程内环形缓冲，与 pino 无关。默认最多 200 条（`AI_CAPABILITY_LOG_MAX_ENTRIES`），30 分钟过期（`AI_CAPABILITY_LOG_TTL_MS`，小于等于 0 表示不过期）。默认只保留载荷的形状摘要；`AI_CAPABILITY_LOG_CAPTURE_PAYLOAD=true` 时才保存全文。进程退出即丢失。

生产构造点在 `packages/core/ai-capability/ai-capability-kernel.ts` 与 `packages/core/bootstrap/composition/whiteboard-composition-module.ts`。

---

## 10. 速查

| 问题                               | 答案                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目录里有哪些实现？                 | §1 的九个文件。没有 barrel，没有追踪                                                                                                                                                                                                                          |
| 探针怎么分？                       | `/health` 只表示进程活着。`/health/ready` 查数据库、存储可写、迁移文件都已应用。失败体只有 `status`                                                                                                                                                           |
| `/metrics` 现在有什么？            | `openlearn_up`、运行秒数、RSS、按状态类的 `openlearn_http_responses_total`，运维 gauge `openlearn_migrations_pending`、`openlearn_backup_age_seconds`、`openlearn_events_rows`，以及按插件维度的 `openlearn_plugin_*`（§4.1）。要管理员会话或 `METRICS_TOKEN` |
| 日志文件在哪？                     | `<LOG_DIR>/openlearn.log`，审计在同目录 `audit.log`。Compose 的目录是 `/data/logs`                                                                                                                                                                            |
| 有脱敏吗？                         | pino 按 §5.3 的字段名。审计和错误上报再用 §5.4。字符串里的秘密和裸 `console.*` 仍可能漏出                                                                                                                                                                     |
| 插件怎么打日志？                   | `PluginContext.log`，不是 DI。Worker 的 console 经 stdout/stderr 进入同一子 logger                                                                                                                                                                            |
| 安全审计和 `events` 表是一回事吗？ | 不是。审计是 `audit.log` 里 §6 的事件。`events` 是总线全量记录                                                                                                                                                                                                |
