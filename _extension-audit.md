# 课堂扩展机制与教学协议现状审计

> 审计日期：2026-11-20　范围：`packages/core`、`packages/activity-ecosystem`、`server/routes`、`server/services`

## 0. 审计前提与证据口径（必读）

**取证方式（v2，已用 CodeGraph CLI 复核）。** 首版审计时 CodeGraph MCP 未挂载，只能 grep/Read；随后用户提供 `codegraph` CLI（v1.6.0）。已执行 `codegraph init -y` 建索引（输出：**1,861 files / 22,635 nodes / 91,775 edges / 1.7s**），并用 `codegraph node -f`、`codegraph callers`、`codegraph impact`、`codegraph query` 对首版关键结论逐条复核。本版“被引用”一栏改为 CodeGraph 子命令来源，grep 仅作交叉验证。

证据优先级：**CodeGraph `callers`/`impact`/`node -f` > grep > 人工读码**。CodeGraph 不可用的能力仅剩 DB 图（CLI 无 `find_db_tables`/`find_db_writers`），故活动表关系仍用 `migrations/schema-golden.json` + SQL grep。仓库内 `audit-tools/reports/*.json` 为旧静态索引，仅旁证。

CodeGraph 复核中发现三处需人工消歧的局限：①**纯 re-export barrel 失真**——`codegraph node -f packages/core/extension-points/index.ts` 报“0 symbols, no dependents”，但 `metadata.ts` 的 `warnDeprecation` 实际有 6 个依赖方，依赖边落在被再导出的具体文件；②**同名方法混淆**——`codegraph callers syncContributionRegistry` 返回 4 个调用方，其中 install.ts 两处调用的是 installer 私有同名方法（`install.ts:1008 private syncContributionRegistry(manifest: Manifest)`），不是 unified registry 的方法；③**file-mode `used by` 过报**——`node -f server/routes/lesson-activities.ts` 报 20 个依赖文件，但 `codegraph impact registerLessonActivitiesRoutes` 只返回 `server.ts:startServer` 与一个测试，grep 全仓也只在 `server.ts:109` 和测试里出现该模块路径，说明 file-mode 因文件内大量通用私有符号（`now`、`VALID_*`、`*Row`）产生了名字碰撞误连。下文凡关键边均同时给出 CodeGraph 子命令与消歧依据。

---

## 一、结论速览

| 维度 | canonical（未来） | legacy（历史） | wrapper | 孤儿/空壳 |
|---|---|---|---|---|
| 扩展机制 | `contribution-registry.ts`（插件 slot 实际落地路径） | `unified-extension-registry.ts`（自声明 deprecated、运行时零填充） | — | `UnifiedExtensionRegistry` 实例被注册进 DI 但无消费者 |
| 扩展元数据 | `extension-points/metadata.ts`（弃用账本，非运行时注册表） | — | — | 与 unified registry 无 import 关系 |
| 课堂钩子 | `classroom-runtime/hooks-system.ts`（kernel 内部生命周期） | — | — | 与 unified registry 并列、互不引用 |
| 活动协议 | `activity-ecosystem/registry.ts`（descriptor + 生命周期 + capability） | `lesson-engine/activity-registry.ts`（前端定义表）、`server/routes/lesson-activities.ts`（学案 DB CRUD） | — | `/api/activities/*` 与学案 `/api/activities/:id` 共用前缀但语义不同 |
| Presence | 无（`presence-engine` 未接入生产） | `server/presence.ts`（Socket 内存态）、`classroom.ts /checkin`（DB + socket） | — | `presence-engine` 已实例化但无生产 resolve |

一句话：**扩展机制“两套半”、活动协议“三套半”、Presence“四套实现且互不共享状态”。`unified-extension-registry` 是名义统一层、实际空壳；`extension-points` 只是弃用元数据；`hooks-system` 是课堂 runtime 私有钩子，三者不共享任何 ExtensionPoint 类型。**

---

## 二、第 1 组：扩展机制

### 2.1 文件总账

| 文件 | 行数 | 导出符号（`codegraph node -f`） | 被引用（CodeGraph 子命令 / 人工消歧） | 出边（CodeGraph / Read） | 标签 |
|---|---|---|---|---|---|
| `packages/core/plugin-host/unified-extension-registry.ts` | 190 | `ExtensionItemMetadata`、`IUnifiedExtensionRegistry`、`UnifiedExtensionRegistry` | **used by 7 files**：生产 3（`plugin-host/index.ts`、`di/interfaces.ts`、`kernel/index.ts`）+ 测试 4；`codegraph callers registerExtension` → 仅自身两个 sync 方法 + 2 测试 | `integration-types`、`version`（Read） | **历史/空壳** |
| `packages/core/plugin-host/contribution-registry.ts` | 1263 | `ContributionRegistry` + 约 80 个 `*Config` slot 接口 | **used by 16 files**：`base.ts`、`install.ts`、`core.ts`、`types.ts`、`context-builder.ts`、`manifest-schema.ts`、SDK + 测试（`codegraph node -f`） | `extension-points/metadata`（grep 交叉验证） | **未来（canonical）** |
| `packages/core/extension-points/index.ts` | 2 | 再导出 `metadata`、`compatibility-reporter` | **barrel 失真**：`codegraph node -f` 报 0 symbols / no dependents；真实边见 `metadata.ts`（6 files） | `metadata` | **未来（元数据/弃用账本）** |
| `packages/core/extension-points/metadata.ts` | 303 | `ExtensionPointKind`、`ExtensionPointMetadata`、`CORE_EXTENSION_POINTS`、`getExtensionPointMetadata`、`warnDeprecation` | **used by 6 files**：`contribution-registry`、`context-builder`、`event-bus`、`command-bus`、`compatibility-reporter`、测试（`codegraph node -f`） | 无外部依赖 | **未来（契约）** |
| `packages/core/classroom-runtime/hooks-system.ts` | 55 | `RuntimeHooksManager`（`registerHook`/`executeHook`/`clear`） | **used by 1 file**：`classroom-runtime/kernel.ts`（`codegraph node -f`） | `./types.js` | **未来（仅课堂运行时内部）** |

