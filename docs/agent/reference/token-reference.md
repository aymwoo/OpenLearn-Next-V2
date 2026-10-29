# 标识符总表（Token / 能力 / 常量 / 状态 / 错误）

> **权威源码**：`packages/core/di/interfaces.ts`（Token 与 `PLUGIN_RESOLVABLE_TOKENS`）、
> `packages/core/registry/index.ts`（`ActionDescriptor.capabilityRequired`）、
> `packages/core/plugin-host/method-policy.ts`（第二套 capability）、
> `packages/core/plugin-host/plugin-grants.ts`（批准表）、
> `packages/core/plugin-host/errors.ts`（18 个错误类）、
> `packages/core/worker-runtime/worker-manager.ts`（`BASE_WORKER_SERVICE_TOKENS`）、
> `packages/core/worker-runtime/service-host.ts`（RPC 守卫）

本页是**字符串常量的唯一真相源**。写插件时凡是「凭记忆拼一个 token 名 / 能力名」的地方，
都应当回到本页核对。LLM 先验在这里错得最多，因为绝大多数名字**看起来**都合理。

---

## 0. 三套互不相通的字符串体系

```{danger}
平台里存在**三套**形如 `resource:action` 的字符串，它们**不是同一回事**，
把 A 套的值填进 B 套的位置不会报错，只会静默失效。

| 体系 | 出现位置 | 消费方 | 数量 |
| --- | --- | --- | --- |
| ① `capabilityRequired` | `ActionDescriptor.capabilityRequired`、manifest `capabilitiesProposed` | `CapabilityGuard.check(actorId, cap)` | **20** 个真实值（19 内置 + `segment:gate_eval`，§5.1） |
| ② `RuntimePermission` | provider descriptor 的 `permissions: string[]` | `ActivityRegistry.startActivity()` | **7** 个（§5.3） |
| ③ Method-policy capability | manifest `capabilitiesProposed`（复用同一字段！） | `checkMethodPolicy()`（ServiceHost Security Barrier 3） | **8** 个（§6） |

最容易被忽略的是 ③：`api:write` / `api:admin` / `agent:tool` / `task:register` /
`ai:invoke` / `grades:write` / `student-data:read` / `student-data:write`
**同样写在 `capabilitiesProposed` 里**，但它们不参与 ① 的命令鉴权，
只影响 worker/process 隔离模式下的**方法级**放行。

只在 ① 的 19 个里打转，你会以为自己声明了 `lesson:write` 就能在 worker 里
`spawn()` 后台任务 —— 实际会被 Barrier 3 以「缺少 `task:register`」拒绝。
```

DI Token 是第四套，与上面三套完全没有语法关系，见 §2。

---

## 1. `requires` 字段的语法校验

manifest 的 `requires: string[]` 在
`packages/core/esm-loader/manifest-schema.ts` 上带正则校验：

```typescript
// packages/core/esm-loader/manifest-schema.ts（Phase 6+ 生效版）
const requiresItemSchema = z.string().regex(/^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$/, {
  message: 'requires/optional 条目格式无效。需要 @scope/domain:IServiceName 或 @scope/domain:IServiceName@^x.y.z',
});
```

```{warning}
### 仓库里有两条正则，别抄错

| schema | 正则 | 允许版本段？ |
| :--- | :--- | :--- |
| `manifestSchema`（Phase 6+，安装路径实际使用） | 见上 | 允许 `@^x.y.z` / `@~x.y.z` / `@x.y.z`，可带 `-pre` |
| `manifestSchemaV3`（Phase 3-5，仍导出供引用） | `/^@[\w-]+\/[\w-]+:I\w+$/` | **完全不允许**，带版本一律拒 |
| 顶层字段 | `requires` 与 `optional` 都用 `requiresItemSchema` | — |
```

拆开看这条正则的要求：

| 片段                                    | 含义                              | 常见错法                                                             |
| --------------------------------------- | --------------------------------- | :------------------------------------------------------------------- |
| `@[\w-]+\/[\w-]+`                       | **包名**，必须带 scope 与斜杠     | `openlearn/core:...`（缺 `@`）、`@openlearn.core:...`（斜杠写成点）  |
| `:I\w+`                                 | 冒号后必须是大写 `I` 开头的接口名 | `:commandBus`、`:CommandBusService`                                  |
| `(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?` | 可选版本后缀，**第二个 `@`** 起   | `...:IFoo\|^1.0.0`（用caret不用`@`前缀）、`...:IFoo@1.0`（段数不足） |

```{danger}
### zod 与解析器接受的版本格式**不一致**

`parseRequiresEntry()` 的文档注释把 `'@openlearn/core:IProcessService@>=1.0.0 <2.0.0'`
列为合法输入并有单测覆盖（解析器只是按第二个 `@` 切分，不做格式校验），
但 **`requiresItemSchema` 会拒它** —— 正则只接受 `^` / `~` 前缀 + 三段数字 + 可选 `-pre`，
`>=`、`<`、空格一律进不去。
写范围请用 `@^1.0.0`，别用 `@>=1.0.0 <2.0.0`。
```

````{warning}
### 版本后缀用「`/` 之后第一个 `@`」，不是「最后一个 `@`」

`'@openlearn/core:ICommandBusService@^1.0.0'` 是合法写法。实际解析是

```typescript
const secondAtIndex = entry.indexOf('@', entry.indexOf('/'));
```

即**从 `/` 往后找第一个 `@`**。因此 `split('@')[1]` 和 `lastIndexOf('@')` 都是错的：
前者在带 scope 的名字上会得到 `openlearn/core:ICommandBusService`（丢了前导 `@`），
后者在名字本身含 `@` 时切错位置。

另外：`requires` 只影响**清单校验与文档语义**，它**不是** `ctx.resolve` 的准入凭证 ——
后者只看 §2 的白名单集合。
````

---

## 2. `ctx.resolve` 的白名单（审计 E-2）

```{important}
`ctx.resolve(token)` 接受 `string | Token`，两条路径的**门禁强度不同**：

- **Token 对象路径**：不受限。理由（源码注释原文）是插件「必须 import SDK 导出的常量才拿得到它」；
- **字符串路径**：只允许命中 `PLUGIN_RESOLVABLE_TOKEN_NAMES`，否则显式抛错。

这条不对称是刻意保留的。此前字符串路径直接落到
`serviceRegistry.resolveByName(name)`，那里是纯粹的 `registry.get(name)`，
**没有任何门禁** —— 插件只要知道一个内部 token 名（LessonEngine / ClassroomRuntime /
Presence / Collaboration / Analytics 等 20+ 个内核服务），就能在 inline 模式下
拿到宿主内部服务实例。E-2 修复加了白名单，但 Token 对象路径维持原样。

结论：**能用 `ctx.services.*` 就不要 `ctx.resolve`**；确实要 resolve 时
优先 import SDK 常量而不是手拼字符串，因为字符串拼错会被白名单拒，
而 import 常量拼错是编译期错误。
```

源码中的集合定义（`packages/core/di/interfaces.ts`）：

