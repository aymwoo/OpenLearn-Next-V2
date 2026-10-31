# 源码反查表：结论 → 符号 → 坐标

> **用途**：AI Agent 读到任何一条结论后，用它反向验证「这句话到底出自哪行代码」。
> 本文件只做**索引**，不重复正文论证。正文坐标与本文冲突时，以本文为准并回改正文。

---

## 0. 怎么用

```text
1. 正文看到一条结论 → 查本文对应主题行 → 得到 `路径 → 符号（L行号）`
2. grep 符号名（不要 grep 行号，行号会飘）
3. 符号不存在 ⇒ 该结论已过期，标记 `待确认` 并在 evidence/unresolved-questions.md 登记
```

**行号基线**：平台 `openlearn-next` @ `4f41c9b`（v0.7.8），插件 `openlearn-plugin-lab-seat` @ v0.6.3。
取证日期 2026-10-31。

---

## 1. 版本与规模核对（先跑这 6 条命令）

| 结论             | 核对命令                                                                                               | 期望值  |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| 平台版本         | `node -p "require('./package.json').version"`                                                          | `0.7.8` |
| SDK 版本         | `node -p "require('./packages/plugin-sdk/package.json').version"`                                      | `3.7.5` |
| test-kit 版本    | `node -p "require('./packages/plugin-test-kit/package.json').version"`                                 | `3.3.3` |
| 槽位总数         | `node -p "JSON.parse(require('fs').readFileSync('docs/agent/contracts/slots.json')).total"`            | `120`   |
| 禁写表总数       | `node -p "JSON.parse(require('fs').readFileSync('docs/agent/contracts/forbidden-tables.json')).total"` | `40`    |
| SDK 可解析 Token | `node -p "JSON.parse(require('fs').readFileSync('docs/agent/contracts/tokens.json')).total"`           | `31`    |

源码侧独立验证（不依赖契约文件，防止契约漂移）：

```bash
grep -c "capabilityRequired:" packages/core/plugin-host/context-builder.ts   # 命令闸门条目基数
grep -c "^\s*'" packages/core/plugin-host/sql-guard.ts                       # 禁写表数量（区间 L13-54）
```

---

## 1.5 平台层坐标（非插件部分）

规模与入口：

| 结论               | 坐标                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| 进程入口（751 行） | `server.ts`（中间件 L211-423、路由注册 L430-537、错误兜底 L608）                                      |
| 内核单例（749 行） | `packages/core/kernel/index.ts → commandBus.setInterceptor（L303）`、`bootstrapSystemPlugins（L435）` |
| 测评注册表注册点   | `packages/core/kernel/index.ts` L300（`IAssessmentGraderRegistryToken`）                              |
| 前端装配           | `src/App.tsx`（全 157 行）、`src/components/AppShell.tsx`（全 35 行）                                 |

请求链路：

| 结论            | 坐标                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 中间件顺序      | `server.ts` L211（helmet）→ L287（写限流）→ L300（大 body）→ L303（2MB parser）→ L307（csrf）→ L308（observability）→ L396（cors）→ L423（强改密） |
| 命令 HTTP 入口  | `server/routes/os.ts` L112-132（10s 超时赛跑）                                                                                                     |
| 命令清单查询    | `server/routes/os.ts` L134（`getAllActions`）                                                                                                      |
| 统一错误出口    | `server/utils/error-handler.ts → sendSafeError（L27）`；4xx 透传 code（L74-79）、5xx 替换文案（L66）                                               |
| 数据范围枚举    | `server/security/route-scope.ts → DataScope（L31）`                                                                                                |
| 路由 scope 审计 | 同文件 `collectAuthRoutes` / `auditRouteScopes`                                                                                                    |

实时：

| 结论                        | 坐标                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 五类房间                    | `server/presence.ts`：`classRoom`（L56）、`PRESENCE_STAFF_ROOM`（L66）、`WHITEBOARD_BROADCAST_ROOM`（L76）、`userRoom`（L85）+ 课节 id 字面量 |
| 事件→socket 路由表（19 条） | `server/event-routing.ts → SOCKET_ROUTES（L263）`                                                                                             |
| `_meta` 附加                | 同文件 `buildMeta（L523）`                                                                                                                    |
| 只改布局不重绘的元素类型    | 同文件 `LAYOUT_ONLY_ELEMENT_TYPES（L157）`                                                                                                    |
| 课堂动态流                  | `server.ts` L459-461（`attachClassroomFeedService`）                                                                                          |

