# 子系统：内核与依赖注入

> 覆盖 `packages/core/kernel/`、`packages/core/di/`、`command-bus/`、`event-bus/`、`capability/`、`process-manager/`、`registry/`、`bootstrap/`。

---

## 1. `EducationalOS`：单例内核

`packages/core/kernel/index.ts`（749 行）是整个后端的中枢。它**不是**服务定位器，而是装配器：
构造时把各子系统实例注册进 DI，并把命令拦截器接上。

| 职责                                                                                                       | 位置                                                        |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 构造 `EventBus` / `CommandBus` / `ActionRegistry` / `CapabilityGuard` / `ProcessManager` / `NodeEsmLoader` | L2-14                                                       |
| 注册 20+ 内核服务到 `ServiceRegistry`                                                                      | L30-60 的 Token 导入 + `serviceRegistry.register(...)` 序列 |
| 安装命令拦截器（4 道闸门）                                                                                 | L303-401 `commandBus.setInterceptor`                        |
| 引导内置系统插件                                                                                           | L435 `bootstrapSystemPlugins()`                             |
| 注册测评题型注册表                                                                                         | L300（`IAssessmentGraderRegistryToken`）                    |

**为什么测评注册表在这里注册而不是 `server.ts`**：`server/__tests__/canary/` 会断言
`PLUGIN_RESOLVABLE_TOKENS` 全部可解析，注册点必须早于 canary 检查。

### 1.1 内置插件清单

`packages/plugins/` 下 9 个文件，全部在 `bootstrapSystemPlugins()` 里被 `import` 并注册
（路径：`packages/plugins/`，与 `packages/core` 同属内核侧，不是"第三方"）：

| 文件                      | 行数  | 作用                               |
| ------------------------- | ----- | ---------------------------------- |
| `builtin.ts`              | 2,174 | 基础业务命令（课节、班级、考勤等） |
| `assignment-eval.ts`      | 1,263 | 作业批改（含 AI 评分）             |
| `management.ts`           | 1,180 | 管理类命令（用户、导入导出）       |
| `courseware-score.ts`     | 757   | 课件评分                           |
| `ai-planner.ts`           | 269   | AI 教学规划                        |
| `score-monitor-script.ts` | 247   | 成绩监控脚本                       |
| `vfs.ts`                  | 215   | 虚拟文件系统                       |
| `process.ts`              | 170   | 进程管理命令                       |
| `ai-submit-injector.ts`   | 173   | 提交注入                           |

这些插件都在 `packages/plugins/` 内 ⇒ 命中「文件位置即信任」⇒ 走 `inline` 模式（见
[plugin-runtime-planes.md](../architecture/plugin-runtime-planes.md) §2）。

---

## 2. DI：`ServiceRegistry` + `Token`

### 2.1 Token 是「带幻影类型的字符串」

`packages/core/di/token.ts`：

```ts
const TOKEN_NAME_RE = /^(?:@[a-zA-Z0-9_-]+\/)?([a-zA-Z0-9_-]+:[a-zA-Z0-9_]+)$/;

export class Token<T> {
  readonly __serviceType?: T; // 幻影类型，运行期不存在
}
```

格式 `(@scope/)?domain:Name`，例 `@openlearn/core:ICommandBusService`。
**构造时即校验**，含空格 / 中文 / 特殊字符会抛 `TokenError`。

**推论**：Token 的**身份是字符串**。两个不同 `new Token('同一字符串')` 指向同一个服务。
这既是跨包协作的基础（插件自己复刻 Token 也能拿到服务），也是命名必须唯一的理由。

### 2.2 `ServiceRegistry` 的能力

`packages/core/di/service-registry.ts → class ServiceRegistry`（L33）：

| 方法                               | 行为                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `register(token, instance, opts?)` | 重复注册抛 `DuplicateRegistrationError`；缺依赖抛 `MissingDependencyError` |
| `resolve(token)`                   | 未注册抛 `ServiceNotFoundError`                                            |
| 依赖图                             | 注册时双向登记 `requires` / `dependents`（`depGraph`，L42）                |

### 2.3 三个 Token 口径（务必分清）

| 口径                   | 数量 | 含义                                                                                    |
| ---------------------- | ---- | --------------------------------------------------------------------------------------- |
| SDK **值导出**         | 32   | `packages/plugin-sdk/index.ts` 的 `export { ...Token }`                                 |
| 主进程可按对象 resolve | 30   | `packages/core/di/interfaces.ts → PLUGIN_RESOLVABLE_TOKENS`（L946）                     |
| 主进程可按名字 resolve | 31   | 同上 + `@openlearn/activity-ecosystem:IActivityRegistry`                                |
| 沙箱内可用             | 9    | `packages/core/worker-runtime/worker-manager.ts → BASE_WORKER_SERVICE_TOKENS`（L77-87） |

两个已定性的例外：