```typescript
export const PLUGIN_RESOLVABLE_TOKENS = [
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IDatabaseToken,
  IPluginHostToken,
  ISemesterGradeServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
  ILessonEngineServiceToken,
  IClassroomRuntimeServiceToken,
  IPresenceEngineServiceToken,
  ITeachingCollaborationServiceToken,
  ILearningAnalyticsServiceToken,
  IAICapabilityServiceToken,
  ICapabilityRuntimeServiceToken,
  IPlatformServiceRegistryToken,
  IPluginLifecycleManagerToken,
  IPluginDistributionManagerToken,
  ICapabilityRegistryToken,
  IAuthSessionBridgeToken,
  ICoursewareRuntimeScriptRegistryToken,
  IStageGuardServiceToken,
  IClassroomLifecycleServiceToken,
  IInteractionRuntimeServiceToken,
  IClassroomCountdownServiceToken,
  IAssessmentGraderRegistryToken,
] as const; // 30 个

export const PLUGIN_RESOLVABLE_TOKEN_NAMES: ReadonlySet<string> = new Set([
  ...PLUGIN_RESOLVABLE_TOKENS.map((t) => t.name),
  '@openlearn/activity-ecosystem:IActivityRegistry',
]); // 31 个名字
```

注释明确写着「**新增对外 Token 时同步加到这里**，否则插件用名字解析会被拒
（报错信息会指明，属显式失败而非静默降级）」—— 这是本页存在的理由：
`IActivityRegistry` 之所以只出现在 Names 而不出现在 Tokens，是因为
`interfaces.ts` import 它会形成反向依赖。

---

## 3. 31 个可解析 Token 全表

`worker` 列 = 是否在 `BASE_WORKER_SERVICE_TOKENS`（9 个，§4）里；
`services` 列 = 是否同时能以 `ctx.services.<同名键>` 拿到包装代理。

### 3.1 基础服务（8）

| SDK 常量                      | Token 名（字符串）                       | TS 类型                  | `services` | `worker` |
| ----------------------------- | ---------------------------------------- | ------------------------ | ---------- | -------- |
| `ICommandBusServiceToken`     | `@openlearn/core:ICommandBusService`     | `ICommandBusService`     | ✅         | ✅       |
| `IEventBusServiceToken`       | `@openlearn/core:IEventBusService`       | `IEventBusService`       | ✅         | ✅       |
| `IActionRegistryServiceToken` | `@openlearn/core:IActionRegistryService` | `IActionRegistryService` | ✅         | ✅       |
| `ICapabilityServiceToken`     | `@openlearn/core:ICapabilityService`     | `ICapabilityService`     | ✅         | ✅       |
| `IProcessServiceToken`        | `@openlearn/core:IProcessService`        | `IProcessService`        | ✅         | ✅       |
| `IStorageServiceToken`        | `@openlearn/core:IStorageService`        | `IStorageService`        | ✅         | ✅       |
| `IAIServiceToken`             | `@openlearn/core:IAIService`             | `IAIService`             | ✅         | ✅       |
| `IDatabaseToken`              | `@openlearn/core:IDatabase`              | `SqliteDatabase`         | ❌         | ✅       |

```{warning}
`IDatabaseToken` 的泛型参数是 `SqliteDatabase`，不是 `IDatabase` —— Token 名里的
`IDatabase` 与 TS 类型名**不同名**。更关键的是同一个 Token 在两种运行模式下
拿到的东西完全不同（inline = 裸句柄，worker/process = 只有 4 个方法的 RPC stub），
详见 {doc}`platform-services` 第 4 节。
```

### 3.2 积点与成绩（3）

| SDK 常量                        | Token 名                                   | TS 类型                    | `services` | `worker` |
| ------------------------------- | ------------------------------------------ | -------------------------- | ---------- | -------- |
| `ISemesterGradeServiceToken`    | `@openlearn/core:ISemesterGradeService`    | `ISemesterGradeService`    | ❌         | ❌       |
| `IPointsDimensionRegistryToken` | `@openlearn/core:IPointsDimensionRegistry` | `IPointsDimensionRegistry` | ✅（可空） | ❌       |
| `IPointsLedgerServiceToken`     | `@openlearn/core:IPointsLedgerService`     | `IPointsLedgerService`     | ✅（可空） | ❌       |

后两个只在 manifest 显式声明 points 相关能力时由
`computeAllowedWorkerTokens` 追加授予（§4.2）。

### 3.3 引擎门面（5）—— 名字可解析，但不是插件契约

| SDK 常量                             | Token 名                                        | TS 类型                         |
| ------------------------------------ | ----------------------------------------------- | ------------------------------- |
| `ILessonEngineServiceToken`          | `@openlearn/core:ILessonEngineService`          | `ILessonEngineService`          |
| `IClassroomRuntimeServiceToken`      | `@openlearn/core:IClassroomRuntimeService`      | `IClassroomRuntimeService`      |
| `IPresenceEngineServiceToken`        | `@openlearn/core:IPresenceEngineService`        | `IPresenceEngineService`        |
| `ITeachingCollaborationServiceToken` | `@openlearn/core:ITeachingCollaborationService` | `ITeachingCollaborationService` |
| `ILearningAnalyticsServiceToken`     | `@openlearn/core:ILearningAnalyticsService`     | `ILearningAnalyticsService`     |

```{danger}
这 5 个 Token **在白名单里**，能解析成功；但它们对应的服务在
`docs/architecture/` 里被标注为「内核内部」，方法签名历史上有过破坏性变更。
白名单收录它们是为了兼容既有插件，**不是**对新插件的承诺。
新代码请走命令（`ctx.command`）而不是直接调引擎。
```

### 3.4 Provider / Capability 框架（4）

| SDK 常量                         | Token 名                                          | TS 类型                           |
| -------------------------------- | ------------------------------------------------- | --------------------------------- |
| `IAICapabilityServiceToken`      | `@openlearn/core:IAICapabilityService`            | `IAICapabilityService`            |
| `ICapabilityRuntimeServiceToken` | `@openlearn/core:ICapabilityRuntimeService`       | `ICapabilityRuntimeService`       |
| `ICapabilityRegistryToken`       | `@openlearn/core:ICapabilityRegistry`             | `CapabilityRegistry`              |
| `IPlatformServiceRegistryToken`  | `@openlearn/core:IPlatformServiceRegistryService` | `IPlatformServiceRegistryService` |

```{warning}
最后一行：常量名 `IPlatformServiceRegistryToken` 与 Token 名
`@openlearn/core:IPlatformServiceRegistryService` **不同**（名字里有两个 `Service`）。
手拼字符串时按常量名写成 `...:IPlatformServiceRegistry` 会被白名单拒。
这是本页里最容易踩的一次字符串不一致。
```

### 3.5 具名业务服务（7）

| SDK 常量                                | Token 名                                           | TS 类型                            | 方法数          |
| --------------------------------------- | -------------------------------------------------- | ---------------------------------- | --------------- |
| `IClassroomLifecycleServiceToken`       | `@openlearn/core:IClassroomLifecycleService`       | `IClassroomLifecycleService`       | 4               |
| `IInteractionRuntimeServiceToken`       | `@openlearn/core:IInteractionRuntimeService`       | `IInteractionRuntimeService`       | 3               |
| `IClassroomCountdownServiceToken`       | `@openlearn/core:IClassroomCountdownService`       | `IClassroomCountdownService`       | 6               |
| `IStageGuardServiceToken`               | `@openlearn/core:IStageGuardService`               | `IStageGuardService`               | 4               |
| `ICoursewareRuntimeScriptRegistryToken` | `@openlearn/core:ICoursewareRuntimeScriptRegistry` | `ICoursewareRuntimeScriptRegistry` | 5               |
| `IAssessmentGraderRegistryToken`        | `@openlearn/core:IAssessmentGraderRegistry`        | `IAssessmentGraderRegistry`        | 5 + `gradeItem` |
| `IAuthSessionBridgeToken`               | `@openlearn/core:IAuthSessionBridgeService`        | `IAuthSessionBridgeService`        | —               |

