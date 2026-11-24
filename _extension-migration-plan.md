# 扩展机制与活动协议冲突迁移改造方案

> 依据：《课堂扩展机制与教学协议现状审计》（v2，CodeGraph 复核）
> 日期：2026-11-20　范围：`packages/core`、`packages/activity-ecosystem`、`server/routes`、`packages/plugin-sdk`

## 0. 范围与前提

**本方案解决两类冲突：**

1. **扩展机制**：`contribution-registry`（canonical） / `unified-extension-registry`（空壳门面） / `extension-points`（弃用账本） / `hooks-system`（课堂私有钩子）四者无共享契约。
2. **活动协议**：activity-ecosystem provider、学案 `lesson-activities`、lesson-engine 前端注册表、课堂旧协议（quick-poll/buzzer 等）四套实现，且 `/api/activities/:id` 语义分裂。

**不在本方案内：** Presence 四实现合并（独立专项）；课堂互动 UI/交互行为重写（只做协议适配）；`.worktrees`、`artifacts` 目录。

**设计原则：**

- **定义（Definition）与运行（Run）分离**：provider 注册的是“能力定义”，一次 start 产生的是“运行实例”，两者不再共用 `:id`。
- **ID 命名空间化**：任何跨体系引用必须携带 `kind:` 前缀，禁止裸 id 跨域传递。
- **一个语义只有一组 canonical 路由**；旧路由只作为带弃用头的兼容别名。
- **契约包零依赖**：共享类型不 import `server/`、`packages/core/` 运行时模块，避免环。
- **先加法后减法**：每个阶段先新增、双写/双路由、观测，再删除。

---

## 1. 目标架构

```
L0 契约层   packages/core/activity-contract   (ActivityKind / ActivityId / Descriptor / RunRef / Lifecycle)
            packages/core/extension-points    (CORE_EXTENSION_POINTS 声明账本)
L1 注册层   ContributionRegistry (manifest slots)   ActivityProviderRegistry (运行时活动)
            LessonEngine ActivityRegistry (前端渲染)  ClassroomLegacy adapters (旧互动)
L2 聚合层   ExtensionCatalog (只读聚合：slots + activities + hooks + 弃用元数据)
L3 传输层   /api/activity-providers  /api/activity-runs  /api/lessons/:lessonId/activities
            旧 /api/activities/*（Deprecation 别名）
L4 消费层   server routes / plugin-sdk / src 前端 / 插件
```

**关键变化：**

- `unified-extension-registry` 不再承担“写入 + 同步”，改为只读 `ExtensionCatalog`，数据来自 L1 各注册表的实时查询（或启动时快照）。
- `extension-points/metadata.ts` 从“只记弃用”升级为“声明账本”，并由 CI 校验其与 `manifest-schema.ts`、Contribution slot 键一致。
- `hooks-system` 增加 `listHooks()`，作为 Catalog 的第四类数据源，但**不与 contribution slot 合并**（一个是 UI/slot 贡献，一个是运行时拦截，维度不同）。

---

## 2. 冲突 → 改造项映射

| #   | 冲突                             | 根因                                            | 改造项                                                                                                                   | 阶段  |
| --- | -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| C1  | `/api/activities/:id` 双语义     | 两套系统共用 REST 前缀                          | provider 迁至 `/api/activity-providers` + `/api/activity-runs`；学案迁至 `/api/lessons/:lessonId/activities/:activityId` | P2    |
| C2  | 三套 `activityId`                | 无命名空间                                      | 引入 `ActivityId = 'kind:localId'`，所有新 API/事件/日志强制该格式                                                       | P1    |
| C3  | provider 状态仅内存              | 无 Run 实体                                     | 新增 `activity_runs` 表（可选但推荐），或明确“运行态不持久化”契约                                                        | P3    |
| C4  | 两套活动抽象                     | `QuickActivityDescriptor` 与 `ActivityProvider` | 以 `ActivityDescriptorBase` 为基类，`QuickActivityDescriptor` 改为其别名/适配                                            | P1    |
| C5  | unified registry 恒空            | sync 无生产调用                                 | 改为 `ExtensionCatalog` 只读聚合；删除 `sync*` 与写方法                                                                  | P1/P4 |
| C6  | extension-points 名不副实        | 只登记弃用                                      | 增加 slot/activity/hook 声明条目 + CI 对账                                                                               | P0/P1 |
| C7  | 声明/装配/运行时靠人工同步       | 三张表                                          | 加 `scripts/check-extension-parity.mjs`，CI 阻断漂移                                                                     | P0    |
| C8  | lesson-engine 与 server 活动重复 | 前端独立内置表                                  | 前端注册表消费共享 `ActivityDescriptor`；CI 校验内置 type 与 server catalog 一致                                         | P5    |
| C9  | 课堂旧协议无注册表               | 路由内联                                        | 先登记 descriptor 进 Catalog；再按需用 `ActivityProvider` 适配（quick-poll 优先）                                        | P5    |

