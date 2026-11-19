# ext-teacher-kb「读取 AI 模型列表失败」根因分析

> **归档说明**：本文是 2026-11-19 对一次线上插件故障的根因定位记录，**只做归档，不随代码更新**。
> 对象基线：`openlearn-next@0.7.17`（`package.json`）＋ `@openlearn/plugin-sdk@3.8.0`（npm latest），
> 代码引用对齐 `main@ccae0db`（行号以该提交为准）。
> 需要「现在是什么样」时，请读源码与[现行权威页面](#9-现行权威页面)。

---

## 0. 一句话结论

插件调用的 `ctx.services.ai.listProviders()` **在平台契约里从来就不存在**。

`IAIService` 自设计起就只有 1 个必需方法（`generateText`）＋ 5 个可选方法（Persona / 上下文注册），
`listProviders` 不在其中。这**不是**配置没配好、**不是**能力没审批、**不是** SDK 版本落后 ——
而是插件作者臆造了一个从未发布过的 API。

---

## 1. 现象与错误溯源

### 1.1 现场报错

```
[Plugin:ext-teacher-kb] 读取 AI 模型列表失败: Method "listProviders" not found on service "@openlearn/core:IAIService"
```

前半段 `[Plugin:ext-teacher-kb] 读取 AI 模型列表失败:` 是**插件自己**的 catch 块日志（中文业务语义 + 插件 id 前缀）。
后半段是**平台抛出的原始错误**，逐字命中：

```ts
// packages/core/worker-runtime/service-host.ts:1198-1201
const method = (service as Record<string, unknown>)[msg.method];
if (typeof method !== 'function') {
  throw new Error(`Method "${msg.method}" not found on service "${msg.token}"`);
}
```

该错误经 `service-proxy.ts:393-397` 回传沙箱侧，`pending.reject(err)` 复活为 `Error`，
`err.name` 取回传的 `code`（此处为 `Error`，未标 `WorkerCapabilityError` —— 这也是排除「能力门禁」的关键线索，见 §3）。

### 1.2 故障表现

- **只影响「模型列表」这一项功能**，AI 问答本身可用（见 §5.1）。
- 插件侧已 try/catch，属**降级而非崩溃**：面板拿不到列表，但插件不 `state=error`。
- 与该插件上一次事故**同源不同症**：上一次是「网关写死 5000ms 导致 `/chat` 间歇性 504」
  （平台读了 manifest 的 `timeoutMs` 声明却没有，回归测试见提交 `285f22d`，该提交**尚未合入 main**），
  这一次是插件写了平台不存在的调用。两次都指向同一件事 —— **`ext-teacher-kb` 与平台契约之间存在持续性缺口**。

### 1.3 本次分析未能覆盖的部分

`ext-teacher-kb` **不在本仓库，也不在本机任何插件仓库**（已核查 `plugins/`、`v2_plugins/`、
`~/Develop/openlearn-plugins`、`~/Develop/openlearn-next-plugins`，以及本机 SQLite 的 `plugins` 表 —— 无该行）。
因此以下结论来自**平台侧源码与已发布 SDK 的静态证据**，而非在本机复现：

- 插件源码原文、其 manifest 的 `capabilitiesProposed`、其 `execution_mode`；
- 该错误出现在哪个部署环境（本地库无此插件，故非本机开发环境）。

---

## 2. 根因链

### 2.1 契约层：真源里就没有这个方法

```ts
// packages/core/di/interfaces.ts:281-308
export interface IAIService {
  generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;
  registerAIContextProvider?(id: string, fn: (lessonId: string | null) => string | null): void;
  unregisterAIContextProvider?(id: string): void;
  registerAIPersona?(persona: AIPersonaDefinition): void;
  listAIPersonas?(): AIPersonaDefinition[];
  unregisterAIPersona?(id: string): void;
}
```

`listProviders` 不在集合内。注意 `listAIPersonas`（列 Persona）**有**，`listProviders`（列 Provider）**没有** ——
二者语义相近但分属不同后缀族，容易混。

### 2.2 实现层：`AIService` 也没有

```ts
// packages/core/di/ai-service.ts:29-164 —— AIService implements IAIService
```

实际方法只有：`generateText` / `registerAIPersona` / `listAIPersonas` / `unregisterAIPersona` /
`registerAIContextProvider` / `unregisterAIContextProvider`。
实现类**没有** `listProviders`，沙箱按方法名反射查找必然落空。

### 2.3 沙箱层（worker / process 模式）：错误在此抛出

worker / process 模式下插件通过 RPC 调用宿主服务。`ServiceHost.handleInvoke` 的流程是：

| 步骤                     | 位置                        | 结果                                                                                                                                                                     |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Barrier 1 · Token 白名单 | `service-host.ts:759-765`   | **通过** —— `@openlearn/core:IAIService` 在 `BASE_WORKER_SERVICE_TOKENS` 内（`worker-manager.ts:76-89`），默认授予所有 worker 插件                                       |
| Barrier 2 · 空能力降级   | `service-host.ts` 早段      | **通过** —— 插件 manifest 有能力声明                                                                                                                                     |
| Barrier 3 · 方法级策略   | `method-policy.ts:271-283`  | **通过** —— 该分支只拦 `generateText`/`chat`/`complete`（需 `ai:invoke`）与 `registerAIPersona`/`registerAIContextProvider`（需 `ai:persona`）；**未列出的方法一律放行** |
| 方法查找                 | `service-host.ts:1198-1201` | ❌ **抛错** —— 实例上没有 `listProviders`                                                                                                                                |

即：**三道安全闸全部放行**，请求死在最后一步「方法不存在」。这说明故障与权限体系无关。

### 2.4 inline 模式：错误文案不同，但同样失败

inline 模式下 `ctx.services.ai` 是 `wrapAI()` 返回的**对象字面量**，只显式列出 6 个方法：

```ts
// packages/core/plugin-host/context-builder.ts:1026-1081
return {
  generateText: ..., registerAIContextProvider: ..., unregisterAIContextProvider: ...,
  registerAIPersona: ..., listAIPersonas: ..., unregisterAIPersona: ...,
} as IAIService;
```

`listProviders` 同样是 `undefined` → 插件侧抛 `TypeError: ctx.services.ai.listProviders is not a function`。

### 2.5 SDK 与文档层：契约对外一直是「1 + 5」

| 出处                                                                  | 声明内容                                     |
| --------------------------------------------------------------------- | -------------------------------------------- |
| `packages/plugin-sdk/openlearn.d.ts:243-261`                          | `IAIService` = `generateText` + 5 个可选方法 |
| npm 已发布 `@openlearn/plugin-sdk@3.8.0` 的 `dist/index.d.ts:231-249` | 同上（逐字核对 tarball）                     |
| `docs/api/di-tokens.md:262-274`                                       | 「5 个可选成员」+ 完整签名                   |
| `docs/agent/reference/platform-services.md:223-260`                   | 同上，并强调「插件里**没有** API Key 概念」  |

**已核验**：npm 上 `@openlearn/plugin-sdk` 从 `3.1.0` 到 `3.8.0` 的**全部已发布版本**，`IAIService` 均无 `listProviders`。
该 SDK 里唯一叫 `listProviders` 的是 **`ActivityRegistry.listProviders(): ReadonlyArray<ActivityProvider>`**
（发布版 `dist/index.d.ts:771`；平台侧实现 `packages/activity-ecosystem/registry.ts:57`）——
即**活动生态**的 provider 注册表，与 AI provider 毫无关系。

> **推断（未经证实）**：插件作者很可能在 SDK 类型里看到过 `listProviders`（活动注册表的那个），
> 遂假定 AI 服务上也有同名方法。这是命名撞车导致的臆造，**不是** SDK 缺文档。

### 2.6 结论

> 平台从未提供过「列出 AI 提供商 / 模型」的内核 API。
> `ext-teacher-kb` 调用了一个**不存在于任何已发布版本**的接口，属于**插件侧契约幻觉**。

---

## 3. 排除法：为什么不是其它常见原因

| 假设                          | 证据                                                                                            | 判定        |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | ----------- |
| Token 未授权                  | `@openlearn/core:IAIService` ∈ `BASE_WORKER_SERVICE_TOKENS`（`worker-manager.ts:83`）           | ❌ 排除     |
| 能力没审批（`ai:invoke`）     | Barrier 3 对未列方法一律放行；且报错文案是「Method not found」而非「Call denied for actor ...」 | ❌ 排除     |
| manifest 声明缺失导致只读降级 | Barrier 2 拒绝的是写操作，且文案不同                                                            | ❌ 排除     |
| SQL 守卫拦了                  | 插件此处未查库；守卫报错形如 `Worker plugin "..." is not permitted to access table ...`         | ❌ 排除     |
| 平台版本落后于插件            | npm 全部已发布 SDK 版本均无此方法                                                               | ❌ 排除     |
| 插件装错 / 未激活             | 错误发生在方法调用时，说明插件已激活并拿到了 `ctx.services.ai`                                  | ❌ 排除     |
| **调用了不存在的 API**        | §2 全链路证据                                                                                   | ✅ **成立** |

---

## 4. 两种执行模式的行为差异（排查陷阱）

| 模式             | `ctx.services.ai` 来源           | 实际失败形态             | 错误文案                                                                   |
| ---------------- | -------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| worker / process | RPC 代理 → 宿主 `AIService` 实例 | 宿主抛错 → RPC 回传      | `Method "listProviders" not found on service "@openlearn/core:IAIService"` |
| inline           | `wrapAI()` 的对象字面量          | 插件侧属性为 `undefined` | `TypeError: ctx.services.ai.listProviders is not a function`               |

**同一个 API 幻觉，在两种模式下给出完全不同的报错**。本报告中的文案对应 worker / process 模式；
若在 inline 模式下看到 TypeError，是**同一个根因**，不要误判为「两处都要修」。

---

## 5. 影响面

### 5.1 插件侧

- 失效范围：**仅「AI 模型列表」**。`generateText` 不受影响 ——
  未指定 `providerId` 时，`resolveAccessibleAiProvider`（`packages/core/di/ai-provider-resolver.ts:101-133`）
  在无 `userId` 上下文下回落到**平台共享 / 预置 provider**（`is_shared = 1 OR owner_id IS NULL`），仍能正常出字。
  这与「模型列表报错、但问答正常」的现象吻合。
- 降级而非崩溃：插件 catch 后功能退化，不影响插件存活。

### 5.2 平台侧

- **无回归风险**：从未有插件成功调用过该方法，平台不存在被绕过的路径。
- **无安全影响**：失败发生在方法查找阶段，未触达任何数据。
- 唯一的隐性成本是**排查成本** —— 错误文案指向「服务缺方法」，容易被误读为平台 bug。

### 5.3 SDK 生态

- 任何第三方插件若照搬这个写法都会踩同样的坑；SDK 未提供任何「列出 AI provider」的等价物，
  文档也未说明「插件拿不到 provider 列表」这一事实（`docs/agent/reference/platform-services.md:260`
  只说了「插件里没有 API Key 概念」）。

---

## 6. 当前版本即可用的替代路径（无需改平台）

> 以下三条是**今天就能落地**的绕行方案，按推荐度排序。

### 路径 A（推荐）：插件前端直连平台 REST

```
GET /api/ai-providers        # server/routes/plugins.ts:2154-2181
```

- 认证：Cookie Session，角色 `self` / `teacher` / `administrator`（**学生角色不可见**）。
- 返回：provider 数组，含 `id` / `name` / `api_url` / `model_name` / `owner_id` / `is_shared`，
  其中 `api_key` 已**掩码**（`maskApiKey`，解密失败时为 `[UNDECRYPTABLE]`，fail-closed 不抛 500）。
- 插件的「模型下拉框」本来就渲染在前端，直接在浏览器侧取即可，**后端无需任何改动**。
- 代价：列表只对教师/管理员可见；插件后端拿不到（见 §6.4）。

### 路径 B：后端直选 provider（不枚举）

`AIService.generateText` 的实现签名支持 `providerId`：

```ts
// packages/core/di/ai-service.ts:129-138
async generateText(prompt: string, options?: {
  systemInstruction?: string; temperature?: number; maxTokens?: number;
  userId?: string; providerId?: string;
}): Promise<string>
```

- 运行时**两种模式都透传**：inline 的 `wrapAI` 原样转发 `options`；worker 的 RPC 参数是 JSON 序列化。
- 但 `IAIService` 的**类型声明没有** `providerId`（`interfaces.ts:289`）→ TS 插件会报类型错，需 `as any` 或等类型补齐。
- ⚠️ **归属校验**：显式 `providerId` 时，`resolveAccessibleAiProvider`（`ai-provider-resolver.ts:85-98`）
  要求 `owner_id === userId` 或 `is_shared = 1`；插件调用通常**没有 `userId` 上下文** →
  **教师私有 provider 会 403**，共享 provider 才可用。别把它当成「任意 provider 直选」。

### 路径 C：provider id 写进插件自身配置

`ctx.config`（仅 inline）或插件自带 settings 表存 provider id，生成时按 id 直选。
适合「只支持一个 provider」的简化场景，但不支持运行时切换模型。

### 6.4 为什么插件后端不能自己查库

worker / process 插件的 SQL 受命名空间守卫限制（`packages/core/plugin-host/sql-guard.ts:294-334`）：
只允许 `plugin_<自己的 id>_*` 命名空间与授权前缀，`ai_providers` 属核心表 → 必被拒。
inline 插件虽默认不启用守卫（`packages/core/plugin-host/inline-db-guard.ts:1-18` 的
`OPENLEARN_SQL_GUARD_ALL_MODES` 开关），但**插件一旦切到 worker 模式同一段代码会立刻炸** ——
不应把它作为方案。

---

## 7. 修复方案对比（供决策，本次未实施）

| 方案                                                   | 改动面                                                                                                                                                                                                                                                                                | 向后兼容                     | 安全影响                                                                                                  | 门禁成本                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. 平台补齐 `IAIService.listProviders()`**           | `interfaces.ts`（加可选方法 + `AIProviderSummary` 类型）、`ai-service.ts`（实现）、`context-builder.ts`（`wrapAI` 补透传）、`method-policy.ts`（可选加能力闸）、`packages/plugin-sdk/openlearn.d.ts` + `generated.d.ts` + `index.ts` 导出、3～4 篇文档、`ai-service.test.ts` 新增用例 | 纯新增可选成员，老插件零影响 | 需**明确不含 `api_key`**；建议挂 `ai:invoke` 能力闸（与 `generateText` 同级），并保持「返回值只含元数据」 | 需重生成 SDK d.ts 并更新 `fixtures/sdk-drift-baseline.json`（`packages/plugin-sdk/__tests__/sdk-drift-parity.test.ts` 门禁）；须发 SDK 新版（插件要拿到类型） |
| **2. 插件侧改造（改用路径 A）**                        | 只动 `ext-teacher-kb`（不在本仓库）                                                                                                                                                                                                                                                   | 无平台改动                   | 无新增暴露面                                                                                              | 无                                                                                                                                                            |
| **3. 新增 action / command（如 `ai.providers.list`）** | 走 `actionRegistry` + `CommandBus`，需 ActionDescriptor、能力声明、Agent 工具暴露规则                                                                                                                                                                                                 | 中                           | 与 §7 方案 1 同量级，另加命令总线 default-deny 约束                                                       | 与方案 1 相当，另加命令注册与端到端用例                                                                                                                       |

**建议**：优先 **方案 2**（插件侧改造，恢复功能且零平台风险）；
若判断「插件需要枚举 provider」是**通用诉求**（不止 `ext-teacher-kb`），再做 **方案 1**，
并在方案 1 中明确两条硬约束 —— **返回值不含凭据**、**挂能力闸**。

---

## 8. 落地建议（遵循仓库协作规范）

1. **Issue-First**：在 GitHub（国内走 Gitee 镜像）开 Issue 记录契约缺口，标题建议
   `插件无法枚举 AI Provider：IAIService 缺少 listProviders()`。
2. **分支隔离**：实现走 `claude/<slug>` 分支，不直推 `main`。
3. **质量门禁**：`pnpm format:check`、`pnpm lint`、`pnpm lint:strict`、
   `node scripts/check-lint-budget.mjs`、`pnpm test`；若改动文档另跑
   `bash scripts/build-docs.sh` 与 `bash audit-tools/run.sh`。
4. **合并授权**：PR 只创建不合并，合并需人类开发者明确授权（推荐 Squash Merge）。

---

## 9. 现行权威页面

| 主题                        | 权威页面                                                                       |
| --------------------------- | ------------------------------------------------------------------------------ |
| Plugin SDK Token 与服务契约 | [api/di-tokens](../api/di-tokens.md)                                           |
| 插件服务上下文              | [agent/reference/platform-services](../agent/reference/platform-services.md)   |
| 能力与安全模型              | [reference/plugin-capability-matrix](../reference/plugin-capability-matrix.md) |
| 插件信任边界                | [reference/plugin-trust-boundary](../reference/plugin-trust-boundary.md)       |
| 审计归档索引                | [audit-index](audit-index.md)                                                  |

---

## 10. 证据索引

| 结论                                     | 证据位置                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| 错误抛出点                               | `packages/core/worker-runtime/service-host.ts:1198-1201`                             |
| RPC 错误回传与复活                       | `packages/core/worker-runtime/service-proxy.ts:393-397`                              |
| `IAIService` 契约（1 + 5）               | `packages/core/di/interfaces.ts:281-308`                                             |
| `AIService` 实现                         | `packages/core/di/ai-service.ts:29-164`                                              |
| inline 包装器（字面量 6 方法）           | `packages/core/plugin-host/context-builder.ts:1002-1081`                             |
| AI 方法级能力闸                          | `packages/core/plugin-host/method-policy.ts:270-283`                                 |
| worker Token 白名单                      | `packages/core/worker-runtime/worker-manager.ts:76-89`                               |
| SQL 命名空间守卫                         | `packages/core/plugin-host/sql-guard.ts:294-334`                                     |
| inline 守卫开关                          | `packages/core/plugin-host/inline-db-guard.ts:1-18`                                  |
| provider 解析与归属校验                  | `packages/core/di/ai-provider-resolver.ts:58-150`                                    |
| `GET /api/ai-providers`（掩码 key）      | `server/routes/plugins.ts:2154-2181`                                                 |
| SDK 契约（手写真源）                     | `packages/plugin-sdk/openlearn.d.ts:243-261`                                         |
| SDK 契约（已发布 3.8.0）                 | npm tarball `dist/index.d.ts:231-249`                                                |
| `listProviders` 的真实归属（活动注册表） | npm tarball `dist/index.d.ts:771`；`packages/activity-ecosystem/registry.ts:57`      |
| 契约文档                                 | `docs/api/di-tokens.md:262-274`；`docs/agent/reference/platform-services.md:223-260` |
| 该插件上一次平台缺口事故                 | 提交 `285f22d`（尚未合入 main，含对应回归测试）                                      |

### 核验命令

```bash
# 契约里没有 listProviders（预期无输出）
grep -rn "listProviders" packages/core/di/ packages/plugin-sdk/openlearn.d.ts

# 错误抛出点
grep -n "not found on service" packages/core/worker-runtime/service-host.ts

# AI Token 默认授予
grep -n "IAIService" packages/core/worker-runtime/worker-manager.ts

# 已发布 SDK 的 IAIService 声明
npm pack @openlearn/plugin-sdk@3.8.0 && tar xzf openlearn-plugin-sdk-3.8.0.tgz \
  && sed -n '/interface IAIService/,/^}/p' package/dist/index.d.ts
```
