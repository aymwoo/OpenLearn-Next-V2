# 模块地图：目录 → 职责 → 关键符号

**读法**：按「我要改/查什么」定位行，再看「关键符号」列去源码搜符号名（不要按行号跳转）。
路径约定：无前缀 = 本仓库相对路径；`[P]` = 外部示例插件仓库 `openlearn-plugin-lab-seat`。

---

## 0. 顶层目录

| 目录 | 文件/行数（不含测试） | 职责 |
| --- | --- | --- |
| `server.ts` | 1 / 751 | 进程入口：中间件链 → Socket.IO → 注册路由 → 错误兜底 |
| `server/` | 99 / 37,719 | 服务端模块：`routes/`（24）、`middleware/`（6）、`security/`（8）、`services/`、`utils/`、AI/课堂/备份等 |
| `src/` | 521 / 125,645 | React 前端：`features/`（22 个域）、`components/`、`plugin-host/`、`hooks/`、`store/`、`services/` |
| `packages/core/` | 322 / 47,913 | 内核：29 个子系统（见 §4） |
| `packages/plugins/` | 9 / 6,448 | 内置插件（`inline` 模式） |
| `packages/plugin-sdk/` | 10 / 9,209 | 插件公开契约 + CLI |
| `packages/plugin-test-kit/` | 1 / 645 | `createMockContext()` 等测试工具 |
| `packages/bridge-sdk/` | — | 沙箱 iframe 桥源（`src/bridge.js`，构建产物落到 `server/utils/bridge-sdk.ts`） |
| `packages/activity-ecosystem/` | 7 / 768 | 活动注册表 |
| `migrations/` | 45 SQL | 数据库迁移（当前 86 张表） |
| `e2e/` | 32 / 7,796 | Playwright 端到端 |
| `scripts/` | — | 构建、审计、运维脚本 |
| `docs/agent/contracts/` | 7 JSON | 机器可读契约（AI 优先读这个） |

---

## 1. `server/` 模块

### 1.1 路由：`server/routes/`（24 文件，313 端点）

| 文件 | 行数 | 职责 | 关键符号 |
| --- | --- | --- | --- |
| `classroom.ts` | 3,684 | 课堂会话/倒计时/视图状态/点名；注册 5 条 `classroom.countdown.*` 命令 | 倒计时注册循环（L405-495） |
| `plugins.ts` | 2,024 | 插件 CRUD、安装、激活、市场、AI provider、站点设置 | `registerPluginsRoutes` |
| `roster.ts` | 1,876 | 班级/学生/账号/机房 CRUD（53 端点） | — |
| `lessons.ts` | 814 | 课节 CRUD、时间轴、环节 | — |
| `classroom-peer-review.ts` | 631 | 同伴互评、展示作品、徽章、弹幕 | — |
| `plugin-api-gateway.ts` | 566 | 插件 REST 网关中间件 | `pluginApiGatewayMiddleware`、`MAX_PAYLOAD_BYTES`（L58） |
| `assessments.ts` | 502 | 测评、作答、题库、题型 | — |
| `os.ts` | 428 | **命令入口**、AI Agent、活动生态、上传 | `POST /api/commands`（L112） |
| `assignment-hub.ts` | 394 | 作业 CRUD + 附件 + 提交 | — |
| `classroom-extras.ts` | 336 | 家长通知、掌握度预测 | — |
| `grading.ts` | 333 | 考勤汇总、成绩权重、考试 | — |
| `bridge.ts` | 293 | LMS 桥（`/bridge.js`、`/runtime/:uuid`） | `registerBridgeRoutes` |
| `courseware.ts` | 292 | 课件上传/确认/作答 | — |
| `workspace.ts` | 247 | 事件流、VFS、诊断上报 | — |
| `shared.ts` | 243 | 路由公共依赖（`ServerContext` 等） | — |
| `health.ts` | 208 | `/health`、`/health/ready`、`/metrics` | `registerHealthRoutes` |
| `schedules.ts` | 200 | 课表与冲突检测 | — |
| `admin.ts` | 187 | 加密状态、升级检查、批量导入 | — |
| `course-packages.ts` | 159 | 课程包导入导出 | — |
| `resources.ts` | 239 | 资源库（5 个 REST 端点 + 4 条 `resource.*` 命令 + 4 条 descriptor） | `core-resource-*` descriptor（L124-197）、`RESOURCE_HANDLERS`（L199）、注册循环（L232） |
| `assignments.ts` | 132 | 作业生成/提交/评分 | — |
| `processes.ts` | 111 | 高危命令审批、长任务日志 | — |
| `demo-data.ts` | 92 | 演示数据 seed/cleanup | — |
| `client-errors.ts` | 32 | 前端错误上报 | — |