### 2.2 必答四问

**Q1：`unified-extension-registry` 的 contribution 来自哪些上游？**
它的填充入口只有两个，且均为**鸭子类型参数**：`syncContributionRegistry(registry)` 读取 `registry.listAll()`（即 `ContributionRegistry`），`syncActivityRegistry(registry)` 读取 `registry.listProviders()`（即 `activity-ecosystem/registry.ts` 的 `ActivityRegistry`），分别以 `slot`/`'activity'` 为 category 落表。

CodeGraph 复核：`codegraph callers syncActivityRegistry` → **仅 1 个测试**；`codegraph callers syncContributionRegistry` → 4 个（2 测试 + `updatePluginFromZipExclusive`@`install.ts:632` + `rollbackPluginToSnapshot`@`install.ts:1049`）。**但这 4 个不能直接采信为“unified 被生产调用”**：`codegraph node -f install.ts` 显示 `install.ts:1008` 另有 `private syncContributionRegistry(manifest: Manifest)`，其函数体调用的是 `this.contributionRegistry.register(...)`（`Read` 1008-1012 行），且全仓 grep `unifiedExtensionRegistry` 在 `install.ts` 中**零命中**。因此那两处是 installer 私有同名方法，unified registry 的两个 sync 在**生产仍然零调用**。结论不变：运行时 `_extensions` 为空 Map，`listExtensions()` 恒空。

**Q2：`extension-points` 是否被 `unified-extension-registry` 消费？**
**否。** `unified-extension-registry.ts` 的 import 只有 `integration-types` 与 `version`（`Read` 第 7-9 行）。CodeGraph 复核：`codegraph node -f extension-points/metadata.ts --symbols-only` → used by 6（`contribution-registry`、`context-builder`、`event-bus`、`command-bus`、`compatibility-reporter`、测试）；`codegraph node -f unified-extension-registry.ts` → used by 7，其中**无 `metadata.ts`**。grep 进一步确认这 6 处均仅取 `warnDeprecation`。`extension-points` 是“弃用告警元数据表”，不是运行时扩展注册表。

**Q3：`hooks-system` 与 unified registry 是并列、替代还是 wrapper？**
**并列，且互不引用。** `RuntimeHooksManager` 只被 `classroom-runtime/kernel.ts` 使用（`hooksManager` 字段 + 两个 lesson 生命周期钩子），类型来自 `classroom-runtime/types.ts` 的 `RuntimeHookName`。unified registry 用自由字符串 `category` + `id` 存任意 `impl`；两者无 import、无类型交叉、无转调。不是 wrapper。

**Q4：三者是否共享同一套 `ExtensionPoint` 定义？**
**不共享。** 存在至少三套互不兼容的“扩展”类型：`ExtensionPointMetadata`（`{id, kind:'command'|'event'|'slot'|'service', since, deprecated}`）、Contribution 的 `slot: string` + 各 `*Config`、Activity 的 `ActivityDefinition`/`ActivityProviderDescriptor`。`extension-points/index.ts` 甚至不导出 unified registry 所需类型。结论：**没有统一 ExtensionPoint 契约**。

### 2.3 判定落地：为什么统一层不是 wrapper

按任务给定的四条判据逐项核对 `UnifiedExtensionRegistry`：**完整生命周期**——它只有 `registerExtension` 与 `unregisterProvider`，没有 init/start/dispose，也没有订阅或事件；**上下文注入**——`registerExtension` 的 `impl: unknown` 是裸对象，没有 `RuntimeContextData`、没有命令总线/事件总线注入；**capability 校验**——完全没有，任何调用方都能写入任意 category/id；**被多处 import**——生产侧只有 `kernel/index.ts` 的 `new`/DI 注册与 `di/interfaces.ts` 的类型引用，真正会“读回”扩展的消费者为零。四条中三条不满足、一条是“只被装配不被消费”，因此它既不是 canonical，也不是 wrapper（wrapper 至少会把调用转给另一模块，而它没有下游转调对象），只能判为**历史空壳/占位门面**。

反过来看 `contribution-registry`：它有明确的注册生命周期（`register`→`getBySlot`/`listAll`→`unregister`/`dispose`），有 manifest 驱动的上下文（`install.ts` 解析 manifest 后写入），有 slot 类型约束（80 余个 `*Config`），被 plugin-host 核心、context-builder、esm-loader、SDK 多处引用，四项判据全部满足，故判为 canonical。`hooks-system` 满足“生命周期 + 上下文（`RuntimeContextData`）+ 多处在 kernel 内调用”，但作用域仅限 `classroom-runtime`，不构成平台级扩展机制，故判为“局部 canonical”。

一个容易误判的点是 `install.ts:832` 的 `this.syncContributionRegistry(manifest)`：它与 `UnifiedExtensionRegistry.syncContributionRegistry(registry)` **同名但不同签名**（前者吃 `Manifest`，后者吃带 `listAll()` 的注册表），是 installer 的私有方法。若只看方法名会误以为统一层在生产中被填充；实际两处互不相干。这也解释了为什么“统一注册表恒空”没有被日常测试发现——测试直接调 `registry.syncContributionRegistry(mockContrib)`，绕过了真实装配链。

---

## 三、第 2 组：活动协议

### 3.1 文件总账

