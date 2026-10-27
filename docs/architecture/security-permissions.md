# Security & Permissions 安全与权限模型

OpenLearn V2 的安全体系涵盖用户鉴权、基于角色的访问控制（RBAC）、插件沙箱隔离（Worker Thread Sandbox）、Prompt 注入防护及加密防篡改机制。

---

## 1. 身份认证与 RBAC 权限矩阵

平台用户划分为三种核心角色（`administrator`, `teacher`, `student`）：

- **不透明会话 ID + HttpOnly Cookie**: 登录成功后签发随机会话 ID（`edu_os_token` Cookie），服务端在 `client_sessions` 表中查表校验。**这不是 JWT**——令牌不含任何签名或载荷，无法离线验证，所有有效性判断都依赖服务端查表（实现见 `server/middleware/auth.ts` 的 `getValidSession`）。
- **角色校验中间件**: `requireAuth(...roles)`（`server/middleware/auth.ts`）返回 Express 中间件，未带有效会话返回 401，角色不匹配返回 403。全仓 `requireAuth(` 实测调用分布：

  | 调用形式                                             | 次数（`server/routes/*.ts`）    | 含义                                   |
  | ---------------------------------------------------- | ------------------------------- | -------------------------------------- |
  | `requireAuth()`                                      | 83                              | 仅要求已登录，不限角色                 |
  | `requireAuth('teacher', 'administrator')`            | 88                              | 教师与管理员（含 1 处无空格写法）      |
  | `requireAuth('administrator')`                       | 31                              | 仅管理员（用户、站点配置、插件安装等） |
  | `requireAuth('student', 'teacher', 'administrator')` | 12 + 1（末位为 `student` 在后） | 三种角色均可                           |
  | `requireAuth('administrator', 'teacher')`            | 1                               | 同上，仅顺序不同                       |

  `requireAuth` 内部会把字面量 `'admin'` 归一为 `'administrator'`，并对 `username === 'admin'` / `userId === 'usr_admin'` 的种子账号做同样的角色提升。

- **`checkIsTeacherOrAdmin(req)`** 是同类逻辑的布尔版本（`session.role === 'teacher' || 'administrator'`），供非中间件形态的调用点使用。

| 操作 / API         | Admin | Teacher | Student    | Plugin                           |
| ------------------ | ----- | ------- | ---------- | -------------------------------- |
| 创建/修改课程      | ✅    | ✅      | ❌         | 依赖 Manifest 授权               |
| 查看全班学习分析   | ✅    | ✅      | 仅查看个人 | 依赖 Manifest 授权               |
| 访问 SQLite 数据库 | ✅    | ❌      | ❌         | 见下方「插件与数据库的权限边界」 |
| 修改系统密钥配置   | ✅    | ❌      | ❌         | ❌                               |

### 其他认证层控制