端点全表见 [../api/http-api.md](../api/http-api.md)。

### 1.2 中间件与安全

| 文件 | 职责 | 关键符号 |
| --- | --- | --- |
| `middleware/auth.ts` | Session 校验、`getActorId`、`requireAuth`、`requireScopedAuth` | `getActorId`（产出 `user:<id>:<role>`） |
| `middleware/csrf.ts` | 写请求跨站来源门控 | `csrfGuard` |
| `middleware/cors.ts` | CORS 中间件工厂 | `createCorsMiddleware` |
| `middleware/body-limits.ts` | 大文件上传的局部放开 | `mountLargeBodyParsers` |
| `middleware/request-observability.ts` | 注入 `req.requestId`、慢请求 | `requestObservability` |
| `middleware/data-scope.ts` | 数据范围辅助 | — |
| `security/route-scope.ts` | `DataScope` 声明 + 审计 | `DataScope`（L31）、`collectAuthRoutes`、`auditRouteScopes` |
| `security/rate-limit.ts` | 各类限流器 | `writeLimiter` / `viewStateLimiter` / `aiLimiter` / `loginLimiter` |
| `security/env-validation.ts` | 环境变量启动校验 | — |
| `security/runtime-preflight.ts` | 运行时前置检查 | — |
| `security/trust-proxy.ts` | `TRUST_PROXY` 封装 | — |
| `utils/error-handler.ts` | 统一错误出口 | `sendSafeError`（L27） |

### 1.3 其他服务端模块

| 文件 | 职责 |
| --- | --- |
| `ai-agent.ts`（514） | Agent 工具编排、OpenAI/Gemini 分支、系统提示词 |
| `ai-context-registry.ts` / `ai-persona-registry.ts` | AI 上下文与人格注册 |
| `event-routing.ts`（585） | **内核事件 → Socket 路由表**（`SOCKET_ROUTES`，19 条） |
| `presence.ts`（756） | 房间命名、presence 事件、`classroomEventRooms`、`emitClassroomEvent` |
| `classroom-events.ts`（94） | 课堂事件发射 |
| `realtime-bridge.ts`（40） | 实时桥入口 |
| `backup-scheduler.ts` | 定时备份 |
| `bootstrap-db.ts` | 启动期建库/种子账号 |
| `context.ts` / `shared-state.ts` | 服务端上下文与共享状态 |

---

## 2. `src/` 前端模块

### 2.1 装配（无路由表）

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `App.tsx` | 157 | 全部装配：加载态 / 登录 / 强改密门 / 主界面 |
| `components/AppShell.tsx` | 35 | 只按角色 lazy-load `TeacherView` / `StudentView` / `StudentWorkspacePreview` |

### 2.2 域模块

| 目录 | 文件 | 行数 | 说明 |
| --- | --- | --- | --- |
| `features/whiteboard/` | 140 | 28,096 | 白板（5 个引擎 + 4,555 行主组件） |
| `features/classroom/` | 102 | 27,544 | 课堂视图、`stage-display/` 大屏 |
| `features/teacher/` | 66 | 15,005 | 教师壳 |
| `features/student/` | 64 | 10,711 | 学生壳 |
| `features/assessment/` | 21 | 5,539 | 作答与批阅 |
| `features/modals/` | 19 | 4,462 | 全局弹窗 |
| `features/shared/` | 8 | 1,576 | 共享 UI |
| `features/student-workspace/` | 10 | 867 | C 组迁移预览壳 |
| `features/command-palette/` | 9 | 852 | Cmd/Ctrl+K |
| `features/lesson-engine/` | 8 | 747 | 前端课节运行时 |
| `features/quick-insert/` | 8 | 642 | 快速插入 |
| `features/workspace/` | 10 | 617 | 工作台 |
| `features/activity-ecosystem/` | 3 | 581 | 活动生态前端 |
| `features/ai-*`（5 个） | 25 | 1,389 | AI 动作/课堂上下文/提示词/技能/教师工作台 |
| `features/admin/` | 2 | 721 | 管理台 |
| `features/navigation/` | 2 | 315 | 导航 |
| `features/courseware/` | 3 | 305 | 课件 |
| `features/resource-runtime/` | 5 | 256 | 资源运行时 |

