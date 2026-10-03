# Security & Permissions 安全与权限模型

OpenLearn V2 的安全体系涵盖用户鉴权、基于角色的访问控制（RBAC）、插件沙箱隔离（Worker Thread Sandbox）、Prompt 注入防护及加密防篡改机制。

---

## 1. 身份认证与 RBAC 权限矩阵

平台用户划分为三种核心角色（`administrator`, `teacher`, `student`）：

- **不透明会话 ID + HttpOnly Cookie**: 登录成功后签发随机会话 ID（`edu_os_token` Cookie），服务端在 `client_sessions` 表中查表校验。**这不是 JWT**——令牌不含任何签名或载荷，无法离线验证，所有有效性判断都依赖服务端查表（实现见 `server/middleware/auth.ts` 的 `getValidSession`）。
- **角色校验中间件**: `requireAuth(...roles)`（`server/middleware/auth.ts`）返回 Express 中间件，未带有效会话返回 401，角色不匹配返回 403。全仓 `requireAuth(` 实测调用分布：

  | 调用形式                                            | 次数（`server/routes/*.ts`） | 含义                                       |
  | --------------------------------------------------- | ---------------------------- | ------------------------------------------ |
  | `requireAuth()`                                      | 83                           | 仅要求已登录，不限角色                     |
  | `requireAuth('teacher', 'administrator')`            | 88                           | 教师与管理员（含 1 处无空格写法）          |
  | `requireAuth('administrator')`                       | 31                           | 仅管理员（用户、站点配置、插件安装等）     |
  | `requireAuth('student', 'teacher', 'administrator')` | 12 + 1（末位为 `student` 在后） | 三种角色均可                           |
  | `requireAuth('administrator', 'teacher')`            | 1                            | 同上，仅顺序不同                           |

  `requireAuth` 内部会把字面量 `'admin'` 归一为 `'administrator'`，并对 `username === 'admin'` / `userId === 'usr_admin'` 的种子账号做同样的角色提升。
- **`checkIsTeacherOrAdmin(req)`** 是同类逻辑的布尔版本（`session.role === 'teacher' || 'administrator'`），供非中间件形态的调用点使用。

| 操作 / API         | Admin | Teacher | Student    | Plugin                            |
| ------------------ | ----- | ------- | ---------- | --------------------------------- |
| 创建/修改课程      | ✅    | ✅      | ❌         | 依赖 Manifest 授权                |
| 查看全班学习分析   | ✅    | ✅      | 仅查看个人 | 依赖 Manifest 授权                |
| 访问 SQLite 数据库 | ✅    | ❌      | ❌         | 见下方「插件与数据库的权限边界」  |
| 修改系统密钥配置   | ✅    | ❌      | ❌         | ❌                                |

### 其他认证层控制

- **强制改密（`SEC-AUTH-06`）**: `enforcePasswordChanged` 中间件拦截带 `mustChangePassword` 标记的会话发起的非 GET/HEAD/OPTIONS 请求，仅放行 `/api/auth/change-password`、`/api/auth/logout`、`/api/auth/session`、`/api/auth/me` 四条豁免路径。前端全屏强制改密是体验层，服务端这里是兜底。
- **Socket 握手鉴权**: `socketAuthMiddleware(socket, next)` 从 cookie `edu_os_token` 或 `socket.handshake.auth.token` 取令牌校验会话，并同样拒绝带 `mustChangePassword` 标记的连接（与 HTTP 层同用 `FORBIDDEN_DEFAULT_PASSWORD` 错误码）。
- **CSRF**: `server/middleware/csrf.ts` 的 `csrfGuard`。

---

## 2. 插件沙箱隔离（Worker Thread）

插件有两条执行路径：**Inline**（主进程内动态 `import()`）与 **Worker**（独立 `node:worker_threads` Worker）。只有 Worker 路径享有以下隔离，**Inline 路径不具备线程隔离**。

### 2.1 Worker 侧资源与模块约束

- **无 DOM 访问**: Worker 线程中无 `window`, `document` 对象。
- **IPC 通信网关**: 所有 API 调用必须通过序列化的 MessageChannel 进行（`InvokeMessage` / `result` / `error` 消息）。
- **V8 堆上限**: `WorkerManager` 创建 Worker 时设 `resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 }`。
- **并发上限**: `MAX_WORKERS = 32`，超出时创建 Worker 直接抛错。
- **激活超时**: 默认 60s（`OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` 可覆盖）；Worker `error` / `exit` 事件在等待期内立即 reject。

> ⚠️ **没有 CPU / 内存采样与自动挂起**。代码中**不存在**「监控 CPU 与内存占用，超限自动挂起」的实现，也没有把插件状态置为 `PAUSED` 的路径 —— `PluginState` 只有 7 个值（`installed` / `activating` / `active` / `deactivating` / `inactive` / `error` / `uninstalled`），其中不含 `PAUSED`。当前唯一的资源约束是上面那条 V8 堆上限（超限表现为 OOM 崩溃，由 Worker `exit` 处理器标记 `crashed`），而非采样驱动的主动挂起。