| 文件 | 契约要点 | 被引用（CodeGraph 子命令 / 人工） | 标签 |
|---|---|---|---|
| `packages/core/lesson-engine/activity-registry.ts`（75 行） | `ActivityRegistry`：`registerActivity/unregisterActivity/getActivity/hasActivity/listActivities`；内置 11 种类型 | **used by 2**：`lesson-runtime.ts` + 测试（`codegraph node -f`） | **历史/前端** |
| `packages/core/lesson-engine/types.ts`（161 行） | `Activity`、`ActivityDefinition`（含 `onStart/onPause/onEnd`）、`TeachingContextData`、`Flow/Stage/Lesson` | 经 `lesson-engine` 包 | **历史/前端** |
| `server/routes/os.ts`（636 行，`/api/activities/*` 在 199-332 行） | 见下 | **used by 7**（`server.ts` + 6 测试）；`codegraph callers registerOsRoutes` → `startServer`@`server.ts:130` | **未来（activity-ecosystem 宿主端）** |
| `server/routes/lesson-activities.ts` | 学案活动 CRUD + 进度 | `codegraph impact registerLessonActivitiesRoutes` → `server.ts:startServer` + 测试（file-mode 报 20 为过报） | **另一套（学案域，DB）** |

### 3.2 必答四问

**Q1：`lesson-engine/activity-registry` 的 Activity 契约有无生命周期方法？**
**有，但只是“可选回调”，注册表本身不驱动。** `ActivityDefinition`（`types.ts:140-150`）声明了 `onStart/onPause/onEnd(activity, context)`、`defaultConfig`、`category` 等；`TeachingContextData`（152-161）提供 `currentLesson/currentFlow/currentStage/currentActivity/role/isPresentationMode`。但 `ActivityRegistry` 只做 `Map<type, definition>` 存取（`Read` 全文），没有任何 `start/pause/finish` 调度方法；生命周期需由 `LessonRuntime`（前端，`lesson-runtime.ts:46` 实例化）自行调用。

**Q2：`/api/activities/*` 的 handler 是否调用 `activityRegistry`？**
**调用，但对象不是 lesson-engine 的 ActivityRegistry。** `os.ts` 从 `ctx` 取 `activityRegistry`，其类型在 `server/context.ts:3` 为 `import type { ActivityRegistry } from '../packages/activity-ecosystem/index.js'`。该 registry（`packages/activity-ecosystem/registry.ts`）提供 `registerProvider/unregisterProvider/getProvider/listProviders/listDescriptors/listByRole/listByCategory/startActivity/clear`，并在 `startActivity` 内做 `capability.check(actorId, cap)` 权限校验。端点映射：`GET /api/activities`→`listDescriptors`/`listByRole`；`POST /:id/start`→`startActivity`；`GET /running`→`listProviders` 过滤 running/paused；`POST /:id/finish|pause|resume`→`getProvider().finish/pause/resume`。CodeGraph 复核：`codegraph callers startActivity` → `POST /api/activities/:id/start`（`os.ts:220`）、前端 `ActivityWorkspaceWidget.tsx:99`、`registerOsRoutes`、测试，证明 handler→registry 的调用链成立。这是**完整生命周期 + 上下文注入（`createActivityContext`）+ capability 校验**，符合 canonical 判据。

**Q3：`lesson-activities.ts` 与 `os.ts` 是否操作同一数据？**
**否，完全不同。** `lesson-activities.ts` 全程 `kernelContainer.db` 直接 SQL，操作 `lesson_activities`、`lesson_activity_blocks`、`activity_progress` 三表（grep 确认；建表见 `migrations/062_xuean_lesson_pkg_and_courses.sql`），无 `activityRegistry`、无 `activity-ecosystem` import。`os.ts` 操作的是内存中的 provider 实例状态（`p.state === 'running'`），无 DB 写入。二者仅在 URL 前缀上“撞名”：
- `os.ts`：`POST /api/activities/:id/start|pause|resume|finish`、`GET /api/activities/running`
- `lesson-activities.ts`：`PUT/DELETE /api/activities/:id`、`POST /api/activities/:id/progress`、`POST /api/activities/:id/progress/verify`

同一 `:id` 在两个文件里分别指“provider 注册 id”与“`lesson_activities` 行 id”，**无共享主键、无外键关联**。这是本次审计最明确的语义冲突点。

**Q4：A 套活动体系背后有没有统一的 `activityId` 注册表？**
**没有。** 存在三套 id 命名空间：①lesson-engine 的 `ActivityDefinition.type`（字符串，11 内置 + 插件）；②activity-ecosystem 的 `descriptor.id`；③`lesson_activities.id`（DB 行 id）。`Activity` 结构里的 `activityId?: string`（`types.ts:22`、`Stage` 中 `activities[].id`）只是实例外键，不是跨体系注册表。`di/interfaces.ts:1264-1268` 的 `IActivityRegistry` token 指向 activity-ecosystem，未覆盖另两套。

### 3.3 第四套：课堂互动旧协议

`server/routes/classroom.ts` 的 quick-poll（1072 起）、buzzer（1363 起）、pacing（1554 起）、exit-ticket（1713 起）由 `classroomService`（`server/services/classroom-runtime-service.ts`，`implements IClassroomLifecycleService, IInteractionRuntimeService`）和 `classroomSessionService` 驱动；grep 确认 `classroom.ts` **不 import** `activityRegistry` 或 `hooksManager`。它们是独立的“课堂互动”通道，未走 activity-ecosystem 的 provider 生命周期。

### 3.4 四套活动实现对照与迁移难点