- **强制改密（`SEC-AUTH-06`）**: `enforcePasswordChanged` 拦截带 `mustChangePassword` 标记的会话访问的全部 `/api` 请求（含 GET），仅放行 `/api/auth/change-password`、`/api/auth/logout`、`/api/auth/session`、`/api/auth/me`。静态资源与 SPA 壳不在 `/api` 下，改密页仍可打开。**适用范围（Issue #94 起）**：仅教师/管理员种子账号（密码等于用户名或 `users.must_change_password=1`）；**学生以初始默认口令 123456 登录不再强制改密**——会话仅携带 `usedDefaultPassword` 提示标记，前端展示可关闭的非阻塞横幅引导修改，接口不受任何拦截。
- **班级对象授权**: 班级、作业、提交、成绩按角色和成员关系校验（`server/services/class-access.ts`）。管理员可访问全部班级；教师只能访问 `classes.owner_user_id` 指向自己的班级（空归属的历史班级不向全体教师开放，需管理员指定归属）；学生只能访问 `class_students` 中的班级，且只能看到自己的提交与成绩。对外列表不返回 `class_passcode`。库内该列是 AES-256-GCM 密文（前缀 `olenc1:`），登录先解密再做常量时间比较；任课教师的口令接口返回原文。越权返回 403，对象不存在返回 404。
- **学生对象写授权**: `PUT /api/students/:id` 与 `DELETE /api/students/:id` 在角色校验之外再做学生级归属校验（`server/routes/roster.ts` 的 `resolveWritableStudentId`）：管理员不限；教师仅可写 `teacherCanSeeStudent` 判定可见的学生（其名下班级的在册学生）；其余 403。路径参数支持 `student_number` 或 `id`，统一解析为规范 id 后再落库。
- **花名册范围**: `GET /api/students` 与班级对象授权同口径——管理员返回全库，教师仅返回其 `owner_user_id` 名下班级的在册学生（`RosterService.listStudents` 的 `scope.mode = 'owner'`），分页 `total` 同步收敛。
- **私有备忘隔离**: `students.private_notes` 只对教师/管理员可见。`GET /api/students/:id/dashboard` 按视角选择列，学生本人响应中的 `profile` 不含 `private_notes`（`locked_lesson_id` 等学生端自用字段保留）；`GET /api/classes/:id/students` 的学生视角同样走字段白名单。
- **私有备忘净化**: `students.private_notes` 以 `{"category","html"}` JSON 或裸 HTML 存储。`packages/core/security/html-sanitize.ts` 是唯一净化入口：`PUT /api/students/:id` 与 `POST /api/students/import` 落库前净化（`xss` 白名单，仅保留排版标签与有限 `style`），编辑器在 `innerHTML` 赋值前再净化一次以覆盖历史脏数据。
- **敏感字段审计**: `PUT /api/students/:id` 比较更新前后的 `password` / `private_notes` / `locked_lesson_id`，实际变更时写入审计事件 `student.sensitive_fields_updated`（操作者 `actorId`、目标 `studentId`、变更字段名），**不记录密码明文/哈希或备忘正文**。
- **学生密码写入**: 教师端不返回、不回显密码，改为一次性「设置新密码」提交；服务端拒绝空/纯空白密码（400），避免空串哈希导致账号无法登录。
- **白板读授权（#127）**: `GET /api/lessons/:id/whiteboard` 与写操作同口径——教师/管理员可读任意课节与作业白板；学生视角对元素 `data` 递归剥离 `correctIndex` / `correctAnswer` / `answer` / `solution` 等答案字段，作业伪课节（`assignment-*-student-<sid>`）只允许本人，已有开课记录的真实课节仅开课班级成员可读（与 socket `canJoinLessonRoom` 一致），未开课的自学场景不额外设限。
- **VFS 访问（#128）**: `GET /api/vfs`（含 `virtual-lessons` / `virtual-assignments` / `virtual-submissions` / 物理节点）与 `GET /files/*` 仅教师/管理员可用，学生一律 403。VFS 是教师工作台的系统资源浏览器，前端也只在教师会话下拉取。
- **Socket 握手鉴权**: `socketAuthMiddleware(socket, next)` 从 cookie `edu_os_token` 或 `socket.handshake.auth.token` 取令牌校验会话，并同样拒绝带 `mustChangePassword` 标记的连接（与 HTTP 层同用 `FORBIDDEN_DEFAULT_PASSWORD` 错误码）。
- **CSRF**: `server/middleware/csrf.ts` 的 `csrfGuard`。
- **路由数据范围声明门禁（#140 / #229）**: 只做 `requireAuth()`（不限角色）的已认证路由必须在认证之外**声明**数据范围 —— `requireScopedAuth('self' | 'class-member' | 'class-staff' | 'admin' | 'authenticated')`。服务端启动时 `server/security/route-scope.ts` 的 `assertRouteDataScopes()` 遍历 Express 路由栈审计：默认只告警；`ROUTE_SCOPE_ENFORCE=true` 时**直接抛错、服务器起不来**。该变量已在 CI（`.github/workflows/ci.yml`）全局启用，因此「新增路由漏声明数据范围」是硬失败而非静默放行。迁移期白名单 `server/security/route-scope-whitelist.ts` 必须保持为空 —— 新增路由应直接声明，而不是加白名单绕过审计。门禁由 `server/__tests__/route-scope-enforce.test.ts` 覆盖（运行时审计 + CI 配置自检）。

---

## 2. 插件沙箱隔离（Worker Thread）