---

## 3. 目标契约（最小集）

新增 `packages/core/activity-contract/`（仅类型与纯函数，不 import 运行时）：

```ts
export type ActivityKind = 'provider' | 'xuean' | 'lesson-engine' | 'classroom-legacy';

/** 形如 "provider:geo-board" / "xuean:9f3c..." / "lesson-engine:quiz" */
export type ActivityId = `${ActivityKind}:${string}`;

export interface ActivityDescriptorBase {
  readonly kind: ActivityKind;
  readonly activityId: ActivityId;
  readonly title: string;
  readonly category: string;
  readonly icon?: string;
  readonly description?: string;
  readonly roles?: ReadonlyArray<'teacher' | 'student' | 'administrator' | 'assistant'>;
  readonly capabilities?: ReadonlyArray<string>;
  readonly deprecated?: { since: string; removedIn?: string; replacement?: string };
}

/** 一次运行；provider 与学案的“完成”语义在此收敛 */
export type ActivityRunState = 'created' | 'running' | 'paused' | 'finished' | 'failed' | 'cancelled';

export interface ActivityRunRef {
  readonly runId: string;
  readonly activityId: ActivityId;
  readonly lessonId?: string;
  readonly classId?: string;
  readonly state: ActivityRunState;
  readonly startedAt?: number;
  readonly endedAt?: number;
}

export interface ActivityLifecycle<TContext> {
  initialize?(ctx: TContext): Promise<void> | void;
  start(ctx: TContext, payload?: Record<string, unknown>): Promise<unknown>;
  pause?(ctx: TContext): Promise<void> | void;
  resume?(ctx: TContext): Promise<void> | void;
  finish?(ctx: TContext): Promise<void> | void;
  dispose?(ctx: TContext): Promise<void> | void;
}

export interface ExtensionCatalog {
  listSlots(): ReadonlyArray<{ slot: string; pluginId: string; id: string }>;
  listActivities(kind?: ActivityKind): ReadonlyArray<ActivityDescriptorBase>;
  listHooks(): ReadonlyArray<{ name: string; owner?: string }>;
  getDeprecations(): ReadonlyArray<{ id: string; since: string; removedIn?: string; replacement?: string }>;
}
```

**兼容映射：**

- `activity-ecosystem`：`ActivityProviderDescriptor` 继承 `ActivityDescriptorBase`；`id` 变为 `activityId`（保留 `id` getter 一个版本）。
- 学案：`lesson_activities` 行 → `xuean:${row.id}`；新增列 `descriptor_version` 不改变主键。
- lesson-engine：`ActivityDefinition.type` → `lesson-engine:${type}`；`onStart/onPause/onEnd` 映射到 `ActivityLifecycle`。
- 课堂旧协议：`classroom-legacy:quick-poll` 等，先只登记 descriptor。

---

## 4. 路由改造表

| 现状                                       | 语义          | Canonical（新）                                                      | 兼容策略                                 |
| ------------------------------------------ | ------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `GET /api/activities?role=`                | provider 目录 | `GET /api/activity-providers?role=`                                  | 旧路由保留，加 `Deprecation`/`Sunset` 头 |
| `POST /api/activities/:id/start`           | 启动 provider | `POST /api/activity-providers/:providerId/runs`                      | 旧路由转调同一 service                   |
| `GET /api/activities/running`              | 运行中列表    | `GET /api/activity-runs?state=running`                               | 同上                                     |
| `POST /api/activities/:id/pause`           | 暂停          | `POST /api/activity-runs/:runId/pause`                               | 旧路由按 provider 当前 run 反查          |
| `POST /api/activities/:id/resume`          | 恢复          | `POST /api/activity-runs/:runId/resume`                              | 同上                                     |
| `POST /api/activities/:id/finish`          | 结束          | `POST /api/activity-runs/:runId/finish`                              | 同上                                     |
| `PUT/DELETE /api/activities/:id`           | 学案定义      | `PUT/DELETE /api/lessons/:lessonId/activities/:activityId`           | 旧路由保留，按行反查 `lesson_id`         |
| `POST /api/activities/:id/progress`        | 学案进度      | `POST /api/lessons/:lessonId/activities/:activityId/progress`        | 同上                                     |
| `POST /api/activities/:id/progress/verify` | 学案批阅      | `POST /api/lessons/:lessonId/activities/:activityId/progress/verify` | 同上                                     |

