# System Configuration 系统配置规范

本页汇总平台全部服务端配置入口：环境变量、SQLite 数据库路径、会话密钥与插件 `manifest.configuration`。**当前唯一权威来源是代码**（`server.ts`、`cli.mjs`、`packages/core/worker-runtime/worker-manager.ts`），本页与其同步于 v0.5.0。

---

## 1. 环境变量全集

> `.env` 由用户自建（可参考 `.env.example`，其刻意只包含最少项）。以下为服务端实际读取的全部变量：

| 变量                                          | 默认值                                       | 说明                                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                        | `9000`                                       | HTTP 服务端口（`cli.mjs -p` 可覆盖）                                                                                                                            |
| `TRUST_PROXY`                                 | 不信任                                       | 未设置、空、`false`、`0` 均不信任 `X-Forwarded-*`。Nginx 后设 `1` 或 `loopback`。直连公网不要设为 `1`                                                           |
| `OPENLEARN_ADMIN_PASSWORD`                    | 随机生成                                     | 空库管理员初始口令。等于 `admin` 时必须改密                                                                                                                     |
| `OPENLEARN_TEACHER_PASSWORD`                  | 随机生成                                     | 空库教师初始口令。等于 `teacher` 时必须改密                                                                                                                     |
| `HOST`                                        | `0.0.0.0`                                    | 监听地址（`cli.mjs -H` 可覆盖）                                                                                                                                 |
| `NODE_ENV`                                    | dev 自动设 `development` / prod `production` | 影响 HMR、静态资源策略、部分测试分支                                                                                                                            |
| `OPEN_BROWSER`                                | 关闭                                         | 设为 `true` 启动后自动打开浏览器（`cli.mjs -o`）                                                                                                                |
| `DISABLE_HMR`                                 | 关闭                                         | `true` 时禁用 Vite HMR（watch/中间件关闭）                                                                                                                      |
| `ALLOWED_ORIGINS`                             | 生产仅同源                                   | CORS 白名单，逗号分隔（`cli.mjs --cors`）；开发环境默认放行 localhost                                                                                           |
| `ALLOWED_FRAME_ORIGINS`                       | dev `localhost:*` / prod 仅同源              | Helmet `frame-src` / `frame-ancestors` 白名单，逗号分隔（课件 iframe 场景）。生产未配置时仅允许同源嵌入（`'self'`），防止 click-jacking                         |
| `LTI_ALLOWED_LMS_ORIGINS`                     | 无                                           | 允许发起 LTI 1.3 启动的 LMS 平台来源白名单                                                                                                                      |
| `ENCRYPTION_KEY`                              | 见下文                                       | 64 位 hex。加密 AI Provider API Key 与班级临时口令。设置了就用环境变量；未设置时首次启动生成并写入 `storage/encryption-key`（0600）。与已有文件不一致则拒绝启动 |
| `OPENLEARN_DB_PATH`                           | 见 §2                                        | SQLite 数据库文件路径                                                                                                                                           |
| `OPENLEARN_DATA_DIR`                          | 库文件所在目录                               | 课件 `storage/`、`plugins/`、`uploads/` 的根。容器默认 `/data`                                                                                                  |
| `BACKUP_DIR`                                  | `<数据目录>/backups`                         | `scripts/site-backup.mjs` 与迁移前快照的输出目录。容器默认 `/backups`                                                                                           |
| `PLUGIN_COMMUNITY_REGISTRY_URL`               | 无                                           | 社区插件注册表 JSON 地址，由服务端代取（见 [community-plugin-registry](../plugin/community-plugin-registry)）                                                   |
| `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS`        | `60000`                                      | Worker 插件激活超时（inline 模式固定 5000ms）                                                                                                                   |
| `OPENLEARN_WORKER_ISOLATE`                    | `thread`                                     | 未显式指定 isolateKind 时的隔离原语。第三方插件激活会显式使用 `process`，不受此默认值拉回同进程                                                                 |
| `OPENLEARN_TRUSTED_INLINE_PLUGINS`            | 空                                           | 逗号分隔的 manifest id。名单内插件可按清单使用 inline/worker。其余非 `@openlearn/` 插件强制子进程                                                               |
| `OPENLEARN_PLUGIN_PERMISSION`                 | `rw`                                         | 子进程 Node 权限档位：`rw`/`ro`/`off`（仅子进程生效；暂无法约束网络）                                                                                           |
| `OPENLEARN_PLUGIN_MAX_HEAP_MB`                | `128`                                        | 子进程 V8 老生代上限（MB），`0`/`off` 关闭                                                                                                                      |
| `OPENLEARN_WORKER_LIVENESS`                   | `on`                                         | 插件存活探活（默认 30s 间隔 + 15s 宽限）；`off` 关闭                                                                                                            |
| `BRIDGE_HOOK_TELEMETRY`                       | `on`                                         | 课件网络遥测总闸：`off` 关闭 fetch/XHR/axios/beacon/form 向父窗口的上报（成绩提交不受影响）                                                                     |
| `OPENLEARN_WORKER_ACTIVATE_PROGRESS_SLIDE_MS` | —                                            | `ctx.reportProgress` 心跳滑动续期窗口                                                                                                                           |
| `DEBUG_COMMAND_BUS`                           | 关闭                                         | `true` 时 CommandBus 打印全部命令日志（含默认静默的只读指令）；`DEBUG=commandbus` 等效                                                                          |
| `LOG_LEVEL`                                   | 生产 `info` / 其他 `debug`                   | 结构化日志级别（pino）                                                                                                                                          |
| `LOG_CONSOLE_LEVEL`                           | 继承 `LOG_LEVEL`                             | 控制台输出级别（可选）。可独立配置以实现控制台只打印 warn/error 而日志文件记录 debug/info                                                                       |
| `HTTP_ACCESS_LOG`                             | `errors`                                     | 请求访问日志策略：`errors`（默认，仅记录 4xx/5xx 与慢请求）、`all`（全量记录，排障开启）、`off`（完全关闭访问日志输出）                                         |
| `HTTP_SLOW_MS`                                | `1000`                                       | 慢请求阈值（毫秒）。耗时达到或超过此阈值的请求以 `warn` 级别记录访问日志                                                                                        |
| `HTTP_ACCESS_LOG_IGNORE`                      | 空                                           | 逗号分隔的路径前缀名单（如 `/api/vfs,/api/classroom/sessions/`），对特定高频轮询接口静默正常访问日志                                                            |
| `LOG_DIR`                                     | `<cwd>/logs`                                 | 访问日志 `openlearn.log` 与审计日志 `audit.log` 的目录。容器为 `/data/logs`                                                                                     |
| `LOG_REDACT`                                  | 开启                                         | `false` / `0` / `off` / `no` 关闭字段脱敏。生产不要关闭                                                                                                         |
| `LOG_MAX_SIZE_MB`                             | `10`                                         | 访问日志单文件上限（MB），超出后轮转                                                                                                                            |
| `LOG_MAX_FILES`                               | `5`                                          | 访问日志保留的历史份数（`openlearn.log.1` …）。更旧的直接删除                                                                                                   |
| `AUDIT_LOG_MAX_SIZE_MB`                       | `20`                                         | 安全审计日志单文件上限（MB）                                                                                                                                    |
| `AUDIT_LOG_MAX_FILES`                         | `20`                                         | 审计日志保留的历史份数                                                                                                                                          |
| `OPENLEARN_EVENT_RETENTION_DAYS`              | `90`                                         | 启动时删除 events 中早于 N 天的总线事件。`0` 不删除。文件审计日志 audit.log 不受影响                                                                            |
| `SENTRY_DSN`                                  | 空                                           | 可选。Sentry 兼容 DSN。与 `OPENLEARN_ERROR_DSN` 二选一，都空则只写本地日志                                                                                      |
| `OPENLEARN_ERROR_DSN`                         | 空                                           | 同上，便于不把变量名叫成 Sentry                                                                                                                                 |
| `METRICS_TOKEN`                               | 空                                           | 可选。`Authorization: Bearer <token>` 可读取 `GET /metrics`。空则仅管理员会话可访问                                                                             |

