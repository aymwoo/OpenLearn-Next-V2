# 能力权限矩阵全集 (Capabilities Permission Matrix)

<!-- doc-version: sdk=3.7.5 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.5`
> 本页是插件声明与校验 `resource:action` 权限的**唯一权威字典**，用于避免 AI 捏造权限名导致 `Access Denied`。
>
> **关键事实**：代码库中存在**四套互不相干的 "capability" 机制**，请勿混淆：
>
> | #   | 机制                   | 载体                                                                                  | 鉴权维度                                     | 拒绝信号                                                                                             |
> | --- | ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
> | 1   | **字符串权限 / RBAC**  | `CapabilityGuard`（`packages/core/capability-system/index.ts`）                       | `resource:action` 字符串                     | `[CapabilityGuard] Access Denied: ...`，`err.status = 403`，`err.code = 'COMMAND_CAPABILITY_DENIED'` |
> | 2   | **课堂运行时角色权限** | `RuntimePermissionManager`（`packages/core/classroom-runtime/permission-manager.ts`） | `RuntimePermission` 枚举（7 成员）           | 见 [capability-gateway](../architecture/capability-gateway.md)                                       |
> | 3   | **能力 Provider 框架** | `PermissionChecker`（`packages/core/capability/pipeline/permission-checker.ts`）      | `CapabilityRole` 角色数组（6 成员）          | `Access Denied: Role '<r>' is not authorized for capability '<id>'`                                  |
> | 4   | **AI 功能 ID**         | `packages/core/ai-capability/capabilities/`                                           | `capability_*` 功能 ID（**不是**权限字符串） | —                                                                                                    |
>
> **不存在**名为 `CAPABILITY_DENIED` 的常量。内核在权限拒绝时设置的是错误码字符串 `err.code = 'COMMAND_CAPABILITY_DENIED'`（`packages/core/kernel/index.ts`）；未注册 action descriptor 时则是 `COMMAND_NOT_REGISTERED`。唯一的 `PERMISSION_DENIED` 出现在**活动生态**（`packages/activity-ecosystem/registry.ts` 的 `startActivity`），与本页第 1 套机制无关——详见 §1.3。

---

## 1. 完整权限字符串全集（按模块）

权限字符串**没有**集中的枚举或注册表，它们散落在各 `ActionDescriptor.capabilityRequired` 与 `CapabilityGuard` 的默认授权中。以下为从 `packages/core` / `packages/plugins` / `packages/activity-ecosystem` / `server.ts` 的**非测试源码**中收集到的**每一个真实字符串**。

实测口径（`grep -rh "capabilityRequired: *'" --include=*.ts`，排除 `__tests__` 与 `node_modules`）：

- **20 个**不同权限字符串：其中 **19 个**用作 `ActionDescriptor.capabilityRequired`（`packages/plugins/*.ts` 口径），另一个是 `server/services/segment-gate-service.ts` 的 `GATE_CAPABILITY` 常量 `segment:gate_eval`
- `capabilityRequired` 在生产源码中约 **100 处**引用（`grep -rn capabilityRequired` 排除 `__tests__` / `.test.`），随代码增长，不必精确到个位
- `segment:gate_eval` **不是** `ActionDescriptor.capabilityRequired`；SDK 注释里建议片段命令同时声明它，见 §1.1 的口径说明

### 1.1 作为 `capabilityRequired` 使用的 19 个字符串（当前实测；逐项以 `grep -rn capabilityRequired` 为准）

> 口径说明：下表是 `packages/plugins/*.ts` 里**真被用作 `capabilityRequired`** 的字符串
> （`grep -rn "capabilityRequired" packages/plugins/*.ts` 去重后 **19** 个）。
> `quiz:write` **不在其中** —— 它只出现在 `CapabilityGuard` 的预置 actor（见 §1.5）与活动生态的
> `permissions` 里，全仓没有任何 `capabilityRequired: 'quiz:write'`，声明它拿不到任何约束力。

| 权限                | 声明处数 | 声明文件                                                        | 绑定的命令类型（全部）                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `management:write`  | 24       | `packages/plugins/builtin.ts`、`packages/plugins/management.ts` | `user.create`、`user.update`、`user.delete`(高危)；`class.create`、`student.create`、`class.add_student`、`class.update`、`class.delete`、`student.update`、`student.delete`、`class.remove_student`、`class.template_download`、`student.template_download`、`student.add_note`、`assignment.create`、`assignment.submit`、`assignment.grade`、`schedule.create`、`attendance.record`、`student.set_progress`、`lab.create`、`lab.assign_seat`、`schedule.cancel` |
| `lesson:write`      | 11       | `packages/plugins/builtin.ts`、`packages/plugins/ai-planner.ts` | `lesson.create`、`lesson.update`、`lesson.update_timeline`、`lesson.add_segment`、`lesson.remove_segment`；`courseware.upload`、`courseware.confirm`、`courseware.save_score_config`、`courseware.regrade_attempts`、`courseware.delete`；`ai.apply_recommendation`(高危)                                                                                                                                                                                          |
| `whiteboard:write`  | 9        | `packages/plugins/builtin.ts`                                   | `whiteboard.draw`、`whiteboard.update`、`whiteboard.delete`、`whiteboard.clear`、`whiteboard.batch_draw`、`whiteboard.duplicate`                                                                                                                                                                                                                                                                                                                                   |
| `management:read`   | 6        | `packages/plugins/builtin.ts`、`packages/plugins/management.ts` | `user.list`；`class.list`、`student.list`、`class.get_students`、`lab.list`、`schedule.list`                                                                                                                                                                                                                                                                                                                                                                       |
| `plugin:write`      | 5        | `packages/plugins/builtin.ts`                                   | `plugin.install`(高危)、`plugin.install_zip`(高危)、`plugin.update_zip`(高危)、`plugin.toggle`(高危)、`plugin.uninstall`(高危)                                                                                                                                                                                                                                                                                                                                     |
| `lesson:read`       | 4        | `packages/plugins/builtin.ts`                                   | `courseware.get_score_config`、`courseware.list_score_configs`、`courseware.get_attempt_raw_data`、`courseware.list`                                                                                                                                                                                                                                                                                                                                               |
| `vfs:write`         | 3        | `packages/plugins/vfs.ts`                                       | `vfs.write_file`、`vfs.mkdir`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `process:write`     | 3        | `packages/plugins/process.ts`、`packages/plugins/ai-planner.ts` | `process.spawn`、`process.kill`；`ai.start_generation`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `assignment:manage` | 3        | `packages/plugins/assignment-eval.ts`                           | `assignment.create`、`assignment.assign_peer_reviews`、`assignment.grade`                                                                                                                                                                                                                                                                                                                                                                                          |
| `whiteboard:read`   | 2        | `packages/plugins/builtin.ts`                                   | `whiteboard.query`、`whiteboard.get_element`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `vfs:read`          | 2        | `packages/plugins/vfs.ts`                                       | `vfs.read_file`、`vfs.list_dir`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `process:read`      | 2        | `packages/plugins/process.ts`                                   | `process.list`、`process.logs`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `assignment:read`   | 2        | `packages/plugins/assignment-eval.ts`                           | `assignment.list`、`assignment.get`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `lesson:delete`     | 1        | `packages/plugins/builtin.ts`                                   | `lesson.delete`（高危）                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `plugin:read`       | 1        | `packages/plugins/builtin.ts`                                   | `plugin.info`（显式 `isHighRisk: false`）                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `student:write`     | 1        | `packages/plugins/builtin.ts`                                   | `courseware.submit_attempt`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `assignment:write`  | 1        | `packages/plugins/ai-planner.ts`                                | `ai.apply_grade`（高危）                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `assignment:submit` | 1        | `packages/plugins/assignment-eval.ts`                           | `assignment.submit`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `assignment:review` | 1        | `packages/plugins/assignment-eval.ts`                           | `assignment.peer_review`                                                                                                                                                                                                                                                                                                                                                                                                                                           |

> ⚠️ **同名命令的权限归属不唯一**：`assignment.create` / `assignment.submit` / `assignment.grade` 在 `packages/plugins/management.ts` 中要求 `management:write`，而在 `packages/plugins/assignment-eval.ts` 中分别要求 `assignment:manage` / `assignment:submit` / `assignment:manage`。两处注册的 action id 必须不同，否则 `ActionRegistry.register` 会因 id 重复抛错。插件应同时声明 `management:write` 与 `assignment:*` 以避免落空。

### 1.2 仅出现在 `capabilitiesProposed`、从未作为 `capabilityRequired`

以下 3 个字符串在**内置插件的 manifest** 中被声明，但**任何源码位置都没有把它们用作 `capabilityRequired`**。声明它们无害（多授无害），但不构成实际约束：

| 权限           | 声明位置                                                            |
| -------------- | ------------------------------------------------------------------- |
| `class:read`   | `packages/plugins/management.ts` 的 `manifest.capabilitiesProposed` |
| `class:write`  | 同上                                                                |
| `student:read` | 同上                                                                |

> 因此**不存在** `class:*` 这个权限模块。`packages/plugins/management.ts` 的所有读写动作实际用的是 `management:read` / `management:write`。

`packages/plugins/ai-submit-injector.ts` 的 `capabilitiesProposed` 是**空数组** `[]`——该插件不声明任何权限。

### 1.3 第 2 套机制：`RuntimePermission`（与 `capabilityRequired` 无关）

`packages/core/classroom-runtime/types.ts` 的 `RuntimePermission` 是一个**独立的 7 成员联合类型**，与 `CapabilityGuard` 无关：

```typescript
export type RuntimeRole = 'Teacher' | 'Assistant' | 'Student' | 'Observer' | 'Plugin' | 'AI';

export type RuntimePermission =
  | 'lesson:control'
  | 'stage:navigate'
  | 'whiteboard:draw'
  | 'quiz:submit'
  | 'plugin:execute'
  | 'ai:invoke'
  | 'session:manage';
```

⚠️ **`lesson:control` 属于这一套，不是第 1 套。** 它**从未**作为任何 `ActionDescriptor.capabilityRequired` 出现，因此**没有插件能通过 `capabilitiesProposed` 获得它**。

它的实际消费方是活动生态：`packages/activity-ecosystem/default-providers.ts` 的 provider descriptor 上声明 `permissions: ['lesson:control']`，`packages/activity-ecosystem/registry.ts` 的 `startActivity(id, context, payload, actorId)` 逐条 `await context.capability.check(actorId, cap)`，**任一条命中即放行**（`some(Boolean)` 语义），全不命中则：

```typescript
const err = new Error(
  `[ActivityPermission] Actor "${actorId}" is missing a required permission ` +
    `(${required.join(', ')}) for activity "${id}".`,
);
(err as Error & { code?: string }).code = 'PERMISSION_DENIED';
throw err;
```

`PERMISSION_DENIED` 由 `server/routes/os.ts` 的 `POST /api/activities/:id/start` 路由捕获并映射为 HTTP **403**（`err?.code === 'PERMISSION_DENIED' ? 403 : 500`）。

> ⚠️ 旧文档称「使用 `IActivityRegistryToken` 的插件必须在 `capabilitiesProposed` 中声明，否则抛 `PERMISSION_DENIED`」——**错误**。检查的是 provider descriptor 的 `permissions` 字段对 `actorId` 的**运行时授权状态**，与 manifest 声明无关。
> ⚠️ 若 `actorId` 为 `undefined`，`startActivity` 的 `if (required.length > 0 && actorId)` 守卫会**跳过整个权限检查**。

### 1.4 通配符与超级管理员绕过

| 权限                  | 说明                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `*:*:*` / `*`         | 超级管理员绕过。`CapabilityGuard` 构造函数给 `user-demo` 预置 `['*:*:*']`；`check()` 的显式授予分支同时接受 `*:*:*` 与 `*`。          |
| `lesson:*` 等部分通配 | `check()` 末段把 `requiredCap` 拆为 `resource:action`，与已授能力逐条比较，`res` 或 `act` 命中 `*` 即通过。                           |
| 管理员 actorId 短路   | `check()` 首段直接放行：`role:administrator`、`admin`、`usr_admin`、`admin-demo`，或 `extractRole` 解析出 `administrator` / `admin`。 |

### 1.5 `CapabilityGuard` 构造函数预置的默认 actor

| actorId          | 预置能力                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user-demo`      | `['*:*:*']`                                                                                                                                                                       |
| `user-frontend`  | `lesson:*`、`whiteboard:*`、`management:*`、`quiz:*`、`vfs:*`、`process:*`、`plugin:*`                                                                                            |
| `anonymous`      | `[]`（无权限）                                                                                                                                                                    |
| `agent-system-0` | `lesson:write`、`lesson:delete`、`whiteboard:write`、`quiz:write`、`plugin:read`、`vfs:read`、`vfs:write`、`management:write`、`management:read`、`process:write`、`process:read` |
| `teacher-demo`   | `lesson:*`、`whiteboard:*`、`management:*`、`quiz:*`、`vfs:*`                                                                                                                     |
| `student-demo`   | `student:write`、`lesson:read`、`whiteboard:read`                                                                                                                                 |

此外 `check()` 内还有两张**角色兜底表**（对 `extractRole` 解析出 `teacher` / `student` 的任意 `actorId` 生效，硬编码在 `check` 方法体中，**不是**构造函数的预置表）：

- `teacher` → `lesson:*`、`whiteboard:*`、`management:*`、`quiz:*`、`vfs:*`、`process:*`、`plugin:*`、`student:write`、`assignment:read`、`assignment:submit`、`assignment:review`、`assignment:manage`
- `student` → `student:write`、`lesson:read`、`whiteboard:read`、`assignment:read`、`assignment:submit`、`assignment:review`

> `agent-system-0` 预置了 `quiz:write`，但**全仓库没有任何 `capabilityRequired: 'quiz:write'`**——该授权实际未被任何命令消费。
> 学生兜底表**刻意不含** `lesson:write`（避免学生改课时内容）；`assignment:submit` / `assignment:review` 是学生发起作业写入的唯一入口。

---

## 2. ⚠️ 不存在的权限模块（切勿捏造）

以下常被误以为存在的权限字符串**在源码中并不存在**：

- **`user:*`** —— 不存在。用户操作（`user.list` / `user.create` / `user.update` / `user.delete`）由 `management:read` / `management:write` 把关。
- **`system:*`** —— 不存在。`System` 仅作为第 3 套机制（Provider 框架）的 `CapabilityRole` 成员出现。
- **`courseware:*`** —— 不存在。课件命令由 `lesson:read` / `lesson:write`（教师侧）与 `student:write`（`courseware.submit_attempt`）覆盖。
- **`classroom:*`** —— 不存在。也没有 `class:*`（见 §1.2）。
- **`analytics:*`** —— 不存在。唯一的 "analytics 能力" 是第 3 套机制的 descriptor id `cap_analytics_insight`。
- **`ai:*`** —— 不存在。AI 层使用 `capability_*` ID（`packages/core/ai-capability/capabilities/` 下实测 7 个：`capability_analytics`、`capability_chat`、`capability_completion`、`capability_lesson`、`capability_plugin`、`capability_tool`、`capability_whiteboard`），而非 `ai:read` / `ai:write`。
- **`lesson:control` / `stage:navigate` / `whiteboard:draw` / `quiz:submit` / `plugin:execute` / `ai:invoke` / `session:manage`** —— 属于第 2 套 `RuntimePermission`（见 §1.3），**不是** `capabilityRequired` 字符串。
- **`storage:write`** —— 仅出现在 `packages/core/__tests__/plugin-http-streaming.test.ts` 的测试 manifest 中，生产代码无任何消费点。
- **`network:*` / `net:*`** —— 不存在。出站网络访问不属于 `resource:action` 字符串机制，而是由独立的 `plugin_network_grants` 域名白名单与 manifest `network.outbound` 共同管控，并由宿主代发执行（详见 [信任边界矩阵](./plugin-trust-boundary.md)）。

---

## 3. 插件如何声明权限

声明**仅通过 manifest 字段 `capabilitiesProposed: string[]`**，运行期没有单独的 ctx API 用来声明权限。

| 位置               | 符号                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SDK 类型           | `packages/plugin-sdk/openlearn.d.ts` 的 `Manifest.capabilitiesProposed?: string[]`                                                        |
| Zod Schema（权威） | `packages/core/esm-loader/manifest-schema.ts` 的 `capabilitiesProposed: z.array(z.string()).optional()`（在两个 schema 分支中各出现一次） |
| 消费侧             | `packages/core/registry/index.ts` 的 `ActionDescriptor.capabilityRequired: string`（必填）                                                |

内置插件的真实 manifest 声明（`packages/plugins/*.ts` 的 `manifest.capabilitiesProposed`）：

```json
// builtin.ts
["lesson:read", "lesson:write", "whiteboard:read", "whiteboard:write"]
// vfs.ts
["vfs:read", "vfs:write"]
// process.ts
["process:read", "process:write"]
// management.ts
["class:read", "class:write", "student:read", "student:write"]
// ai-planner.ts
["process:write", "lesson:write", "assignment:write"]
// assignment-eval.ts
["assignment:read", "assignment:submit", "assignment:review", "assignment:manage"]
// ai-submit-injector.ts
[]
```

**激活期授予**：`packages/core/plugin-host/lifecycle.ts` 的 `grantCapabilities()` 在构建 context 之后、进入激活管道之前，按 `mergedManifest.capabilitiesProposed` 逐项授予；`actorId` 为 `plugin:${manifest.id}`。ESM（`process` / `worker`）、preloaded 两条路径都会调用它（`activateWorker()` 内也有一处）。

授予规则：

- **官方 / 可信插件**（`isTrustedInProcessPlugin(manifest.id, env, file_path)`）自动授予所有**非通配**能力；
- **第三方插件**只授予管理员已写入 `plugin_capability_grants` 表的项（`plugin-grants.ts` 的 `isCapabilityApproved()`，按 `plugin_key` 匹配 `plugins` 行 UUID 或 `manifest.id`）；
- 未获批准的项**不会导致激活失败**，只会 `console.warn('[PluginHost] Capability "..." awaits administrator approval')` 并跳过；
- `*` / `*:*` / `*:*:*` 永远拒绝授予；
- 只有 `capService.grant()` 本身抛错时才会 rethrow 中止激活。

因此：**清单里的 `capabilitiesProposed` 只是申请，不是授权**。第三方插件安装在管理员审批页确认之前，相关命令会因缺少能力而被内核拒绝。

插件运行期可通过 `ctx.capability`（`packages/core/plugin-host/context-builder.ts` 的 `wrapCapability` 包装 `ICapabilityService`）调用 `grant` / `revokeAll` / `check`，但这是**运行期授权/校验**，**不是**声明新权限。

> Worker 模式另有独立的门禁：`packages/core/worker-runtime/service-host.ts` 的 `ServiceHost` 持有 `manifestCapabilities`（同样来自 `capabilitiesProposed`）。当该数组为**空**时，除 `get` 之外的所有 RPC 方法都会被拒绝（抛 `empty manifestCapabilities, only 'get' methods allowed`）。这是 Token 白名单，与 §1 的 `resource:action` 权限是两件事。

---

## 4. 高危权限与动态审批

> **重要**：「高危」**不是权限字符串的属性**，而是**命令动作**的属性——`packages/core/registry/index.ts` 的 `ActionDescriptor.isHighRisk?: boolean`。

实测全仓库（`packages/core`、`packages/plugins`、`src/`、`server.ts`，排除 `node_modules`）共 **9 处** `isHighRisk: true`，以及 **1 处**显式 `isHighRisk: false`：

| 命令类型                  | 所需权限           | 声明位置                         | 高危            |
| ------------------------- | ------------------ | -------------------------------- | --------------- |
| `lesson.delete`           | `lesson:delete`    | `packages/plugins/builtin.ts`    | ✅              |
| `plugin.install`          | `plugin:write`     | `packages/plugins/builtin.ts`    | ✅              |
| `plugin.install_zip`      | `plugin:write`     | `packages/plugins/builtin.ts`    | ✅              |
| `plugin.update_zip`       | `plugin:write`     | `packages/plugins/builtin.ts`    | ✅              |
| `plugin.toggle`           | `plugin:write`     | `packages/plugins/builtin.ts`    | ✅              |
| `plugin.uninstall`        | `plugin:write`     | `packages/plugins/builtin.ts`    | ✅              |
| `user.delete`             | `management:write` | `packages/plugins/builtin.ts`    | ✅              |
| `ai.apply_recommendation` | `lesson:write`     | `packages/plugins/ai-planner.ts` | ✅              |
| `ai.apply_grade`          | `assignment:write` | `packages/plugins/ai-planner.ts` | ✅              |
| `plugin.info`             | `plugin:read`      | `packages/plugins/builtin.ts`    | ❌ 显式 `false` |

> `plugin.update_zip` 是旧文档**遗漏**的高危动作。

**决策逻辑**（`packages/core/kernel/index.ts` 的 `commandBus.setInterceptor` 回调）：

```typescript
const pluginSuppliedApproval = command.actorId.startsWith('plugin:');
if (action.isHighRisk && (command.metadata?.approved !== true || pluginSuppliedApproval)) {
  if (isAdmin && !pluginSuppliedApproval) {
    // 管理员直接绕过人工审批（仅 console.log 记录）
  } else {
    // INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at)
    // eventBus.publish({ type: 'approval.requested', source: 'kernel.security', ... })
    throw new Error(
      `[Security] Command ${command.type} requires human approval. It has been queued to pending actions.`,
    );
  }
}
```

即：非管理员、或 actor 以 `plugin:` 开头（即使 `metadata.approved === true`），高危动作都会被写入 `pending_commands` 表、发布 `approval.requested` 事件并抛出异常；只有非插件 actor 的管理员能直接绕过队列。插件 actor **不能**自己带 `metadata.approved` 跳过人工审批。

拦截器内 `isAdmin` 的判定（`packages/core/kernel/index.ts` 内联，非委托 `CapabilityGuard`）：

```typescript
const isAdmin =
  command.actorId === 'role:administrator' ||
  command.actorId === 'admin' ||
  command.actorId === 'usr_admin' ||
  command.actorId === 'admin-demo' ||
  (command.actorId.startsWith('user:') &&
    (command.actorId.endsWith(':administrator') || command.actorId.endsWith(':admin')));
```

> 注意此处只对 `user:` 前缀的 actor 做角色尾段判定（v0.6.1 起）；`plugin:` 等其他前缀一律走能力表。`CapabilityGuard.check` 则用白名单角色解析 `extractRole`，两者判定口径不同。

---

## 5. 校验流程（缺失权限时发生什么）

### 主路径：`resource:action` 权限检查

位置：`packages/core/kernel/index.ts` 的 `commandBus.setInterceptor` 回调（在 `isHighRisk` 判定**之前**执行）。

```typescript
if (action.capabilityRequired && !isAdmin) {
  const allowed = this.capabilityGuard.check(command.actorId, action.capabilityRequired);
  if (!allowed) {
    const err = new Error(
      `[CapabilityGuard] Access Denied: Actor ${command.actorId} missing capability ${action.capabilityRequired} for ${command.type}`,
    ) as any;
    err.status = 403;
    err.code = 'COMMAND_CAPABILITY_DENIED';
    throw err;
  }
}
```

拦截器在权限检查**之前**还有一步 JSON Schema 校验：若 `action.inputSchema` 存在，用 `validateJsonSchema(command.payload, action.inputSchema)` 校验 payload，失败抛 `[PayloadValidationError] Invalid command payload for <type>: <errors>`。该函数是 `packages/core/kernel/index.ts` 内的模块级递归校验器，只处理 `OBJECT`（含 `required` / `properties` 递归）、`ARRAY`、`STRING`、`NUMBER`、`BOOLEAN` 五种 `type`；**其他 `type` 值（如 `GENERIC`）或缺省 `type` 一律返回 `[]` 即放行**。

- 拦截器是**默认拒绝**的：`actionRegistry.getActionByCommandType(command.type)` 查不到 action descriptor 时直接抛 `COMMAND_NOT_REGISTERED`（`err.status = 403`）。插件只调 `commandBus.registerHandler()` 而不注册 `ActionDescriptor` 的命令无法派发。
- 因宿主只为已批准（或官方自动授予）的 `capabilitiesProposed` 授予字符串，未声明的 `capabilityRequired` 必然在此处 `Access Denied`。
- 管理员 actor 跳过能力检查；`plugin:` 前缀的 actor 永远不会被 `isAdmin` 匹配，也无法用 `metadata.approved` 绕过高危审批（见下节代码）。

### 副路径：Provider 框架按角色鉴权

位置：`packages/core/capability/pipeline/capability-pipeline.ts` 的 `executePipeline` 第 3 步。

```typescript
const hasPermission = PermissionChecker.validatePermission(desc, request.context.actorRole);
// CapabilityRole: Teacher | Student | Plugin | AI | Observer | System
```

每个 descriptor 携带 `permission: CapabilityRole[]`（而非 `resource:action` 字符串）。`PermissionChecker.validatePermission` 在 `permission` 为空数组、或 `actorRole === 'System'` 时放行，否则精确匹配，**无层级继承**。详见 [capability-gateway](../architecture/capability-gateway.md)。

### 5.3 学生个人数据隐私与安全审计能力声明（Issue #145）

平台在 `packages/core/plugin-host/method-policy.ts` 中引入了两项专用的学生个人数据能力常量：

- `CAP_STUDENT_DATA_READ = 'student-data:read'`：声明插件有权读取学生个人数据（如通过 `pointsLedger` 访问积分日志、统计与维度汇总）。
- `CAP_STUDENT_DATA_WRITE = 'student-data:write'`：声明插件有权写入或修改学生个人数据（如通过 `pointsLedger.addPoints` 记录积分）。

**审计与迁移策略**：

1. **双端统一审计**：Inline 模式下的上下文代理包装器与 Worker 隔离模式下的 `ServiceHost` RPC 拦截器均对学生数据读写调用进行统一拦截，记录 `plugin.student_data_access` 安全审计日志。
2. **渐进迁移兼容期**：对于尚未声明该能力的存量插件，当前版本在控制台输出警告并放行，在审计记录中标记 `migrationWarning: true`；待升级周期结束后将强制阻断未声明能力的插件访问。

---

## 6. 统计口径

- `capabilityRequired` 不同的权限字符串：**20** 个（2026-10-25 实测，新增 `segment:gate_eval`）。
- 专有学生数据能力声明（隐私审计）：**2** 个（`student-data:read` / `student-data:write`）。
- `capabilityRequired` 声明点（后端非测试源码）：**101** 行（2026-10-25 实测）。
- `isHighRisk: true`：**9** 处；显式 `isHighRisk: false`：**1** 处（`plugin.info`）。
- `CapabilityGuard` 构造函数预置默认 actor：**6** 个；`check()` 内角色兜底表：**2** 张（`teacher` / `student`）。
- `RuntimePermission` 成员：**7** 个；`CapabilityRole` 成员：**6** 个。
- 内置插件 manifest 中 `capabilitiesProposed` 声明：**7** 个插件，其中 1 个为空数组。

> 统计更新至 Issue #145 学生个人数据能力声明与审计策略落地。
