# 配置与环境变量

> 全仓 `process.env` 引用 **68 个键**（不含测试专用）。本文件按用途分组，标注默认值与易错点。
> 逐字真源：`server.ts`、`server/**`、`packages/core/**`、`src/**` 中的 `process.env.X`。

---

## 1. 最小可运行配置

`.env.example` 只有 6 个键，其余全部有默认值：

```dotenv
APP_URL=http://localhost:9000
PLUGIN_COMMUNITY_REGISTRY_URL=
OPENLEARN_WORKER_ISOLATE=worker
OPENLEARN_PLUGIN_PERMISSION=restricted
OPENLEARN_PLUGIN_MAX_HEAP_MB=256
OPENLEARN_WORKER_LIVENESS=on
```

复制为 `.env` 即可 `pnpm dev`。生产必须额外设置：`OPENLEARN_ADMIN_PASSWORD`、`OPENLEARN_TEACHER_PASSWORD`、
`TRUST_PROXY`、`ENCRYPTION_KEY`（若用到加密字段）。

---

## 2. 数据与路径

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OPENLEARN_DB_PATH` | `packages/core/db/educational_os.db` | SQLite 文件路径 |
| `OPENLEARN_DATA_DIR` | 仓库根 | 数据根目录，影响 storage/uploads/backups 的基准 |
| `OPENLEARN_PLUGINS_DIR` | `plugins/` | 插件安装目录（每个插件一个 `<DB-UUID>/` 子目录） |
| `BACKUP_DIR` | `backups/` | 备份目录 |
| `LOG_DIR` | `logs/` | 日志目录 |
| `BACKUP_SCHEDULE` | — | 备份周期 |
| `BACKUP_DAILY_AT` | — | 每日备份时刻 |
| `BACKUP_KEEP` | — | 保留份数 |
| `BACKUP_CHECKPOINT_INTERVAL_MS` | — | WAL checkpoint 间隔 |
| `PRE_MIGRATION_KEEP` | — | 迁移前快照保留份数 |

> **测试注意**：`vitest.setup.ts` 会主动清除 `BACKUP_DIR` / `OPENLEARN_DB_PATH`，
> 防止测试写进真实目录。这是预期行为，不是配置失效。

---

## 3. 服务与网络

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `9000` | HTTP 端口 |
| `HOST` | — | 绑定地址 |
| `APP_URL` | — | 对外基址（用于生成回调、邮件链接） |
| `NODE_ENV` | `development` | 影响错误脱敏（生产时 5xx 换通用文案）、日志与 CSP |
| `TRUST_PROXY` | **off** | 反向代理后必须显式设置，否则 `req.ip` 与限流全部失真 |
| `ENABLE_HTTPS` / `FORCE_HTTPS` / `ENABLE_HSTS` | — | HTTPS 相关；`ENABLE_HSTS` 或（生产 + `FORCE_HTTPS`）才启用 HSTS |
| `ALLOWED_ORIGINS` | — | CORS 白名单 |
| `ALLOWED_FRAME_ORIGINS` | — | 允许 iframe 嵌入的来源 |
| `LTI_ALLOWED_LMS_ORIGINS` | — | LTI 场景允许的 LMS 来源 |
| `OPEN_BROWSER` | — | dev 启动时自动开浏览器 |
| `DISABLE_HMR` | — | 关闭 Vite HMR |

---

## 4. 日志与可观测

| 变量 | 说明 |
| --- | --- |
| `LOG_LEVEL` | 文件日志级别 |
| `LOG_CONSOLE_LEVEL` | 控制台级别 |
| `HTTP_ACCESS_LOG` | 访问日志开关 |
| `HTTP_SLOW_MS` | 慢请求阈值 |
| `HTTP_ACCESS_LOG_IGNORE` | 访问日志忽略的路径 |
| `METRICS_TOKEN` | `/metrics` 的 Bearer token；未设时仅管理员 session 可访问 |
| `DEBUG` | 调试命名空间 |
| `DEBUG_COMMAND_BUS` | 命令总线调试输出 |

---

## 5. 安全

| 变量 | 说明 |
| --- | --- |
| `OPENLEARN_ADMIN_PASSWORD` | `admin` 种子密码；未设则随机生成并写入 `storage/bootstrap-credentials.txt` |
| `OPENLEARN_TEACHER_PASSWORD` | `teacher` 种子密码，同上 |
| `ENCRYPTION_KEY` | 字段级加密密钥（班级口令等） |
| `ROUTE_SCOPE_ENFORCE` | `true` 时未声明数据范围的路由让启动失败（CI 建议开） |
| `ALLOW_UNSAFE_PLUGIN_SCRIPTS` | 允许插件安装期执行脚本，**仅开发环境** |
| `OPENLEARN_ALLOW_UNSIGNED` | 允许安装无签名插件（有签名但签名错的仍拒绝） |
| `OPENLEARN_MAX_ZIP_SIZE` | 插件 ZIP 大小上限 |

---

## 6. 插件与隔离

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OPENLEARN_WORKER_ISOLATE` | `worker` | 隔离方式：`worker`（worker_threads）/ `process`（child_process） |
| `OPENLEARN_PLUGIN_PERMISSION` | `restricted` | 插件权限档位 |
| `OPENLEARN_PLUGIN_MAX_HEAP_MB` | `256` | 插件进程堆上限 |
| `OPENLEARN_WORKER_LIVENESS` | `on` | 活体检测开关 |
| `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` | 5000（代码常量） | 激活超时，覆盖 `ACTIVATION_TIMEOUT_MS` |
| `OPENLEARN_WORKER_ACTIVATE_PROGRESS_SLIDE_MS` | — | 激活进度滑动窗口 |
| `OPENLEARN_WORKER_TERM_GRACE_MS` | — | 终止宽限期 |
| `OPENLEARN_WATCHDOG_BASE_DELAY` | — | 看门狗基础延迟 |
| `OPENLEARN_PLUGINS_NPM_REGISTRY` | — | 插件依赖安装的 npm 源 |
| `PLUGIN_COMMUNITY_REGISTRY_URL` | — | 社区插件市场地址 |
| `BRIDGE_HOOK_TELEMETRY` | — | 桥接钩子遥测 |