插件有**三档执行模式**（`PluginExecutionMode`）：**Inline**（主进程内动态 `import()`）、**Worker**（`node:worker_threads` 线程）、**Process**（`child_process` 子进程 + 最小环境变量白名单）。

实际落到哪一档由 `packages/core/plugin-host/execution-policy.ts` 的 `resolvePluginExecutionMode()` 决定：**只有**管理员写进 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 的 manifest id、或插件文件真实位于内置目录 `packages/plugins`，才允许 inline / worker；其余第三方插件请求 inline / worker 一律被**强制改写为 process**（`coerced: true`）。manifest id 以 `@openlearn/` 开头不构成信任依据。

因此隔离强度是 **Process > Worker > Inline**：只有前两档享有下述隔离，**Inline 路径既不隔离线程也不隔离环境变量与网络栈**（`plugin-net-preload.cjs` 对 inline 不生效）。

### 2.1 Worker 侧资源与模块约束

- **无 DOM 访问**: Worker 线程中无 `window`, `document` 对象。
- **IPC 通信网关**: 所有 API 调用必须通过序列化的 MessageChannel 进行（`InvokeMessage` / `result` / `error` 消息）。
- **V8 堆上限**: `WorkerManager` 创建 Worker 时设 `resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 }`。
- **并发上限**: `MAX_WORKERS = 32`，超出时创建 Worker 直接抛错。
- **激活超时**: 默认 60s（`OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` 可覆盖）；Worker `error` / `exit` 事件在等待期内立即 reject。

### 2.1a 两种隔离原语的出网管控（Issue #237）

插件 Worker 路径有两种隔离原语，出网管控**同口径**：

| 能力                                  | `process`（子进程）                                                  | `thread`（worker_threads）                                            |
| ------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 原始 socket / UDP / TLS / HTTP2 / DNS | ⛔ `plugin-net-preload.cjs`（`--require` 入口脚本）                  | ⛔ bootstrap 内 `net-guard` section                                   |
| `fetch` 未批准域名                    | ⛔ 拒绝                                                              | ⛔ 拒绝                                                               |
| `fetch` 已批准域名                    | ✅ 宿主代发（`ol-net-proxy` 协议）                                   | ✅ 宿主代发（同一协议，经 transport 路由）                            |
| `http(s).request` 直连                | 已批准域名由 preload 的 shim 代理                                    | ⛔ 被底层 socket 封锁兜底拒绝（内置插件无直连用法，出网请走 `fetch`） |
| `process.getBuiltinModule`            | ⛔ process-masking 屏蔽（Node ≥22.3 的官方 require/import 绕过入口） | ⛔ 同左                                                               |

两条路径共用 `plugin-net-proxy.ts` 的宿主代发实现（内网/环回/元数据地址阻断、DNS rebinding 防护、10MB 体积上限），批准名单同源于插件出站授权。

> ⚠️ **资源超限是「杀掉」，不是「挂起」**。`packages/core/worker-runtime/plugin-quota.ts` 的 `startProcessQuota()` 会按 `OPENLEARN_PLUGIN_MAX_RSS_MB`（默认 512）与 `OPENLEARN_PLUGIN_CPU_QUOTA_MS` / `_WINDOW_MS`（默认 8000 / 10000）采样，超限直接 `SIGKILL`，随后交给崩溃看门狗（指数退避 + 熔断）。**采样只覆盖 `process` 模式**，且只在 Linux 上读 `/proc` 生效；`thread` 模式目前只有 V8 堆上限（`resourceLimits.maxOldGenerationSizeMb`），超限表现为 OOM 崩溃。`OPENLEARN_PLUGIN_QUOTA=off` 可整体关闭 RSS 与 CPU 采样。
>
> 代码中**不存在**「检测到超限后把插件状态置为 `PAUSED`」的路径 —— `PluginState` 只有 7 个值（`installed` / `activating` / `active` / `deactivating` / `inactive` / `error` / `uninstalled`），其中不含 `PAUSED`。所以准确表述是「采样 + 硬终止 + 看门狗」，而非「采样驱动的主动挂起」。

### 2.2 共享模块白名单