| 实现 | 主键 | 存储 | 生命周期 | 扩展入口 | 生产调用方 |
|---|---|---|---|---|---|
| activity-ecosystem provider | `descriptor.id` | 内存 provider 实例 | initialize/start/pause/resume/finish/dispose | `registerProvider` | `os.ts` `/api/activities/*`、前端 activity-service |
| 学案活动 | `lesson_activities.id` | SQLite 三表 | 无（只有 status 字段与 verify） | 路由 CRUD | `lesson-activities.ts`、学案前端 |
| lesson-engine | `ActivityDefinition.type` | 内存 Map（浏览器） | onStart/onPause/onEnd 回调 | `registerActivity` | `lessonEngineStore`（前端） |
| 课堂旧协议 | `session.id`/`pollId`/`buzzerId` | `classroom_sessions` + 内存 poll | 由 route handler 内联实现 | 无注册表，硬编码端点 | `classroom.ts` |

迁移难点在于“活动完成”的语义在三套里不同：ecosystem 的完成是 `finish()` 回调触发；学案活动是学生上报 `status` + 教师 `verified` 写 `activity_progress`；lesson-engine 是前端 `ActivityStatus` 状态机。三者都不自动推进课堂门禁（`lesson-activities.ts` 文件头明确“活动完成不自动推进课堂门禁，与 timeline 并列”），因此无法仅靠统一 `activityId` 合并，必须先把“活动实例”与“活动定义”分离。当前最危险的是 `/api/activities/:id` 同前缀：`PUT/DELETE` 命中 DB 行、`/start` 命中内存 provider，若前端把学案活动 id 传给 `/start`，只会得到 404（provider not found）而非明确错误，排查成本高。

---

## 四、第 3 组：Presence

### 4.1 总账

| 文件 | 公开方法（`codegraph node -f`） | 存储 | 被引用（CodeGraph 子命令） | 标签 |
|---|---|---|---|---|
| `presence-engine/presence-manager.ts`（191 行） | `getPresence`、`watchPresence`、`updatePresence`、`queryPresence`、`subscribePresence`、`raiseHand`、`requestHelp`、`registerPresence`、`getCustomPresenceDefs`、`getDashboardMetrics` | `PresenceStore` 内存 `Map` | **used by 7**：全部在 `presence-engine/` 内（kernel、detector、focus、group、heartbeat、synchronizer）+ 测试，**无 server/src 依赖** | **未接入生产** |
| `presence-engine/presence-engine-kernel.ts` | 暴露 store/eventBus/heartbeat/detector/focus/group/synchronizer/manager；`start/stop/registerEntity/dispose` | 内存 | **used by 2**：`kernel/index.ts` + 测试；`codegraph callers PresenceEngineKernel` → `constructor`@`kernel/index.ts:167`、`presenceEngine` 属性@142 | **已实例化、无消费者** |
| `presence-engine/heartbeat.ts` | `receiveHeartbeat`、`start`、`stop`、`sweep`（codegraph node -f） | 内存 | kernel 内部 | 能力存在但未与 Socket 对接 |
| `server/presence.ts` | `getOnlineStudentIds`、`getActiveStudentLessons`、`getPresentStudentIds`、`setupPresence` | 内存 `Map` | **used by 17**（`event-routing`、`routes/lessons`、`classroom-session-service` 等）；`codegraph callers getPresentStudentIds` → `registerRosterRoutes`、`GET /api/classes/:classId/picker-candidates`、`listSessions` + 测试 | **legacy（生产在用）** |
| `server/routes/classroom.ts /checkin`（994 起） | `POST /api/classroom/sessions/:lessonId/checkin` | DB + socket | handler 代码（Read 1000-1068）；`codegraph node -f classroom.ts` used by 18 | **legacy（生产在用）** |

### 4.2 必答四问

**Q1：presence-engine 是否提供 `enter / heartbeat / leave / checkIn / query`？**
**部分提供，关键三项缺失。** `PresenceManager` 提供 `queryPresence`（query ✅）；heartbeat 由 `PresenceHeartbeatManager.receiveHeartbeat/start/sweep` 提供（✅，但在 kernel 子模块，不在 manager 门面）。**没有 `enter`、`leave`、`checkIn`**：进出场在 legacy 侧由 Socket 事件 `register-student`/`enter-lesson`/`leave-lesson` 写入 `server/presence.ts` 的内存 Map；签到在 `classroom.ts` 手写。

**Q2：状态存储是内存还是 DB？**
**纯内存。** `PresenceStore` 是 `Map<string, PresenceEntity>`（`presence-store.ts:9`）；`PresenceManager` 的依赖仅 `presence-store/event-bus/timeline/privacy`（`presence-manager.ts:6-17` 的 import），**未 import 任何 db/`kernelContainer`**。`PresenceEngineKernel` 也不碰 DB。

**Q3：`classroom.ts /checkin`、`attendance` 表、`presence.ts` 内存态三者与 presence-engine 的关系？**
**四条互不共享的实现：**
1. `server/presence.ts`：Socket.IO 实时态，`onlineStudents` + `activeStudentLessons` 两张 Map，`getPresentStudentIds(lessonId)` = 在线 ∩ 当前课节；`setupPresence` 在 `connection` 里维护，断线/`leave-lesson` 立即失效。
2. `classroom.ts /checkin`：校验 `classroom_sessions.checkin_code` → 写 `attendance`（按 `classroom_sessions.class_id` 反查 `schedules`）→ `segmentGateService.recordCheckin` 写 `lesson_checkins` → 发 `classroom:checkin_submitted` socket。
3. `attendance` / `lesson_checkins`：DB 事实表，历史签到，报告与 `classroom.ts:2057` 查询使用。
4. `presence-engine`：独立内存 store，仅被 `PresenceEngineKernel` 持有，`getPresentStudentIds` 与它无关；`IPresenceEngineServiceToken` 在生产代码中**无 resolve 方**。CodeGraph 复核：`codegraph callers getPresenceEngine` → Symbol not found（kernel 用对象字面量 `{ getPresenceEngine: async () => ... }` 注册，未形成独立符号）；`codegraph node -f presence-manager.ts` 的 7 个依赖方全部位于 `presence-engine/` 内，无 `server/` 或 `src/` 外部依赖。

