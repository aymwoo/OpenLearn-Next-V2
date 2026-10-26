# docs/ 与代码一致性审计报告（2026-10-26）

> 审计对象：`docs/` 全部 150 篇 Markdown
> 对照真源：仓库代码（`server.ts`、`server/`、`packages/core/`、`packages/plugins/`、`src/`、`migrations/schema-golden.json`、`package.json`）
> 平台版本：`openlearn-next@0.7.4`（HEAD `a17b840`）｜ SDK：`@openlearn/plugin-sdk@3.7.0`
> 结论：**机器门禁全绿，但语义层存在 13 类实质偏差，已修复 12 篇文档。**

---

## 1. 结论先行

仓库自带的 `audit-tools/`（路径存在性 / 文档内链 / 子系统命名）**全部为 0 drift**，这说明文档的「骨架」是健康的：没有断链、没有引用不存在的文件路径、没有多余的子系统页面。

但这套门禁**不检查内容语义**。本次逐条比对代码后，发现的问题集中在四类：

| 类型                    | 数量 | 危害                                                |
| ----------------------- | ---- | --------------------------------------------------- |
| 会产出错误代码的契约    | 3 类 | 插件作者按文档写会直接踩守卫报错，或误判安全边界    |
| 整篇结构性漂移          | 1 篇 | `classroom-runtime.md` 描述的实现**在代码中不存在** |
| 文档内部/文档间自相矛盾 | 4 处 | 读者无法判断哪个是对的                              |
| 时效标记与统计数字滞后  | 5 处 | 版本戳、Token 数、槽位数、环境变量清单              |

---

## 2. 机器可检部分（审计前后对比）

```bash
bash audit-tools/run.sh
```

| 指标                   | 审计前 | 审计后 | 说明                                   |
| ---------------------- | ------ | ------ | -------------------------------------- |
| canonical drift        | 0      | 0      | 文档子系统 ↔ 代码目录                  |
| ref drift（路径/内链） | 0      | 0      | 1212 条路径引用、178 条内链，0 失效    |
| 重复文档分组           | 0      | 0      | —                                      |
| **symbol hints**       | **61** | **42** | 文档提到但代码中搜不到的符号，非门禁项 |

symbol hints 从 61 降到 42，是因为重写 `classroom-runtime.md` 消掉了 19 个幽灵符号。剩余 42 条经逐条核对**绝大多数是假阳性**：`Host` / `Origin` / `Bearer` / `Integrity` / `Secure` 是英文散文词，`Atomics` / `EvalError` / `ReferenceError` / `DataCloneError` 是 JS 全局，`ContextBuilder` / `PluginApiGateway` / `HostSharedDeps` / `ExtensionPointRegistry` 实际存在于 `packages/core/plugin-host/`（符号索引漏检）。

---

## 3. 已修复清单（12 篇）

### P0 — 会产出错误代码 / 错误配置

#### 3.1 插件私有表前缀：「两种模式相反」是错的（5 篇 / 7 处）

**文档原说法**：inline 用 DB UUID 前缀，worker 用 manifestId 前缀，两者「语义相反」，切换执行模式会「找不到表」。

**代码事实**（`packages/core/plugin-host/plugin-tables.ts`）：