**为什么 provider 迁走而不是学案迁走：** 学案已有 `/api/lessons/:lessonId/activities` 的列表/创建路由，item 级平移到同一嵌套层是自然闭合；provider 是插件面向的运行时 API，独立成 `/api/activity-providers` + `/api/activity-runs` 后，`:id` 永远指“定义”，`:runId` 永远指“运行”，语义最清晰。

**兼容解析规则（旧 `/api/activities/:id/*`）：**

- 子路径 `start|pause|resume|finish|running` → provider 命名空间。
- 方法 `PUT|DELETE` 与子路径 `progress*` → 学案命名空间。
- 不在两表都查；按“子路径/方法”静态分派，避免运行时歧义。
- 每个旧路由 handler 记录 `legacy_route_used` 计数（按路由 + 调用方 UA/pluginId），作为删除门槛。

---

## 5. 扩展机制收敛

### 5.1 用 ExtensionCatalog 取代 UnifiedExtensionRegistry

1. 新增 `packages/core/plugin-host/extension-catalog.ts`，实现 `ExtensionCatalog`，构造参数为四个只读数据源：
   - `ContributionRegistry.listAll()`
   - `ActivityRegistry.listDescriptors()`（activity-ecosystem）
   - `RuntimeHooksManager.listHooks()`（新增）
   - `CORE_EXTENSION_POINTS`
2. `kernel/index.ts` 用 `new ExtensionCatalog(...)` 替换 `new UnifiedExtensionRegistry()`；DI token 先保留 `IUnifiedExtensionRegistryToken` 指向 catalog（标记 deprecated），下个大版本换名为 `IExtensionCatalogToken`。
3. 删除 `UnifiedExtensionRegistry` 的 `registerExtension`/`syncContributionRegistry`/`syncActivityRegistry`/`unregisterProvider` 写路径；只读方法 `list*` 委托数据源。
4. `plugin-host/index.ts` 与 `packages/plugin-sdk/index.ts` 的导出同步调整；`generated.d.ts` / `openlearn.d.ts` 用 `pnpm build:plugin-sdk` 重新生成。

> 选择“改造而非直接删除”的原因：`IUnifiedExtensionRegistryToken` 已出现在 SDK 公共 surface 与 DI 契约测试中，直接删除会造成一次不必要的 breaking；先降级为只读聚合，再在 1.0 改名，迁移成本更低。

### 5.2 hooks 可发现

`RuntimeHooksManager` 增加：

```ts
public listHooks(): ReadonlyArray<{ name: RuntimeHookName; count: number }> {
  return Array.from(this.hooks.entries()).map(([name, set]) => ({ name, count: set.size }));
}
```

仅暴露名称与数量，不暴露回调，避免插件越权调用。

### 5.3 声明账本对账（解决“三张表靠人工同步”）

新增 `scripts/check-extension-parity.mjs`，CI 中执行，校验三件事：

1. `manifest-schema.ts` 的 slot 枚举 ⊆ `ContributionRegistry` 的 `*Config` 键集合；
2. `CORE_EXTENSION_POINTS` 中 `kind:'slot'` 的 id 与 manifest slot 对齐（允许显式 `declaredOnly` 例外表）；
3. activity-ecosystem 的 provider id 与 lesson-engine 内置 type 不出现“同名不同义”（通过 `ActivityId` 前缀天然隔离，仅检查裸 id 误用）。

失败即阻断合并，替代 `manifest-schema.ts:34` 的人工注释约定。

---

## 6. 数据迁移

### 6.1 必做（加法、可回滚）

```sql
-- 061/063 之后的新迁移
ALTER TABLE lesson_activities ADD COLUMN descriptor_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lesson_activities ADD COLUMN provider_id TEXT NULL; -- 预留：学案活动绑定 provider
```