为什么四者没有共享状态？根因是“在场”在不同场景有不同事实源：Socket 层关心“连接是否还在”，`/checkin` 关心“是否输入了正确口令且属于该班”，`attendance` 关心“排课维度是否出勤”，presence-engine 关心“实体的富状态（focus/interactionSignal/connectionState）”。四者各自解决一个问题，却都用“学生是否在场”这个词描述，因而在代码里形成同名不同义的重复实现。真正的统一不是把四张表/Map 合成一个，而是定义清楚“实时在场（socket）”“课节签到（checkin）”“排课出勤（attendance）”“富状态遥测（presence-engine）”的边界与同步时机。当前缺的正是这个边界声明：`getPresentStudentIds` 只读 socket，`/checkin` 写 DB 后不回写 socket 内存态，导致“刚签到但未 enter-lesson”的学生在教师端在场名单里不可见。

**Q4：presence-engine 能否直接替换上述三者？阻塞点：**
**不能直接替换。** 阻塞点：①无 DB 持久化（`attendance`/`lesson_checkins` 的幂等 upsert 与报告查询无对应）；②Socket 生命周期未接线（`register-student`/`enter-lesson`/`leave-lesson`/`disconnect` 的竞态保护在 `presence.ts`，engine 只提供 `receiveHeartbeat`）；③无 `checkIn` 语义（4 位码校验、班级成员校验、阶段门禁、缓存失效）；④无“课节 → 在场学生”查询（`getPresentStudentIds` 的口径是“在线 ∩ 该课节”，engine 的 `queryPresence` 无 lesson 维度）；⑤隐私/角色裁剪（`visiblePresence`、`PRESENCE_STAFF_ROOM`）未对齐。可行路径是先做适配层：Socket 事件写入 `PresenceStore`，engine 只做实时视图，DB 仍由 `attendance` 承担。

---

## 五、第 4 组：DI 契约总账（`packages/core/di/interfaces.ts`，1423 行）

### 5.1 全部 `I*` 接口与职责

| 接口 | 职责（由名称/方法推断） |
|---|---|
| `ICommandBusService` | 命令创建、执行与已注册命令查询 |
| `IEventBusService` | 事件发布/订阅 |
| `IActionRegistryService` | Action descriptor 注册与列举 |
| `ICapabilityService` | capability 检查与调用 |
| `IProcessService` | 进程/后台任务编排 |
| `IStorageService` | 文件持久化存储 |
| `IAIService` | AI 生成、上下文 provider、persona 注册 |
| `IAuthSessionBridgeService` | 会话与认证身份桥接 |
| `ISemesterGradeService` | 学期成绩读写 |
| `IPointsDimensionRegistry` | 积分维度注册 |
| `IPointsLedgerService` | 积分流水账本 |
| `IClassRosterService` | 班级花名册 |
| `ILessonOutlineService` | 课时大纲 |
| `ICreditAwardService` | 学分发放 |
| `IRewardCatalogReader` | 奖励目录只读视图 |
| `ICreditRedemptionService` | 学分兑换 |
| `IClassroomMessageService` | 课堂消息频道注册、补投/分页 |
| `ILessonEngineService` | 课时引擎门面 |
| `IClassroomRuntimeService` | 课堂运行时门面 |
| `IPresenceEngineService` | presence 引擎门面（`getPresenceEngine`） |
| `ITeachingCollaborationService` | 教学协作 |
| `ILearningAnalyticsService` | 学习分析 |
| `IAICapabilityService` | AI 能力 |
| `ICapabilityRuntimeService` | 能力运行时 |
| `ICapabilityGovernanceService` | 能力治理 |
| `IPlatformServiceRegistryService` | 平台服务注册表 |
| `IRegisteredCoursewareRuntimeScript` | 课件运行时脚本记录（extends `CoursewareRuntimeScript`） |
| `ICoursewareRuntimeScriptRegistry` | 课件脚本注册表 |
| `IClassroomLifecycleService` | 课堂阶段读取/流转/guard 注册 |
| `IInteractionRuntimeService` | 互动 provider 注册/列举 |
| `IClassroomCountdownService` | 课堂倒计时 |
| `IStageGuardService` | 教学环节守卫 |
| `IAssessmentQuestionTypeSummary` | 题型摘要（注：命名带 I 但为数据形状） |
| `IAssessmentGraderRegistry` | 题型注册与判分 |
| `INetworkProxyService` | 网络代理 |
| `IRegisteredFileBackend` | 文件后端记录 |
| `IRegisteredFileProcessor` | 文件处理器记录 |
| `IFileStorageExtensionRegistry` | 文件存储扩展注册 |

### 5.2 重点签名（`Read` 原文）

```ts
export type ClassroomLifecycleStage =
  'PRE_CLASS_READY' | 'IN_CLASS_TEACHING' | 'WRAP_UP_EXIT_TICKET' | 'ARCHIVED_REPORT';

export interface IClassroomLifecycleService {
  getStage(lessonId: string): Promise<ClassroomLifecycleStage>;
  transitionStage(
    lessonId: string,
    toStage: ClassroomLifecycleStage,
    actorId: string,
    classId?: string,
  ): Promise<{ success: boolean; stage: ClassroomLifecycleStage; reason?: string }>;
  registerStageGuard(owner: string, guard: ClassroomStageGuard): void;
  unregisterStageGuard(owner: string): void;
}

export interface QuickActivityDescriptor {
  id: string;
  name: string;
  category: string;
  icon?: string;
  description?: string;
  supportedRoles?: ('teacher' | 'student')[];
}

export interface IInteractionRuntimeService {
  registerActivityProvider(owner: string, descriptor: QuickActivityDescriptor): void;
  unregisterActivityProvider(owner: string, id: string): void;
  listActivityProviders(): QuickActivityDescriptor[];
}
```