> **`OPENLEARN_WORKER_ISOLATE` 的取值不是插件执行模式**。插件是否 `inline` 由
> 「文件位置 + `OPENLEARN_TRUSTED_INLINE_PLUGINS`」决定（见
> [../architecture/plugin-runtime-planes.md](../architecture/plugin-runtime-planes.md) §2）。
> 这个变量只决定**非受信插件**跑在 worker 还是子进程。

---

## 7. 数据保留

| 变量 | 默认天数 |
| --- | --- |
| `OPENLEARN_EVENT_RETENTION_DAYS` / `RETENTION_EVENTS_DAYS` | 90 |
| `OPENLEARN_ATTENDANCE_RETENTION_DAYS` / `RETENTION_ATTENDANCE_DAYS` | 365 |
| `OPENLEARN_NOTIFICATIONS_RETENTION_DAYS` / `RETENTION_NOTIFICATIONS_DAYS` | 30 |
| `OPENLEARN_ROLLCALLS_RETENTION_DAYS` / `RETENTION_ROLLCALLS_DAYS` | 180 |
| `OPENLEARN_SESSIONS_RETENTION_DAYS` / `RETENTION_SESSIONS_DAYS` | 30 |
| `OPENLEARN_PENDING_COMMANDS_RETENTION_DAYS` / `RETENTION_PENDING_COMMANDS_DAYS` | 14 |

两套前缀（`OPENLEARN_*` 与 `RETENTION_*`）都支持，后者是历史名。
设为 `0` 或负数即**禁用**该类别清理。默认值定义在
`packages/core/db/retention-policy.ts → DEFAULT_RETENTION_DAYS`（L22）。

---

## 8. 迁移

| 变量 | 说明 |
| --- | --- |
| `MIGRATION_ALLOW_UNKNOWN_LEDGER` | 允许账本存在源码中没有的迁移记录 |
| `MIGRATION_CHECKSUM_STRICT` | 校验和不符时直接失败 |
| `FORCE_MIGRATION_SNAPSHOT` | 迁移前强制快照 |

---

## 9. 课堂与业务

| 变量 | 说明 |
| --- | --- |
| `OPENLEARN_CLASSROOM_GUARD_TIMEOUT_MS` | 课堂守卫超时（断线宽限） |

---

## 10. 测试专用（**不得在生产设置**）

| 变量 | 说明 |
| --- | --- |
| `VITEST` / `VITEST_POOL_ID` | Vitest 标识；`POOL_ID` 用于每 worker 独立临时库（`/tmp/openlearn_test_dbs/`） |
| `PLAYWRIGHT_TEST` | **生产环境设置会触发断言**（`db/index.ts → assertPlaywrightTestNotInProduction`，L203） |

---

## 11. 环境检查清单（部署前）

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