数据：

| 结论              | 坐标                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| 写连接单例 / 读池 | `packages/core/db/index.ts`：`db`（L394）、`readPool`（L491）、`queryRead`（L504） |
| 迁移执行 / 校验和 | `packages/core/db/migrator.ts`：`runMigrations`（L116）、`simpleChecksum`（L93）   |
| 保留策略默认值    | `packages/core/db/retention-policy.ts → DEFAULT_RETENTION_DAYS`（L22）             |
| 表前缀规则        | `packages/core/plugin-host/plugin-tables.ts → pluginTablePrefix（L11）`            |
| 备份              | `packages/core/db/backup-manager.ts`（`validateBackup` L80、`listBackups` L136）   |

AI / 测评：

| 结论               | 坐标                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| AI Agent HTTP      | `server/routes/os.ts` L270 / L278（`aiLimiter`）/ L390 / L412                              |
| 7 个 AI 能力模块   | `packages/core/ai-capability/capabilities/`（7 个文件）                                    |
| Provider 网关      | `packages/core/ai/provider/provider-gateway.ts`                                            |
| 题型注册表         | `packages/core/assessment/registry-service.ts` + `question-types/registry.ts`              |
| 成绩写入（含历史） | `packages/core/db/assignment-grade-writer.ts`                                              |
| 活动注册表         | `packages/activity-ecosystem/`，Token 名 `@openlearn/activity-ecosystem:IActivityRegistry` |

安全与可观测：

| 结论           | 坐标                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 探针与指标     | `server/routes/health.ts`：`/health`（L142）、`/health/ready`（L148）、`/metrics`（L169，`METRICS_TOKEN` 或管理员）                      |
| 限流器         | `server/security/rate-limit.ts`；挂载点 `server.ts` L287-293（`writeLimiter` / `viewStateLimiter`）、`os.ts` L278（`aiLimiter`）         |
| 插件 REST 网关 | `server/routes/plugin-api-gateway.ts`（`MAX_PAYLOAD_BYTES` L58、SSE 并发、超时 L560）；挂载 `plugins.ts` L21                             |
| 可观测模块     | `packages/core/observability/`（10 文件，见 [../subsystems/observability-and-security.md](../subsystems/observability-and-security.md)） |

命令总量（精确统计口径）：

```bash
# 排除 unregisterHandler 与 processManager.registerHandler
grep -oE '(^|[^a-zA-Z])commandBus\.registerHandler\(' -r packages/plugins server/routes | wc -l
grep -c 'actionRegistry\.register(' packages/plugins/*.ts server/routes/*.ts
```

