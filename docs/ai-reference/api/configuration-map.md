# 配置与环境变量

> **变量表只有一份**：[系统配置规范 §1 环境变量全集](../../configuration/system-configuration.md#1-环境变量全集)。
> 本文**不复刻**那张表。历史上这里曾并列维护第二份清单，两份各自漂移，且门禁只守得住其中一份
> ——`audit-tools/envcheck.py` 的 **D4** 就是专门拦「`docs/configuration/` 之外又出现一份成规模变量表」。
> 本文只回答 AI 代理真正需要的问题：**按用途去哪找**、**哪些地方容易配错**、**部署前该检查什么**。

---

## 1. 查配置的入口

| 你要找什么                                   | 去哪儿                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 变量名 / 默认值 / 取值语义                   | [系统配置规范 §1](../../configuration/system-configuration.md#1-环境变量全集)                                      |
| 配了但值非法会不会拒绝启动                   | [系统配置规范 §5 启动期强校验](../../configuration/system-configuration.md#5-启动期环境变量强校验p1)               |
| 数据库文件路径、备份目录、容器卷             | [系统配置规范 §2 SQLite 路径](../../configuration/system-configuration.md#2-sqlite-数据库路径)                     |
| 插件 `manifest.configuration` 的作用域与存储 | [系统配置规范 §4](../../configuration/system-configuration.md#4-插件-manifestconfiguration)                        |
| 设计意图与约束（为什么是这个默认值）         | [系统配置架构规范](../../architecture/configuration.md)                                                            |
| 逐字真源（出现分歧时以代码为准）             | `server.ts`、`cli.mjs`、`packages/core/**`、`packages/core/worker-runtime/**`、`server/security/env-validation.ts` |

> 上文表格只有 6 行，且首列不是变量名——它不会被当成第二份清单。

---

## 2. 最小可运行配置

`.env.example` 刻意只留 6 个键，其余全部有默认值：

```dotenv
APP_URL=http://localhost:9000
PLUGIN_COMMUNITY_REGISTRY_URL=
OPENLEARN_WORKER_ISOLATE=worker
OPENLEARN_PLUGIN_PERMISSION=restricted
OPENLEARN_PLUGIN_MAX_HEAP_MB=256
OPENLEARN_WORKER_LIVENESS=on
```

复制为 `.env` 即可 `pnpm dev`。**生产必须额外设置**：`OPENLEARN_ADMIN_PASSWORD`、
`OPENLEARN_TEACHER_PASSWORD`、`TRUST_PROXY`、`ENCRYPTION_KEY`（若用到加密字段）。

> ⚠️ 这份样例里的 `APP_URL` 是**脚手架遗留**：全仓没有任何 `process.env.APP_URL` 读取点
> （`grep -r APP_URL server/ packages/ cli.mjs server.ts` 为空），`.env.example` 里给的是占位值
> `MY_APP_URL`。写进 `.env` 不会改变任何回调或邮件链接的基址——别在这里改部署域名。
> 它留在样例里只因为 `.env.example` 还留着它。

---

## 3. 按用途索引（变量族 → 权威页）

- **服务与网络**：`PORT`、`HOST`、`APP_URL`、`TRUST_PROXY`、`ALLOWED_ORIGINS`、
  `ALLOWED_FRAME_ORIGINS`、`LTI_ALLOWED_LMS_ORIGINS`、`ENABLE_HTTPS` / `FORCE_HTTPS` / `ENABLE_HSTS`、
  `NODE_ENV`、`OPEN_BROWSER`、`DISABLE_HMR`、`SOURCE_MAP`。
- **数据与路径**：`OPENLEARN_DB_PATH`、`OPENLEARN_DATA_DIR`、`OPENLEARN_PLUGINS_DIR`、`BACKUP_DIR`、
  `LOG_DIR`、`BACKUP_SCHEDULE` / `BACKUP_DAILY_AT` / `BACKUP_KEEP` / `BACKUP_CHECKPOINT_INTERVAL_MS`、
  `PRE_MIGRATION_KEEP`、`OPENLEARN_MIGRATIONS_DIR`。
- **日志与可观测**：`LOG_LEVEL`、`LOG_CONSOLE_LEVEL`、`LOG_REDACT`、`LOG_MAX_SIZE_MB` / `LOG_MAX_FILES`、
  `AUDIT_LOG_MAX_SIZE_MB` / `AUDIT_LOG_MAX_FILES`、`HTTP_ACCESS_LOG`、`HTTP_SLOW_MS`、
  `HTTP_ACCESS_LOG_IGNORE`、`METRICS_TOKEN`、`SENTRY_DSN` / `OPENLEARN_ERROR_DSN`、
  `DEBUG`、`DEBUG_COMMAND_BUS`。
- **安全**：`OPENLEARN_ADMIN_PASSWORD`、`OPENLEARN_TEACHER_PASSWORD`、
  `ENCRYPTION_KEY`、`ROUTE_SCOPE_ENFORCE`、`OPENLEARN_SKIP_PASSWORD_CHANGE_GATE`、
  `ALLOW_UNSAFE_PLUGIN_SCRIPTS`、`OPENLEARN_ALLOW_UNSIGNED`、`OPENLEARN_MAX_ZIP_SIZE`。
- **插件与隔离**：`OPENLEARN_WORKER_ISOLATE`、`OPENLEARN_TRUSTED_INLINE_PLUGINS`、
  `OPENLEARN_PLUGIN_PERMISSION`、`OPENLEARN_PLUGIN_MAX_HEAP_MB`、`OPENLEARN_PLUGIN_MAX_RSS_MB`、
  `OPENLEARN_PLUGIN_CPU_QUOTA_MS` / `OPENLEARN_PLUGIN_CPU_WINDOW_MS`、`OPENLEARN_PLUGIN_QUOTA`、
  `OPENLEARN_WORKER_LIVENESS` 及 `_INTERVAL_MS` / `_GRACE_MS`、`OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS`、
  `OPENLEARN_WORKER_ACTIVATE_PROGRESS_SLIDE_MS`、`OPENLEARN_WORKER_TERM_GRACE_MS`、
  `OPENLEARN_WATCHDOG_BASE_DELAY`、`OPENLEARN_ENFORCE_PLUGIN_ISOLATION`、
  `PLUGIN_COMMUNITY_REGISTRY_URL`、`OPENLEARN_COMMUNITY_INSTALL`、`OPENLEARN_COMMUNITY_PUBKEY`、
  `OPENLEARN_TRUSTED_PUBKEYS`、`OPENLEARN_PLUGINS_NPM_REGISTRY`、`OPENLEARN_RESEARCH_SQL_PLUGINS`、
  `BRIDGE_HOOK_TELEMETRY`。
- **数据保留**：`OPENLEARN_EVENT_RETENTION_DAYS`、`OPENLEARN_ATTENDANCE_RETENTION_DAYS`、
  `OPENLEARN_NOTIFICATIONS_RETENTION_DAYS`、`OPENLEARN_ROLLCALLS_RETENTION_DAYS`、
  `OPENLEARN_SESSIONS_RETENTION_DAYS`、`OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS`
  （均有 `RETENTION_*` 历史别名，见 §4.3）。
- **迁移**：`MIGRATION_ALLOW_UNKNOWN_LEDGER`、`MIGRATION_CHECKSUM_STRICT`、`FORCE_MIGRATION_SNAPSHOT`。
- **课堂与业务**：`OPENLEARN_CLASSROOM_GUARD_TIMEOUT_MS`。
- **测试专用（不得在生产设置）**：`VITEST`、`VITEST_POOL_ID`、`PLAYWRIGHT_TEST`。

---

## 4. 易错点

### 4.1 `OPENLEARN_WORKER_ISOLATE` 不是插件执行模式

插件是否 `inline` 由「文件位置 + `OPENLEARN_TRUSTED_INLINE_PLUGINS`」决定
（见 [../architecture/plugin-runtime-planes.md](../architecture/plugin-runtime-planes.md) §2）。
这个变量只决定**非受信插件**跑在 worker 还是子进程，写成 `inline` 不会让插件同进程执行。

### 4.2 初始口令只在首次建库生效

种子账号的初始口令取自 `OPENLEARN_ADMIN_PASSWORD` / `OPENLEARN_TEACHER_PASSWORD`；
未设置时口令怎么来、落在哪里（`storage/bootstrap-credentials.txt`），见
[系统配置规范 §1](../../configuration/system-configuration.md#1-环境变量全集) 的对应行——
本文不复述默认值，否则一改默认值这里就成了第二处真相。

两条跨版本成立的要点：

- 这套策略**只在首次建库生效**。库已存在时改这两个变量不会重置任何已有账号的口令。
- 弱初始口令必须改密：未改密前，除改密 / 登出外的 `/api` 一律 403（SEC-AUTH-06）。

### 4.3 保留策略有两套前缀

`OPENLEARN_*_RETENTION_DAYS` 与 `RETENTION_*_DAYS` 都被读取，后者是历史名，规范名优先。
默认值定义在 `packages/core/db/retention-policy.ts → DEFAULT_RETENTION_DAYS`。
设为 `0` 或负数即**禁用**该类别清理（是禁用，不是立刻清空）。

### 4.4 测试会主动清空两个变量

`vitest.setup.ts` 会清除 `BACKUP_DIR` / `OPENLEARN_DB_PATH`，防止测试写进真实目录
与真实库。看到「配置没生效」先确认是不是跑在 Vitest 里，这是预期行为。

### 4.5 `METRICS_TOKEN` 留空的语义

未设置时 `GET /metrics` 并非公开，而是**降级为仅管理员会话可访问**。Prometheus 用无 session
的抓取方式会拿到 401——生产必须设。

### 4.6 `PLAYWRIGHT_TEST` 在生产会直接断言失败

`packages/core/db/index.ts → assertPlaywrightTestNotInProduction`。这个键不进生产环境，
`ALLOW_UNSAFE_PLUGIN_SCRIPTS` 同理（它会让 manifest 里声明的 `deploy.script` 真的被执行）。

### 4.7 改配置时的门禁

`server/security/env-validation.ts` 的 `assertStartupEnv()` 在 `startServer()` 最早期运行，
分 error（拒绝启动）与 warning（仅告警）两档。新增变量若属于枚举型或带单位的数值型，
应同时登记进这两档，否则拼错值会静默回落默认值。**新变量必须在
[系统配置规范 §1](../../configuration/system-configuration.md#1-环境变量全集) 补一行**，
`audit-tools/envcheck.py` 会以代码读取为准做三方比对。

---

## 5. 环境检查清单（部署前）

```text
[ ] NODE_ENV=production
[ ] OPENLEARN_ADMIN_PASSWORD / OPENLEARN_TEACHER_PASSWORD 已改为强密码
[ ] TRUST_PROXY 与反向代理层数一致
[ ] ALLOWED_ORIGINS / ALLOWED_FRAME_ORIGINS / LTI_ALLOWED_LMS_ORIGINS 已含真实域名
[ ] METRICS_TOKEN 已设（否则 Prometheus 抓取 401）
[ ] ENCRYPTION_KEY 已设且已备份（丢失后加密字段不可解）
[ ] BACKUP_DIR 可写、BACKUP_KEEP 合理
[ ] 未设置 PLAYWRIGHT_TEST、ALLOW_UNSAFE_PLUGIN_SCRIPTS
[ ] OPENLEARN_DB_PATH 指向持久卷，而非容器临时层
[ ] Node 主版本为 22（与 better-sqlite3 ABI 对齐）
```