````{danger}
`IAuthSessionBridgeToken` 是这组里唯一的**特权** Token：它的 `createSession()`
不校验调用方身份，且能签发 `role: 'administrator'` 的会话。
它在白名单里的原因是「SDK 导出了这个 Token 对象」，而按 E-2 的规则
Token 对象路径不受限。worker 基线白名单**不含**它（§4），
所以在 inline 之外用不到；一旦你的插件跑在 inline 模式，请确认你真的需要它 ——
{doc}`platform-services` 3.4 节列了使用前的两个前置条件。

注意它的 Token 声明带了第三个参数：

```typescript
export const IAuthSessionBridgeToken = new Token<IAuthSessionBridgeService>(
  '@openlearn/core:IAuthSessionBridgeService',
  '1.0.0',
);
```

version 只参与 `Token` 的 `toString()`，**不参与** `resolveByName` 的匹配。
````

### 3.6 插件管理（4）+ 活动生态（1）

| SDK 常量                               | Token 名                                          | TS 类型                     | 备注                     |
| -------------------------------------- | ------------------------------------------------- | --------------------------- | ------------------------ |
| `IPluginHostToken`                     | `@openlearn/core:IPluginHost`                     | `PluginHost`                | ⚠ 见下                   |
| `IPluginLifecycleManagerToken`         | `@openlearn/core:IPluginLifecycleManager`         | `PluginLifecycleManager`    | ⚠ 见下                   |
| `IPluginDistributionManagerToken`      | `@openlearn/core:IPluginDistributionManager`      | `PluginDistributionManager` | ⚠ 见下                   |
| `ICapabilityGovernanceServiceToken`    | —                                                 | —                           | ✗ **不在**白名单（§3.7） |
| （`@openlearn/activity-ecosystem` 包） | `@openlearn/activity-ecosystem:IActivityRegistry` | `IActivityRegistry`         | 仅按名字收录             |

```{danger}
### `IPluginHost` / Lifecycle / Distribution 是历史遗留的可达后门

2026-10-04 这两个 + `IPluginHost` 被**移出 worker 基线白名单**，
源码理由原文：`IPluginHost` 暴露 `installPlugin` / `installPluginFromZip` /
`activatePlugin` / `uninstallPlugin`，沙箱化插件本不该能安装并激活**其他**插件
（等于给自己留一个能在自身被卸载后继续存活的后门）。

但它们**仍在** `PLUGIN_RESOLVABLE_TOKENS` 里 —— 也就是说
**inline 模式插件依然能 `ctx.resolve('@openlearn/core:IPluginHost')` 拿到它**。
白名单（E-2，管字符串 resolve）与 worker 基线（管 RPC 可达性）是两个独立集合，
移出后者的动作没有同步移出前者。

第三方 ZIP 插件被强制为 `process` 模式，不受影响；
`packages/plugins` 内置插件默认 inline，本来就需要它 —— 这是保留的原因。
```

`ActivityRegistry` 有 9 个方法，但要注意它 **没有可 import 的 Token 常量导出**
（`packages/plugin-sdk` 只 re-export 了接口类型），只能用字符串名解析。
这是 §2 那条「优先 import 常量」建议的唯一例外。

### 3.7 白名单外的内部 Token（5）

以下 Token 在 `interfaces.ts` 里定义，但**不在** `PLUGIN_RESOLVABLE_TOKENS`，
用字符串名 resolve 会被拒：

| Token 常量                          | Token 名                                       |
| ----------------------------------- | ---------------------------------------------- |
| `ICapabilityGovernanceServiceToken` | `@openlearn/core:ICapabilityGovernanceService` |
| `INetworkProxyServiceToken`         | `@openlearn/core:INetworkProxyService`         |
| `IPluginCapabilityGatewayToken`     | `@openlearn/core:IPluginCapabilityGateway`     |
| `IPluginRuntimeCompositionToken`    | `@openlearn/core:IPluginRuntimeComposition`    |
| `IUnifiedExtensionRegistryToken`    | `@openlearn/core:IUnifiedExtensionRegistry`    |

```{note}
`INetworkProxyService` 看起来矛盾：它在 `BASE_WORKER_SERVICE_TOKENS`（§4）里，
却不在字符串白名单里。原因是 `ServiceHost.handleInvoke` 对它**单独特判**，
出网能力来自 manifest `network.outbound` + worker 运行时 `fetch`，
而不是来自插件主动 resolve 一个服务。
不要在 inline 插件里尝试 `ctx.resolve('@openlearn/core:INetworkProxyService')`。
```

---

## 4. Worker / Process 模式的可达集合

Token 白名单决定「能不能 resolve 到」，worker 基线决定「RPC 允许不允许」。
两者独立，交集才是 worker 插件的实际可用面。

### 4.1 `BASE_WORKER_SERVICE_TOKENS`（9 个，逐字照抄）

```typescript
export const BASE_WORKER_SERVICE_TOKENS: readonly string[] = Object.freeze([
  '@openlearn/core:ICommandBusService',
  '@openlearn/core:IEventBusService',
  '@openlearn/core:IActionRegistryService',
  '@openlearn/core:ICapabilityService',
  '@openlearn/core:IProcessService',
  '@openlearn/core:IStorageService',
  '@openlearn/core:IAIService',
  '@openlearn/core:IDatabase',
  '@openlearn/core:INetworkProxyService',
]);
```

对照 §3 可知：**22 个**可 resolve 的 Token 在 worker 模式下不可达。
`ISemesterGradeService` 的 token 名仍是 `@openlearn/core:...`（服务端），
前端同名服务的 token 名是 `@openlearn/frontend:...`（§7）—— 名字不同，别混。

同文件还有一个 `ALL_SERVICE_TOKENS`，注释自称「兼容性超集列表，保留供历史外部模块引用」，
= 上面 9 个 + `IPointsDimensionRegistry` 等。

```{warning}
**不要用 `ALL_SERVICE_TOKENS` 判断自己能用什么。** 它不是门禁输入，
真正的门禁是 `computeAllowedWorkerTokens(manifest)` 的返回值。
读到这个名字的 LLM 常会把它当成「worker 可用服务全集」。
```

### 4.2 `computeAllowedWorkerTokens` 的三条规则

允许集合 = `BASE_WORKER_SERVICE_TOKENS` ∪ 按 manifest 追加的项，追加依据：

| 来源字段                        | 追加内容                                   |
| ------------------------------- | ------------------------------------------ |
| `manifest.requires`             | 命中的 `@openlearn/core:I*` token 名       |
| `manifest.optional`             | 同上（缺失时不报错，仅不可达）             |
| `manifest.capabilitiesProposed` | 特定能力映射到特定 Token（如 points 系列） |

```{important}
匹配是**全名精确比较**（审计 B-2 修复前曾按前缀匹配，导致
`@openlearn/core:IPluginHost` 被 `@openlearn/core:IPlugin` 这类片段意外放行/拦截）。
因此在 `requires` 里写 `@openlearn/core:ICommandBus`（漏掉 `Service`）
不会报错，只会**静默得不到**该 Token。
```

---

## 5. 能力字符串：`capabilityRequired`（体系 ①）

### 5.1 内置插件用到的 19 个值

统计口径：`capabilityRequired` 在 `packages/core` / `packages/plugins` / `src/` / `server.ts`
的全量出现次数（「声明处数」），并给出绑定的命令前缀。

