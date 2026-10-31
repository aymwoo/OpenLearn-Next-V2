# 子系统：可观测性、安全与治理

> 覆盖 `packages/core/observability/`、`packages/core/security/`、`server/security/`、
> `server/middleware/`、`packages/core/capability-governance/`、`service-registry/`。

---

## 1. 可观测性：10 个模块各司其职

`packages/core/observability/`（10 文件 / 1,421 行）：

| 文件 | 作用 |
| --- | --- |
| `logger.ts` | 结构化日志（pino 底座） |
| `request-context.ts` | `AsyncLocalStorage` 请求上下文，注入 `requestId` |
| `metrics.ts` | 计数器/直方图 |
| `plugin-metrics.ts` | 插件维度指标（激活耗时、RPC 次数、崩溃数） |
| `health.ts` | 健康检查聚合 |
| `audit-log.ts` | 审计日志（谁在何时改了什么） |
| `error-reporter.ts` | `captureError`，5xx 自动上报 |
| `redaction.ts` | 敏感字段脱敏（密码、口令、token） |
| `sanitize.ts` | 输入净化 |
| `rotating-file-stream.ts` | 日志轮转 |

### 1.1 日志级别与落点

| 变量 | 作用 |
| --- | --- |
| `LOG_LEVEL` | 文件日志级别 |
| `LOG_CONSOLE_LEVEL` | 控制台日志级别（可与文件不同） |
| `LOG_DIR` | 日志目录，默认 `logs/` |
| `HTTP_ACCESS_LOG` / `HTTP_SLOW_MS` / `HTTP_ACCESS_LOG_IGNORE` | 访问日志开关、慢请求阈值、忽略路径 |

`server/middleware/request-observability.ts` 负责把请求 id 注入 `req.requestId`，
并记录慢请求。它挂载在 `server.ts` L308。

### 1.2 健康检查

| 端点 | 行 | 用途 |
| --- | --- | --- |
| `GET /health` | `server/routes/health.ts` L142 | 存活探针 |
| `GET /health/ready` | L148 | 就绪探针（依赖可用性） |
| `GET /metrics` | L169-180 | Prometheus 指标导出，需 `METRICS_TOKEN` Bearer 或管理员 session |

**注意路径是 `/metrics` 不是 `/api/metrics`**。默认无 token 时：`options?.metricsToken ?? process.env.METRICS_TOKEN ?? ''`
为空串，此时仅接受管理员 session。部署时若未设 `METRICS_TOKEN`，Prometheus 抓取会 401。

---

## 2. 安全：四层防线

```text
① 接入层     helmet / CORS / CSRF / 限流 / body 限制        server.ts + server/middleware/
② 认证授权   requireAuth / requireScopedAuth（数据范围）      server/middleware/auth.ts + server/security/route-scope.ts
③ 命令层     default-deny + 能力闸门 + 高危审批              packages/core/kernel/index.ts L303-401
④ 数据层     SQL 守卫（表黑名单 + 前缀归属 + 禁语句）         packages/core/plugin-host/sql-guard.ts
```

### 2.1 数据范围：6 个档次

`server/security/route-scope.ts → DataScope`（L31）：

| scope | 含义 | 中间件做什么 | handler 还要做什么 |
| --- | --- | --- | --- |
| `public` | 无需登录 | 不认证 | — |
| `authenticated` | 任意已登录 | 认证 | 不得返回个人/班级归属数据 |
| `self` | 仅本人 | 认证 | **必须**按 session 主体做归属校验 |
| `class-member` | 班级成员 | 认证 | 用 `authorizeClass(..., 'member')` 校验 |
| `class-staff` | 管理员或班级 owner 教师 | 角色下限拦截 | 仍需校验班级归属 |
| `admin` | 仅管理员 | 直接拦截 | — |

**审计机制**：`collectAuthRoutes()` 遍历 Express 路由栈，找出「用了 `requireAuth` 但没声明 scope」
的路由；`auditRouteScopes()` 默认告警，`ROUTE_SCOPE_ENFORCE=true` 时直接抛错（CI 用）。

历史缺口 #127/#128/#133/#139 都是「只校验登录、没校验归属」漏出去的。

### 2.2 认证与强改密

| 机制 | 位置 | 行为 |
| --- | --- | --- |
| Session | `server/middleware/auth.ts` | Cookie token → `getValidSession` |
| Actor id | 同文件 `getActorId` | 产出 `user:<id>:<role>`，**唯一生产者** |
| 强改密 | `enforcePasswordChanged`（`server.ts` L423） | 种子账号未改密时写操作 403 |
| 前端强改密门 | `src/components/ForcedPasswordChangeGate.tsx` | 改密前不渲染外壳 |
| Socket 握手 | `socketAuthMiddleware`（`server.ts` L421） | 匿名/伪造/待改密一律拒连 |