### 2.3 前端插件宿主：`src/plugin-host/`

| 文件 | 职责 | 关键符号 |
| --- | --- | --- |
| `types.ts` | 前端契约：`ExtensionSlot`（120）、`ExtensionPointConfig`、`FrontendPluginContext`、各槽位 Props | `ExtensionSlot`（L95）、`AnchorSlot`（L265）、`ExtensionPointConfig`（L270）、`FrontendPluginContext`（L524） |
| `plugin-host.ts` | 载入 `frontend.js`、iframe 沙箱、桥接分发、声明式贡献注册 | `registerManifestContributions`（L185）、`answerSandboxCall`（L585）、`activateRemotePlugin`（L657） |
| `plugin-host-store.ts` | zustand 扩展点注册表（真正的 UI 来源） | `registerExtensionPoint` / `unregisterExtensionPoint` |
| `extension-point-renderer.tsx` | 渲染：合并 props、角色门控、`view` 分支、错误边界 | `resolveExtensionComponent`（L338） |
| `extension-breaker.ts` | 崩溃熔断 | `CRASH_BREAKER_THRESHOLD = 3`（L14）、`CRASH_BREAKER_WINDOW_MS = 5min`（L15） |
| `service-host.ts` | 浏览器侧 Worker RPC | `ServiceHost`（L74）、`handleInvoke`（L232） |
| `allowed-tokens.ts` | 按 manifest 计算 Worker 可用 Token | `computeAllowedWorkerTokens` |
| `capabilities.ts` | 解析声明能力 | `resolveDeclaredCapabilities` |
| `host-action-dispatcher.ts` | `host:*` 受控动作（refresh/modal/toast/navigate） | `IHostActionDispatcher` |
| `sandbox-frame.ts` | iframe 属性与消息协议 | `PLUGIN_FRAME_CHANNEL`、`PLUGIN_SANDBOX_ATTR` |
| `read-slot-props.ts` | 槽位 props 读取 | — |
| `method-policy.ts` | **前端版** Barrier 3（位置参数签名） | `checkMethodPolicy(token, method, args, caps)` |

> ⚠️ **两个 `method-policy.ts` 不是同一个函数**：内核版
> （`packages/core/plugin-host/method-policy.ts`）签名是 `checkMethodPolicy(input: MethodPolicyInput)`，
> 参数里带 `tokens` 映射；前端版是位置参数。改一处不改另一处 = 两端判定漂移。

---

## 3. `packages/core/` 29 个子系统