- 不改主键、不删列、不改 `activity_progress` 唯一键，保证旧代码可继续读写。
- `provider_id` 仅预留，v1 不写入；避免“先建后弃”的过度设计，字段可空且无索引。

### 6.2 可选（若决定持久化 provider 运行态）

```sql
CREATE TABLE IF NOT EXISTS activity_runs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,       -- namespaced ActivityId
  provider_id TEXT NOT NULL,
  lesson_id TEXT NULL,
  class_id TEXT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NULL,
  actor_id TEXT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_runs_lesson_state ON activity_runs(lesson_id, state);
```

- 写入点只在 `startActivity` / `finish` / `pause` / `resume` 的 service 层，不在 route handler。
- 若不做此表，必须在文档与 OpenAPI 明确“provider 运行态为进程内、重启丢失”，并把 `GET /api/activity-runs` 标注为 `volatile`。

### 6.3 回滚

- 列新增可回滚（SQLite 不删列即可，旧代码忽略新列）。
- `activity_runs` 为独立表，删除表不影响既有功能。
- 双路由阶段旧路由始终可用，回滚只需把前端开关切回旧路由，无需数据回滚。

---

## 7. 分阶段执行

### Phase 0：基线与护栏

- **动作**：加旧路由使用计数；加 `check-extension-parity.mjs`；在 OpenAPI/文档标注 `/api/activities/:id` 为“按子路径分派”的兼容路由；补契约测试骨架。
- **文件**：`server/routes/os.ts`、`server/routes/lesson-activities.ts`、`scripts/check-extension-parity.mjs`、`docs/`。
- **验收**：CI 新增 parity 检查通过；旧路由计数可在日志/指标中看到。
- **回滚**：脚本与计数均为旁路，删除即可。

### Phase 1：契约与聚合（无行为变化）

- **动作**：新增 `packages/core/activity-contract`；`ActivityProviderDescriptor` 继承基类；新增 `ExtensionCatalog` 与 `listHooks()`；`unified-extension-registry` 改为只读委托（或先并列运行）。
- **文件**：`packages/core/activity-contract/*`、`packages/activity-ecosystem/types.ts`、`packages/core/plugin-host/extension-catalog.ts`、`packages/core/classroom-runtime/hooks-system.ts`、`packages/core/kernel/index.ts`。
- **验收**：`pnpm lint`、`pnpm test`；`codegraph callers UnifiedExtensionRegistry` 的写方法调用方只剩测试；Catalog 的 `listActivities()` 能返回 provider + 学案类型 + lesson-engine 内置（通过适配器）。
- **回滚**：Catalog 未接入任何业务读路径，删除新文件即可。

### Phase 2：路由双写

- **动作**：新增 `/api/activity-providers`、`/api/activity-runs`、`/api/lessons/:lessonId/activities/:activityId/*`；旧路由改为转调同一 service；前端新代码走新路由（feature flag）。
- **文件**：新增 `server/routes/activity-providers.ts`（从 `os.ts` 拆出）、`server/routes/lesson-activities.ts`（加嵌套 item 路由）、`server.ts` 注册。
- **验收**：新旧路由契约测试同时通过；`codegraph callers startActivity` 显示新 route + 旧 alias；前端 flag 开/关行为一致。
- **回滚**：关 flag + 旧路由仍在。

### Phase 3：数据与运行态

- **动作**：执行加法迁移；若启用 `activity_runs`，在 service 层写入 run 生命周期；`/api/activity-runs` 读该表。
- **文件**：`migrations/`、`packages/activity-ecosystem/registry.ts`（或新增 `run-service.ts`）、`server/routes/activity-providers.ts`。
- **验收**：`pnpm db:gen-golden` 更新 schema-golden；重启后 `GET /api/activity-runs` 能恢复 running/paused（若启用表）；迁移前后旧数据可读。
- **回滚**：保留列/表不删，关闭读路径。

### Phase 4：删除空壳与旧别名