实现方为 `server/services/classroom-runtime-service.ts:104` `ClassroomRuntimeService implements IClassroomLifecycleService, IInteractionRuntimeService`，`classroom.ts` 通过 `classroomService.transitionStage/getOrCreateSession` 调用。CodeGraph 复核：`codegraph callers transitionStage` → `wrapClassroomLifecycleService`（`context-builder.ts:629`）、`registerClassroomRoutes`、`POST /api/classroom/sessions/:lessonId/stage`（`classroom.ts:859`）、测试；`codegraph callers registerActivityProvider` → `wrapInteractionRuntimeService`（`context-builder.ts:664`）、插件 E2E 测试、测试文件。前者证明插件上下文确实包裹了这两个服务（用于停用回收），后者证明 `registerActivityProvider` 被插件上下文消费、但**仍未被 `/api/activities/:id/start` 消费**。注意：`IInteractionRuntimeService` 只登记 `QuickActivityDescriptor`（元数据），不承载活动生命周期——生命周期在 activity-ecosystem 的 `ActivityProvider`，二者是**两套活动抽象**。

### 5.3 契约与实现的错位

`IClassroomLifecycleService` 的四个方法在 `ClassroomRuntimeService` 中都有实现（`getStage`/`transitionStage`/`registerStageGuard`/`unregisterStageGuard`），且 `transitionStage` 会调用 guard 管道（`runClassroomGuard`）。但注意 `ClassroomLifecycleStage` 只有四个粗粒度阶段（`PRE_CLASS_READY`/`IN_CLASS_TEACHING`/`WRAP_UP_EXIT_TICKET`/`ARCHIVED_REPORT`），而 `lesson-engine` 的 `LessonStatus` 有六态、`Stage` 又有 `completionStatus` 四态——**课堂生命周期与课时/环节生命周期是两套状态机**，`IClassroomLifecycleService` 不覆盖 `lesson-engine`。`IInteractionRuntimeService` 同理只是“互动提供者名册”，`registerActivityProvider` 只存 descriptor，不会被 `/api/activities/:id/start` 消费（后者走 `ctx.activityRegistry` 而非 `classroomService`）。因此 DI 总账里这两个“课堂扩展点”与实际的 activity-ecosystem/lesson-engine 之间是**契约先行、实现分叉**：插件通过 token 注册的东西，不一定进入真正的活动调度链。这是插件开发者最容易踩的坑，也应在文档中显式注明“注册 ≠ 可被 start”。

---

## 六、第 5 组：补充探查

### 6.1 `server/routes/classroom.ts` 章节分布（来源：grep `───`，CodeGraph 不覆盖章节目录）

| 行号 | 章节 |
|---|---|
| 91 | 课堂倒计时管理 |
| 340 | Action descriptor |
| 454 | 1. 课堂会话与生命周期阶段 |
| 1072 | 2. 课堂口播极速投票 (Quick Poll) |
| 1246 | 2.5 课堂随堂测评与考试 |
| 1363 | 3. 毫秒级竞技抢答器 (Buzzer) |
| 1554 | 4. 听懂反馈晴雨表 (Pacing Signal) |
| 1713 | 5. 结课通票 (Exit Ticket) |
| 1931 | 6. 大屏公开脱敏数据接口 (Stage Display) |
| 2089/2109/2134 | 课堂动态流 / 互动课件参与 / 结课通票人数（子块） |
| 2203 | 7. 全景课堂学情简报 |
| 2300 | 逐生真实明细（子块） |
| 2459 | 8. 实时课堂情绪与参与度追踪 |

（`/checkin` 位于第 1 章之后、990-1068 行，未单独成章。）

### 6.2 三套扩展机制的直接 import 关系（CodeGraph `node -f` + `callers` 复核）

- `contribution-registry` → `extension-points`（`warnDeprecation`）✅；`codegraph node -f contribution-registry.ts` → used by 16 files
- `context-builder` / `event-bus` / `command-bus` → `extension-points` ✅；`codegraph node -f metadata.ts` → used by 6 files
- `unified-extension-registry` → 仅 `integration-types`、`version`；**不 import `extension-points`、`contribution-registry`、`hooks-system`** ❌；`codegraph node -f` → used by 7（3 生产装配 + 4 测试），无 `contribution-registry` 边
- `hooks-system` → 仅 `classroom-runtime/types`；**`codegraph node -f` → used by 1（`classroom-runtime/kernel.ts`）** ❌
- `lesson-engine/activity-registry` → `lesson-engine/types` + `lesson-runtime`（前端）；`codegraph node -f` → used by 2（test + `lesson-runtime.ts`）
- `activity-ecosystem/registry` → `codegraph node -f` → used by 13（`server.ts`、`server/context.ts`、`server/routes/os.ts`、`default-providers.ts`、前端 service + 测试）；与 `lesson-engine` 无相互 import

结论：**三套扩展机制之间不存在调用/包装关系，是完全并行的孤岛。**

