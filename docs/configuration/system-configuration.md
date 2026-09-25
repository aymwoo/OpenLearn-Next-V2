# System Configuration 系统配置规范

本页汇总平台全部服务端配置入口：环境变量、SQLite 数据库路径、会话密钥与插件 `manifest.configuration`。**当前唯一权威来源是代码**（`server.ts`、`cli.mjs`、`packages/core/worker-runtime/worker-manager.ts`），本页与其同步于 v0.3.22。

---

## 1. 环境变量全集

> `.env` 由用户自建（可参考 `.env.example`，其刻意只包含最少项）。以下为服务端实际读取的全部变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `9000` | HTTP 服务端口（`cli.mjs -p` 可覆盖） |
| `HOST` | `0.0.0.0` | 监听地址（`cli.mjs -H` 可覆盖） |
| `NODE_ENV` | dev 自动设 `development` / prod `production` | 影响 HMR、静态资源策略、部分测试分支 |
| `OPEN_BROWSER` | 关闭 | 设为 `true` 启动后自动打开浏览器（`cli.mjs -o`） |
| `DISABLE_HMR` | 关闭 | `true` 时禁用 Vite HMR（watch/中间件关闭） |
| `ALLOWED_ORIGINS` | 生产仅同源 | CORS 白名单，逗号分隔（`cli.mjs --cors`）；开发环境默认放行 localhost |
| `ALLOWED_FRAME_ORIGINS` | 同源 | Helmet `frame-src` / `frame-ancestors` 白名单，逗号分隔（课件 iframe 场景） |
| `LTI_ALLOWED_LMS_ORIGINS` | 无 | 允许发起 LTI 1.3 启动的 LMS 平台来源白名单 |
| `ENCRYPTION_KEY` | 自动生成 | 64 位 hex，加密 AI Provider API Key。**非必需**：首次使用时自动生成并写回 `.env`（`packages/core/di/api-key-crypto.ts`） |
| `OPENLEARN_DB_PATH` | 见 §2 | SQLite 数据库文件路径 |
| `PLUGIN_COMMUNITY_REGISTRY_URL` | 无 | 社区插件注册表 JSON 地址，由服务端代取（见 [community-plugin-registry](../plugin/community-plugin-registry)） |
| `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` | `60000` | Worker 插件激活超时（inline 模式固定 5000ms） |
| `OPENLEARN_WORKER_ACTIVATE_PROGRESS_SLIDE_MS` | — | `ctx.reportProgress` 心跳滑动续期窗口 |
| `DEBUG_COMMAND_BUS` | 关闭 | `true` 时 CommandBus 打印全部命令日志（含默认静默的只读指令）；`DEBUG=commandbus` 等效 |

## 2. SQLite 数据库路径

| 场景 | 路径 |
| --- | --- |
| 本地开发（`pnpm dev`） | `packages/core/db/educational_os.db`（相对项目根） |
| npx 安装 | `~/openlearn-next/data.db` |
| `--db-path` / `OPENLEARN_DB_PATH` | 任意指定路径 |
| Vitest | `/tmp/openlearn_test_dbs/` per-worker 临时库（按 `VITEST_POOL_ID` 隔离） |

## 3. 会话与密钥

- 会话采用 **HttpOnly Cookie**（`server/middleware/auth.ts` 的 `getCookieToken`），无独立 JWT 签名密钥环境变量；登录态由服务端 sessions 存储校验。
- 唯一的加密密钥是 `ENCRYPTION_KEY`（仅用于 AI Provider API Key 落库加密，见上表）。

## 4. 插件 `manifest.configuration`

插件在 manifest 中声明配置 schema（[plugin-manifest-spec §2.5](../plugin/plugin-manifest-spec)），由 `IConfigService`（`ctx.config`）提供读取与变更订阅：

- 属性类型：`string | number | boolean | integer`，支持 `default` / `enum` / `minimum` / `maximum` / `description`；
- 特殊保留键 `showInDashboard`（`boolean`）：控制插件卡片「总览」开关（见 [plugin-sdk §5.11](../sdk/plugin-sdk)）；
- `ctx.config.onChange(callback)` 全键订阅，回调内按 `key` 过滤。