- **动作**：删除 `UnifiedExtensionRegistry` 写方法与 `sync*`；`IUnifiedExtensionRegistryToken` 改名为 `IExtensionCatalogToken`（保留旧 token 一版别名）；旧 `/api/activities/*` 在计数归零并过弃用窗口后移除。
- **文件**：`packages/core/plugin-host/unified-extension-registry.ts`、`packages/core/di/interfaces.ts`、`packages/core/kernel/index.ts`、`server/routes/os.ts`、`packages/plugin-sdk/*`。
- **验收**：`codegraph callers syncContributionRegistry` 仅剩测试；SDK d.ts parity 测试通过；旧路由 404 仅发生在弃用窗口结束后。
- **回滚**：保留 git tag；旧路由删除前一个版本仍可回退。

### Phase 5（可选，需决策）：收敛旧互动与前端注册表

- **动作**：为 quick-poll/buzzer 实现 `ActivityProvider` 适配器（路由仍是 transport，内部走 provider）；lesson-engine 内置 type 与 server catalog 做 CI 对账，或前端改为从 catalog 拉取。
- **文件**：`server/services/classroom-runtime-service.ts`、`server/routes/classroom.ts`、`packages/core/lesson-engine/activity-registry.ts`、`src/features/lesson-engine/*`。
- **验收**：quick-poll 通过 provider 契约启动/结束；前端内置 type 与 server 一致。
- **回滚**：适配器旁路，保留原 handler。

---

## 8. 兼容与弃用策略

- **弃用信号**：旧路由响应加 `Deprecation: true`、`Sunset: <date>`、`Link: <新路由>; rel="successor-version"`；SDK 对旧方法加 `@deprecated` JSDoc。
- **删除门槛（按版本，不按时间）**：旧路由标记于下一个 minor；连续两个 minor 的 `legacy_route_used` 为 0 后，在下一个 major 删除。
- **SDK 版本**：`activity-contract` 类型进入 SDK 为 minor；`UnifiedExtensionRegistry` 改名/移除为 major；`generated.d.ts` 与 `openlearn.d.ts` 必须同批重建。
- **事件名**：`classroom:quick_poll_*` 等现有 socket 事件**不改名**，只在 payload 增加 `activityId`/`runId` 可选字段；避免前端大面积改动。

---

## 9. 测试与验收矩阵

| 维度       | 用例                                                                   | 命令/方式                                                   |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| 类型与构建 | 新契约包无环、SDK 可生成                                               | `pnpm lint`、`pnpm build:plugin-sdk`                        |
| 契约一致性 | Catalog 活动集合 = provider ∪ xuean ∪ lesson-engine ∪ classroom-legacy | 新增 `activity-contract.test.ts`                            |
| 路由契约   | 新旧路由对同一输入返回等价结果                                         | 现有 `route-scope-enforce` / 新增 `activity-routes.test.ts` |
| 数据迁移   | 迁移前后旧数据可读、可回滚                                             | `pnpm db:gen-golden` + 迁移集成测试                         |
| 扩展对账   | slot/config/metadata 三方一致                                          | `node scripts/check-extension-parity.mjs`                   |
| 依赖方向   | 无人再 import `UnifiedExtensionRegistry` 写方法                        | `codegraph callers syncContributionRegistry` + `rg` 检查    |
| 回归       | 全量测试                                                               | `pnpm test`                                                 |
| 前端       | flag 开/关行为一致                                                     | Playwright / 组件测试                                       |

**完成定义（DoD）：**

- `/api/activities/:id` 的两种语义在文档、OpenAPI tag、代码注释中明确分离；
- 新代码只使用 `ActivityId` 命名空间；
- `UnifiedExtensionRegistry` 要么只读、要么已删除；
- `extension-points` 与 manifest/contribution 由 CI 对账；
- 旧路由删除有计数依据与版本窗口。

---

## 10. 风险与回滚

| 风险                       | 影响              | 缓解                                                                 |
| -------------------------- | ----------------- | -------------------------------------------------------------------- |
| 插件依赖裸 `descriptor.id` | provider 启动 404 | `id` getter 保留一版；`ActivityId` 解析兼容裸 id（默认 `provider:`） |
| SDK d.ts 漂移              | 插件编译失败      | 同批重建 `generated.d.ts`/`openlearn.d.ts`，CI parity                |
| 双路由导致测试分叉         | 维护成本          | 旧路由只做薄转调，不复制业务逻辑                                     |
| `activity-contract` 引入环 | 构建失败          | 仅类型 + 纯函数；用 lint 规则禁止 import server/core 运行时          |
| 数据迁移锁表               | 课堂中断          | 仅 `ADD COLUMN`；`activity_runs` 独立表；迁移在低峰执行              |
| 课堂旧协议适配改动面大     | 回归风险          | Phase 5 可选、quick-poll 单点先行、适配器旁路                        |

