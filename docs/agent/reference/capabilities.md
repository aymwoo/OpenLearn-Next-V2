# 权限与授权（能力 / 高危审批 / Agent 暴露）

> **权威源码**：`packages/core/kernel/index.ts`（`commandBus.setInterceptor`）、
> `packages/core/registry/index.ts`（`ActionDescriptor` / `ActionRegistry`）、
> `packages/core/capability/guard/capability-guard.ts`（`CapabilityGuard.check`）、
> `packages/core/plugin-host/plugin-grants.ts`（批准表）、
> `packages/core/plugin-host/method-policy.ts`（方法级策略）、
> `packages/core/plugin-host/context-builder.ts`（`wrap*`）、
> `server/routes/plugins.ts` + `server.ts`（`/api/approvals`）

字符串常量的完整清单在 {doc}`token-reference`；本页讲**判定过程**：
一次命令到底怎么被放行、被拒绝、或被塞进审批队列。

---

## 0. 三条正交的轴

```{important}
`ActionDescriptor` 上有三个字段常被当成一个：

| 字段 | 管什么 | 不管什么 |
| --- | --- | --- |
| `capabilityRequired` | 谁能执行（能力表） | 不影响审批、不影响 AI 工具箱 |
| `isHighRisk` | 是否需要**人工审批** | 不影响是否出现在 AI 工具箱 |
| `exposeToAgent` | 是否进入 `getAgentTools()` | 不影响鉴权与审批 |

源码注释原文（`registry/index.ts`）：

> 与 `isHighRisk` 正交，不可互相替代：`isHighRisk` 只决定是否需要人工审批，
> **不影响是否出现在 AI 工具箱**；`exposeToAgent` 只决定是否出现在 AI 工具箱，
> **不影响鉴权与审批**。

典型用例也是原文给的：`courseware.save_score_config` 会改写成绩计算规则
（满分/权重/多次尝试取哪次），这类命令不应交给 agent 自主决策 ——
注意它的处理方式是 `exposeToAgent: false`，**不是** `isHighRisk: true`。
```

---

## 1. 一次命令派发的完整管线

```
commandBus.execute(cmd)
  └─ setInterceptor 回调（packages/core/kernel/index.ts）
       1. getActionByCommandType(cmd.type)
            ├─ 找到 ──────────────────────────────┐
            └─ 找不到 → throw 403 COMMAND_NOT_REGISTERED   ← default-deny（审计 H-1）
       2. inputSchema 存在 → validateJsonSchema(payload, schema)
            └─ errors.length > 0 → throw [PayloadValidationError] ...（**无 status，落到 500**）
       3. isAdmin 判定（内联，非委托 CapabilityGuard）
       4. capabilityRequired && !isAdmin
            └─ capabilityGuard.check(actorId, cap) === false
                 → throw 403 COMMAND_CAPABILITY_DENIED
       5. isHighRisk && (metadata.approved !== true || pluginSuppliedApproval)
            ├─ isAdmin && !pluginSuppliedApproval → console.log 绕过
            └─ else → INSERT pending_commands + publish approval.requested
                      + throw [Security] ... requires human approval
```

### 1.1 第 1 步：default-deny

逐字消息：

```
[Security] Command "<type>" has no registered action descriptor and is denied by default. Only commands registered via actionRegistry.register() may be dispatched. If you own this command, register an ActionDescriptor (capabilityRequired + inputSchema).
```

`err.status = 403`、`err.code = 'COMMAND_NOT_REGISTERED'`。

```{danger}
### 只 `registerHandler` 不 `register(descriptor)` 的命令**永远派不了**

审计 H-1 的修复说明原文（要点）：

> 此前 interceptor 写成 `if (action) { ... }` 且**无 else 分支**，等价于 default-allow ——
> 任何只调用 `commandBus.registerHandler()` 而未在 actionRegistry 登记的命令，
> 对任意已登录角色（含 student）都**无任何授权检查**。
> ……
> 修复方式：命令实现方补 `actionRegistry.register()`。
> **不要在此加豁免名单** —— 豁免只是把缺口从「静默」变成「显式且无人复审」。

排查工具也是原文给的：`scripts/plugin-command-audit.mjs` 可列出所有
「有 handler 无 action」的命令（历史上是 5 个 `classroom.countdown.*`）。

插件侧最常见的表现：`activate()` 成功、handler 注册成功、
第一次调用命令就收到 403。这时**不是**能力不足，是**忘注册描述符**。
```