| 能力                | 声明处数 | 典型命令                                  |
| ------------------- | -------- | ----------------------------------------- |
| `management:write`  | 24       | `management.*`、`assignment.*`（见 §5.4） |
| `lesson:write`      | 11       | `lesson.*`                                |
| `whiteboard:write`  | 9        | `whiteboard.*`                            |
| `management:read`   | 6        | `management.*`                            |
| `plugin:write`      | 5        | `plugin.*`                                |
| `lesson:read`       | 4        | `lesson.*`                                |
| `vfs:write`         | 3        | `vfs.*`                                   |
| `process:write`     | 3        | `process.spawn` / `kill`                  |
| `assignment:manage` | 3        | `assignment.*`                            |
| `whiteboard:read`   | 2        | `whiteboard.*`                            |
| `vfs:read`          | 2        | `vfs.*`                                   |
| `process:read`      | 2        | `process.list` / `logs`                   |
| `assignment:read`   | 2        | `assignment.*`                            |
| `lesson:delete`     | 1        | `lesson.delete`                           |
| `plugin:read`       | 1        | `plugin.*`                                |
| `student:write`     | 1        | `student.*`                               |
| `assignment:write`  | 1        | `assignment.*`                            |
| `assignment:submit` | 1        | `assignment.submit`                       |
| `assignment:review` | 1        | `assignment.review`                       |