## 2. SQLite 数据库路径

| 场景                              | 路径                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------- |
| 本地开发（`pnpm dev`）            | `packages/core/db/educational_os.db`（相对项目根）                           |
| npx 安装                          | `~/openlearn-next/data.db`                                                   |
| `--db-path` / `OPENLEARN_DB_PATH` | 任意指定路径                                                                 |
| Docker Compose                    | `/data/educational_os.db`，文件在同一卷的 `storage/`、`plugins/`、`uploads/` |
| Vitest                            | `/tmp/openlearn_test_dbs/` per-worker 临时库（按 `VITEST_POOL_ID` 隔离）     |

## 3. 会话与密钥

- 会话采用 **HttpOnly Cookie**（`server/middleware/auth.ts` 的 `getCookieToken`），无独立 JWT 签名密钥环境变量；登录态由服务端 sessions 存储校验。
- 唯一的加密密钥是 `ENCRYPTION_KEY`（AES-256-GCM）。它加密 AI Provider API Key，也加密 `classes.class_passcode`。未设置环境变量时，钥匙在数据目录的 `storage/encryption-key`（与 `bootstrap-credentials.txt` 同目录，权限 600）。启动日志和管理后台会警告这是自动生成的钥匙，应改设 `ENCRYPTION_KEY` 并离线备份该文件。`site-backup` 不打包这个文件。环境变量若与文件不一致，进程报错并说明如何二选一，不会悄悄换钥匙，也不会再使用只活在内存里的临时密钥。