已核对结果：`packages/plugins` 78 命令 / 78 描述符（1:1）；`server/routes/classroom.ts` 5/5；
`server/routes/resources.ts` 4/**4**（U-11 已补齐，见 [unresolved-questions.md](unresolved-questions.md)）。
唯一 commandType 去重后全平台 **84 / 84**，复核命令：`node scripts/plugin-command-audit.mjs`。

---

## 2. 内核与生命周期

| 结论                             | 坐标                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `PluginContext` 定义（字段全集） | `packages/core/plugin-host/types.ts → PluginContext（L227）`                                |
| 7 态枚举                         | `packages/core/plugin-host/types.ts → enum PluginState（L54）`                              |
| 激活超时 5000ms                  | `packages/core/plugin-host/base.ts → ACTIVATION_TIMEOUT_MS（L124）`                         |
| 停用超时 5000ms                  | `packages/core/plugin-host/base.ts → DEACTIVATION_TIMEOUT_MS（L126）`                       |
| 激活超时实际触发点               | `packages/core/plugin-host/lifecycle.ts`（L467-468，抛 `EsmLoadTimeoutError`）              |
| 停用超时实际触发点               | `packages/core/plugin-host/lifecycle.ts`（L755-756，抛 `PluginDeactivateTimeoutError`）     |
| 热重载停用超时                   | `packages/core/plugin-host/reload.ts`（L445-446）                                           |
| 状态机迁移与非法迁移拦截         | `packages/core/plugin-host/lifecycle.ts` + `errors.ts → IllegalStateTransitionError（L87）` |
| 插件实例基类                     | `packages/core/plugin-host/base.ts → PluginInstance`                                        |

## 3. 命令派发与 default-deny

| 结论                                        | 坐标                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **default-deny 唯一实现点**                 | `packages/core/kernel/index.ts → commandBus.setInterceptor（L303-401）`                            |
| 无描述符 → 403 `COMMAND_NOT_REGISTERED`     | `packages/core/kernel/index.ts`（L372-400，`err.status = 403` / `err.code`）                       |
| 能力不符 → 403 `COMMAND_CAPABILITY_DENIED`  | `packages/core/kernel/index.ts`（L330-342）                                                        |
| 管理员判定（`user:<id>:<role>` 形态才认）   | `packages/core/kernel/index.ts`（L315-328）                                                        |
| 高危命令 → 入 `pending_commands` 等人工审批 | `packages/core/kernel/index.ts`（L344-371）                                                        |
| **`inputSchema` 运行期校验**                | `packages/core/kernel/index.ts`（L306-314，调 `validateJsonSchema`）                               |
| `validateJsonSchema` 只认大写类型名         | `packages/core/kernel/index.ts → validateJsonSchema（L689-749）`                                   |
| 工具定义原样透传 `inputSchema`              | `packages/core/registry/index.ts`（L54，`parameters: action.inputSchema`）                         |
| 命令命名空间解析                            | `packages/core/plugin-host/plugin-namespace.ts → resolvePluginCommandType（L62）`                  |
| 缺描述符的引导错误文案（worker 侧）         | `packages/core/plugin-host/context-builder.ts`（L189）与 `worker-runtime/service-host.ts`（L1178） |
| 全仓「有 handler 无描述符」审计脚本         | `scripts/plugin-command-audit.mjs`                                                                 |

## 4. 执行模式与隔离

| 结论                       | 坐标                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| 三档模式求值函数           | `packages/core/plugin-host/execution-policy.ts → resolvePluginExecutionMode（L116）`      |
| 未受信插件被强制 `process` | 同上（返回值带 `coerced` 标记）                                                           |
| 运行时适配层               | `packages/core/plugin-host/plugin-runtime-adapter.ts`、`plugin-runtime-composition.ts`    |
| 子进程隔离                 | `packages/core/worker-runtime/child-isolate.ts`、`child-spawn.ts`、`child-transport.ts`   |
| worker_threads 隔离        | `packages/core/worker-runtime/worker-isolate.ts`、`worker-manager.ts`                     |
| 子进程服务宿主（RPC 落地） | `packages/core/worker-runtime/service-host.ts`                                            |
| 服务代理（插件侧 stub）    | `packages/core/worker-runtime/service-proxy.ts`                                           |
| 出站网络代理               | `packages/core/worker-runtime/plugin-net-proxy.ts`、`plugin-net-preload.cjs`              |
| 活体检测 / 配额 / 限额     | `packages/core/worker-runtime/liveness-monitor.ts`、`plugin-quota.ts`、`plugin-limits.ts` |

## 5. 表归属与 SQL 守卫

| 结论                                          | 坐标                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 禁写表 40 张                                  | `packages/core/plugin-host/sql-guard.ts → FORBIDDEN_CORE_TABLES（L13-54）`                                             |
| 禁写语句（ATTACH/PRAGMA/VACUUM/TRIGGER/VIEW） | `packages/core/plugin-host/sql-guard.ts → FORBIDDEN_OPERATIONS（L58-66）`                                              |
| 表名前缀归属校验                              | `packages/core/plugin-host/sql-guard.ts`（L276-290，ownPrefix / `plugin_migrations` / `plugin_research_*`）            |
| **守卫只作用于 process/worker**               | `packages/core/worker-runtime/service-host.ts`（L81 导入、L1216 调用 —— 全仓唯一调用方）                               |
| 表前缀生成                                    | `packages/core/plugin-host/plugin-tables.ts → pluginTablePrefix（L11）`                                                |
| `ctx.db.table()` 标识符白名单                 | `packages/core/plugin-host/context-builder.ts`（L984 `ensureTable`、L990 `table`，均过 `assertSafeSqlIdentifier` L76） |
| 孤儿数据回收                                  | `packages/core/plugin-host/orphan-data.ts`                                                                             |
| 声明式迁移                                    | `packages/core/plugin-host/declarative-migrator.ts`                                                                    |

## 6. 能力与权限

| 结论                                        | 坐标                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 命令闸门 19 条                              | `docs/agent/contracts/capabilities.json → command_required`                                                                                      |
| 方法级策略 8 条 `CAP_*`                     | 同上 → `method_policy`                                                                                                                           |
| 运行时权限 7 条                             | 同上 → `runtime_permission`                                                                                                                      |
| **不存在全局通配白名单**                    | 同上 → `_no_global_whitelist`                                                                                                                    |
| 方法/路径门禁实现                           | `packages/core/plugin-host/method-policy.ts`（服务端）与 `src/plugin-host/method-policy.ts`（前端，**两处签名不同**）                            |
| 能力网关                                    | `packages/core/plugin-host/plugin-capability-gateway.ts`                                                                                         |
| 授权/授予                                   | `packages/core/plugin-host/plugin-grants.ts`                                                                                                     |
| 平台 API 网关（1MB / 120rpm / SSE 5 / 504） | `server/routes/plugin-api-gateway.ts`（`MAX_PAYLOAD_BYTES` L58、鉴权 L350、限流 L371、超时 L560），挂载点 `server/routes/plugins.ts`（L21 导入） |
| 学生数据导出/删除钩子                       | `packages/core/plugin-host/student-data-privacy.ts`                                                                                              |
| 签名与完整性                                | `packages/core/plugin-host/errors.ts`（L190-241：`PluginSignatureError` 家族）                                                                   |

## 7. 注册、装载、贡献

| 结论                     | 坐标                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 安装期校验链             | `packages/core/plugin-host/install.ts`                                                                                                     |
| manifest zod schema      | `packages/core/esm-loader/manifest-schema.ts → manifestSchema（L787）`；`id` 不含 `:` 的 refine（L795）、`main: z.string().min(1)`（L798） |
| 依赖解析 / 自动安装      | `packages/core/plugin-host/dependency-resolver.ts`、`dependency-install.ts`                                                                |
| 贡献注册表               | `packages/core/plugin-host/contribution-registry.ts`                                                                                       |
| 统一扩展注册表           | `packages/core/plugin-host/unified-extension-registry.ts`                                                                                  |
| 贡献键 A 组 71 / B 组 38 | `docs/agent/contracts/contributes-groups.json`                                                                                             |
| 插件分发 / 更新          | `packages/core/plugin-host/plugin-distribution-manager.ts`                                                                                 |
| 卸载                     | `packages/core/plugin-host/uninstall.ts`                                                                                                   |
| 热重载                   | `packages/core/plugin-host/reload.ts`、`hot-reload.ts`                                                                                     |

## 8. 前端宿主

| 结论                                                              | 坐标                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 槽位 120 + anchor 8                                               | `docs/agent/contracts/slots.json`（`total` / `extension_slots` / `anchor_slots`）                       |
| 槽位渲染器                                                        | `src/plugin-host/extension-point-renderer.tsx`                                                          |
| 槽位 props 读取（`dispatcher` / `context.get()` / `i18n` 注入点） | `src/plugin-host/read-slot-props.ts`                                                                    |
| **熔断：3 次 / 5 分钟**                                           | `src/plugin-host/extension-breaker.ts → CRASH_BREAKER_THRESHOLD（L14）、CRASH_BREAKER_WINDOW_MS（L15）` |
| 熔断判定                                                          | 同上（L30 窗口重置、L36 触发）                                                                          |
| 熔断消费                                                          | `src/plugin-host/extension-point-renderer.tsx`（L31 导入）                                              |
| `origin: 'manifest' \| 'runtime'` 语义                            | `src/plugin-host/extension-breaker.ts` + `extension-point-renderer.tsx`                                 |
| frame 沙箱                                                        | `src/plugin-host/sandbox-frame.ts`                                                                      |
| host action 派发（6 种）                                          | `src/plugin-host/host-action-dispatcher.ts`                                                             |
| 前端服务注册表                                                    | `src/plugin-host/service-registry.ts`                                                                   |
| 浏览器 worker                                                     | `src/plugin-host/browser-worker-manager.ts`、`browser-worker-transport.ts`                              |
| 前端可解析 Token 白名单                                           | `src/plugin-host/allowed-tokens.ts`                                                                     |
| 前端 ctx Provider / store                                         | `src/plugin-host/plugin-host-context.tsx`、`plugin-host-store.ts`                                       |
| 前端方法门禁                                                      | `src/plugin-host/method-policy.ts`                                                                      |
| bridge op：frame 10 / view 8                                      | `docs/agent/contracts/bridge-ops.json`（`frame_total` / `view_total`）                                  |
| bridge SDK 源                                                     | `packages/bridge-sdk/src/bridge.js`（构建产物 `server/utils/bridge-sdk.ts`，**勿直接改**）              |

## 9. Plugin SDK 与 test-kit

| 结论                                                          | 坐标                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 自包含 `.d.ts`（不 re-export monorepo 内部）                  | `packages/plugin-sdk/openlearn.d.ts`（头注释 L1-8）                                     |
| `ActionDescriptor`                                            | `packages/plugin-sdk/openlearn.d.ts → interface ActionDescriptor`                       |
| `PlatformEvent`（6 字段）                                     | 同上 → `interface PlatformEvent`                                                        |
| `IEventBusService`（`publish` / `subscribe` / `unsubscribe`） | 同上 → `interface IEventBusService`                                                     |
| `IActionRegistryService`（6 方法）                            | 同上 → `interface IActionRegistryService`                                               |
| Token 三口径（32 导出 / 30 值 / 31 名）                       | `docs/agent/contracts/tokens.json`（含 `_count_trap` 说明）                             |
| 主进程可解析 Token 清单                                       | `packages/core/di/interfaces.ts → PLUGIN_RESOLVABLE_TOKENS（L946）`                     |
| 沙箱可解析 Token 清单（9 个）                                 | `packages/core/worker-runtime/worker-manager.ts → BASE_WORKER_SERVICE_TOKENS`（L77-87） |
| `INetworkProxyService` 只在沙箱可用                           | `packages/core/worker-runtime/service-host.ts`（L769-770，按字符串拦截 RPC）            |
| `createMockContext`                                           | `packages/plugin-test-kit/src/` → `createMockContext`（默认 `pluginId: 'ext-test'`）    |
| `MockCommandBus` / `MockEventBus` / `MockActionRegistry`      | 同上                                                                                    |
| `runTestPluginMigrations`                                     | 同上                                                                                    |

## 10. 示例插件 `lab-seat`

| 结论                      | 坐标                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27 个 `registerHandler`   | `[P] src/index.ts` L415, 443, 454, 467, 495, 660, 681, 690, 700, 711, 721, 740, 762, 792, 841, 854, 887, 914, 973, 998, 1064, 1129, 1167, 1225, 1238, 1247, 1397 |
| 8 条具名 ActionDescriptor | `[P] src/index.ts` L397, 476, 778, 873, 960, 983, 1115, 1149                                                                                                     |
| 19 条批量补齐             | `[P] src/index.ts → MISSING_ACTIONS（L1419）+ for 循环（L1440-1448）`                                                                                            |
| default-deny 事故复盘注释 | `[P] src/index.ts`（L1412-1418）                                                                                                                                 |
| 错误类型与 11 个 code     | `[P] src/index.ts → LabSeatErrorCode（L62）、LabSeatError（L75）、labError（L84）`                                                                               |
| `ctx.config` 缺失回落     | `[P] src/index.ts → getConfigValue（L281）`                                                                                                                      |
| `provide` 存在性守卫      | `[P] src/index.ts`（L1293-1337）                                                                                                                                 |
| 跨插件服务 Token          | `[P] src/index.ts → ILabSeatServiceToken（L49）`                                                                                                                 |
| 缓存 timer 与清理         | `[P] src/index.ts`（L92 声明、L1406 设置、L1455-1457 清理）                                                                                                      |
| 事件发布（5 类）          | `[P] src/index.ts`（L435, 523, 599, 652, 753, 770, 832）                                                                                                         |
| 事件订阅（积分）          | `[P] src/index.ts`（L1272-1289）                                                                                                                                 |
| React 运行期注入          | `[P] src/frontend.tsx → resolveReact（L21）+ Proxy（L32）+ hooks 转发（L43-45）`                                                                                 |
| 事件订阅退避轮询          | `[P] src/frontend.tsx → subscribeToEvents（L66）`                                                                                                                |
| 4 槽位注册                | `[P] src/frontend.tsx → activate（L1512）`，注册体 L1518-1552                                                                                                    |
| 交付契约                  | `[P] plugin.contract.json`（`executionMode` / `uiChannel` / `slots` / `trustedInlineAllowlistEntry`）                                                            |

---

## 11. 机器可读契约（7 个，**平台自带，优先级高于本目录**）

位置：`docs/agent/contracts/`

| 文件                      | 顶层键                                                                                                    | 已核对的计数          |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| `versions.json`           | `platform` / `plugin_sdk` / `plugin_test_kit`                                                             | 0.7.8 / 3.7.5 / 3.3.3 |
| `slots.json`              | `extension_slots` / `anchor_slots` / `total`                                                              | 120 / 8 / 120         |
| `capabilities.json`       | `command_required` / `method_policy` / `runtime_permission` / `blocked_wildcard` / `_no_global_whitelist` | 19 / 8 / 7            |
| `tokens.json`             | `tokens` / `extra_names` / `total` / `_count_trap`                                                        | 30 / 1 / 31           |
| `forbidden-tables.json`   | `tables` / `total`                                                                                        | 40 / 40               |
| `contributes-groups.json` | `a_strict_keys` / `b_loose_keys` / `a_total` / `b_total`                                                  | 71 / 38               |
| `bridge-ops.json`         | `frame_ops` / `view_wire_ops` / `frame_total` / `view_total`                                              | 10 / 8                |

**冲突裁决顺序**：

```text
源码 > docs/agent/contracts/*.json + docs/agent/facts-ledger.md > 平台 docs/reference/*.md > 本目录
```

---

## 12. repomix 索引产物

| 产物                                   | 规模                     | 配置                                            |
| -------------------------------------- | ------------------------ | ----------------------------------------------- |
| `.repomix/openlearn-next.repo.pack.md` | 1687 文件 / 4.46M tokens | `.repomix/repomix.host.config.json`             |
| `.repomix/plugin-subsystem.pack.md`    | 193 文件 / 628k tokens   | `.repomix/repomix.plugin-subsystem.config.json` |

重新生成（在仓库根执行）：

```bash
repomix --config .repomix/repomix.host.config.json
repomix --config .repomix/repomix.plugin-subsystem.config.json
```

**为什么优先级是「源码 > 契约 > 索引」**：repomix 产物是**某一时刻的快照**，改代码不会自动更新；
契约文件由 CI 或人工在发布时同步；源码是唯一实时真相。索引的用途是**建立全局心智与做首轮定位**，
不是引用源。

---

## 13. 一条结论的完整取证示例

以「`view` 路径必须以 `storage/` 开头」为例：

```text
① 正文结论      → plugin-system/registration-and-loading.md §5
② 反查本文       → 未列 → 补入下表
③ grep 源码      → grep -rn "storage/" packages/core/plugin-host/install.ts
④ 命中符号       → packages/core/plugin-host/install.ts → 视图路径校验（zod refine）
⑤ 判定           → 有实现、有报错路径 ⇒ 标 `已验证`
                  只有类型无实现 ⇒ 标 `推断`
                  找不到       ⇒ 标 `待确认` 并登记 unresolved-questions.md
```

---

## 14. 已知坐标漂移风险（改代码后必须复查）

| 风险点                        | 说明                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 行号整体平移                  | 任何文件顶部增删注释都会让本文所有 L 号失效 —— **按符号名 grep，不按行号跳转**                                                   |
| 两个 `method-policy.ts`       | 服务端 `packages/core/plugin-host/method-policy.ts` 与前端 `src/plugin-host/method-policy.ts` **签名不同**，改一处必须同步另一处 |
| `bridge-sdk.ts` 是产物        | `server/utils/bridge-sdk.ts` 由 `scripts/build-bridge-sdk.mjs` 从 `packages/bridge-sdk/src/bridge.js` 生成，**改错文件会被覆盖** |
| `lab-seat` 的 19 条批量描述符 | 若上游把它拆成具名注册，L1419 这个符号会消失；届时以「`commandType` 去重集合是否等于 handler 集合」为准                          |