`ctx.require(moduleName)` 只允许引用 `packages/core/plugin-host/types.ts` 的 `PLUGIN_SHARED_MODULES` 白名单（共 7 项）：

```text
recharts, react-markdown, jspdf, jspdf-autotable, exceljs（可选）, lucide-react, uuid
```

白名单外的引用直接抛错。`exceljs` 按需加载，失败只 `console.warn` 不阻塞。

### 2.3 三道安全门禁（后端 Worker）

全部在 `packages/core/worker-runtime/service-host.ts` 的 `handleInvoke` 入口处，**按顺序**执行：

| 顺序 | 门禁                  | 实现                                                                                                                                                                                         |
| ---- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Token 白名单**      | `ServiceHost` 构造时接收 `allowedTokens` 存入 `allowedServiceTokens`；`handleInvoke` 首行校验 `msg.token` 是否在集合内，不在则抛 `WorkerCapabilityError`。**在 `resolveService` 之前拦截**。 |
| 2    | **manifest 能力检查** | 若 `manifestCapabilities.length === 0`（插件未声明任何能力），只允许 `msg.method === 'get'`，其余一律拒绝。                                                                                  |
| 3    | **数据库语句守卫**    | `assertDatabaseAccessAllowed(sql)`：见下。                                                                                                                                                   |

白名单由 `packages/core/worker-runtime/worker-manager.ts` 的 `computeAllowedWorkerTokens(manifest, serviceTokens)` 计算并注入 `new ServiceHost(..., allowedTokens)`：

- 基础集合 `BASE_WORKER_SERVICE_TOKENS`（`packages/core/worker-runtime/worker-manager.ts`，**9 个**）：`ICommandBusService` / `IEventBusService` / `IActionRegistryService` / `ICapabilityService` / `IProcessService` / `IStorageService` / `IAIService` / `IDatabase` / `INetworkProxyService`；
- 积分相关 Token（`IPointsDimensionRegistry` / `IPointsLedgerService`）**仅在** manifest 的 `requires` / `optional` 显式声明依赖，或 `capabilitiesProposed` 含 `points` / `points:*` / `*` 时才加入。

### 2.4 数据库安全屏障与自建表 DDL 白名单

`assertDatabaseAccessAllowed(sql)` 分三层拦截：

1. **禁用指令**: `ATTACH` / `DETACH` / `PRAGMA` / `VACUUM` / `CREATE|DROP TRIGGER|VIEW`（含 TEMP 变体）。
2. **核心表黑名单**: `users`、`client_sessions`、`plugins`、`plugin_storage`、`ai_providers`、`processes`、`pending_commands`、`classes`、`students`、`class_students`、`lessons`、`assignments`、`assignment_submissions`、`attendance`、`schedules`、`class_grade_weights`、`exams`、`exam_scores`、`student_semester_reports`、`student_rollcalls`、`student_seats`、`student_read_notifications`、`student_lesson_progress`、`courseware`、`courseware_attempt`、`system_resources`、`events`、`_migrations`，以及 2026-10-04 审计补充的 `site_settings`、`agent_conversations`、`classroom_sessions`、`lesson_quiz_submissions`、`courseware_score_config`、`demo_data_registry`、`whiteboard_elements`、`student_point_logs`、`lianyun_research_*`（共 **40 张**）；SQL 中出现任一表名即拒绝。

   > ⚠️ 这仍是一张**黑名单**：任何将来新增的核心表若未登记，默认对插件开放。彻底解法是改为白名单（只允许 `plugin_*` 自有表 + 少量显式共享表），但那会改变现有插件的可见面，需单独评估。