### 2.2 共享模块白名单

`ctx.require(moduleName)` 只允许引用 `packages/core/plugin-host/types.ts` 的 `PLUGIN_SHARED_MODULES` 白名单（共 7 项）：

```text
recharts, react-markdown, jspdf, jspdf-autotable, exceljs（可选）, lucide-react, uuid
```

白名单外的引用直接抛错。`exceljs` 按需加载，失败只 `console.warn` 不阻塞。

### 2.3 三道安全门禁（后端 Worker）

全部在 `packages/core/worker-runtime/service-host.ts` 的 `handleInvoke` 入口处，**按顺序**执行：

| 顺序 | 门禁                        | 实现                                                                                  |
| ---- | --------------------------- | ------------------------------------------------------------------------------------- |
| 1    | **Token 白名单**            | `ServiceHost` 构造时接收 `allowedTokens` 存入 `allowedServiceTokens`；`handleInvoke` 首行校验 `msg.token` 是否在集合内，不在则抛 `WorkerCapabilityError`。**在 `resolveService` 之前拦截**。 |
| 2    | **manifest 能力检查**       | 若 `manifestCapabilities.length === 0`（插件未声明任何能力），只允许 `msg.method === 'get'`，其余一律拒绝。 |
| 3    | **数据库语句守卫**          | `assertDatabaseAccessAllowed(sql)`：见下。                                             |

白名单由 `packages/core/worker-runtime/worker-manager.ts` 的 `computeAllowedWorkerTokens(manifest, serviceTokens)` 计算并注入 `new ServiceHost(..., allowedTokens)`：

- 基础集合 `BASE_WORKER_SERVICE_TOKENS`：`IEventBusService` / `ICommandBusService` / `IActionRegistryService` / `ICapabilityService` / `IProcessService` / `IStorageService` / `IAIService` / `IDatabase` / `IPluginHost`（9 个）；
- 积分相关 Token（`IPointsDimensionRegistry` / `IPointsLedgerService`）**仅在** manifest 的 `requires` / `optional` 显式声明依赖，或 `capabilitiesProposed` 含 `points` / `points:*` / `*` 时才加入。

### 2.4 数据库安全屏障与自建表 DDL 白名单

`assertDatabaseAccessAllowed(sql)` 分三层拦截：

1. **禁用指令**: `ATTACH` / `DETACH` / `PRAGMA` / `VACUUM` / `CREATE|DROP TRIGGER|VIEW`（含 TEMP 变体）。
2. **核心表黑名单**: `users`、`client_sessions`、`plugins`、`plugin_storage`、`ai_providers`、`processes`、`pending_commands`、`classes`、`students`、`class_students`、`lessons`、`assignments`、`assignment_submissions`、`attendance`、`schedules`、`class_grade_weights`、`exams`、`exam_scores`、`student_semester_reports`、`student_rollcalls`、`student_seats`、`student_read_notifications`、`student_lesson_progress`、`courseware`、`courseware_attempt`、`system_resources`、`events`、`_migrations`（共 28 张）；SQL 中出现任一表名即拒绝。
3. **DDL 命名空间白名单**: `CREATE|DROP|ALTER TABLE` 的目标表名必须以插件专属前缀开头（`plugin_<dbPluginId>_` 或 `plugin_<pluginId>_`，特殊字符转义为 `_`），或为 `plugin_migrations`；另有为 `lianyun-course` 插件放行的 `plugin_research_` 前缀。这既允许插件在自己作用域内建表，也防止表名拦截本身引发的 Supervisor 重启崩溃循环。

### 2.5 插件与数据库的权限边界

「插件 ❌ 访问 SQLite」需要分开看两个层面：

- **REST 层面**: 插件自身不能直接发 HTTP 请求访问平台 API（浏览器侧 `IFrontendAPI` 走 `same-origin` fetch，但受 §3.3 的方法/路径门禁约束）。
- **DI 层面**: 插件**可以**通过 `ctx.resolve(IDatabaseToken)` 拿到平台共享的 `better-sqlite3` 句柄（`Token<T>` 绑定的是 `kernelContainer.db`，即平台主库）。**真正的边界不是"拿不到句柄"，而是上面 §2.4 的语句级守卫** —— 所有 SQL 都要过 `assertDatabaseAccessAllowed`，核心表与跨库指令被硬禁，自建表限定在 `plugin_*` 命名空间内。
- **`ctx.db`**: 另有插件命名空间隔离的 `PluginDatabaseAPI`（`ctx.db`），其表前缀在 inline 模式用 DB UUID、worker 模式用 `manifest.id`（两者规则不同，详见 `docs/reference/plugin-database-api.md`）。

因此 RBAC 表中 Plugin 列写「❌（只能用 Plugin DB）」并不准确 —— 更贴切的表述是「受 Token 白名单 + 语句守卫限制，只能操作 `plugin_*` 命名空间内的表」。

### 2.6 前端插件运行时（浏览器 Worker）