### 1.2 第 2 步：schema 校验只认 5 种 type

```typescript
if (action.inputSchema) {
  const errors = validateJsonSchema(command.payload, action.inputSchema);
  if (errors.length > 0)
    throw new Error(`[PayloadValidationError] Invalid command payload for ${command.type}: ${errors.join('; ')}`);
}
```

```{warning}
`validateJsonSchema` 是 `kernel/index.ts` 内的**模块级递归校验器**，
只处理 `OBJECT`（含 `required` / `properties` 递归）、`ARRAY`、`STRING`、`NUMBER`、`BOOLEAN`
五种 `type`；**其他 `type` 值（如 `GENERIC`）或缺省 `type` 一律返回 `[]` 即放行**。

两个后果：

1. 你写 `type: 'integer'`（JSON Schema 合法，但不在这 5 种里）→ **完全不校验**，
   字符串也会通过。想要整数校验必须写 `type: 'number'` 或自己在校验里挡。
2. 这条错误**没有** `err.status` / `err.code`，会经 `sendSafeError` 默认路径变成 **500**，
   而 403 那两条都刻意带了 `status`（注释：「避免被 `/api/commands` 等路由当作 500 上报
   （前端会误报为服务端崩溃）」）。也就是说：**参数写错比没权限更难从状态码看出来**。
```

### 1.3 第 3 步：`isAdmin` 的两套口径

拦截器内联判定（逐字）：

```typescript
const isAdmin =
  command.actorId === 'role:administrator' ||
  command.actorId === 'admin' ||
  command.actorId === 'usr_admin' ||
  command.actorId === 'admin-demo' ||
  (typeof command.actorId === 'string' &&
    command.actorId.startsWith('user:') &&
    (command.actorId.endsWith(':administrator') || command.actorId.endsWith(':admin')));
```

```{danger}
### v0.6.1 审计 C-3：裸后缀启发式被废除

修复前是 `actorId.endsWith(':admin')`，于是
`plugin:@evil:admin` 这类**可自声明的插件 actor** 被判为管理员 ——
跳过能力检查且高危命令免审批。现在要求**用户形态** actor
（`user:<id>:<role>`，唯一生产者是 `server/middleware/auth.ts` 的 `getActorId`，
userId 已消毒）才允许按角色尾段判定；`plugin:` / 其他前缀一律走能力表。

**且这里的 `isAdmin` 与 `CapabilityGuard.check()` 内部的管理员短路不是同一份代码**：
后者用白名单 + `extractRole` 解析，两者判定口径不同。
不要因为「check 里放行」就假设拦截器也绕过能力检查 —— 拦截器是先算 `isAdmin`
再决定**要不要调用** `check`。

对你的插件意味着：actorId 永远是 `plugin:<manifest.id>`，
**不可能**被判为管理员，也无法靠它跳过任何一道闸。
```

### 1.4 第 4 步：能力拒绝

```
[CapabilityGuard] Access Denied: Actor <actorId> missing capability <cap> for <commandType>
```

`status = 403`、`code = 'COMMAND_CAPABILITY_DENIED'`。
注释明确：「因宿主只为已批准（或官方自动授予）的 `capabilitiesProposed` 授予字符串，
未声明的 `capabilityRequired` 必然在此处 Access Denied」。

---

## 2. 第 5 步：高危动作的人工审批队列

````{danger}
### 插件 actor **不能**自己带 `metadata.approved` 跳过审批

逐字代码：

