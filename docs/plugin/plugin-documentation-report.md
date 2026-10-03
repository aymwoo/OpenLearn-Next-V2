# 插件系统文档审计报告 (Plugin Documentation Report)

> ⚠️ **快照报告（Snapshot）**：本页是 2026-07-30 的审计快照。"100% Fully Verified" 只反映撰写时点；此后平台已演进（内核服务 7→9、DI Token 补齐至 33、UI 扩展槽位增至 64 种、共享模块白名单 xlsx→exceljs、插件模块 7→9 个）。本页下方表格已于 2026-10-03 按当前代码逐条复核校准，**权威数字仍请以** [DI Token 字典](../api/di-tokens) 与 [UI 扩展槽位全目录](../reference/plugin-ui-extension-slots) **为准**。

**Project**: OpenLearn V2  
**Module**: Plugin Subsystem (`packages/core/plugin-host/`, `packages/plugin-sdk/`, `packages/plugins/`)  
**SDK Version**: `@openlearn/plugin-sdk@3.7.0`  
**Audited Date**: 2026-07-30（**2026-10-03 复核校准**）  
**Status**: 原文声称 100% Fully Verified against Source Code；校准后关键指标均与源码一致

---

## 1. 核心组件与文件验证映射表

| 组件名称                             | 验证物理源码路径                                           | 审计结论（2026-10-03 复核）                                                                                                    |
| :----------------------------------- | :--------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| **PluginHost**                       | `packages/core/plugin-host/index.ts`                       | 已验证。7 状态确切转换、默认 5s 超时保护。资源回收用 `ResourceTracker`——**正序**（按原始追加顺序）逐个 `dispose()`，每个包在 try/catch 中，不是逆序也不是强保。 |
| **PluginContext**                    | `packages/core/plugin-host/types.ts`                       | 已验证。提供 **9 个**内核服务代理（`commandBus` / `eventBus` / `actionRegistry` / `capability` / `processManager` / `storage` / `ai` / `pointsDimension` / `pointsLedger`），以及 `ctx.resolve()`、`ctx.provide()`、`ctx.db`、白名单 `require()`。构造见 `context-builder.ts` 的 `services` 容器（冻结）。 |
| **Manifest Schema**                  | `packages/core/esm-loader/manifest-schema.ts`              | 已验证。Zod 校验包含版本限定 `requires`/`optional`、声明式 `contributes` 及 `deploy` 配置。                                                          |
| **PluginLifecycleManager**           | `packages/core/plugin-host/plugin-lifecycle-manager.ts`    | 已验证。提供微服务级别的安装、激活、停用、热重载与健康检查。                                                                         |
| **ContributionRegistry**             | `packages/core/plugin-host/contribution-registry.ts`       | 已验证。管理**声明式 UI 贡献点**。⚠️ 原结论「成功管理 5 大声明式 UI 插槽」**不成立**：`contribution-registry.ts` 本身不含硬编码槽位清单，而是按 manifest 的 `contributes` 键动态归集。真实前端渲染槽位集合是 `src/plugin-host/types.ts` 的 `ExtensionSlot` 联合类型，**共 64 个成员**，全目录见 [UI 扩展槽位全目录](../reference/plugin-ui-extension-slots)。 |
| **UnifiedExtensionRegistry**         | `packages/core/plugin-host/unified-extension-registry.ts`  | 已验证。全平台统一扩展点聚集索引。                                                                                               |
| **WorkerManager & Worker Isolation** | `packages/core/worker-runtime/worker-manager.ts`           | 已验证。通过 Worker Thread 及 IPC 实现第三方未信任插件隔离。`worker-manager.ts` 的 `computeAllowedWorkerTokens` 负责注入 Token 白名单。 |
| **Plugin Distribution Manager**      | `packages/core/plugin-host/plugin-distribution-manager.ts` | 已验证。多仓库适配器及 ZIP 自动更新序列。                                                                                       |

---

## 2. 插件体系架构关键指标