```{danger}
### 第 20 个：`segment:gate_eval`

能力矩阵的统计口径自己就写着矛盾的两行：

> - **20 个**不同权限字符串：其中 **19 个**用作 `ActionDescriptor.capabilityRequired`
>   （`packages/plugins/*.ts` 口径），另一个是 `server/services/segment-gate-service.ts`
>   的 `GATE_CAPABILITY` 常量 `segment:gate_eval`
> - `segment:gate_eval` **不是** `ActionDescriptor.capabilityRequired`；SDK 注释里建议
>   片段命令同时声明它

也就是说：内置插件不用它，但**平台要求你自己注册的分环节闸门命令带上它**
（`capabilityRequired: 'segment:gate_eval'` 且 `exposeToAgent: false`，
宿主以系统身份执行、超时 1500ms、失败即拒绝）。

本页其余表格按 **19 + 1** 的口径书写：上面那张计数表是内置插件的 19 个，
`segment:gate_eval` 是第 20 个、由插件侧自行声明。
```

```{danger}
### `quiz:write` 没有任何消费点

全仓库 `capabilityRequired: 'quiz:write'` 出现 **0 次**。
`agent-system-0` 预置了它，但没有任何命令要求它。
在 manifest 里声明 `quiz:write` 不会带来任何额外权限 —— 测验命令实际要求的是
`lesson:write` / `management:write`。

同理，`student:read` 也不在上面的 19 个 `capabilityRequired` 值里
（它出现在内置 `management.ts` 的 `capabilitiesProposed` 中，属「多授无害」）。
```

### 5.2 只声明不要求的「多授无害」项

`capabilitiesProposed` 允许声明未在 §5.1 出现的能力，`CapabilityGuard` 会照样授予，
但没有命令消费它。内置插件的真实声明：

| 插件                    | `capabilitiesProposed`                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| `builtin.ts`            | `lesson:read`、`lesson:write`、`whiteboard:read`、`whiteboard:write`             |
| `vfs.ts`                | `vfs:read`、`vfs:write`                                                          |
| `process.ts`            | `process:read`、`process:write`                                                  |
| `management.ts`         | `class:read`、`class:write`、`student:read`、`student:write`                     |
| `ai-planner.ts`         | `process:write`、`lesson:write`、`assignment:write`                              |
| `assignment-eval.ts`    | `assignment:read`、`assignment:submit`、`assignment:review`、`assignment:manage` |
| `ai-submit-injector.ts` | `[]`                                                                             |

`ai-submit-injector.ts` 声明空数组，是「纯监听型插件」的范例 ——
它只订阅事件，不发起命令。

### 5.3 体系 ②：`RuntimePermission`（7 个）

定义在 `packages/activity-ecosystem` 的联合类型，**不是** `capabilityRequired`：

```typescript
| 'lesson:control'
| 'stage:navigate'
| 'whiteboard:draw'
| 'quiz:submit'
| 'plugin:execute'
| 'ai:invoke'
| 'session:manage';
```

````{warning}
`lesson:control` **从未**作为任何 `ActionDescriptor.capabilityRequired` 出现，
因此没有插件能通过 `capabilitiesProposed` 拿到它。
它的消费方是 `default-providers.ts` 的 provider descriptor
`permissions: ['lesson:control']`，由 `startActivity(id, context, payload, actorId)`
逐条 `context.capability.check(actorId, cap)`，**任一条命中即放行**（`some(Boolean)`），
全不命中抛出 `code = 'PERMISSION_DENIED'`：

```typescript
const err = new Error(
  `[ActivityPermission] Actor "${actorId}" is missing a required permission ` +
    `(${required.join(', ')}) for activity "${id}".`,
);
(err as Error & { code?: string }).code = 'PERMISSION_DENIED';
throw err;
```

`POST /api/activities/:id/start` 把它映射为 HTTP **403**。
若 `actorId` 为 `undefined`，`if (required.length > 0 && actorId)` 会**跳过整个权限检查**。
````

旧文档「使用 `IActivityRegistryToken` 的插件必须在 `capabilitiesProposed` 中声明，
否则抛 `PERMISSION_DENIED`」是**错误**的：检查的是 provider descriptor 的
`permissions` 对 `actorId` 的运行时授权状态，与 manifest 声明无关。

### 5.4 同一业务两处要求不同能力

```{danger}
`assignment.create` / `assignment.submit` / `assignment.grade` 在
`packages/plugins/management.ts` 里要求 **`management:write`**，
在 `packages/plugins/assignment-eval.ts` 里要求 **`assignment:*`**。

两套注册共存。若你把 action id 注册成同名，`ActionRegistry.register`
会因重复 id **抛错**；若想避免冲突又想要 `assignment:*` 语义，
必须使用不同的 `type` 字符串。这不是设计，是既成事实，写插件前先看
你要接的是哪一个。
```

### 5.5 通配符与短路

| 规则                  | 行为                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `*:*:*` / `*`         | 超级管理员绕过，`check()` 显式授予分支两者都接受                                                                                    |
| `lesson:*` 等部分通配 | `check()` 末段把 `requiredCap` 拆成 `resource:action`，已授能力逐条比较，`res` 或 `act` 命中 `*` 即通过                             |
| 管理员 actorId 短路   | `check()` 首段直接放行：`role:administrator`、`admin`、`usr_admin`、`admin-demo`，或 `extractRole` 解析出 `administrator` / `admin` |

### 5.6 `CapabilityGuard` 构造函数预置的 7 个 actor

| actorId          | 预置能力                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user-demo`      | `['*:*:*']`                                                                                                                                                                       |
| `user-frontend`  | `lesson:*`、`whiteboard:*`、`management:*`、`quiz:*`、`vfs:*`、`process:*`、`plugin:*`                                                                                            |
| `anonymous`      | `[]`（无权限）                                                                                                                                                                    |
| `agent-system-0` | `lesson:write`、`lesson:delete`、`whiteboard:write`、`quiz:write`、`plugin:read`、`vfs:read`、`vfs:write`、`management:write`、`management:read`、`process:write`、`process:read` |
| `teacher-demo`   | `lesson:*`、`whiteboard:*`、`management:*`、`quiz:*`、`vfs:*`                                                                                                                     |
| `student-demo`   | `student:write`、`lesson:read`、`whiteboard:read`                                                                                                                                 |

`check()` 方法体内另有两张**角色兜底表**（对 `extractRole` 解析出 `teacher` / `student`
的任意 actorId 生效，硬编码在方法体中，**不是**构造函数预置）：

- `teacher` → `lesson:*`、`whiteboard:*`、`management:*`、`quiz:*`、`vfs:*`、`process:*`、`plugin:*`、`student:write`、`assignment:read`、`assignment:submit`、`assignment:review`、`assignment:manage`
- `student` → `student:write`、`lesson:read`、`whiteboard:read`、`assignment:read`、`assignment:submit`、`assignment:review`

```{note}
学生兜底表**刻意不含** `lesson:write`（避免学生改课时内容）；
`assignment:submit` / `assignment:review` 是学生发起作业写入的唯一入口。
这些是演示/兜底用 actorId，插件的 actorId 是 `plugin:<manifest.id>`，不在表内。
```

### 5.7 不存在的权限字符串

```{danger}
以下常被 LLM 捏造，源码中**不存在** `capabilityRequired` 消费点：

| 猜测值 | 实际情况 |
| --- | --- |
| `user:*` | 不存在。`user.list/create/update/delete` 由 `management:read` / `management:write` 把关 |
| `system:*` | 不存在。`System` 仅是体系 ③ 的 `CapabilityRole` 成员 |
| `courseware:*` | 不存在。课件命令由 `lesson:read` / `lesson:write` 与 `student:write` 覆盖 |
| `classroom:*` / `class:*` | 不存在于 ①；`class:read` / `class:write` 只在 `capabilitiesProposed` 里出现（多授无害） |
| `analytics:*` | 不存在。唯一相关物是 descriptor id `cap_analytics_insight` |
| `ai:read` / `ai:write` / `ai:chat` / `ai:completion` | 不存在。AI 层用 `capability_*` ID：`capability_analytics`、`capability_chat`、`capability_completion`、`capability_lesson`、`capability_plugin`、`capability_tool`、`capability_whiteboard`（7 个） |
| `process:execute` / `plugin:execute` | 不存在于 ①（后者属体系 ②） |
| `session:manage` | 属体系 ②，不是 ① |
| `storage:read` / `storage:write` | 生产代码无消费点，仅出现在 `__tests__/plugin-http-streaming.test.ts` 的测试 manifest 里 |
| `network:*` / `net:*` | 不存在。出站网络由 `plugin_network_grants` 域名白名单 + manifest `network.outbound` 管控（§8.2） |
| `grades` / `grades:read` | 属体系 ③ 的命名族，见 §6.1 的说明 |
```

---

## 6. 体系 ③：方法级 capability（`method-policy.ts`）

这是 ServiceHost 的 **Security Barrier 3**，只作用于 `worker` / `process` 隔离模式。
声明位置**仍是** `manifest.capabilitiesProposed` —— 与体系 ① 共用同一字段。

```typescript
export const CAP_API_WRITE = 'api:write'; // 浏览器侧任意非 GET 调用
export const CAP_API_ADMIN = 'api:admin'; // 高危路径 / 不可逆操作
export const CAP_GRADES_WRITE = 'grades:write'; // 学期成绩写入
export const CAP_AGENT_TOOL = 'agent:tool'; // 注册暴露给 AI Agent 的 action
export const CAP_AI_INVOKE = 'ai:invoke'; // 驱动 AI 生成
export const CAP_TASK_REGISTER = 'task:register'; // 注册后台常驻任务
export const CAP_STUDENT_DATA_READ = 'student-data:read'; // 读学生个人敏感数据
export const CAP_STUDENT_DATA_WRITE = 'student-data:write'; // 写学生个人敏感数据
```

### 6.1 判定规则表

| Token                    | 方法                                    | 需要            | 拒绝原因（原文）                                                                                 |
| ------------------------ | --------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `IFrontendAPI`           | 非只读（`isReadOnlyMethod` 之外的全部） | `api:write`     | `写操作（<method>）需要 manifest 声明 'api:write' 能力（普通只读调用请用 get）`                  |
| `IFrontendAPI`           | 命中高危前缀 / 不可逆后缀 / 实体级删除  | `api:admin`     | `写入高危路径 '<p>' 需要 manifest 声明 'api:admin' 能力`                                         |
| `ISocketService`         | `disconnect` / `destroy`                | —               | `插件无权调用 <method>()——断开课堂实时通道会中断正在进行的教学`（**任何能力都解锁不了**）        |
| `ISemesterGradeService`  | `save*` / `write*` / `set*`             | `grades:write`  | `写入学期成绩需要 manifest 声明 'grades:write' 能力（'grades' 或 'grades:read' 不足以解锁写入）` |
| `IProcessService`        | `registerHandler` / `registerInterval`  | `task:register` | `注册后台任务（<method>）需要 manifest 声明 'task:register' 能力`                                |
| `IProcessService`        | `restore`                               | `task:register` | `恢复后台任务（restore）会重放全部插件的 running 进程，需要...`                                  |
| `IAIService`             | `generateText` / `chat` / `complete`    | `ai:invoke`     | `调用 AI 生成（<method>）需要 manifest 声明 'ai:invoke' 能力`                                    |
| `IActionRegistryService` | `register` 且 `exposeToAgent !== false` | `agent:tool`    | 见 §6.3（实际走降级，不拒绝）                                                                    |
| `IStorageService`        | 全部                                    | —               | 允许（已在 DB 层按 `plugin_id` 隔离）                                                            |
| `IUIService`             | 全部                                    | —               | 允许                                                                                             |
| 未列入的 Token           | 全部                                    | —               | `return null`，交由 Barrier 1 白名单裁决                                                         |

```{important}
**未列入本策略的 Token 返回 `null`（允许）**，注释写明「不在此处裁决，
交由 Barrier 1 白名单负责」。所以 Barrier 3 是**黑名单式增强**，
不要指望它拦住你没想到的服务 —— 唯一的硬边界是 §4 的可达集合。
```

### 6.2 高危路径三张表

```typescript
export const HIGH_RISK_PATH_PREFIXES = Object.freeze([
  '/api/plugins',
  '/api/users',
  '/api/auth',
  '/api/ai-providers',
  '/api/agent',
  '/api/grade-sync',
  '/api/site-settings',
  '/api/approvals',
]);
export const IRREVERSIBLE_PATH_SUFFIXES = Object.freeze(['/gdpr-delete']);
const ENTITY_DELETE_RE = /^\/api\/[^/]+\/[^/]+$/; // del() 且恰好 3 段
```

```{warning}
`/api/classes`、`/api/students`、`/api/lessons` **刻意不在**前缀表里 ——
这些命名空间既有正当 `POST`（建课时、导入名单）又有 `DELETE`（删班级、删学生），
整段拦截会挡住大量正常插件行为，全放行又漏掉不可逆删除，
因此改用「`del` + 恰好 3 段」的形状规则兜底。

后果：`del('/api/students/123')` 被拦，
`del('/api/classes/123/students/456')`（从班级移除学生）**不因形状被拦**，
只需 `api:write`。新增写端点若忘记登记前缀表，会以「普通路径」放行 ——
这是源码自己列出的残余风险。

`hasCapability(caps, name)` 的匹配是 `c === name || c.startsWith(name + ':')`，
**`*` 不是超级能力**：声明 `*` 过不了 `hasCapability`，但 `api:write` 能过
`api:` 前缀检查 —— 注意方向，声明 `api` 不能解锁 `api:write`，
声明 `api:write` 会同时满足 `api`。
```

### 6.3 `exposeToAgent` 的降级而非拒绝

```{important}
`ActionDescriptor.exposeToAgent` 默认值是 `true`。若 Barrier 3 直接拒绝
未声明 `agent:tool` 插件的 `register()` 调用，`activate()` 会随之失败、
插件被打成 `state=error` —— 升级回归门禁（Issue #147）用三个真实第三方插件
验证时，`class-manager` / `attendance-record` 全部因此激活失败。

现在 `sanitizeActionRegisterArgs` 把 descriptor **改写为 `exposeToAgent: false`**
再转发，并返回一条 `downgraded` 说明：

`action "<type>" 的 exposeToAgent=true 需要 'agent:tool' 能力；插件未声明该能力，已降级为 exposeToAgent=false（不进入 AI Agent 工具列表，其余功能不受影响）。`

**这是典型的静默降级**：插件注册成功、激活成功、命令能跑，
唯一的变化是 AI Agent 的工具列表里没有它。若你发现
「action 明明注册了但 `getAgentTools()` 里没有」，先查 manifest 是否声明了
`agent:tool`，而不是怀疑 `getAgentTools` 的过滤逻辑。
`checkMethodPolicy` 里对 `register` 的拒绝分支仍然保留（纵深防御），
只在绕过 sanitize 的直接调用时触发。
```

### 6.4 两端 `caps` 的来源不同

```{danger}
源码「残余风险」第 3 条原文要点：

- **服务端（worker / process）**传入的 `caps` 是「清单声明 **∩** 管理员已审批」
  —— 自声明但未审批的能力**不生效**（Issue #224）；
- **浏览器侧没有 `CapabilityGuard`**，用的仍是清单自声明值 ——
  那里声明 `api:admin` **就真的拿到了它**。

因此同一份 manifest，在两个Barrier 3 实例上的判定结果可以不同。
前端 `capabilitiesProposed` 的提取优先级为：
扁平 `record.capabilitiesProposed` → `record.manifest`（JSON 字符串）→ `[]`。
**空数组会触发 Barrier 2 的只读降级**（见 §8.1），这是又一个静默失败路径。
```

---

## 7. 前端 Token 名（5 个）

定义在 `src/plugin-host/types.ts`，命名空间是 `@openlearn/frontend:`：

| 常量                           | Token 名                                    |
| ------------------------------ | ------------------------------------------- |
| `FRONTEND_API_TOKEN`           | `@openlearn/frontend:IFrontendAPI`          |
| `SOCKET_SERVICE_TOKEN`         | `@openlearn/frontend:ISocketService`        |
| `UI_SERVICE_TOKEN`             | `@openlearn/frontend:IUIService`            |
| `STORAGE_SERVICE_TOKEN`        | `@openlearn/frontend:IStorageService`       |
| `SEMESTER_GRADE_SERVICE_TOKEN` | `@openlearn/frontend:ISemesterGradeService` |

```{warning}
`STORAGE_SERVICE_TOKEN` 的前端名与 §3.1 的后端 `@openlearn/core:IStorageService`
**是两个不同的 Token**，指向两个不同的实现。
`BASE_FRONTEND_WORKER_SERVICE_TOKENS` 有 4 项（不含 semester grade），
后者在 `SENSITIVE_FRONTEND_SERVICE_TOKENS` 里单独设防，见
{doc}`platform-services` 第 5 节。
```

---

## 8. 共享模块、状态与批准表

### 8.1 `PLUGIN_SHARED_MODULES`（7 个）

```
recharts, react-markdown, jspdf, jspdf-autotable, exceljs, lucide-react, uuid
```

```{note}
`konva` / `react-konva` **不在**此列表：它们是纯 ESM，无法在 worker 侧以 CJS 方式注入，
只在前端沙箱里可用。插件里 `import('konva')` 在服务端会失败。

同理，不要指望 `lodash`、`dayjs`、`date-fns`、`nanoid` —— 一个都不在。
需要用就在插件自己的 bundle 里带上。
```

### 8.2 `PluginState`（7 个）

```
installed → inactive ⇄ active → error
               ↓                    ↑
            (activating) ──────────┘
              suspended
```

| 状态           | 含义                  | HTTP 请求结果                           |
| -------------- | --------------------- | --------------------------------------- |
| `installed`    | 已入库未激活          | 503 `Plugin "x" is currently installed` |
| `activating`   | 激活管道执行中        | 503                                     |
| `active`       | 正常                  | 正常分发                                |
| `suspended`    | 被暂停（配额/管理员） | 503                                     |
| `error`        | 激活或运行期抛错      | 503                                     |
| `deactivating` | 停用中                | 503                                     |
| `uninstalled`  | 已卸载（行仍在）      | 404                                     |

非法迁移抛 `IllegalStateTransitionError`，见 §9。

### 8.3 批准表（能力与出网域名）

````{danger}
**清单里的 `capabilitiesProposed` 只是申请，不是授权。**
第三方插件的每项能力必须由管理员写入下表后才生效：

```sql
CREATE TABLE IF NOT EXISTS plugin_capability_grants (
  plugin_key  TEXT    NOT NULL,
  capability  TEXT    NOT NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_key, capability)
);
CREATE TABLE IF NOT EXISTS plugin_network_grants (
  plugin_key TEXT    NOT NULL,
  host       TEXT    NOT NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_key, host)
);
```

`plugin_key` 匹配 `plugins` 行的 **UUID 或 `manifest.id`**（两个 key 都会查，
`keys.some(...)` 语义）。授予规则：

| 情形 | 结果 |
| --- | --- |
| 官方 / 可信插件（`isTrustedInProcessPlugin`） | 自动授予所有**非通配**能力 |
| 第三方插件 + 管理员已写入批准表 | 授予 |
| 第三方插件 + 未批准 | **不报错**，只 `console.warn('[PluginHost] Capability "..." awaits administrator approval')` 并跳过 |
| `*` / `*:*` / `*:*:*` | **永远拒绝**，`isBlockedPluginCapability` 硬挡，批准接口也会跳过 |
| `capService.grant()` 自身抛错 | rethrow，**中止激活** |

因此未获批准的插件会**激活成功**，然后在第一次调用相关命令时收到
`PluginCapabilityDeniedError`。这是最容易被误判为「平台 bug」的现象。
````

`clearPluginGrants(db, keys)` 在卸载时同时删两张表的行；
`revokePluginNetHost` 返回布尔以区分「撤了」与「本来就没有」。

### 8.4 出站域名归一化与拒绝原因

`normalizeNetHost` 只返回 `null` 不说明原因，因此另有
`classifyNetHostProposals(hosts)` 返回 `{ raw, host, approvable, reason }`，
拒绝原因按顺序判定：

| 条件                 | reason                                    |
| -------------------- | ----------------------------------------- |
| 非字符串             | `不是字符串`                              |
| 空串                 | `空字符串`                                |
| 长度 > 253           | `域名过长（>253）`                        |
| 含 `*`               | `不支持通配符，请逐个列出域名`            |
| 含 `/` `:` 空格      | `只能写主机名，不能带协议、端口或路径`    |
| 回环 / 私有 / 保留   | `回环/私有/保留地址一律拒绝（SSRF 防线）` |
| 四段数字但某段 > 255 | `非法 IPv4 字面量`                        |
| 其余                 | `不是合法的域名或 IP`                     |

```{warning}
SSRF 防线比直觉严格：`localhost`、`*.localhost`、`*.local`、`0.0.0.0`、`::1`、
以及 IPv4 的 `0.x` `10.x` `127.x` `100.64–127.x` `169.254.x` `172.16–31.x`
`192.0.0.x` `192.0.2.x` `192.168.x` `198.18/19.x` `198.51.100.x` `203.0.113.x`
`a >= 224` 全部拒绝。
且解析**接受** `0x7f000001`、`017700000001`（十六进制 / 八进制字面量）
这类变形写法并归类为私有 —— 别指望用 `http://0x7f000001/` 绕过。

另外注意：`normalizeNetHost` 拒绝含 `:` 的输入，
因此**IPv6 字面量域名一律无法批准**（`[::1]` 之类的检查在更前面）。
开发时把出站域名写成 `api.example.com:8443` 会得到「不能带端口」的拒绝，
协议与端口不参与匹配。
```

### 8.5 `student-data:*` 在两条路径上都硬拦

````{danger}
`student-data:read` / `student-data:write` 不只出现在 Barrier 3，
它们在 **inline 的包装层里就直接抛错**（Issue #225，此前只告警后放行）：

```typescript
function wrapPointsLedgerService(service, pluginId, capabilities?) {
  const auditAccess = (studentId, method, operation, requiredCap) => {
    const hasCap = hasCapability(capabilities ?? [], requiredCap);
    recordSecurityAudit('plugin.student_data_access', {
      pluginId, studentId, method, operation, hasCapability: hasCap,
      ...(hasCap ? {} : { denied: true }),
    });
    if (!hasCap) throw new PluginCapabilityDeniedError(pluginId, requiredCap, operation, method);
  };
```

`addPoints` 要求 `student-data:write`，`getLogs` / `getStudentTotalByDimension`
要求 `student-data:read`。worker 侧 `service-host.ts` 用同一口径，
注释原文：「inline 与 worker 两条隔离路径不能一个拦一个放」。

三个后果：

1. 只声明 `student:write`（体系 ① 的值）**不能**解锁 `addPoints` —— 名字很像，
   是两套东西；
2. 被拒绝的调用**仍会写一条 `plugin.student_data_access` 审计记录**（`denied: true`），
   排查时别把它当成成功调用；
3. `callerPluginId` 是第 6 个参数且**由包装层自动填**本插件 id，
   你手动传值会被覆盖（详见 {doc}`platform-services` 2.6）。
```

```{warning}
### 文档仍在描述「兼容期放行」，代码已经改成硬拒

`docs/reference/plugin-capability-matrix.md` §5.3 的第 2 条原文：

> **渐进迁移兼容期**：对于尚未声明该能力的存量插件，当前版本在控制台输出警告并放行，
> 在审计记录中标记 `migrationWarning: true`；待升级周期结束后将强制阻断未声明能力的插件访问。

而 `context-builder.ts` 的注释是「Issue #225：缺能力时**直接拒绝**，不再只告警后放行」，
代码里也确实 `throw new PluginCapabilityDeniedError(...)`，且**没有任何**
`migrationWarning` 字段被写入（grep 无果）。

按代码为准。这条漂移本身就是本页存在的理由之一 ——
`docs/` 下的参考文档不保证与源码同步。
````

---

## 9. PluginHost 错误类（18 个）

```{important}
基类构造是 `super(\`[PluginHost] ${message}\`)` —— **每一条消息都带
`[PluginHost] ` 前缀**，包括子类。做字符串匹配、写测试断言、
或在前端按 `err.message` 分支时，前缀必须算进去。
每个类都设 `this.name = '<ClassName>'`，`instanceof` 在跨 realm（worker/process 序列化后）
会失效，判断类型请读 `error.name`。
```

| 类                               | 继承                   | 消息模板（不含 `[PluginHost] ` 前缀）                                                                                                                        |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PluginHostError`                | `Error`                | 基类                                                                                                                                                         |
| `PluginCapabilityDeniedError`    | `PluginHostError`      | `Plugin "<id>" denied: ${读取\|写入}学生数据需要 '<cap>' 能力（调用 <method> 被拒绝）`                                                                       |
| `PluginActivateError`            | `PluginHostError`      | `Plugin "<id>" activation failed: <message>`                                                                                                                 |
| `PluginDeactivateTimeoutError`   | `PluginHostError`      | `Plugin "<id>" deactivate timed out after <ms>ms`                                                                                                            |
| `IllegalStateTransitionError`    | `PluginHostError`      | `Illegal state transition for plugin "<id>": <from> → <to>`                                                                                                  |
| `SemverMismatchError`            | `PluginHostError`      | `Plugin "<name>" (<id>) requires <token>@<range>, but host provides <ver>. Please upgrade the host or use a compatible plugin version.`                      |
| `PluginDispatchTimeoutError`     | `PluginHostError`      | `Plugin "<id>" request timed out after <ms>ms`                                                                                                               |
| `HotReloadError`                 | `PluginHostError`      | `Hot reload failed for "<id>": <message>`                                                                                                                    |
| `HotReloadActivationError`       | `HotReloadError`       | `Activation of new version failed: <cause.message>`                                                                                                          |
| `MiddlewareError`                | `PluginHostError`      | `Middleware error in phase "<phase>" for "<id>": <message>`                                                                                                  |
| `PluginSignatureError`           | `PluginHostError`      | `Signature verification failed for "<id>" [<code>]: <message>`                                                                                               |
| `PluginIntegrityRequiredError`   | `PluginSignatureError` | code=`COMMUNITY_INTEGRITY_REQUIRED`                                                                                                                          |
| `PluginAttestationRequiredError` | `PluginSignatureError` | code=`COMMUNITY_ATTESTATION_REQUIRED`                                                                                                                        |
| `PluginIntegrityMismatchError`   | `PluginSignatureError` | code=`COMMUNITY_INTEGRITY_MISMATCH`；默认消息 `Integrity verification failed for plugin "<id>". Downloaded ZIP checksum does not match repository metadata.` |
| `PluginSignatureInvalidError`    | `PluginSignatureError` | code=`COMMUNITY_SIGNATURE_INVALID`                                                                                                                           |
| `PluginMigrationError`           | `PluginHostError`      | `Plugin "<id>" migration failed: <message>`                                                                                                                  |
| `PluginMigrationExecutionError`  | `PluginMigrationError` | `Execution of migration "<name>" failed: <cause.message>`                                                                                                    |
| `PluginMigrationDowngradeError`  | `PluginMigrationError` | `Downgrade rejected: Database has migration version <n>, but package only declares version <m>. Downgrading plugin database schema is not permitted.`        |

```{warning}
`PluginDispatchTimeoutError` 的消息是 `request timed out`，
但网关侧返回给浏览器的是 HTTP 504 + `{ success:false, error:'Gateway Timeout: Plugin did not respond in time' }`
—— **两个字符串不同源**。用户看到的是后者，日志/审计里可能是前者，
grep 时两个都要试。见 {doc}`http-api` 第 5 节。

`PluginMigrationDowngradeError` 值得单独记住：插件数据库版本**只能升不能降**。
回滚插件包版本后，若 DB 里已是更高 migration version，激活会直接失败，
必须手工处理 `plugin_migrations` 表 —— 平台不提供降级路径。
```

---

## 10. 我该填哪个字符串（决策表）

| 我想做的事                               | 需要的字符串                                         | 属于                         |
| ---------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| 发起一个内核命令                         | 命令本身要求的能力，从 §5.1 的 19 个里挑             | ①                            |
| 在 worker 里调用 `IFrontendAPI.del/post` | `api:write`，命中高危路径再加 `api:admin`            | ③                            |
| 让 action 出现在 AI Agent 工具列表       | `agent:tool`（否则静默降级为 `exposeToAgent:false`） | ③                            |
| 注册后台 handler / interval              | `task:register`                                      | ③                            |
| 读写学生积分流水                         | `student-data:read` / `student-data:write`           | ③（inline 与 worker 都硬拦） |
| 驱动 AI 生成                             | `ai:invoke`                                          | ③（注意与体系 ② 同名）       |
| 写学期成绩                               | `grades:write`                                       | ③                            |
| 启动某个 activity-ecosystem 活动         | 由 provider descriptor 决定，manifest 里写无效       | ②                            |
| 访问外部域名                             | 不是 capability，是 `network.outbound` + 管理员批准  | §8.3                         |
| 用 `ctx.resolve('...')`                  | §3 的 31 个 token 名之一                             | DI                           |
| 引用一个 SDK 类型（`@types`）            | `packages/plugin-sdk/openlearn.d.ts` 的导出          | —                            |

---

## 11. 提交前自查

1. manifest 里每个 `capabilitiesProposed` 值都能在 §5.1 / §6 / §5.3 找到消费点，找不到就删掉；
2. 没有写 `user:*`、`ai:read`、`storage:write`、`quiz:write`、`network:*` 之一；
3. `requires` 每一项通过 §1 的正则（重点是 `@scope/pkg:IName` 的斜杠与冒号位置）；
4. 字符串 resolve 只用 §3 表里的 token 名，且注意 `IPlatformServiceRegistryService` 的双 `Service`；
5. worker/process 插件：确认所需 token 在 §4.1 的 9 个或 `computeAllowedWorkerTokens` 追加项里；
6. 用了 `registerInterval` / `registerHandler` / `restore` → 声明 `task:register`；
7. 用了 `actionRegistry.register` 且希望进 Agent 工具列表 → 声明 `agent:tool`，否则检查是否被降级；
8. 用了 `pointsLedger.addPoints` / `getLogs` → 声明 `student-data:write` / `:read`；
9. 前端 `IFrontendAPI` 写操作 → 声明 `api:write`，命中 8 个高危前缀之一 → `api:admin`；
10. 第三方插件：确认管理员批准页已勾选这些能力，否则激活会「成功」但调用被拒；
11. 没有在 manifest 或代码里写 `'*'` / `'*:*'` / `'*:*:*'` 作为申请（永远拒绝）；
12. 出站域名只写主机名，无协议/端口/路径/通配符，且不是回环或私有地址；
13. 错误断言按 `error.name` 而非 `instanceof`，且消息带 `[PluginHost] ` 前缀；
14. 没有指望 `ALL_SERVICE_TOKENS` 作为可用性判据。

---

## 12. 取证

| 断言                                                                                | 来源                                                                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PLUGIN_RESOLVABLE_TOKENS` 30 项 + `PLUGIN_RESOLVABLE_TOKEN_NAMES` 追加 1 个名字    | ``packages/core/di/interfaces.ts`→`PLUGIN_RESOLVABLE_TOKENS`（L946） 起）                                                         |
| E-2 背景：字符串路径此前直达 `serviceRegistry.resolveByName` 无门禁                 | 同上，白名单上方注释块                                                                                                            |
| 「新增对外 Token 时同步加到这里」                                                   | 同上                                                                                                                              |
| 31 个 token 名的逐字字符串                                                          | `interfaces.ts` 内每条 `export const I*Token = new Token<...>('...')`                                                             |
| `IPlatformServiceRegistryToken` → `@openlearn/core:IPlatformServiceRegistryService` | `interfaces.ts`（常量名 ≠ token 名）                                                                                              |
| `IAuthSessionBridgeToken` 带 version `'1.0.0'`                                      | `interfaces.ts`                                                                                                                   |
| `IDatabaseToken` 泛型为 `SqliteDatabase`                                            | `interfaces.ts`                                                                                                                   |
| 5 个白名单外内部 Token                                                              | `interfaces.ts`（`ICapabilityGovernanceServiceToken` 等声明处）                                                                   |
| `BASE_WORKER_SERVICE_TOKENS` 9 项逐字                                               | ``packages/core/worker-runtime/worker-manager.ts`→`BASE_WORKER_SERVICE_TOKENS`（L76））                                           |
| `ALL_SERVICE_TOKENS` 为「兼容性超集」                                               | 同文件 L131132 起                                                                                                                 |
| `IPluginHost` 于 2026-10-04 移出 worker 基线及「后门」理由                          | `docs/reference/plugin-trust-boundary.md`；测试 `expect(BASE_WORKER_SERVICE_TOKENS).not.toContain('@openlearn/core:IPluginHost')` |
| `requires` 正则原文                                                                 | `packages/core/esm-loader/manifest-schema.ts`                                                                                     |
| 19 个 `capabilityRequired` 值与声明处数                                             | `docs/reference/plugin-capability-matrix.md` §1.1                                                                                 |
| `quiz:write` 零消费点                                                               | 同上 §1.5 注                                                                                                                      |
| 内置插件 `capabilitiesProposed` 7 份真实值                                          | `packages/plugins/{builtin,vfs,process,management,ai-planner,assignment-eval,ai-submit-injector}.ts`                              |
| 体系 ② 的 7 个 `RuntimePermission`                                                  | `packages/activity-ecosystem` 类型定义 + 能力矩阵 §1.3                                                                            |
| `startActivity` 的 `some(Boolean)` 与 `PERMISSION_DENIED`                           | `packages/activity-ecosystem/registry.ts`                                                                                         |
| 403 映射                                                                            | `server/routes/os.ts` `POST /api/activities/:id/start`                                                                            |
| `assignment.*` 两处要求不同能力                                                     | `packages/plugins/management.ts` / `assignment-eval.ts`                                                                           |
| 通配符与管理员短路、7 个预置 actor、两张角色兜底表                                  | 能力矩阵 §1.4 / §1.5（`CapabilityGuard` 构造函数与 `check()`）                                                                    |
| 8 个 method-policy capability 常量                                                  | `packages/core/plugin-host/method-policy.ts`（repomix L110122 起）                                                                |
| `HIGH_RISK_PATH_PREFIXES` 8 项 / `IRREVERSIBLE_PATH_SUFFIXES` / `ENTITY_DELETE_RE`  | 同文件                                                                                                                            |
| Barrier 3 逐条拒绝消息原文                                                          | 同文件 `checkMethodPolicy`                                                                                                        |
| `exposeToAgent` 降级历史与 Issue #147                                               | 同文件 `sanitizeActionRegisterArgs` 文档注释                                                                                      |
| 残余风险第 3 条（服务端 caps = 声明 ∩ 已审批，Issue #224）                          | 同文件「残余风险」段                                                                                                              |
| 前端 caps 提取优先级与空数组降级                                                    | `src/plugin-host/capabilities.ts`、`service-host.ts` Security Barrier 2                                                           |
| 5 个前端 Token 名                                                                   | ``src/plugin-host/types.ts`→`FRONTEND_API_TOKEN`（L21–L25））                                                                     |
| `PLUGIN_SHARED_MODULES` 7 项与 konva 例外                                           | `packages/core/plugin-host/*`（repomix L113731）                                                                                  |
| `PluginState` 与状态迁移                                                            | ``packages/core/plugin-host/types.ts`→`Disposable`（L44–L60））                                                                   |
| 两张批准表 DDL、`isBlockedPluginCapability`、授予规则 5 条                          | `packages/core/plugin-host/plugin-grants.ts`（repomix L111539 起）                                                                |
| `classifyNetHostProposals` 的 8 条拒绝原因                                          | 同文件                                                                                                                            |
| `isPrivateOrReservedHost` / `parseIpv4HostOctets` 的进制变形处理                    | 同文件                                                                                                                            |
| 18 个错误类与消息模板                                                               | ``packages/core/plugin-host/errors.ts`（L1））                                                                                    |
| `[PluginHost] ` 前缀约定（D-10/D-11 四条模式）                                      | 同文件头注释                                                                                                                      |
| `student-data:*` 在 inline 硬拦（Issue #225）+ 审计先落再抛                         | `context-builder.ts` `wrapPointsLedgerService`（repomix L103158–103200）                                                          |