```typescript
const pluginSuppliedApproval = typeof command.actorId === 'string' && command.actorId.startsWith('plugin:');
if (action.isHighRisk && (command.metadata?.approved !== true || pluginSuppliedApproval)) {
  if (isAdmin && !pluginSuppliedApproval) {
    console.log(`[Security] Command ${command.type} initiated by Administrator (${command.actorId}). Bypassing human approval.`);
  } else {
    stmt.run(command.id, command.type, JSON.stringify(command.payload), command.actorId, Date.now());
    this.eventBus.publish({ id: uuidv7(), type: 'approval.requested', source: 'kernel.security',
      payload: { commandId: command.id, commandType: command.type },
      timestamp: Date.now(), correlationId: command.id });
    throw new Error(`[Security] Command ${command.type} requires human approval. It has been queued to pending actions.`);
  }
}
```

条件里的 `command.metadata?.approved !== true || pluginSuppliedApproval` 是关键：
对 `plugin:` actor，**`approved: true` 被无视**。
`wrapCommandBus` 本来也会把 `metadata.approved` 剥掉（见 {doc}`command-and-event`）。

这条抛出的错误**同样没有 `status`/`code`** → 经 HTTP 层通常是 500。
也就是说「命令进了审批队列」在插件侧看起来像一次崩溃。
正确判法是 `err.message.includes('requires human approval')`。
````

表结构与消费端：

```sql
CREATE TABLE IF NOT EXISTS pending_commands (
  id           TEXT    NOT NULL PRIMARY KEY,
  command_type TEXT    NOT NULL,
  payload      TEXT    NOT NULL,
  actor_id     TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);
```