**为什么 `actorId` 格式重要**：内核的管理员判定依赖它（`kernel/index.ts` L315-328）。
`plugin:@evil:admin` 这类**可自声明**的 actor 被判为管理员，是 v0.6.1 审计 C-3 修掉的漏洞。
自定义 actor 时不要模仿 `user:` 前缀。

### 2.3 CSRF 与 CORS

| 机制 | 位置 | 判据 |
| --- | --- | --- |
| CSRF | `server/middleware/csrf.ts` | `Sec-Fetch-Site` / `Sec-Fetch-Dest` + 豁免清单；`SameSite=Lax` 兜底 |
| CORS | `createCorsMiddleware()`（`server.ts` L396） | 白名单来自 `ALLOWED_ORIGINS`；Socket 用 `createSocketIoCors()` 对齐 |
| iframe 允许 | `ALLOWED_FRAME_ORIGINS`、`LTI_ALLOWED_LMS_ORIGINS` | 分别控制嵌入与 LTI |

### 2.4 限流

| 限流器 | 位置 | 作用面 |
| --- | --- | --- |
| `writeLimiter` | `server.ts` L287 | 所有 POST/PUT/DELETE |
| `viewStateLimiter` | 同上 | `POST /api/classroom/sessions/:id/view-state` 专用 |
| `aiLimiter` | `os.ts` L278 | `POST /api/agent/chat` |
| `loginLimiter` | `server/security/rate-limit.ts` | 登录 |
| 插件网关限流 | `server/routes/plugin-api-gateway.ts` | 默认 120/min，SSE 并发 5 |

### 2.5 环境与运行时自检

`server/security/` 下三个文件在启动阶段兜底：

| 文件 | 作用 |
| --- | --- |
| `env-validation.ts` | 关键环境变量校验 |
| `runtime-preflight.ts` / `runtime-check.ts` | 运行时前置检查（Node 版本、原生模块 ABI） |
| `trust-proxy.ts` | `TRUST_PROXY` 语义封装 |
| `file-permissions.ts` | 敏感文件权限（凭据、数据库） |
| `route-scope-whitelist.ts` | 未声明 scope 的临时白名单 |

---

## 3. 治理：能力准入与签名

`packages/core/capability-governance/`（12 文件 / 544 行）+ `plugin-host/plugin-grants.ts`。

| 关注点 | 位置 | 说明 |
| --- | --- | --- |
| 能力授予 | `plugin-grants.ts` | 激活时按 `capabilitiesProposed` 授予 |
| 能力准入评审 | `capability-governance/` | 高危能力的额外审查 |
| 插件签名 | `packages/core/security/plugin-signature.ts` | 签名/完整性校验 |
| 签名错误族 | `plugin-host/errors.ts` L190-241 | `PluginSignatureError` 及 4 个子类 |
| 未签名放行 | `OPENLEARN_ALLOW_UNSIGNED` | 仅开发环境应开启 |

**`OPENLEARN_ALLOW_UNSIGNED` 不是「关闭校验」**，而是「允许无签名插件安装」；
有签名但签名错误的插件依然被拒（`PluginSignatureInvalidError`）。

---

## 4. 插件指标（排查插件问题时最先看的地方）

`packages/core/observability/plugin-metrics.ts` 记录：

- 激活耗时分布（对比 5000ms 超时线）
- RPC 调用次数与失败率（`process` / `worker` 模式）
- 崩溃次数与熔断状态
- 插件私有表行数（识别数据膨胀）

对应的前端熔断参数：`CRASH_BREAKER_THRESHOLD = 3` / `CRASH_BREAKER_WINDOW_MS = 5min`
（`src/plugin-host/extension-breaker.ts` L14-15）。

---

## 5. 排障索引

| 现象 | 先看 |
| --- | --- |
| 生产 5xx 但前端只显示 "Internal server error" | 这是设计（`sendSafeError` L66）；去 `logs/` 找 `captureError` 记录 |
| 4xx 没有 `code` 字段 | 抛错点没设 `err.code`；只有 4xx 才透传 code |
| `/metrics` 401 | `METRICS_TOKEN` 未设且非管理员 session |
| 部署后 CORS 403 | `ALLOWED_ORIGINS` 未含新域名；Socket 需同步 `createSocketIoCors` |
| 插件装不上、报签名错 | 签名公钥不匹配；区分 `Invalid` 与 `Mismatch` 两个子类 |
| 启动即崩 `ERR_DLOPEN_FAILED` | Node 主版本与 `better-sqlite3` ABI 不匹配，`pnpm rebuild better-sqlite3` |
| 测试大面积 `Cannot read properties of undefined (reading 'clear')` | 用了 Node 26，换回 22（见本仓库 `AGENTS.md` 环境段） |