前端有**独立实现**的一套门禁（`src/plugin-host/`），与后端同名同规则但**不共享代码**（后端 `worker-manager.ts` 依赖 `node:worker_threads` / `better-sqlite3`，浏览器无法直接 import）：

| 顺序 | 门禁                | 实现位置                                              |
| ---- | ------------------- | ----------------------------------------------------- |
| 1    | Token 白名单        | `src/plugin-host/allowed-tokens.ts` 的 `computeAllowedWorkerTokens` + `BASE_FRONTEND_WORKER_SERVICE_TOKENS`（4 项：`IFrontendAPI` / `ISocketService` / `IUIService` / `IStorageService`），在 `src/plugin-host/service-host.ts` 的 `handleInvoke` 校验 |
| 2    | manifest 能力检查   | 同文件 `handleInvoke`：空能力集时只允许 `'get'`       |
| 3    | 方法 / 路径门禁     | `src/plugin-host/method-policy.ts` 的 `checkMethodPolicy` |

前端第 3 道的具体判定（`method-policy.ts`）：

- **`IFrontendAPI`**：`get*` 只读放行；写操作（`post` / `put` / `patch` / `del` / `del` 等）需 manifest 声明 `api:write`；若路径命中 `HIGH_RISK_PATH_PREFIXES`（`/api/plugins`、`/api/users`、`/api/auth`、`/api/ai-providers`、`/api/agent`、`/api/grade-sync`、`/api/site-settings`、`/api/approvals`）则改需 `api:admin`。
- **`ISemesterGradeService`**：方法名以 `save` / `write` / `set` 开头时需 `grades:write`（`grades` 或 `grades:read` 不足以解锁写入）。
- **`ISocketService`**：禁止调用 `disconnect()` / `destroy()`（会中断正在进行的课堂实时通道）。
- **`IUIService` / `IStorageService`**：直接放行。

> 该层的定位是**纵深防御而非访问控制** —— 真正的权限边界在服务端（每个 REST 端点各自校验会话与角色）。它收窄的是「manifest 里写一条任意字符串即可获得全部写能力」的爆炸半径。

---

## 3. Prompt 注入防护与 API Key 加密

这两项位于**不同的文件**，不应并列理解为同一模块：

- **Prompt Injection Detection**: `detectPromptInjection` 定义在 `server/utils/crypto.ts`，**唯一调用点**是 `server/routes/os.ts` 的聊天入口（即 `/api/agent/chat` 一类的对话请求）。它**只覆盖 AI Agent 的聊天输入** —— 其他入口（课件、作业提交、插件 manifest 等）不经过该检测。
- **API Key Masking & AES-256-GCM Encryption**: 大模型 API Keys 在 SQLite 中加密存储，UI 中掩码展示。实现在 `packages/core/di/api-key-crypto.ts` 的 `encryptApiKey` / `decryptApiKey`（`server/utils/crypto.ts` 亦导出同名函数），该文件**只做加解密**，不涉及注入检测。

---

## 4. iframe Courseware Security

- **Helmet CSP `frame-src` configuration**: 服务端 Content Security Policy 的 `frame-src` 为 `["'self'", 'blob:', 'data:', ...frameAllowedOrigins, ...ltiAllowedOrigins]`。其中 `frameAllowedOrigins` 来自环境变量 `ALLOWED_FRAME_ORIGINS`（逗号分隔），**未设置时**回落到 `['http://localhost:*', 'http://127.0.0.1:*']`；`ltiAllowedOrigins` 来自 `LTI_ALLOWED_LMS_ORIGINS`，未设置时为空数组。**没有任何 `http:` / `https:` 协议通配** —— 需要放开某个来源必须显式写进环境变量。

  > 与之配套的 `connectSrc` 为 `["'self'", 'ws:', 'wss:']`，注释明确说明这是**刻意去掉** `http: https:`（等于无出站限制）；`scriptSrc` 在生产环境为 `["'self'", 'blob:']`（`blob:` 是插件前端 Blob URL 加载通道所必需），非生产环境额外放开 `'unsafe-inline'` / `'unsafe-eval'`。
  >
  > 第三方课件 HTML 由独立路由直出并用**自有宽松 CSP** 覆盖（`server/routes/shared.ts` 的 `setCoursewareDocumentCsp`），不继承全局头。
- **iframe sandbox attribute**: 课件 iframe 使用 `sandbox="allow-scripts allow-forms allow-downloads"`（**不含** `allow-same-origin`），以保证严格的跨源隔离。运行位置为 `src/features/courseware/InteractiveCoursewareViewer.tsx`（互动课件）与 `src/features/whiteboard/components/HtmlAppletFrame.tsx`（白板内课件组件）。
- **Bridge SDK Proxy pattern**: 跨源 `postMessage` 归一化由 Bridge SDK 通过 `Object.defineProperty + Proxy` 模式遮蔽跨源 WindowProxy 上的 `window.parent` / `window.top` 来安全处理（`server/utils/bridge-sdk.ts` 的 `BRIDGE_SDK_CODE`）。