进一步看“谁真正决定插件能扩展什么”：manifest 的 slot（`contribution-registry` + `esm-loader/manifest-schema.ts`）决定前端能渲染哪些贡献点；activity-ecosystem 决定活动 provider 能否被 start；`hooks-system` 决定课堂内核在 `beforeLessonStart`/`afterLessonStart` 时能插入什么。三者服务对象不同、装配时机不同，因此“合并成一套”并不现实；现实目标是让它们共享同一份 id/生命周期声明，至少让插件作者在一处声明、三处可查。当前的 `extension-points/metadata.ts` 本可承担这个“声明中枢”，但它只登记弃用状态，不登记真实 slot/provider 清单，也未与 manifest schema 自动对齐（`manifest-schema.ts:34` 的注释要求“新增 slot 时请同步”，属人工约定）。这是扩展体系最大的结构性债：**声明、装配、运行时三张表靠人工同步**。

### 6.3 活动相关表名

> `find_db_tables` / `find_db_writers` 不可用（CodeGraph CLI v1.6.0 未提供 DB 图子命令）。以下来自 `migrations/schema-golden.json` 与 SQL grep。

| 表 | 写入方（grep） | 用途 |
|---|---|---|
| `lesson_activities` | `server/routes/lesson-activities.ts`（INSERT/UPDATE/DELETE） | 学案活动定义 |
| `lesson_activity_blocks` | 同上 | 学案首页块 |
| `activity_progress` | 同上（学生自报 + 教师 verify） | 活动进度/批阅 |
| `attendance` | `classroom.ts /checkin` upsert | 排课出勤 |
| `lesson_checkins` | `segment-gate-service.recordCheckin` upsert | 课堂签到 |
| `classroom_sessions` | `ClassroomRuntimeService.getOrCreateSession`（推断）/ `classroom.ts` 查询 | 课堂会话（含 `checkin_code`） |

补充观察：`activity_progress` 的写入方只有 `lesson-activities.ts`，activity-ecosystem 的 provider 生命周期**不落任何活动表**——`startActivity` 的 `StartActivityResult` 只回给 HTTP 响应，状态留在内存 provider 实例（`p.state`/`p.startedAt`），进程重启即丢失。这意味着“活动中心”的运行中列表无法跨重启恢复，也无法与学案进度做 join。`attendance` 与 `lesson_checkins` 则是双写：`/checkin` 先 upsert `attendance`，再经 `segmentGateService.recordCheckin` upsert `lesson_checkins`，两表语义重叠但消费方不同（报表读 attendance、门禁读 lesson_checkins），属“有意的双轨”，需在文档中保留说明，避免后续误删其一。

### 6.4 `http-router.ts` / `public-routes.ts` 公开签名（`Read`）

`PluginHttpRouter implements IPluginHttpRouter`：
- `route(method, path, handler, options?)`
- `get/post/put/patch/delete(path, handler, options?)`
- `stream(path, handler)` / `stream(method, path, handler)`
- `handle(req: PluginApiRequest): Promise<PluginApiResponse>`
- `handleStream(req, stream)`
- 类型：`PluginRouteScope = 'authenticated'|'self'|'class-member'|'class-staff'|'admin'`、`PluginRouteOptions`、`PluginHttpRouterOptions`
- 私有：`warnIfUnscoped`、`registerStream`；导出工具 `compileRoutePattern`

`public-routes.ts`（函数式，无类）：
- `ensurePublicRouteTable(db)`
- `declaredPublicRoutes(manifest)`
- `approveDeclaredPublicRoutes(db, pluginKeys, manifest)`
- `clearPublicRouteApprovals(db, pluginKeys)`
- `isPublicRouteApproved(...)`
- 类型：`PublicRouteRef`

---

## 七、冲突与重复清单（按优先级）

1. **`/api/activities/:id` 语义分裂（高）**：`os.ts` 的 `:id` = activity-ecosystem provider id（内存、生命周期）；`lesson-activities.ts` 的 `:id` = `lesson_activities.id`（DB 行）。同一前缀、不同主键、不同存储，调用方极易误用。
2. **`/api/activities/:id/start` 无对应学案活动概念（高）**：学案活动没有 start/pause/finish 端点，前端若按 provider 语义调用会 404/行为不符。
3. **`unified-extension-registry` 空壳（中）**：被 kernel 实例化并注册 DI，但 `registerExtension` 只由零调用的 `sync*` 触发，`listExtensions()` 恒空；且自声明 deprecated。任何依赖它的“统一枚举”都会得到空结果。
4. **`extension-points` 名不副实（中）**：名字像运行时扩展注册表，实际只是弃用元数据 + `warnDeprecation`；不能用于发现扩展。
5. **Presence 四实现并存（高）**：Socket 内存态、`/checkin` DB 写入、`attendance`/`lesson_checkins` 历史表、presence-engine 内存 store；`getPresentStudentIds` 只认第一套，签到成功不一定立即改变“在场”口径。
6. **`IPresenceEngineServiceToken` 注册但无 resolve（中）**：kernel 注册 `getPresenceEngine`，生产无消费者，属“已接线未使用”。
7. **两套活动抽象（中）**：`ActivityProvider`（initialize/start/pause/resume/finish/dispose + capability）与 `QuickActivityDescriptor`（仅元数据）并存，插件开发者难以判断该注册哪一套。

严重度理由：第 1、2、5 条会直接导致“调用到错误对象/错误存储”，属于可复现的功能缺陷来源；第 3、4、6 条是“看起来有、实际为空/未消费”的认知陷阱，影响扩展开发者与后续重构判断；第 7 条是文档/抽象层面的歧义，短期不炸但会持续制造新分叉。需要强调：以上均为静态分析（CodeGraph + Read），未做运行时验证。CodeGraph 已确认 `syncActivityRegistry` 仅测试调用、`syncContributionRegistry` 的 install.ts 两处是私有同名方法（`install.ts:1008`），故“统一层恒空”为高置信度结论；若要排除动态装配，仍需以运行日志/DI resolve 记录佐证。

## 八、建议（不改代码，仅方向）