```ts
export function pluginTablePrefix(scopeId: string, _manifestId?: string): string {
  return `plugin_${scopeId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;
}
```

`manifestId` 参数**被忽略**（下划线前缀），前缀只取决于 `scopeId`。两个调用点（`worker-manager.ts:785`、`context-builder.ts:855`）传的第一个实参都是 `pluginId`。所以**inline / worker / process 三档前缀完全一致**，切换模式不会改表名。

这条错误的实际危害：插件作者按文档用 `plugin_{manifestId}_` 建表，会被 `assertDatabaseAccessAllowed` 的 DDL 命名空间守卫拒绝（守卫只放行 `plugin_{scopeId}_`）。

已修正：

| 文件                                       | 处数 | 修正                                         |
| ------------------------------------------ | ---- | -------------------------------------------- |
| `tutorials/plugin-development-tutorial.md` | 1    | 对照表 `ctx.db.table()` 行改为「两模式一致」 |
| `reference/plugin-database-api.md`         | 2    | 表名前缀行 + DDL 守卫说明                    |
| `architecture/security-permissions.md`     | 1    | `ctx.db` 条目                                |
| `migration/version-migration.md`           | 2    | §3.2 与另一处提示框                          |
| `reference/platform-data-tables.md`        | 1    | 私有表判据                                   |

> 注意 `plugin-database-api.md` 原本**自相矛盾**：第 22 行说「两种模式均保持一致」，第 54 行又说「Worker 模式下为 manifestId」。教程也是表格说「不同」、紧接的正文说「已统一收敛」。

#### 3.2 `OPENLEARN_PLUGIN_PERMISSION`「暂无法约束网络」——已失效

`docs/configuration/system-configuration.md` 原文把该变量的说明写成「仅子进程生效；**暂无法约束网络**」。

代码事实：出网在两种隔离原语下都已收紧（Issue #237）——`process` 模式由 `plugin-net-preload.cjs`、`thread` 模式由 bootstrap 的 net-guard section 拦截原始 socket / DNS，`fetch` 只放行 `plugin_network_grants` 里管理员批准的域名。`.env.example` 与 `packages/core/worker-runtime/plugin-permission.ts` 的注释都写明了这一点。

这条错误的危害：运维会误以为插件可自由出网，从而跳过出站授权配置。

#### 3.3 「没有 CPU / 内存采样」——采样早已落地

`docs/architecture/security-permissions.md` §2.1a 原文断言「代码中**不存在**监控 CPU 与内存占用、超限处理的实现」。

代码事实：`packages/core/worker-runtime/plugin-quota.ts` 的 `startProcessQuota()` 在 `worker-manager.ts:830` 被调用，按 `OPENLEARN_PLUGIN_MAX_RSS_MB`（默认 512）/ `CPU_QUOTA_MS`（8000）/ `CPU_WINDOW_MS`（10000）采样，超限 `SIGKILL` 后交给崩溃看门狗。

已改写为准确表述：**采样 + 硬终止 + 看门狗**，但**确实没有**「置为 `PAUSED` 的主动挂起」——`PluginState` 仍是 7 个值，无 `PAUSED`。原文正确的部分保留，错误的部分纠正。

#### 3.4 隔离模型：文档说两档 / 默认 Worker，实际三档 / 默认 process

- `security-permissions.md` §2 开头：「插件有**两条**执行路径：Inline 与 Worker」
- `governance/architecture-governance.md` §2.4：「**默认 Worker Thread 模式运行**，inline 为受控例外」

代码事实（`packages/core/plugin-host/execution-policy.ts`）：三档 `inline` / `worker` / `process`，且**非受信插件默认被强制改写为 `process`**——只有 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 白名单内的 id 或位于 `packages/plugins` 的插件才允许进程内执行。manifest id 以 `@openlearn/` 开头**不构成信任依据**。

这两处会直接误导安全评审：按原文，读者会认为第三方插件默认跑在同进程的 Worker 线程里，而实际是独立子进程 + 最小环境变量。

### P1 — 结构性漂移与自相矛盾

#### 3.5 `classroom-runtime.md`：整篇描述的实现不存在（重写）

原文声称：

- 前端 `src/features/classroom-runtime/`（343 行 / 7 文件）—— **该目录不存在**
- 「9 阶段生命周期状态机 + 6 个底层 runtime 协调器」
- 19 个符号：`ClassroomSession`、`ClassroomService`、`ClassroomRegistry`、`ClassroomContextFacade`、`ClassroomEventBus`、`IClassroomContext`、`ClassroomEvent`、`ClassroomCreated/Prepared/Ready/Teaching/Paused/Resumed/Finished/Archived/Disposed` 等 —— 全仓**零命中**
- 事件必须是 `classroom.<stage>` 命名空间 —— 实际是 PascalCase 的 12 个通道

代码事实是**同一名词指代两套系统**：

|        | 内核版 `packages/core/classroom-runtime/` | 服务版 `server/services/classroom-runtime-service.ts`                         |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------- |
| 主类   | `ClassroomRuntimeKernel`                  | `ClassroomRuntimeService`                                                     |
| 状态   | `RuntimeLifecycleState` **8 态**          | `ClassroomLifecycleStage` **4 阶段**                                          |
| 四阶段 | —                                         | `PRE_CLASS_READY → IN_CLASS_TEACHING → WRAP_UP_EXIT_TICKET → ARCHIVED_REPORT` |
| 持久化 | 无                                        | 落库                                                                          |
| 接线   | 已实例化、注册 Token，**全仓零 resolve**  | 路由层直接使用                                                                |

整篇已按代码重写：新增「先分清两个同名系统」对照表、8 态生命周期图、11 个协作者清单、状态树分区、12 个事件通道、8 个钩子、6 角色 / 7 权限，以及服务版的 4 阶段与门禁策略（1500ms fail-close）。原文后半段「教学全生命周期四阶段 + 生态（Edge LAN Mesh / Hardware Bridge / Macro Engine）」经核对引用的组件真实存在，予以保留，仅修正了 `FairPickerEngine.ts` 的错误路径（实为 `src/features/whiteboard/services/fair-picker-engine.ts`）。

> **顺带发现一个代码层问题**（已在文档中如实记录，未改代码）：`ClassroomRuntimeKernel` 被 `packages/core/kernel/index.ts` 实例化并注册 `IClassroomRuntimeServiceToken`，但全仓没有任何 `resolve`；唯一构造它的是 `src/features/student-workspace/student-workspace-context.ts`，且是**另起的独立实例**。这与 `audit-2026-10-15.md` 的记录一致。建议单独排期决定「明确边界 / 重命名 / 下线内核版」。

#### 3.6 `security-permissions.md` 内部自相矛盾：8 个还是 9 个 Token

- §2.3：基础集合「9 个」，成员含 `IPluginHost`
- §2.5：「收敛为 **8 个** Token … `IPluginHost` 已移出」

代码事实（`worker-manager.ts:76-86`）：`BASE_WORKER_SERVICE_TOKENS` 共 **9 个**，成员是 `ICommandBusService` / `IEventBusService` / `IActionRegistryService` / `ICapabilityService` / `IProcessService` / `IStorageService` / `IAIService` / `IDatabase` / **`INetworkProxyService`**。

即：§2.3 数量对、成员错（写成了 `IPluginHost`）；§2.5 结论对（`IPluginHost` 确实已移除）、数量错。两处已统一为 9 个且成员正确，并说明空出的位置由出网代理 `INetworkProxyService` 占位。

#### 3.7 `platform-data-tables.md` 的过期告警框

原文警告「`security-permissions.md` §1 把 Plugin 访问 SQLite 标为 ❌，与本页冲突」。实际上 `security-permissions.md` 该行早已改为「见下方『插件与数据库的权限边界』」，并在 §2.5 完整解释了边界。告警框已改为「已澄清」，并补上真实边界（40 张核心表黑名单 + `plugin_*` 命名空间隔离）。

#### 3.8 `system-configuration.md`：环境变量清单缺 14 项

原文自称「服务端实际读取的全部变量」，实际缺：`OPENLEARN_PLUGIN_MAX_RSS_MB`、`OPENLEARN_PLUGIN_CPU_QUOTA_MS`、`OPENLEARN_PLUGIN_CPU_WINDOW_MS`、`OPENLEARN_PLUGIN_QUOTA`、`OPENLEARN_WORKER_LIVENESS_INTERVAL_MS`、`OPENLEARN_WORKER_LIVENESS_GRACE_MS`、`OPENLEARN_WORKER_TERM_GRACE_MS`、`OPENLEARN_COMMUNITY_INSTALL`、`OPENLEARN_COMMUNITY_PUBKEY`、`OPENLEARN_TRUSTED_PUBKEYS`、`OPENLEARN_RESEARCH_SQL_PLUGINS`、`OPENLEARN_ENFORCE_PLUGIN_ISOLATION`、`OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS` 及四个保留天数变量、`ROUTE_SCOPE_ENFORCE`、`OPENLEARN_SKIP_PASSWORD_CHANGE_GATE`、`OPENLEARN_CLASSROOM_GUARD_TIMEOUT_MS`、`OPENLEARN_MAX_ZIP_SIZE`、`OPENLEARN_WATCHDOG_BASE_DELAY`、`OPENLEARN_MIGRATIONS_DIR`、`OPENLEARN_PLUGINS_DIR`、`OPENLEARN_PLUGINS_NPM_REGISTRY`、`OPENLEARN_UPGRADE_TARGET_VERSION`。

全部已按代码默认值补入表格，并同步更新 §5「启动期强校验」的 error 级键清单（原来只写了 `OPENLEARN_PLUGIN_MAX_HEAP_MB`，实际校验的是 RSS / CPU / 探活三组键）。

#### 3.9 统计数字滞后

| 文件                                     | 原值                   | 实测                  | 依据                                                            |
| ---------------------------------------- | ---------------------- | --------------------- | --------------------------------------------------------------- |
| `reference/plugin-ui-extension-slots.md` | 119 个槽位             | **120**               | `ExtensionSlot` 联合类型；v0.7.4 新增 `assignment.file.preview` |
| `api/api-coverage-report.md`             | 「19 个公共 DI Token」 | 核心 35 / SDK 导出 33 | 按 `export const *Token` 统计                                   |

`api-coverage-report.md` 原本只有 6 行且声称「100% Verified」却无任何清单与依据，已重写为可复算的数字表 + 指向 `di-tokens.md` 作为唯一权威字典。

### P2 — 时效标记与导航

| 文件                                    | 修改                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `index.md`                              | 「最后更新 v0.7.2」→ v0.7.4                                                  |
| `governance/architecture-governance.md` | 「同步于 v0.3.22」→ v0.7.4                                                   |
| `configuration/system-configuration.md` | 「同步于 v0.5.0」→ v0.7.4                                                    |
| `deployment/production-guide.md`        | Node 要求「≥ 20.0.0」→ `20.x/22.x/24.x` + 硬闸说明                           |
| `index.md`                              | 补入 `architecture/assignment` 与 `architecture/assessment-model` 到 toctree |

最后一条说明：`assignment.md` 与 `assessment-model.md` 是内容现行的架构文档（引用的 `server/services/assignment-service.ts`、`packages/core/assessment/settings.ts` 均存在），但此前**不在任何 toctree 中**，侧栏无法导航到——`assessment-model` 仅靠 `assignment.md` 的正文链接可达。

---

## 4. 未修复项与理由

| 项                                                                                                                                                         | 判断                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 6 篇游离文档（`AUDIT_REPORT`、`PLUGIN_AUDIT_REPORT`、`audit/course-import-audit`、`experimental-modules`、`feature-sweep`、`student-workspace-migration`） | 均为**带日期的审计快照或一次性报告**，是否进侧栏属信息架构决策，未擅自收录。建议统一移入 `docs/audit/` 或加 `orphan` 标注 |
| 多篇文档的「最后更新」日期偏旧（如 `installation-guide` 2026-07-15、`plugin-ui-extension-slots` 2026-07-26、`typescript-interfaces` 2026-09-18）           | 日期本身不是错误证据。已抽检内容，未发现实质偏差，故不改日期（改日期会谎报复核）                                          |
| 剩余 42 条 symbol hints                                                                                                                                    | 逐条核对后为假阳性（英文散文词 / JS 全局 / 符号索引漏检），不改                                                           |
| `ClassroomRuntimeKernel` 零 resolve 且存在双实例                                                                                                           | **代码问题**，非文档问题。已在文档中如实披露，建议单独开 issue 决定去留                                                   |
| `v2_plugins/*` 在 `architecture-governance.md` 中被提及                                                                                                    | 该目录实际存在（gitignore 的外部插件集合），描述与 `AGENTS.md` 的口径差异属仓库策略问题，未改                             |

---

## 5. 复查方式

```bash
# 1. 机器门禁（应输出 drift_count=0）
bash audit-tools/run.sh

# 2. 格式门禁
npx prettier --check docs/

# 3. 本报告引用的关键事实，可逐条复核
grep -n "pluginTablePrefix" packages/core/plugin-host/plugin-tables.ts
grep -n "BASE_WORKER_SERVICE_TOKENS" -A 12 packages/core/worker-runtime/worker-manager.ts
grep -n "RuntimeLifecycleState =" packages/core/classroom-runtime/types.ts
grep -n "ClassroomLifecycleStage =" -A 3 packages/core/di/interfaces.ts
grep -n "startProcessQuota" packages/core/worker-runtime/worker-manager.ts
```

---

## 6. 建议：把语义检查补进门禁

本次暴露的 12 个问题，**没有一个能被现有 `audit-tools/` 抓到**——它们全部通过了路径与内链检查。若要防复发，建议按性价比排序补三类检查：

1. **环境变量清单比对**（高性价比）：从 `server/`、`packages/core/` 抽出 `process.env.*` / `env.*` 键名，与 `system-configuration.md` 的表格双向比对，缺一报警。这类漂移每个版本都会发生。
2. **统计数字断言**（中）：`ExtensionSlot` 成员数、DI Token 数、数据表数，改为在文档里写占位符、由脚本注入真实数字，或加单测断言文档中的数字与代码一致。
3. **文档内自相矛盾检测**（低，成本高）：同一篇文档内出现互斥断言（如「8 个」与「9 个」描述同一集合）。收益明显但实现难度大，可先靠 review。