| REST                              | 行为                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/approvals`              | `requireAuth('administrator')`，`SELECT * FROM pending_commands ORDER BY created_at DESC`                                               |
| `POST /api/approvals/:id/approve` | 重放命令，**actor 换成审批人**                                                                                                          |
| `POST /api/approvals/:id/reject`  | **只是 `DELETE` 该行**，不通知任何插件                                                                                                  |
| 过期                              | `OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS`（默认 `14`，`0` 不删；旧名 `OPENLEARN_PENDING_COMMANDS_RETENTION_DAYS` 作回退，Issue #195） |

````{important}
### 批准后的命令**以审批人身份执行**，不是以你的插件身份

```typescript
const payload = JSON.parse(pending.payload);      // 忽略请求体，SEC-FIX：禁止 payloadOverride 篡改
const approverId = getActorId(req) || 'admin';
const cmd = kernelContainer.commandBus.createCommand(pending.command_type, payload, approverId, { approved: true });
```

三点含义：

1. `payload` 一律取库里的原始值，**审批时不能改参数**；
2. `actor_id` 变成管理员 → 第二次派发时 `isAdmin` 为真，
   **能力检查被整体跳过**，高危闸门也因 `approved: true` 放行；
3. 所以你的命令在队列里被批准后，执行的**不是**插件的能力集。
   想审计「谁真正改了什么」，看的是这条命令的 actor 而不是发起者 ——
   `pending_commands.actor_id` 保留的是**原始发起者**，两处都要查。
````

````{warning}
### `410 APPROVAL_STALE_CLEARED`：批不掉的审批单会被自动删

```typescript
if (isStaleApprovalError(execErr)) {
  db.prepare('DELETE FROM pending_commands WHERE id = ?').run(pending.id);
  return res.status(410).json({ success: false, code: 'APPROVAL_STALE_CLEARED', cleared: true,
    error: `指令 "<type>" 已失效（对应的插件或命令已不存在），该待审批记录已被自动清除。` });
}
```

「确定性失效」= 插件已卸载 / 命令已注销。
对你的插件意味着：**卸载即作废**所有排队中的审批；
重新安装后 id 变了，也不会接回旧单。
````

### 2.1 全仓库 9 个高危动作

| 命令类型                  | 所需权限           | 声明位置                         |
| ------------------------- | ------------------ | -------------------------------- |
| `lesson.delete`           | `lesson:delete`    | `packages/plugins/builtin.ts`    |
| `plugin.install`          | `plugin:write`     | 同上                             |
| `plugin.install_zip`      | `plugin:write`     | 同上                             |
| `plugin.update_zip`       | `plugin:write`     | 同上（旧文档**遗漏**的一条）     |
| `plugin.toggle`           | `plugin:write`     | 同上                             |
| `plugin.uninstall`        | `plugin:write`     | 同上                             |
| `user.delete`             | `management:write` | 同上                             |
| `ai.apply_recommendation` | `lesson:write`     | `packages/plugins/ai-planner.ts` |
| `ai.apply_grade`          | `assignment:write` | 同上                             |

显式 `isHighRisk: false` 只有 1 处：`plugin.info`（`plugin:read`）。

```{note}
「高危」**不是能力字符串的属性，而是命令动作的属性**。
`lesson:delete` 这个名字看着很危险，但危险与否取决于
`ActionDescriptor.isHighRisk`，而不是名字里的动词。
```

---

## 3. `ActionRegistry` 的键与两处静默遮蔽

```typescript
export interface ActionDescriptor {
  readonly id: string;
  readonly commandType: string;
  readonly description: string;
  readonly inputSchema: any; // JSON Schema，直接对齐 GenAI tool parameters
  readonly capabilityRequired: string; // ⚠ 必填，非可选
  readonly isHighRisk?: boolean;
  readonly exposeToAgent?: boolean; // 默认 true
}
```

````{danger}
### 重复 id 抛错，重复 `commandType` **不抛错**

```typescript
public register(descriptor: ActionDescriptor): void {
  if (this.actions.has(descriptor.id)) throw new Error(`Action ${descriptor.id} is already registered.`);
  this.actions.set(descriptor.id, descriptor);
}
public getActionByCommandType(commandType: string) {
  return Array.from(this.actions.values()).find((a) => a.commandType === commandType);
}
```

`actions` 以 **`id`** 为键，而拦截器按 **`commandType`** 用 `find` 取**第一个匹配**。
于是两个插件用**不同 id、相同 commandType** 各注册一次：

- 两次 `register` 都成功（无警告）；
- 派发时**只有先注册的那份 descriptor 生效**，
  后一份的 `capabilityRequired` / `isHighRisk` / `inputSchema` **全部被遮蔽**。

这是「我明明要求了 `assignment:review`，学生却能调」这类问题的一个真实成因。
防御手段：把 `id` 命名成 `` `${pluginId}/${commandType}` `` 之类的全局唯一串，
并让 `commandType` 也带插件前缀（`ctx.action` / `wrapActionRegistry` 会做前缀化，
裸 `ctx.resolve('@openlearn/core:IActionRegistryService')` 不会 —— 见
{doc}`platform-services`）。
````

### 3.1 Agent 工具名的双向碰撞

```typescript
const SafeName = action.commandType.replace(/[^a-zA-Z0-9_\-]/g, '_');
```

```{warning}
工具名是 `commandType` 把非 `[\w-]` 字符换成 `_` 的结果，
而 `getActionByToolName` 用**同一个变换**反向 `find` 第一个匹配。

因此 `a.b` 与 `a_b` 会映射到同一个 `SafeName`（`a_b`），
`find` 返回先注册的那个 —— AI 选择 `a_b` 时**执行的是另一个命令**。
命名时避开 `_` 与 `.` 混用。

另外 `getAgentTools()` 在没有可暴露 action 时返回 `[]`（不是 `[{functionDeclarations: []}]`），
消费方要能处理空数组。历史上「`getAgentTools` 过滤不足」是被当作缺陷修过的（见
{doc}`platform-services` 2.3）。
```

---

## 4. 能力是怎么被授予的

```
安装 → 管理员审批页写 plugin_capability_grants
     → activate() → grantCapabilities(mergedManifest.capabilitiesProposed)
        actorId = `plugin:${manifest.id}`