3. **DML 命名空间隔离**（SEC-DB-03，2026-10-04 新增）: 此前命名空间校验**只作用于 DDL**（`CREATE/DROP/ALTER TABLE`），DML（`SELECT/INSERT/UPDATE/DELETE`）完全没有约束 —— 任何 worker 插件都能任意读写**其他插件的私有表**（实测库中 19 张 `plugin_<id>_*` 表，跨插件读写畅通无阻）。现改为：从 `FROM / INTO / UPDATE / JOIN / TABLE` 位置提取**表名**（不能用全文搜 `plugin_`，否则 `plugin_id` 这类**列名**会被误判），凡 `plugin_` 前缀且不在本插件命名空间内的一律拒绝。**只有 `plugin_migrations` 是共享表豁免**；`plugin_storage` 在核心表黑名单里，插件不能直接读写，请改用 `ctx.services.storage`（见[插件数据库 API](../reference/plugin-database-api.md)）。
4. **DDL 命名空间白名单**: `CREATE|DROP|ALTER TABLE` 的目标表名必须以插件专属前缀开头（`plugin_<dbPluginId>_` 或 `plugin_<pluginId>_`，特殊字符转义为 `_`），或为 `plugin_migrations`；另有为 `lianyun-course` 插件放行的 `plugin_research_` 前缀。这既允许插件在自己作用域内建表，也防止表名拦截本身引发的 Supervisor 重启崩溃循环。

### 2.5 插件与数据库的权限边界

「插件 ❌ 访问 SQLite」需要分开看两个层面：

- **REST 层面**: 插件自身不能直接发 HTTP 请求访问平台 API（浏览器侧 `IFrontendAPI` 走 `same-origin` fetch，但受 §3.3 的方法/路径门禁约束）。
- **DI 层面**: 插件**可以**通过 `ctx.resolve(IDatabaseToken)` 拿到平台共享的 `better-sqlite3` 句柄（`Token<T>` 绑定的是 `kernelContainer.db`，即平台主库）。**真正的边界不是"拿不到句柄"，而是上面 §2.4 的语句级守卫** —— 所有 SQL 都要过 `assertDatabaseAccessAllowed`：跨库指令硬禁、40 张核心表硬禁、`plugin_*` 表仅限本插件命名空间。
- **Worker 基础白名单**（**9 个** Token，与 §2.3 的 `BASE_WORKER_SERVICE_TOKENS` 同一份）：`ICommandBusService`、`IEventBusService`、`IActionRegistryService`、`ICapabilityService`、`IProcessService`、`IStorageService`、`IAIService`、`IDatabase`、`INetworkProxyService`。**`IPluginHost` 已移出**（2026-10-04）—— 它暴露 `installPlugin` / `installPluginFromZip` / `activatePlugin` / `uninstallPlugin`，沙箱化插件本不该能安装并激活**其他**插件（等于给自己留一个能在自身被卸载后继续存活的后门）。内置插件确实需要它，但内置默认 **inline 模式**，不经过 worker 白名单，因此移除无功能影响；空出的位置由出网代理 `INetworkProxyService` 占位。
- **`ctx.db`**: 另有插件命名空间隔离的 `PluginDatabaseAPI`（`ctx.db`），其表前缀统一为 `plugin_<scopeId>_`（`pluginTablePrefix(scopeId)`）——**只取决于安装主键，与 inline / worker / process 模式无关**，详见 `docs/reference/plugin-database-api.md`。

因此 RBAC 表中 Plugin 列写「❌（只能用 Plugin DB）」并不准确 —— 更贴切的表述是「受 Token 白名单 + 语句守卫限制，只能操作 `plugin_*` 命名空间内的表」。

### 2.6 前端插件运行时（浏览器 Worker）

前端有**独立实现**的一套门禁（`src/plugin-host/`），与后端同名同规则但**不共享代码**（后端 `worker-manager.ts` 依赖 `node:worker_threads` / `better-sqlite3`，浏览器无法直接 import）：

| 顺序 | 门禁              | 实现位置                                                                                                                                                                                                                                               |
| ---- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Token 白名单      | `src/plugin-host/allowed-tokens.ts` 的 `computeAllowedWorkerTokens` + `BASE_FRONTEND_WORKER_SERVICE_TOKENS`（4 项：`IFrontendAPI` / `ISocketService` / `IUIService` / `IStorageService`），在 `src/plugin-host/service-host.ts` 的 `handleInvoke` 校验 |
| 2    | manifest 能力检查 | 同文件 `handleInvoke`：空能力集时只允许 `'get'`                                                                                                                                                                                                        |
| 3    | 方法 / 路径门禁   | `src/plugin-host/method-policy.ts` 的 `checkMethodPolicy`                                                                                                                                                                                              |

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