- **受控核心服务数**: **9 个**（`commandBus`, `eventBus`, `actionRegistry`, `capability`, `processManager`, `storage`, `ai`, `pointsDimension`, `pointsLedger`）
  - 原快照写「7 大内核服务」，漏了后加入的 `pointsDimension` / `pointsLedger`（见 `packages/core/plugin-host/context-builder.ts` 的 `services` 容器构造与 `TOKEN_TO_SERVICE_KEY` 映射）
  - 兼容性：若插件 manifest 的 `requires` 未声明某个 Token，该服务会被置 `null`（D-12 语义），插件应做降级判断
- **生命周期状态数**: 7 个（`PluginState` 枚举：`INSTALLED`, `ACTIVATING`, `ACTIVE`, `DEACTIVATING`, `INACTIVE`, `ERROR`, `UNINSTALLED`）
- **激活/停用超时阈值**:
  - **inline 模式** `5000ms`（`packages/core/plugin-host/index.ts` 的 `ACTIVATION_TIMEOUT_MS` / `DEACTIVATION_TIMEOUT_MS`）
  - **worker 模式** 激活默认 `60000ms`（`packages/core/worker-runtime/worker-manager.ts` 的 `ACTIVATE_TIMEOUT_MS`，可用环境变量 `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` 覆盖，下限 5000ms；另有 `ACTIVATE_PROGRESS_SLIDE_MS` 滑动超时——收到 `activate-progress` 心跳即重置剩余窗口）
- **DI Token 数**: 33 个，权威清单见 [DI Token 字典](../api/di-tokens)
- **UI 扩展槽位数**: 64 个（`ExtensionSlot` 联合类型成员数），全目录见 [UI 扩展槽位全目录](../reference/plugin-ui-extension-slots)
- **共享 Node 模块白名单**: 7 个（`packages/core/plugin-host/types.ts` 的 `PLUGIN_SHARED_MODULES`）：`recharts`, `react-markdown`, `jspdf`, `jspdf-autotable`, `exceljs`, `lucide-react`, `uuid`
  - `xlsx` 已在 v0.3.14 被 `exceljs` 完全取代，不再在白名单内
- **内置范例插件库**: **9 个**（`packages/plugins/` 实测文件数）

  | 模块                    | 职责                                          |
  | ----------------------- | --------------------------------------------- |
  | `builtin.ts`            | 课程、白板、课件、插件安装等核心命令          |
  | `vfs.ts`                | 虚拟文件系统（`vfs.write_file` / `vfs.read_file` 等） |
  | `management.ts`         | 班级、学生、作业、排课、考勤等管理命令        |
  | `process.ts`            | 进程管理（`spawn` / `kill` / `list` / `logs`） |
  | `ai-planner.ts`          | AI 自动规划器（后台任务 + 高危审批）          |
  | `ai-submit-injector.ts` | 自动提分 SDK 注入器                          |
  | `assignment-eval.ts`    | 作业评价                                      |
  | `courseware-score.ts`   | 互动课件原生成绩归集（策略、满分、权重）      |
  | `score-monitor-script.ts`| 成绩监控脚本                                  |

---

## 3. 本次复核（2026-10-03）修正项清单

| 原快照结论                        | 复核结果                                                     | 依据                                                                 |
| --------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 页面自述「服务 7→9」              | ✅ 一致，但 §1 表内仍写「7 大内核服务」，页内自相矛盾         | 统一改为 9，并列出全部 9 个服务名                                    |
| `ContributionRegistry` 管「5 大插槽」 | ❌ 不成立                                                     | 槽位集合由 `ExtensionSlot`（64 个）定义，见 `src/plugin-host/types.ts` |
| `PluginHost`「强力资源回收」      | ❌ 不成立                                                       | `resource-tracker.ts` 的 `disposeAll` 按**原始追加顺序**逐个 `dispose()`，逐个 try/catch 隔离 |
| 内置范例插件「7 个」              | ❌ 已过期                                                       | `packages/plugins/` 实测 9 个 `.ts` 模块                             |
| 生命周期 7 态 / 5s 超时           | ✅ 仍准确                                                       | `plugin-lifecycle-manager.ts`                                       |
| 共享模块白名单 7 项              | ✅ 仍准确（`xlsx` → `exceljs` 已在别处修正）                   | `packages/core/plugin-host/types.ts` 的 `PLUGIN_SHARED_MODULES`        |