## 4. 插件 `manifest.configuration`

插件在 manifest 中声明配置 schema（[plugin-manifest-spec §2.5](../plugin/plugin-manifest-spec)），由 `IConfigService`（`ctx.config`）提供读取与变更订阅：

- 属性类型：`string | number | boolean | integer`，支持 `default` / `enum` / `minimum` / `maximum` / `description`；
- 特殊保留键 `showInDashboard`（`boolean`）：控制插件卡片「总览」开关（见 [plugin-sdk §5.11](../sdk/plugin-sdk)）；
- `ctx.config.onChange(callback)` 全键订阅，回调内按 `key` 过滤。

## 5. 启动期环境变量强校验（P1）

`server/security/env-validation.ts` 的 `assertStartupEnv()` 在 `startServer()` 最早期执行，在接触数据库与插件运行时之前拦截配置笔误。规则分两档：

- **error（拒绝启动）**：`PORT` 越界/非整数、`TRUST_PROXY` 无法识别的取值、`ENCRYPTION_KEY` 非法、`OPENLEARN_WORKER_ISOLATE` / `OPENLEARN_PLUGIN_PERMISSION` / `OPENLEARN_WORKER_LIVENESS` / `BRIDGE_HOOK_TELEMETRY` 拼写错误、`OPENLEARN_PLUGIN_MAX_HEAP_MB` 带单位或低于下限、`ALLOWED_ORIGINS` 非法 origin，以及生产环境把 `OPENLEARN_ADMIN_PASSWORD` / `OPENLEARN_TEACHER_PASSWORD` 设为用户名。
- **warning（仅告警）**：生产环境未显式设置 `ENCRYPTION_KEY`、`TRUST_PROXY=1/true` 且可能被公网直连、`ALLOWED_ORIGINS` 含 `*`、`METRICS_TOKEN` 过短、iframe/LTI 白名单无法解析。

校验是纯函数，便于单测覆盖；副作用（打印与抛错）集中在 `assertStartupEnv()`，由 `server.ts` 统一处理退出。