```

| 情形                                                              | 结果                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 官方 / 可信插件（`isTrustedInProcessPlugin(id, env, file_path)`） | 自动授予所有**非通配**能力                                                                       |
| 第三方 + 已批准                                                   | 授予（`isCapabilityApproved` 按 `plugin_key` = DB UUID 或 `manifest.id` 双 key 查）              |
| 第三方 + 未批准                                                   | **不失败**，`console.warn('[PluginHost] Capability "..." awaits administrator approval')` 后跳过 |
| `*` / `*:*` / `*:*:*`                                             | 永远拒绝（`isBlockedPluginCapability`）                                                          |
| `capService.grant()` 抛错                                         | rethrow，中止激活                                                                                |

ESM（`process` / `worker`）与 preloaded 两条激活路径都会调 `grantCapabilities()`
（`activateWorker()` 内另有一处），时机是「构建 context 之后、进入激活管道之前」。

```{danger}
### 「激活成功」不等于「有权限」

未获批准的能力**不影响激活**，插件状态照样 `active`，
第一次发命令才收到 `COMMAND_CAPABILITY_DENIED`。
写自动化验收时，只看 `state === 'active'` 会漏掉整类权限问题；
要么逐项 `ctx.services.capability.check('plugin:<id>', cap)`，要么真的把命令跑一遍。
```

`ctx.capability`（`wrapCapability` 包 `ICapabilityService`）提供
`grant` / `revokeAll` / `check` —— 但那是**运行期改动授权状态**，
不是「声明新权限」：见 {doc}`platform-services` 2.4。

### 4.1 通配符匹配规则

| 规则                                      | 行为                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `check()` 首段                            | 管理员 actorId 直接短路放行（白名单 + `extractRole`）                                     |
| `*:*:*` / `*`                             | 超级绕过，两者都接受                                                                      |
| `lesson:*`                                | 把 `requiredCap` 拆成 `resource:action`，已授能力逐条比较，`res` 或 `act` 命中 `*` 即通过 |
| `hasCapability(caps, name)`（方法策略侧） | `c === name \|\| c.startsWith(name + ':')`，**`*` 不是超级能力**                          |

注意最后一条与前几条**方向相反**：`CapabilityGuard` 里「已授 `*`」能匹配任何要求；
`checkMethodPolicy` 里声明 `*` 什么也匹配不到。

---

## 5. 第三套框架：Provider / `CapabilityRole`

```typescript
// packages/core/capability/pipeline/capability-pipeline.ts  executePipeline 第 3 步
const hasPermission = PermissionChecker.validatePermission(desc, request.context.actorRole);
// CapabilityRole: Teacher | Student | Plugin | AI | Observer | System
```

```{important}
这套用的是 descriptor 上的 `permission: CapabilityRole[]`，
**不是** `resource:action` 字符串。放行条件只有两种：

- `permission` 是**空数组** → 放行；
- `actorRole === 'System'` → 放行；
- 否则**精确匹配**，**无层级继承**（`Teacher` 不蕴含 `Observer`）。