| 子系统 | 文件 | 行数 | 一句话职责 | 详见 |
| --- | --- | --- | --- | --- |
| `plugin-host` | 37 | 12,904 | 插件宿主：状态机、上下文构造、SQL 守卫、安装、卸载 | §3.1 |
| `worker-runtime` | 25 | 6,517 | 隔离运行时：子进程/线程 RPC、配额、活体检测 | §3.2 |
| `di` | 23 | 3,387 | DI 容器、Token、各服务实现 | [kernel-and-di.md](../subsystems/kernel-and-di.md) |
| `db` | 10 | 2,905 | SQLite、读池、迁移、备份、保留策略 | [data-and-migrations.md](../subsystems/data-and-migrations.md) |
| `lesson-engine` | 14 | 2,622 | 课节状态机、阶段守卫、环节门槛、时间轴 | [classroom-and-whiteboard.md](../subsystems/classroom-and-whiteboard.md) |
| `bootstrap` | 42 | 2,598 | 装配管线：adapter/builder/composition/permission/pipeline | [kernel-and-di.md](../subsystems/kernel-and-di.md) §7 |
| `esm-loader` | 8 | 2,099 | ESM 载入 + **`manifest-schema.ts`（manifest 的 zod 真源）** | [manifest-reference.md](../development/manifest-reference.md) |
| `assessment` | 14 | 1,835 | 测评：题型注册、评分、题目分析、快照 | [ai-and-assessment.md](../subsystems/ai-and-assessment.md) |
| `observability` | 10 | 1,421 | 日志、指标、健康、审计、脱敏 | [observability-and-security.md](../subsystems/observability-and-security.md) |
| `classroom-runtime` | 14 | 1,391 | 课堂会话生命周期、状态恢复、资源管理 | [classroom-and-whiteboard.md](../subsystems/classroom-and-whiteboard.md) §3 |
| `collaboration-engine` | 15 | 1,150 | 多人协同与冲突处理 | [realtime-and-events.md](../subsystems/realtime-and-events.md) §6 |
| `presence-engine` | 13 | 1,029 | 在线状态与出勤 | 同上 §4 |
| `ai` | 14 | 1,014 | provider 网关、流式、会话、记忆、工具、prompt | [ai-and-assessment.md](../subsystems/ai-and-assessment.md) |
| `analytics-engine` | 13 | 919 | 采集、指标、指标引擎、洞察、预测、隐私存储 | — |
| `ai-capability` | 12 | 902 | 7 个 AI 能力模块（含 `plugin-capability`） | [ai-and-assessment.md](../subsystems/ai-and-assessment.md) §1.1 |
| `capability` | 14 | 776 | 能力授予与校验 | [kernel-and-di.md](../subsystems/kernel-and-di.md) §5 |
| `kernel` | 1 | 749 | `EducationalOS`：装配器 + 命令拦截器 | [kernel-and-di.md](../subsystems/kernel-and-di.md) §1 |
| `service-registry` | 12 | 657 | 平台服务注册/解析/作用域 | — |
| `security` | 3 | 612 | HTML 净化、URL 安全、插件签名 | [observability-and-security.md](../subsystems/observability-and-security.md) §3 |
| `capability-governance` | 12 | 544 | 能力准入与治理 | 同上 §3 |
| `extension-points` | 3 | 506 | 扩展点元数据与兼容性报告 | — |
| `event-bus` | 2 | 337 | 事件总线（`publish`/`subscribe`/`unsubscribe`） | [kernel-and-di.md](../subsystems/kernel-and-di.md) §4 |
| `assignment` | 1 | 264 | 作业领域逻辑 | [ai-and-assessment.md](../subsystems/ai-and-assessment.md) §5 |
| `process-manager` | 1 | 227 | 长任务（与插件执行模式无关） | [kernel-and-di.md](../subsystems/kernel-and-di.md) §6 |
| `whiteboard` | 2 | 206 | 白板元素持久化与事件（后端极薄） | [classroom-and-whiteboard.md](../subsystems/classroom-and-whiteboard.md) §4 |
| `command-bus` | 2 | 180 | 命令总线 | [kernel-and-di.md](../subsystems/kernel-and-di.md) §3 |
| `registry` | 1 | 74 | `ActionRegistry` | 同上 |
| `types` | 1 | 24 | `semver.d.ts` 类型补充 | — |
| `capability-system` | 1 | 9 | 能力系统聚合出口 | — |

### 3.1 `packages/core/plugin-host/` 详表