- 明确唯一活动主键：为学案活动与 provider 活动引入命名空间（如 `/api/lesson-activities/:id` 与 `/api/activity-providers/:id`），消除 `/api/activities/:id` 歧义。
- 要么让 `UnifiedExtensionRegistry` 真正在 `install/uninstall` 时被 `syncContributionRegistry`/`syncActivityRegistry` 调用并移除 `@deprecated`，要么删除该 DI 注册，避免“统一层恒空”。
- 将 `extension-points` 重命名/注释为“deprecation ledger”，避免被误当扩展发现入口。
- Presence 先做适配层：Socket 事件写入 `PresenceStore`，`getPresentStudentIds` 改为读 engine；`attendance`/`lesson_checkins` 作为持久化事实保留，`/checkin` 成功后同步 engine。
- 合并 `QuickActivityDescriptor` 与 `ActivityProviderDescriptor` 的元数据字段，或明确前者仅用于课堂旧协议、后者用于 ecosystem。

---

## 九、CodeGraph 复核总表（v2 新增）

> 索引：`codegraph init -y` → 1,861 files / 22,635 nodes / 91,775 edges。下表每条首版结论都给出复核子命令与判定。

| # | 首版结论 | CodeGraph 复核命令 | 复核结果 |
|---|---|---|---|
| 1 | unified registry 生产零读取方 | `codegraph node -f packages/core/plugin-host/unified-extension-registry.ts --symbols-only` | **成立**：used by 7，其中 3 生产均为装配（index/DI/kernel），4 为测试；`callers registerExtension` 仅自身 sync + 2 测试 |
| 2 | unified 的 sync 零生产调用 | `codegraph callers syncContributionRegistry` / `syncActivityRegistry` | **成立（需消歧）**：`syncActivityRegistry` 仅 1 测试；`syncContributionRegistry` 4 个中 2 个是 installer 私有同名方法（`install.ts:1008`，body 用 `this.contributionRegistry`），2 个测试 |
| 3 | extension-points 不被 unified 消费 | `codegraph node -f extension-points/index.ts` + `metadata.ts` | **成立**：index barrel 报 0 dependents；`metadata.ts` used by 6，全部只取 `warnDeprecation`，无 unified |
| 4 | hooks-system 与 unified 并列 | `codegraph node -f classroom-runtime/hooks-system.ts` | **成立**：used by 1（`classroom-runtime/kernel.ts`），与 plugin-host 无交集 |
| 5 | lesson-engine registry 仅前端 | `codegraph node -f lesson-engine/activity-registry.ts` | **成立**：used by 2（test + `lesson-runtime.ts`） |
| 6 | `/api/activities/*` 调 activity-ecosystem | `codegraph callers startActivity` | **成立**：`POST /api/activities/:id/start`@`os.ts:220`、`ActivityWorkspaceWidget.tsx:99`、`registerOsRoutes`、测试 |
| 7 | 学案活动与 os 活动不同源 | `codegraph impact registerLessonActivitiesRoutes` | **成立**：仅 `server.ts:startServer` + 测试；file-mode 的 20 files 为私有符号碰撞过报 |
| 8 | presence-engine 未接入生产 | `codegraph node -f presence-manager.ts` / `kernel.ts` | **成立**：manager used by 7 全部在 presence-engine 内；kernel used by 2（kernel/index + test） |
| 9 | getPresentStudentIds 仅 legacy socket | `codegraph callers getPresentStudentIds` | **成立**：`registerRosterRoutes`、`GET /api/classes/:classId/picker-candidates`、`listSessions` + 测试，无 presence-engine 边 |
| 10 | 两个课堂 DI 服务被插件包裹 | `codegraph callers transitionStage` / `registerActivityProvider` | **补充**：`wrapClassroomLifecycleService`/`wrapInteractionRuntimeService`（`context-builder.ts:629/664`）确实包裹；但 `registerActivityProvider` 未被 `/api/activities/:id/start` 消费 |

复核未推翻任何首版核心判断，但补充了两点：①`registerActivityProvider` 在插件上下文中有生产包装（停用回收路径），不是完全死代码；②CodeGraph 的 barrel / 同名方法 / file-mode 依赖三种失真必须在引用时人工消歧，不能盲信单一数字。

---

## 附录：证据命令（可复现）

```bash
# 0) 建索引 / 状态（v1.6.0）
codegraph init -y
codegraph status

# 1) 文件级 dependents（barrel 需人工消歧）
codegraph node -f packages/core/plugin-host/unified-extension-registry.ts --symbols-only
codegraph node -f packages/core/plugin-host/contribution-registry.ts --symbols-only
codegraph node -f packages/core/extension-points/index.ts
codegraph node -f packages/core/extension-points/metadata.ts --symbols-only
codegraph node -f packages/core/classroom-runtime/hooks-system.ts --symbols-only
codegraph node -f packages/core/lesson-engine/activity-registry.ts --symbols-only
codegraph node -f packages/activity-ecosystem/registry.ts --symbols-only
codegraph node -f packages/core/presence-engine/presence-manager.ts --symbols-only
codegraph node -f server/presence.ts --symbols-only

# 2) 调用边（关键复核）
codegraph callers syncContributionRegistry
codegraph callers syncActivityRegistry
codegraph callers registerExtension
codegraph callers startActivity
codegraph callers getPresentStudentIds
codegraph callers registerLessonActivitiesRoutes
codegraph callers transitionStage
codegraph callers registerActivityProvider

# 3) 影响面
codegraph impact registerLessonActivitiesRoutes

# 4) 符号检索
codegraph query ActivityRegistry -l 10

# 5) DB 图无对应子命令，退回迁移 + SQL grep
grep -n "lesson_activities\|activity_progress\|attendance\|lesson_checkins" migrations/schema-golden.json
```