AI 能力层的 7 个 descriptor id 属于这一套：
`capability_analytics`、`capability_chat`、`capability_completion`、`capability_lesson`、
`capability_plugin`、`capability_tool`、`capability_whiteboard`
（外加 `cap_analytics_insight` 这类洞察 id）。
它们与 §4 的能力授予**互不相通** —— 在 `capabilitiesProposed` 里写 `ai:chat` 无效。
```

---

## 6. 注册自己的命令时该怎么选

| 你要的语义                 | 写法                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 普通业务写入               | `capabilityRequired: 'lesson:write'` 之类（从 {doc}`token-reference` §5.1 的 20 个里选），`isHighRisk` 省略 |
| 不可逆 / 影响面大          | 加 `isHighRisk: true`，并接受「插件发起时必然进审批队列」                                                   |
| 不希望 AI 自主调用         | `exposeToAgent: false`（worker/process 下不声明 `agent:tool` 时会被**自动降级成 false**）                   |
| 只读闸门类（供宿主调用）   | `capabilityRequired: 'segment:gate_eval'` + `exposeToAgent: false`（SDK 对 `segment.gate_type` 的逐字建议） |
| 不想进 AI 工具箱但也没能力 | `exposeToAgent: false`，`sanitizeActionRegisterArgs` 会原样放行                                             |
| 参数必须校验               | `inputSchema.type` 只用 `object/array/string/number/boolean` 五种，否则不校验                               |

```{danger}
`capabilityRequired` 是**必填**（`readonly capabilityRequired: string`，无 `?`）。
TS 会拦你，但 `as any` / JS 插件会绕过 ——
缺字段时 `if (action.capabilityRequired && !isAdmin)` 直接**跳过能力检查**，
只剩高危审批一道闸。这是「命令人人能调」的第二条成因。
```

---

## 7. 症状 → 原因 → 动作

| 症状                                                                          | 原因                                    | 动作                                                         |
| ----------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| 403 `COMMAND_NOT_REGISTERED`                                                  | 只注册了 handler，没注册 descriptor     | 补 `ctx.services.actionRegistry.register(...)`               |
| 403 `COMMAND_CAPABILITY_DENIED`                                               | 能力未声明，或声明了但管理员未批准      | 核对 manifest + 批准表；`ctx.services.capability.check` 自检 |
| `[PayloadValidationError] ...`（HTTP 500）                                    | `inputSchema` 与实际 payload 不符       | 注意只支持 5 种 `type`                                       |
| `[Security] ... requires human approval`（500）                               | `isHighRisk: true` + 插件 actor         | 预期行为；去审批页批准后由**审批人身份**执行                 |
| 审批页点批准后仍失败并 410                                                    | 插件已卸载 / 命令已注销                 | 重新注册后需重新发起                                         |
| `Plugin "x" denied: 写入学生数据需要 'student-data:write' 能力`               | `pointsLedger` 写入缺能力               | manifest 加 `student-data:write`                             |
| `注册后台任务（registerInterval）需要 manifest 声明 'task:register' 能力`     | Barrier 3                               | 加 `task:register`                                           |
| `action "x" 的 exposeToAgent=true 需要 'agent:tool' 能力；...已降级...`       | 缺 `agent:tool`，静默降级               | 要么声明，要么显式写 `exposeToAgent: false`                  |
| 权限声明了却「时灵时不灵」                                                    | 同 `commandType` 被两个 descriptor 遮蔽 | 让 id 与 commandType 都带插件前缀                            |
| AI 调到了别的命令                                                             | `SafeName` 碰撞（`.` 与 `_`）           | 统一分隔符                                                   |
| 声明 `*` 后方法策略仍拒绝                                                     | `hasCapability` 不认 `*`                | 逐个声明真实能力名                                           |
| `console.warn('[PluginHost] Capability "..." awaits administrator approval')` | 第三方未获批                            | 管理员审批；这不是 bug                                       |

---

## 8. 提交前自查

1. 每个 `commandBus.registerHandler()` 都有配对的 `actionRegistry.register()`；
2. `ActionDescriptor.capabilityRequired` 非空、且取自那 20 个真实值；
3. `id` 全局唯一（带插件前缀），`commandType` 也带前缀，避免遮蔽；
4. `inputSchema.type` 只用被支持的 5 种；
5. `isHighRisk: true` 的动作，插件文档里写明「需人工审批、且批准后以审批人身份执行」；
6. 不希望 AI 自主执行的动作用 `exposeToAgent: false`（而不是靠 `isHighRisk`）；
7. manifest `capabilitiesProposed` 逐项能对上消费点（含 `api:*` / `task:register` / `agent:tool` / `grades:write` / `student-data:*` / `ai:invoke`）；
8. 第三方插件走查过管理员批准状态，不只看 `state === 'active'`；
9. 代码里没有 `actorId.endsWith(':admin')` 之类的自制管理员判定（C-3 同源漏洞）；
10. 没有试图用 `metadata.approved` 跳过高危审批；
11. 写学生个人数据的路径都有 `student-data:*`，并接受被拒时仍会落审计；
12. 不依赖 `/api/approvals/:id/reject` 会通知插件（它只 `DELETE`）。

---

## 9. 取证

| 断言                                                               | 来源（repomix 行）                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 拦截器整体结构与顺序                                               | ``packages/core/kernel/index.ts`→`infrastructureRefs`（L302–L402）                                 |
| default-deny 原文与审计 H-1、`scripts/plugin-command-audit.mjs`    | `packages/core/kernel/index.ts`（L374–L391）                                                       |
| `COMMAND_NOT_REGISTERED` 消息逐字                                  | `packages/core/kernel/index.ts`（L393–L399）                                                       |
| `[PayloadValidationError]` 消息与无 status                         | `packages/core/kernel/index.ts`（L307–L314）                                                       |
| `validateJsonSchema` 仅 5 种 type                                  | ``docs/reference/plugin-capability-matrix.md`（L269） 段（同上代码）                               |
| `isAdmin` 内联判定逐字、v0.6.1 C-3 与 `plugin:@evil:admin`         | `kernel/index.ts` L84239–84254                                                                     |
| 能力拒绝消息与 403/code                                            | `docs/reference/plugin-capability-matrix.md`（L61845–L61857）                                      |
| `pluginSuppliedApproval` 与高危队列代码                            | `docs/reference/plugin-capability-matrix.md`（L61859–L61885）                                      |
| 管理员绕过日志原文                                                 | `docs/reference/plugin-capability-matrix.md`（L61864）                                             |
| `approval.requested` 事件字段                                      | `docs/reference/plugin-capability-matrix.md`（L61872–L61879）                                      |
| `pending_commands` DDL                                             | 初始 schema L42090–42095                                                                           |
| `GET/POST /api/approvals*` 行为、payload 不可篡改、410 stale       | `server.ts` L211899–211955                                                                         |
| `OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS=14` 与旧名回退          | `docs/`（L16710）                                                                                  |
| `ActionDescriptor` 7 字段与 `exposeToAgent` 注释                   | ``packages/core/registry/index.ts`→`ActionDescriptor`（L1–L24）                                    |
| `register` 只查 id、`getActionByCommandType` 用 `find`             | `packages/core/registry/index.ts`（L27–L74）                                                       |
| `SafeName` 替换与 `getAgentTools` 空数组                           | `packages/core/registry/index.ts`（L42–L64）                                                       |
| 9 处 `isHighRisk: true` + 1 处显式 `false`                         | 能力矩阵 §4（L22620–22631）                                                                        |
| 授予规则 5 条、`grantCapabilities` 时机                            | 能力矩阵 §3（L22560 段）；`plugin-grants.ts` L111539ff                                             |
| `[PluginHost] Capability "..." awaits administrator approval`      | `docs/reference/plugin-capability-matrix.md` §3 引自 `plugin-host`                                 |
| `*:*:*` / 部分通配 / 管理员短路                                    | 能力矩阵 §1.4（L22530 段）                                                                         |
| `hasCapability` 的 `startsWith(name + ':')` 与「`*` 不是超级能力」 | ``packages/core/plugin-host/method-policy.ts`→`withoutQuery`（L96）                                |
| `CapabilityRole` 6 成员与 `PermissionChecker` 放行条件             | 能力矩阵 §5 副路径（L22695 段）                                                                    |
| AI 能力 7 个 `capability_*` id                                     | 能力矩阵 §2                                                                                        |
| `segment:gate_eval` 双口径与 SDK 建议                              | 能力矩阵 L22438–22440、L22723；``server/services/segment-gate-service.ts`→`GATE_CAPABILITY`（L33） |
| `student-data:*` 双端统一审计与文档漂移                            | 能力矩阵 §5.3（L22700 段）vs `context-builder.ts` L103158–103200                                   |
| `api:write` / `api:admin` 前缀表                                   | `method-policy.ts` L110181–110209                                                                  |