- `IActivityRegistryToken`：有对象，但白名单只有名字 → 只能按名字 resolve。
- `INetworkProxyServiceToken`：**主进程不可解析**；它是沙箱专用，由
  `service-host.ts` L769 按字符串拦截 RPC 转发，`inline` 下反而拿不到。

完整对照见 [../plugin-system/context-and-services.md](../plugin-system/context-and-services.md) §3。

---

## 3. CommandBus

`packages/core/command-bus/index.ts`（156 行，精简）。

| 方法                                    | 说明                                                        |
| --------------------------------------- | ----------------------------------------------------------- |
| `createCommand(type, payload, actorId)` | 生成 `id`（uuid）、`timestamp`                              |
| `registerHandler(type, handler)`        | handler 形如 `{ execute(command) }`                         |
| `execute(command)`                      | 先跑 interceptor，再找 handler                              |
| `setInterceptor(fn)`                    | **全局唯一**，内核在 L303 设置；前端/插件不可再设           |
| `registerMiddleware(fn)`                | 中间件链，`MiddlewareError` 在 `plugin-host/errors.ts` L174 |

**注意**：`setInterceptor` 是单值不是数组 —— 后设置的会覆盖前面的。
这是 default-deny 能生效的前提，也意味着**不要**在业务代码里调它。

---

## 4. EventBus

`packages/core/event-bus/index.ts`（281 行）。

```ts
publish(event: PlatformEvent): Promise<void>;
subscribe(eventType: string, subscriber: EventSubscriber): EventSubscriber | void | Promise<void>;
unsubscribe(eventType: string, subscriber: EventSubscriber): void | Promise<void>;
```

`PlatformEvent` 六字段（`packages/plugin-sdk/openlearn.d.ts`）：

```ts
{ id: string; type: string; source: string; payload: T; timestamp: number; correlationId?: string }
```

| 事实            | 说明                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| 支持通配 `*`    | `publish` 会投给精确匹配 + `*` 订阅者                                               |
| `source` 约定   | 插件用 `plugin.${ctx.pluginId}`（DB 行 UUID），内核用 `kernel.*`                    |
| `correlationId` | 由命令派发时应传 `command.id`，用于把「一条命令引发的所有事件」串起来               |
| 事件保留        | `packages/core/db/event-retention.ts`，天数由 `OPENLEARN_EVENT_RETENTION_DAYS` 控制 |

---

## 5. Capability（能力闸门）

`packages/core/capability/index.ts`（776 行内）。

| 方法                          | 说明                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `grant(actorId, cap)`         | 激活插件时由 `lifecycle.ts → grantCapabilities` 调用 |
| `check(actorId, requiredCap)` | 拦截器第 3 道闸门调用                                |
| `revokeAll(actorId)`          | 停用时回收                                           |

19 条真值 + 8 条方法级 `CAP_*` + 7 条运行时权限的完整表在
[../plugin-system/capabilities-and-security.md](../plugin-system/capabilities-and-security.md) §1-§3。
**不存在任何全局通配白名单**（`docs/agent/contracts/capabilities.json` → `_no_global_whitelist`）。

---

## 6. ProcessManager

`packages/core/process-manager/index.ts`（227 行）。

```ts
spawn(name, taskType, payload, ownerHint?): string;
kill(processId): void;
registerHandler(taskType, handler): void;
unregisterHandler(taskType): void;
registerInterval(name, intervalMs, tickFn, ownerHint?): string;
restore(): void;
```

**与插件执行模式无关**：`ProcessManager` 管的是「长任务」（如批量评分、备份），
插件 `process` 模式管的是「插件代码跑在子进程」。名字相似，别混。

---

## 7. bootstrap：装配管线

`packages/core/bootstrap/`（42 文件 / 2,598 行），子目录：

```text
adapter/  builder/  composition/  domain-registry/  integration/
lesson-session/  module-registry/  permission/  pipeline/  types/
```

职责是**把领域服务按依赖顺序组装**，与 `kernel/index.ts` 的「注册内核服务」是两件事：
bootstrap 面向业务域（课节会话、权限、模块注册），kernel 面向基础设施。

改启动逻辑前先看 `bootstrap/pipeline/`——装配顺序写在那里，顺序错会得到
`MissingDependencyError` 而不是运行期报错。

---

## 8. 改动这类代码前必须知道的四件事

1. **不要在业务层 `setInterceptor`** —— 会覆盖 default-deny。
2. **新增内核服务必须同时**：定义 Token → 在 `kernel` 注册 → 加进 `PLUGIN_RESOLVABLE_TOKENS`（若要给插件用）→
   更新 `docs/agent/contracts/tokens.json`。漏最后一步会让下一个 AI 按文档写出解析失败的代码。
3. **`register` 是重复即抛错**，热重载场景要用 `serviceRegistry` 的替换语义而非重复 register。
4. **事件只增不改**：给已有 `type` 改 payload 结构会静默破坏 `SOCKET_ROUTES` 的 `map` 函数。