| 文件 | 职责 | 关键符号 | 状态 |
| --- | --- | --- | --- |
| `types.ts` | 宿主侧类型契约 | `PluginState`（L54）、`PluginContext`（L227）、`PluginExecutionMode`（L390）、`requiresIsolatedExecution`（L413） | 已验证 |
| `errors.ts` | 17 个错误类 | `PluginCapabilityDeniedError`（L33）、`PluginActivateError`（L53）、`SemverMismatchError`（L105） | 已验证 |
| `lifecycle.ts` | 激活/停用编排（状态迁移 + 超时 + 回滚） | `activate`（L120）、`waitForLifecycleIdle`（L651）、`deactivate`（L701） | 已验证 |
| `base.ts` | 生命周期超时常量 | `ACTIVATION_TIMEOUT_MS = 5000`（L124）、`DEACTIVATION_TIMEOUT_MS = 5000`（L126） | 已验证 |
| `context-builder.ts` | 构造 `PluginContext`，包装每个服务调用 | `buildContext`、`createSafeFunction` | 已验证 |
| `execution-policy.ts` | 决定能否进程内运行 | `trustedInlineAllowlist`（L20）、`resolvePluginExecutionMode`（L116） | 已验证 |
| `plugin-namespace.ts` | 命令命名空间唯一规则 | `resolvePluginCommandType`（L62） | 已验证 |
| `method-policy.ts` | Barrier 3 共享策略 | `CAP_*`（L28-49）、`checkMethodPolicy`（L197） | 已验证 |
| `sql-guard.ts` | 插件 SQL 守卫 | `FORBIDDEN_CORE_TABLES`（L13，40 条）、`assertPluginSqlAllowed`（L238） | 已验证 |
| `install.ts` | ZIP 解压、`storage/**` 提取 | `getPluginDir`（L160）、解压谓词（L359/L756） | 已验证 |
| `plugin-tables.ts` | 表前缀规则 | `pluginTablePrefix`（L11）、`isSafePluginTablePrefix`（L38） | 已验证 |
| `student-data-privacy.ts` | 学生数据导出/删除钩子 | `onStudentExport` / `onStudentDelete` | 已验证（类型层） |
| `unified-extension-registry.ts` / `contribution-registry.ts` | 贡献登记 | `ContributionConfig` | 已验证 |
| `hot-reload.ts` / `reload.ts` | 热重载 | `HotReloadError` | 推断 |
| `orphan-data.ts` / `uninstall.ts` | 卸载与孤儿数据 | — | 待确认 |

### 3.2 `packages/core/worker-runtime/` 详表

| 文件 | 职责 | 关键符号 |
| --- | --- | --- |
| `service-host.ts` | 子进程/线程侧 RPC 服务端；SQL 守卫与网络代理的唯一调用点 | `assertPluginSqlAllowed`（L1216）、`INetworkProxyService` 拦截（L769） |
| `service-proxy.ts` | 沙箱内把 `ctx.services.*` 变成 RPC 代理 | Proxy 方法拦截 |
| `child-spawn.ts` / `child-isolate.ts` / `worker-isolate.ts` / `thread-isolate.ts` | 三种隔离载体 | — |
| `worker-manager.ts` | Worker 生命周期与 Token 白名单 | `BASE_WORKER_SERVICE_TOKENS`（L77-87，9 个） |
| `plugin-permission.ts` / `plugin-quota.ts` / `plugin-limits.ts` | 权限与配额 | — |
| `liveness-monitor.ts` | 心跳与假死检测 | — |
| `plugin-net-proxy.ts` / `plugin-net-preload.cjs` | 出站网络代理 | — |
| `transport.ts` / `child-transport.ts` / `event-forwarder.ts` | 消息通道 | `postMessage` 协议 |
| `__tests__/namespace-parity.test.ts` | 校验 bootstrap 内拷贝与 `plugin-namespace.ts` 不漂移 | — |

---

## 4. SDK、测试工具、内置插件