**统一回滚原则：** 每个 Phase 都能通过“关 flag / 保留旧路由 / 保留新列”回退，不做破坏性迁移。

---

## 11. 待拍板的三个决策

| 决策            | 选项                               | 推荐                  | 理由                                                                   |
| --------------- | ---------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| 路由归属        | A. provider 迁新族；B. 学案迁新族  | **A**                 | 学案已有嵌套列表路由，item 平移自然；provider 是插件 API，独立族更清晰 |
| UnifiedRegistry | A. 改只读 Catalog；B. 直接删除     | **A**                 | 避免 SDK/DI 一次性 breaking；下个 major 再改名                         |
| 课堂旧协议      | A. 本方案内适配；B. 延后到独立专项 | **B（Phase 5 可选）** | 冲突核心在路由与定义，旧互动行为重写风险高、收益低                     |

若三项均按推荐执行，改造后的边界是：**`/api/activity-providers` 管定义，`/api/activity-runs` 管运行，`/api/lessons/:lessonId/activities` 管学案内容；`ExtensionCatalog` 只读聚合四类扩展数据；旧 `/api/activities/*` 仅作带弃用头的兼容层。**

---

## 12. 执行记录（Phase 0–5，2026-11-20）

**已确认决策：** provider 迁新族 / UnifiedRegistry 改只读 Catalog / 课堂旧协议延后 Phase 5。

**已落地：**

- 新增 `packages/core/activity-contract/`：`ActivityKind`、`ActivityId` 命名空间、`ActivityDescriptorBase`、`ActivityRunRef`、`ActivityLifecycle`、`IExtensionCatalog`、`XUEAN_ACTIVITY_TYPES`、`classroomLegacyDescriptors`。
- 新增 `packages/core/plugin-host/extension-catalog.ts`：只读聚合 slots / activities / hooks / 弃用元数据；动态 provider 源由 `server.ts` 启动期 `attachActivitySource` 接入。
- `kernel/index.ts` 改用 `ExtensionCatalog`；`IUnifiedExtensionRegistryToken` 与新增的 `IExtensionCatalogToken` 均解析为 Catalog；`unifiedExtensionRegistry` 降级为 deprecated getter。
- **Phase 2**：新增 canonical 路由族 `server/routes/activity-providers.ts`（`/api/activity-providers`、`/api/activity-runs`）；`lesson-activities.ts` 为全部 item 级操作增加 `/api/lessons/:lessonId/activities/:activityId/*` 嵌套路由；旧 `/api/activities/*` 保留为带 `Deprecation` 头的兼容别名。
- **Phase 3**：新增 `server/services/activity-run-service.ts` 与迁移 `070_activity_runs.sql`（`activity_runs` 表 + `lesson_activities.descriptor_version/provider_id`），运行态可持久化并在重启后恢复。
- **Phase 4**：`UnifiedExtensionRegistry` 改为只读别名（继承 `ExtensionCatalog`），删除全部写方法/`sync*`；新增 `IExtensionCatalogToken`，旧 token 保留过渡。
- **Phase 5（发现/对账部分）**：课堂旧互动与 lesson-engine 内置活动登记进 Catalog；新增 `extension-parity.test.ts` 校验四类活动数量与 ID 唯一性。行为级 provider 适配按决策延后。
- `RuntimeHooksManager.listHooks()` 提供只读 hook 目录。

**验证结果：**

- `pnpm lint`：通过。
- `pnpm test`：**712 test files / 5,761 tests 通过**（3 skipped）。
- `pnpm build:plugin-sdk`：重新生成 `generated.d.ts` / `dist`；SDK parity 27 项通过。
- `pnpm db:gen-golden`：71 个迁移、105 张表。
- `codegraph sync`：`registerActivityProviderRoutes` 仅由 `server.ts` 调用；`ActivityRunService` 被 `server.ts`、`os.ts`、新路由与测试引用；`startActivity` 的调用方已收敛到 `ActivityRunService.start`。

**按决策保留：** 旧 `/api/activities/*` 别名在弃用窗口内继续可用；课堂 quick-poll/buzzer 的行为级 provider 适配延后到后续专项；`UnifiedExtensionRegistry` 的下个大版本删除。