| 路径 | 职责 | 关键符号 |
| --- | --- | --- |
| `packages/plugin-sdk/index.ts` | npm 运行期出口（Token 值、`Token`、`PluginHttpRouter`） | 32 个 `*Token` 值导出 |
| `packages/plugin-sdk/openlearn.d.ts` | **公开类型契约**（自包含，不 re-export 内部） | `PluginContext`（L455）、`Manifest`（L40）、`ActionDescriptor`（L126）、`PlatformEvent` |
| `packages/plugin-sdk/cli.mjs` | 构建/打包/签名 CLI | `frontendBareSpecifierGuard`（L272）、打包三件套（L546-553）、`signZip`（L233） |
| `packages/plugin-test-kit/index.ts` | Mock 上下文 | `createMockContext`（L328）、`MockCommandBus`（L62） |
| `packages/plugins/builtin.ts` | 内置命令主体（35 命令 / 35 描述符） | — |
| `packages/plugins/management.ts` | 管理类命令（25/25） | — |
| `packages/plugins/assignment-eval.ts` | 作业批改（7/7） | `assignment.grade` |
| `packages/plugins/process.ts` | 进程命令（4/4） | — |
| `packages/plugins/vfs.ts` | 虚拟文件系统（4/4） | — |
| `packages/plugins/ai-planner.ts` | AI 规划（3/3） | `ai.start_generation` |
| `packages/plugins/courseware-score.ts` / `score-monitor-script.ts` / `ai-submit-injector.ts` | 课件评分、成绩监控脚本、提交注入 | — |

---

## 5. 机器可读契约：`docs/agent/contracts/`

7 个 JSON 由 `audit-tools/agent_facts.py` 从源码抽取，`--check` 在 CI 校验漂移。
**AI 应优先读它们，而不是数文档里的数字。**

| 文件 | 内容 | 关键计数 |
| --- | --- | --- |
| `slots.json` | `ExtensionSlot` 全集 + 有渲染点的 anchor | 120 / 8 |
| `capabilities.json` | 三套能力登记 + 被硬拒的通配符 | 19 / 8 / 7 |
| `tokens.json` | SDK 导出 Token、可解析 Token | 32 / 31 |
| `contributes-groups.json` | `contributes` 严格键 / 宽松键 | 71 / 38 |
| `bridge-ops.json` | frame / view 两套 op | 10 / 8 |
| `forbidden-tables.json` | SQL 禁写表 | 40 |
| `versions.json` | 版本基线 | 0.7.8 / 3.7.5 / 3.3.3 |

---

## 6. 示例插件：`[P] src/`

| 文件 | 行数 | 职责 | 关键符号 |
| --- | --- | --- | --- |
| `src/index.ts` | 1,461 | manifest、`activate`、27 命令、27 描述符（8 具名 + 19 批量）、迁移、`provide`、定时扫描 | `default.manifest`（L96）、`activate`（L163）、`MISSING_ACTIONS`（L1419） |
| `src/frontend.tsx` | 1,556 | 4 槽位、React 运行期注入、事件订阅 + 退避轮询 | `resolveReact`（L21）、`subscribeToEvents`（L66） |
| `src/smart-assign.ts` / `src/csv.ts` | 184 / 23 | 纯函数 | `parseSmartConstraint`、`escapeCsvField` |

逐行解剖见 [../examples/lab-seat-walkthrough.md](../examples/lab-seat-walkthrough.md)。

---

## 7. 依赖方向（不允许反向）

```text
src/**  ──────────────────► packages/plugin-sdk（类型 + Token 值）
src/plugin-host/** ───────► server/utils/bridge-sdk.ts（生成物，iframe 桥）
server/** ────────────────► packages/core/**
server.ts ────────────────► server/** + packages/core/**
packages/core/** ─────────► packages/plugin-sdk（仅 Token 名与类型，不 import 运行期）
packages/plugins/** ──────► packages/plugin-sdk（同插件约束）
packages/plugin-sdk ──────► 无内部依赖（openlearn.d.ts 自包含）
packages/plugin-test-kit ─► packages/plugin-sdk（值导入 PluginHttpRouter）
```

**三条硬结论**：

1. `packages/plugin-sdk` 是唯一允许被插件依赖的包；插件**不得** import `packages/core/**`。
   证据：`packages/plugin-sdk/openlearn.d.ts` 头注释「Self-contained `.d.ts` for npm publishing.
   No re-exports from monorepo internals.」（L1-8）。
2. `packages/core/**` **不得** import `server/**`（反向依赖会让内核无法独立测试）。
3. `server/utils/bridge-sdk.ts` 是构建产物，源在 `packages/bridge-sdk/src/bridge.js`；
   改生成物会被 `pnpm build` 覆盖。
