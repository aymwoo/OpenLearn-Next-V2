# 测试与自检

本页回答三个问题：**插件代码怎么写测试**、**测试通过为什么不等于生产可用**、**没有真实宿主时怎样把风险压到最低**。

结论先行：

> [!warning]
> `@openlearn/plugin-test-kit` 的 Mock 上下文**刻意不做任何安全校验**。
> 表名规则、Token 白名单、capability 判定、命令拦截器、共享模块白名单在 Mock 里全部不存在。
> 单测全绿 + 插件装不上，是这个平台上最常见的 Agent 失败模式。
> 因此本页把「Mock 与生产宿主的差异」（§3）放在最显眼的位置。

---

## 1. 三层验证金字塔

| 层              | 工具                                                                           | 验证什么                                                                            | 验不到什么                    |
| :-------------- | :----------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- | :---------------------------- |
| **L1 单元**     | Vitest / Jest + `@openlearn/plugin-test-kit@3.3.3`                             | 业务分支、命令 handler 逻辑、SQL 语句是否可跑、路由响应形状                         | 全部安全边界（§3）            |
| **L2 平台集成** | 仓库内 `pnpm test`（Vitest，`pool: 'forks'` + `jsdom`）                        | 与真实 Kernel / 真实 SQLite / 真实 install 路径一起跑                               | 前端 iframe、浏览器扩展点渲染 |
| **L3 真实装载** | `npx @openlearn/plugin-sdk build` → ZIP → 插件中心上传 → 激活；或 `pnpm sweep` | 隔离档位、ZIP 内容、`frontend.js` 加载、`--permission` 旗标、网络代理、槽位实际渲染 | —                             |

`docs/examples/verifiable-examples.md` L18164 给出了 L1 的最小可编译契约样本。

---

## 2. L1：`@openlearn/plugin-test-kit`

包版本 **3.3.3**（`packages/plugin-test-kit/package.json` L141970），源码只有一个文件 `packages/plugin-test-kit/index.ts`（L141322–L141969，648 行）。

### 2.1 导出清单（全部 14 个）

```{important}
**这就是全部导出**，没有 `createMockKernel`、没有 `withRealCapabilities`、没有 `renderPluginView`。
凭直觉 import 其它名字会得到 `SyntaxError: The requested module ... does not provide an export named ...`。
```

| 导出                                                | 种类  | 用途                                |
| :-------------------------------------------------- | :---- | :---------------------------------- |
| `createMockContext(opts?)`                          | 函数  | 构造一个 `PluginContext` 替身       |
| `createMockStreamResponse()`                        | 函数  | SSE 写入器替身（§2.6）              |
| `runTestPluginMigrations(db, pluginId, dir, opts?)` | 函数  | 跑声明式 `migrations/*.sql`（§2.7） |
| `MockCommandBus`                                    | class | `commandBus` 替身                   |
| `MockEventBus`                                      | class | `eventBus` 替身                     |
| `MockActionRegistry`                                | class | `actionRegistry` 替身               |
| `MockCapability`                                    | class | `capability` 替身                   |
| `MockProcessManager`                                | class | `processManager` 替身               |
| `MockStorage`                                       | class | `storage` 替身                      |
| `MockAI`                                            | class | `ai` 替身                           |
| `MockLogger`                                        | class | `log` 替身                          |
| `CreateMockContextOptions`                          | type  | 选项类型                            |
| `MockStreamResult`                                  | type  | 流替身类型                          |
| `RunTestPluginMigrationsOptions`                    | type  | 迁移选项类型                        |

### 2.2 `createMockContext(options)`

```typescript
interface CreateMockContextOptions {
  pluginId?: string; // 默认 'ext-test'
  manifest?: Partial<Manifest>; // ⚠ 只读 name / version / main 三个字段
  capabilities?: string[]; // 默认 []
  customTokens?: Record<string, unknown>; // key 是 Token.name 字符串
  overrides?: {
    commandBus?: Partial<ICommandBusService>;
    eventBus?: Partial<IEventBusService>;
    actionRegistry?: Partial<IActionRegistryService>;
    capability?: Partial<ICapabilityService>;
    processManager?: Partial<IProcessService>;
    storage?: Partial<IStorageService>;
    ai?: Partial<IAIService>;
  };
}
```

真实行为（逐条对源码）：

- **`manifest` 参数是半透明的**。构造出的对象固定是
  `{ id: pluginId, name, version, main, capabilitiesProposed: opts.capabilities ?? [] }`
  —— 只有 `name` / `version` / `main` 会被采纳，`id` 永远由 `pluginId` 决定。
  `provides` / `requires` / `contributes` / `executionMode` / `api` 等字段**全部被丢弃**。
  因此 `ctx.manifest.contributes?.slots` 在 Mock 下恒为 `undefined`，
  读它的插件代码在单测里走的是「没有贡献」分支，而不是生产分支。

```{danger}
**`⚠ 与 LLM 先验冲突`**：`createMockContext({ manifest: fullManifest })` 不会给你一个完整的 manifest。
想在测试里验证 `contributes` 解析，必须直接对 `manifest.json` 跑 `manifest-schema.ts` 的 zod 校验
（`packages/core/esm-loader/manifest-schema.ts` L81517），Mock 帮不了你。
```

- **`capabilities` 有两个作用**：写进 `manifest.capabilitiesProposed`，并且逐个
  `mockCapability.grant('plugin:<pluginId>', cap)`。注意被授予的 actorId 是 `plugin:<pluginId>` 这个字符串；
  换成别的 actorId 去 `check()` 一律 `false`。
- **`overrides` 是 `Object.assign` 浅合并**，不是替换实例。你 override 掉 `execute` 之后，
  `MockCommandBus.handlers` 这个 Map 仍然是原来那个（多数断言依赖它，这是好事），
  但 `instanceof MockCommandBus` 依然为真而行为已被改写。
- **`MockCapability` 构造函数的 `initialCaps` 参数是死代码**：函数体里只有一句注释，
  真正授权发生在构造函数之后的 `for (const cap of opts.capabilities ?? [])` 循环。

### 2.3 `ctx` 成员与它们的 Mock 语义

| 成员                       | Mock 实现                                       | 生产宿主                                      |
| :------------------------- | :---------------------------------------------- | :-------------------------------------------- |
| `services.commandBus`      | `MockCommandBus`                                | 真 `CommandBus` + 默认拒绝拦截器              |
| `services.eventBus`        | `MockEventBus`（支持 `'*'` 通配订阅）           | 真 `EventBus`                                 |
| `services.actionRegistry`  | `MockActionRegistry`                            | 真注册表 + Barrier 校验                       |
| `services.capability`      | `MockCapability`                                | 真授权表（`plugin_capability_grants`）        |
| `services.processManager`  | `MockProcessManager`（`spawn` 只记 id，不执行） | 真进程/定时器管理                             |
| `services.storage`         | `MockStorage`（进程内 `Map`，**不落库**）       | `plugin_storage` 表                           |
| `services.ai`              | `MockAI`（`generateTextFn` 默认返回 `''`）      | provider gateway                              |
| `services.pointsDimension` | **恒为 `null`**                                 | inline 注入真服务；worker/process 也为 `null` |
| `services.pointsLedger`    | **恒为 `null`**                                 | 同上                                          |
| `db`                       | 内存 SQLite + 4 个方法（§2.5）                  | 共享库 + `sql-guard`                          |
| `log`                      | `MockLogger.messages[]`                         | 分级日志 + 脱敏                               |
| `http`                     | **真实的 `PluginHttpRouter` 实例**（来自 SDK）  | 同一个类                                      |
| `resolve(token)`           | 按 `token.name` 查表，未命中抛错                | E-2 白名单 + DI                               |
| `provide(token, inst)`     | 直接写入表，**不校验 `manifest.provides`**      | 必须声明，否则抛错                            |
| `require(name)`            | **总是抛错**                                    | `PLUGIN_SHARED_MODULES` 白名单                |
| `config.get()`             | 恒返回 `undefined`                              | 真实配置                                      |
| `config.getAll()`          | 恒返回 `{}`                                     | 真实配置                                      |
| `config.set()`             | no-op                                           | 写库                                          |
| `config.onChange()`        | 返回一个空注销函数                              | 真订阅                                        |
| `contributions.list()`     | 恒返回 `[]`                                     | 跨插件贡献                                    |
| `i18n.t(key, dv)`          | `dv` 是字符串就回显 `dv`，否则回显 `key`        | 词条表                                        |
| `i18n.getLanguage()`       | 恒 `'zh'`                                       | 跟随用户设置                                  |

```{danger}
**`config` 全家是空壳**。插件若依赖 `ctx.config.get('threshold')` 决定行为，
在单测里永远拿到 `undefined`，于是走 `?? defaultValue` 分支。
生产上管理员把该键设成别的值，行为就不同 —— 单测不会告诉你。
断言配置分支请显式 `overrides`：Mock 没有提供 config 的 override 入口
（`CreateMockContextOptions.overrides` 只有 7 个键），只能在用例里
`Object.defineProperty(ctx, 'config', ...)` 或 `(ctx as any).config.get = ...`。
```

`resolve` 未命中时的报错文案（逐字）：

```
[MockContext] No provider registered for token: <token.name>
```

`require` 的报错文案（逐字）：

```
[MockContext] require("<moduleName>") is not available in test context. Use customTokens to inject mock modules.
```

`tokenMap` 预置 8 个键（逐字）：`@openlearn/core:ICommandBusService`、
`IEventBusService`、`IActionRegistryService`、`ICapabilityService`、`IProcessService`、
`IStorageService`、`IAIService`、`IDatabase`。
`customTokens` 通过 `Object.assign` 合并进同一张表，所以**用同名 key 可以直接覆盖内建 mock**。

### 2.4 `MockCommandBus` 的两个致命简化

```typescript
async execute(command) {
  this.executeCalls.push(command);
  const handler = this.handlers.get(command.type);
  if (handler) return handler.execute(command);
  return undefined;          // ← 未注册：静默返回 undefined
}
async setInterceptor(_interceptor) { /* no-op */ }
```

- **未注册命令返回 `undefined`，不抛错**。生产 `CommandBus.execute()` 会抛
  `No handler registered for command: <type>`（``packages/core/command-bus/index.ts`→`handler`（L123）），
worker 侧另有 `No handler registered for command <type> in worker`
（`worker-runtime/bootstrap/sections/message-handler.ts`L125652）。
所以「命令名拼错」这种缺陷在单测里表现为断言`toBeUndefined()`通过，而不是失败。
防御写法：断言`bus.executeCalls.length`与`bus.handlers.has('<type>')`，而不是只看返回值。
- **`handler.execute` 是硬契约**。Mock 直接调用 `handler.execute(command)`，
  传裸函数得到 `handler.execute is not a function`。
  inline 宿主虽然兼容裸函数，但 **worker / process 与 Mock 都只认对象契约** ——
  第三方插件默认被强制到 `process`（见 [隔离与安全](isolation-and-security.md)），
  所以按对象写是唯一安全选择。
- **`setInterceptor` 是 no-op**，因此**不可能**在 Mock 里验证默认拒绝、
  高危命令进审批队列、capability 拒绝这三件事。这三件必须靠 L2/L3。

### 2.5 `ctx.db`：真 SQLite，零守卫

Mock 里 `new Database(':memory:')` 并预建两张表：`plugin_storage` 与 `plugin_migrations`。
表前缀 `plugin_<pluginId 里非 [A-Za-z0-9_] 换成 _>_`。

```{danger}
**Mock 的 `ensureTable` / `table()` 完全不过 `sql-guard`**：
不校验表名正则 `/^[A-Za-z_][A-Za-z0-9_]{0,63}$/`、不限制 schema ≤ 4000 字符、
不禁止分号、不禁核心表、不做跨库指令检查。
生产里 `ensureTable('1foo', ...)`、`ensureTable('a'.repeat(70), ...)`、
schema 里写 `;` 都会炸，单测全部通过。
```

`migrate(targetVersion, upgradeFn)` 在 Mock 与生产的语义一致（都是 `BEGIN IMMEDIATE` 包裹 +
写 `plugin_migrations` + 失败 `ROLLBACK` 后重抛），
所以**幂等性、版本推进、异常回滚是可以在 L1 真测的**——这是 Mock 少数可信的路径之一。

`dropAllTables()` 在 Mock 用 `LIKE '<prefix>%'` 枚举后逐个 `DROP`；
生产额外要求插件表名匹配 `^plugin_[A-Za-z0-9_]+$`（见 isolation-and-security §7）。

`resolve(IDatabaseToken)` 在 Mock 返回**裸的内存 better-sqlite3 句柄**，无任何语句守卫。
用它写的所有测试都不构成安全证据。

### 2.6 `createMockStreamResponse()`

返回 `{ stream, getChunks(), getErrors(), isEnded(), simulateClose() }`。
`stream.write(data, event, id)` 在 `isClosed` 后返回 `false`；`end()` 只置 `ended`；
`error(err)` 同时 push 到 errors 并置 `ended`；`onClose(cb)` 若已关闭则**立即同步调用** `cb`。
`isClosed` 是 getter：`closed || ended` —— 注意 `end()` 之后 `write()` 立刻变 false。

### 2.7 `runTestPluginMigrations()`

用于测试「从历史版本升级」的声明式 SQL 迁移。签名：

```typescript
runTestPluginMigrations(db, pluginId, migrationsDir, { tablePrefix? })
  : { appliedCount: number; appliedNames: string[] }
```

行为细节（逐条对源码 L141896–L141969）：

- 自建 `plugin_declared_migrations` 表；目录不存在直接返回 `{ appliedCount: 0 }`，**不报错**。
- 文件名按 `numeric: true` 的自然序排序（`2_x.sql` 排在 `10_x.sql` 前）。
- `-- UP` / `-- DOWN` 分段：`up = content.match(/--\s*UP([\s\S]*?)(?=--\s*DOWN|$)/i)`；
  没有 `-- UP` 标记时回退到「`-- DOWN` 之前的全部内容」。
- 支持 `{{prefix}}` 与 `{{table_prefix}}` 两种占位符替换。
- 版本号取文件名前导数字，取不到则为 `0`。
- 逐语句 `split(';')` 执行，整体包在 `db.transaction()` 里。

```{warning}
**它写入的 `checksum` 是硬编码字符串 `'test-checksum'`**。
生产的 `declarative-migrator.ts`（L106067）会比对校验和并在漂移时报错，
Mock 迁移助手**不做这件事**。
「改了已发布的迁移文件」这类缺陷在 L1 完全测不出来，只能靠
平台侧的 `scripts/upgrade-regression/`（L157474 起）。
```

---

## 3. Mock 与生产宿主的行为差异（本页最重要的一节）

``docs/sdk/plugin-test-kit.md`（L54） 自己列了这张表，此处按源码复核并补全。

| 行为                               | Mock                                                             | 生产宿主（`context-builder.ts` L102462）                               |
| :--------------------------------- | :--------------------------------------------------------------- | :--------------------------------------------------------------------- |
| `ctx.provide`                      | 不校验 `manifest.provides`，直接注册                             | `token.name` 必须完整出现在 `manifest.provides`，否则抛错              |
| `ctx.resolve`                      | 8 个预置 + `customTokens`，其余抛 `[MockContext] No provider...` | `PLUGIN_RESOLVABLE_TOKEN_NAMES`（31）白名单，非白名单静默 `undefined`  |
| `ctx.db.ensureTable/table`         | 无 SEC 校验                                                      | 表名正则、schema ≤ 4000、禁分号、40 张核心表黑名单、跨库指令硬禁       |
| `ctx.db` 物理位置                  | 内存 SQLite，per-test                                            | 平台共享库 + `plugin_<id>_` 命名空间                                   |
| `ctx.require`                      | 直接抛错                                                         | `PLUGIN_SHARED_MODULES` 白名单（`recharts` / `exceljs` / `jspdf` / …） |
| `pointsDimension` / `pointsLedger` | 恒 `null`                                                        | inline 注入真服务；worker / process 也是 `null`                        |
| `commandBus.registerHandler`       | 原样存名，**不补前缀**                                           | `resolvePluginCommandType()` 自动补 `<manifest.id>.`                   |
| `commandBus.execute` 未命中        | 返回 `undefined`                                                 | `No command handler registered for type ...`                           |
| capability / 默认拒绝 / 高危审批   | **完全不校验**                                                   | 拦截器 default-deny + `pending_commands` + `COMMAND_CAPABILITY_DENIED` |
| `setInterceptor`                   | no-op                                                            | 真实链式拦截                                                           |
| `config.*`                         | 空壳                                                             | 真实三层作用域                                                         |
| `contributions.list()`             | `[]`                                                             | 真实跨插件贡献                                                         |
| `i18n.t`                           | 回显                                                             | 词条表 + 回退                                                          |
| 隔离档位                           | 无概念                                                           | `resolvePluginExecutionMode()` 强制 `process`                          |

```{danger}
**`⚠ 与 LLM 先验冲突`**：很多人以为「单测覆盖率够高就等于插件安全」
—— 恰恰相反，Mock 是**故意**没有安全模型的。
凡是踩到 `ensureTable` 命名/分号、`provide` 未声明、`require` 白名单、
capability 声明、跨线程函数传递这五条路径的代码，**必须**额外做一次
「上传真实 ZIP → 插件中心安装 → 激活」的 L3 验证。
```

### 3.1 命令命名空间的三种写法陷阱

生产：`registerHandler('poll.create', …)` → 实际注册为 `ext-poll.poll.create`。
Mock：原样保存为 `poll.create`。

统一规则由 `packages/core/plugin-host/plugin-namespace.ts`（L111941）的
`resolvePluginCommandType(type, pluginId)` 承担：

- `type` 已经以 `${pluginId}.` 开头 → 原样返回（调用方显式带了命名空间）；
- `type` 以「UUID v7 + `.`」开头 → 原样返回（那是别人的命名空间，别抢）；
- id 以 `@openlearn/` 开头的内核插件 → **保持全局命名空间，不加前缀**（向后兼容）；
- 其余 → 前置 `${pluginId}.`。

````{danger}
**第二个参数必须是 `manifest.id`，不能是数据库主键**。
内核给每个上传的插件另发一个 UUID v7 存进 `plugins.id`：

```text
DB id:        019f6029-884d-71dd-a4f1-31f815fa9698   ← 只对服务端有效
manifest id:  @courseware-hub/plugin                 ← 命令命名空间的真前缀
```

前端 `invokeCommand`、worker `registerHandler`、宿主 `service-host` 拦截**三处必须传同一个
`manifest.id`**，否则注册键与执行键不一致，主 CommandBus 抛
`No handler registered for command: courseware.query`。
这是历史上真实发生过的三处规则漂移 bug（本模块就是为修它而生的）。
````

```{warning}
**worker/子进程沙箱里用的是这份函数的「另一份拷贝」**，不是 import。
Worker bootstrap 是动态生成的代码字符串（沙箱不能 import 宿主模块，那正是隔离的意义），
所以纯逻辑函数在沙箱侧复制了一份。这份拷贝会**静默漂移** ——
``packages/core/worker-runtime/__tests__/namespace-parity.test.ts` → `start`（L33） 起）
守的就是上一次漂移：沙箱侧少了 UUID v7 短路（宿主有、沙箱无）。
当时没暴露，纯粹因为两边碰巧都传 `manifest.id` —— 「参数一致」是调用点的巧合，不是不变量。
```

因此：

- 单测断言**未加前缀**的名字；
- 与平台其它模块联调 / 看日志 / 写 `ActionDescriptor.commandType` 时用**全名** `ext-poll.poll.create`；
- 服务端 / 前端一律 `ctx.services.commandBus`，**没有 `ctx.commands` 这个成员**。
  ``docs/sdk/plugin-test-kit.md`（L230） 写了「前端 `ctx.commands.execute()`也走同一条规则」，
但全仓库源码里`ctx.commands`只出现在这一行文档里，任何`PluginContext`定义都没有它
—— **这是文档漂移，不要照抄**。前端沙箱侧真正的入口是 op`command.invoke`（桥接方法`ctx.invokeCommand(type, payload)`，见 [前端沙箱](frontend-sandbox.md) §3）。

完整的四种位置三种前缀语义见 [命令与事件](command-and-event.md) §2.2。

`manifest.id` 是前缀的唯一来源。id 写成 `@scope/name` 时前缀是 `@scope/name.`，
所以命令形如 `@example/my-plugin.some_command` —— 别用 `@/name` 这种空 scope。

---

## 4. 可复制的测试配方

### 4.1 命令 handler

```typescript
import { describe, it, expect } from 'vitest';
import { createMockContext, MockCommandBus } from '@openlearn/plugin-test-kit';

it('registers and executes poll.create', async () => {
  const ctx = createMockContext({ pluginId: 'ext-poll' });
  await plugin.activate(ctx);

  const bus = ctx.services.commandBus as MockCommandBus;
  expect(bus.handlers.has('poll.create')).toBe(true); // Mock 不补前缀

  const res = await bus.execute({ type: 'poll.create', payload: { title: 'x' } } as any);
  expect(bus.executeCalls).toHaveLength(1); // 防「未注册也通过」
  expect(res).toMatchObject({ pollId: 'poll-101' });
});
```

### 4.2 事件

```typescript
const handler = vi.fn();
ctx.services.eventBus.subscribe('poll.created', handler);
await ctx.services.eventBus.publish({ type: 'poll.created', payload: {}, timestamp: Date.now() });
expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'poll.created' }));
// 断言发布历史：(ctx.services.eventBus as MockEventBus).publishCalls
```

`MockEventBus` 支持 `'*'` 通配订阅；`publish` 会 `await` 每个订阅者，
因此订阅者抛错会**冒泡到 `publish` 调用本身**（生产 EventBus 是异步派发，语义不同）。

### 4.3 HTTP 路由

`ctx.http` 是**真实**的 `PluginHttpRouter`，所以路径匹配、`:param`、auth 标记是可信的：

```typescript
const res = await ctx.http.handle({
  method: 'GET',
  path: '/students/stu_007/summary',
  params: {},
  query: { term: '2026-autumn' },
  headers: {},
  body: null,
  ip: '127.0.0.1',
  actor: { actorId: 'user:1', username: 'teacher_li', role: 'teacher' },
});
expect(res.status).toBe(200);
```

未注册路径返回 `404`；handler 返回 `{ status, body }` 时按其值响应。

### 4.4 AI Action

```typescript
const reg = ctx.services.actionRegistry as MockActionRegistry;
expect(reg.actions.size).toBe(1);
const tools = await reg.getAgentTools();
// tools[0].functionDeclarations[0].name === commandType 里所有非 [A-Za-z0-9_-] 换成 '_'
```

`getAgentTools()` 在没有任何 action 时返回**空数组**（不是 `[{ functionDeclarations: [] }]`），
断言时注意。

### 4.5 capability

```typescript
const ctx = createMockContext({ pluginId: 'ext-x', capabilities: ['quiz:write'] });
const cap = ctx.services.capability as MockCapability;
expect(await cap.check('plugin:ext-x', 'quiz:write')).toBe(true);
expect(await cap.check('someone-else', 'quiz:write')).toBe(false); // ⚠ actorId 是 plugin:<id>
```

`MockCapability.check` 支持 `prefix*` 通配（**以 `*` 结尾的授权串**匹配前缀）。

### 4.6 生命周期

```typescript
afterEach(async () => {
  await plugin.deactivate?.(ctx);
});
```

`deactivate` 断言重点：`MockCommandBus.handlers.size === 0`、
`MockProcessManager.processes` 是否被清理（注意 **`MockProcessManager.kill` 是 no-op**，
不会从 `processes` 数组里移除，别指望用它验证清理）。

---

## 5. L2：平台侧测试环境

只有当你要把插件放进 `packages/plugins/`（内置插件）或修改宿主时才会用到。

`vitest.config.ts`（L423551）关键设置：

| 项                            | 值                                                                                | 影响                                                                                              |
| :---------------------------- | :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `pool`                        | `'forks'`                                                                         | 每 worker 独立进程                                                                                |
| `maxWorkers`                  | `min(4, freeMemGb/0.6, ceil(cpus/2))`，可用 `VITEST_MAX_FORKS` 覆盖               | 每 worker 约 400–600MB                                                                            |
| `environment`                 | `'jsdom'`                                                                         | 全局 `TextEncoder` 等被 `vitest.setup.ts` 换成 Node 实现                                          |
| `include`                     | `packages/**` `server/**` `src/**` `scripts/**` 下 `__tests__/**/*.test.{ts,tsx}` | **通配**（旧版是 20 条白名单，新目录会被静默跳过）                                                |
| `exclude`                     | `packages/core/__tests__/lti-provider-plugin.test.ts`                             | 依赖被 gitignore 的 `v2_plugins/`，新克隆必红，属预期                                             |
| `alias`                       | `@openlearn/plugin-sdk` → 仓库源码；`exceljs` → `packages/core/__mocks__/xlsx.ts` | 仓库内测试走源码，不走 npm 产物                                                                   |
| `testTimeout` / `hookTimeout` | `60000`                                                                           | ZIP 装载类集成测试可 >5s                                                                          |
| coverage thresholds           | lines 57 / branches 46 / functions 52 / statements 55                             | 底线；真棘轮在 `scripts/coverage-ratchet.mjs` + `coverage-baseline.json`（-0.5pp 容差，只升不降） |

```bash
pnpm test                 # 全量
pnpm vitest run -t "Kernel"
pnpm vitest watch
pnpm test:coverage -- --coverage.reporter=json-summary --coverage.reportOnFailure=true
pnpm test:ratchet         # 覆盖率棘轮
pnpm test:e2e             # Playwright
```

### 5.1 `vitest.setup.ts` 做的四层隔离（L423648）

这些是**平台自己**的测试防线，理解它们能避免你把插件测试写进仓库后误伤真实数据：

1. **清除 `OPENLEARN_DB_PATH`**。历史上 `dotenv` 会把本地 `.env` 的开发库路径灌进来，
   导致测试写进**真实开发库**（实测：插件审计用例把 `audit.poc.highrisk.*`
   永久留在 `pending_commands`，后台挂一条批不掉的死项，且 `pnpm test` 全绿）。
   做法是 `delete` 而非改写 —— 该变量还有别的读者（`cli-cleaner.mjs` 的 `dbPath` 无条件优先它）。
   清除时打印 `[vitest.setup] 已清除继承的 OPENLEARN_DB_PATH=...` 警告。
2. **清除 `BACKUP_DIR`**，同一类泄漏：否则测试把迁移前快照写进生产备份目录。
3. **每 worker 一个库**：`<tmp>/openlearn_test_dbs/`，文件名带 `process.pid`；
   并按 24h 粗粒度回收旧文件。曾经用过「pid 哨兵文件重置」方案，被 pid 复用坑了
   （残留 `_migrations` 行 → `UNIQUE constraint failed: _migrations.name`）。
4. **`OPENLEARN_DATA_DIR` 重定向**到 `<tmp>/openlearn_test_data_<VITEST_POOL_ID>`，
   并把 `kernelContainer` 的插件目录指向同键临时目录
   （单例是 import 进来的，env 是唯一能在 import 前生效的通道）。

另外：`ENCRYPTION_KEY` 若非 64 位 hex 则现场生成随机钥匙；
`global.fetch` 在 `afterEach` 还原（防跨文件污染）；
`OPENLEARN_MAX_ZIP_SIZE` 默认 5MB。

### 5.2 服务端集成测试的 schema 兜底

课堂相关表（`classroom_sessions` / `classroom_feed` / `teaching_modes` 等）**只存在于 `migrations/*.sql`**，
`packages/core/db/index.ts` 的内联 schema 块里没有，而 `runMigrations` 只在 `server.ts` 启动时执行。
`vitest.setup.ts` 已对 `server/__tests__/` 下的测试统一补齐迁移；
若你使用独立的 `:memory:` 库，在 `beforeAll` 调 `ensureTestSchema()`
（`server/__tests__/helpers/test-schema.ts`，幂等）。

```{danger}
**依赖同 worker 内其它测试文件的执行顺序 = flaky**。
`fileParallelism: true` 下文件到 worker 的分配不确定。
历史教训：7 个文件各自 `beforeAll` 手动跑迁移，其余文件靠「别人先跑过」，
导致 `classroom-session-resume.test.ts` 间歇性 `no such table: classroom_sessions`。
```

### 5.3 测试隔离档位开关

| 变量                                 | 语义                                                                                                      |
| :----------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `VITEST`                             | 设置后 `execution-policy.ts:37` 把**所有** id 视为可进程内执行                                            |
| `OPENLEARN_ENFORCE_PLUGIN_ISOLATION` | 写 `1` 时即使有 `VITEST` 也强制改写为 `process`；**只接受 `1`/`0`**，写 `true`/`yes` 会被启动期强校验拒绝 |

想在 CI 里证明「我的插件在真子进程下也能跑」，就带上 `OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1`。

---

## 6. L3：真实装载路径（不可省略的一步）

```bash
# 1. 脚手架
npx @openlearn/plugin-sdk init --name demo-vote --template full-stack
npm i -D @openlearn/plugin-sdk@3.7.5     # ⚠ 不要装 3.7.1，见下

# 2. 编译 + 打 ZIP
npx @openlearn/plugin-sdk build

# 3. 取产物（包名 = package.json 的 name，不要硬编码）
ls dist/*.zip

# 4. 装载：插件中心上传 ZIP → 批准 capabilities / routes → 激活
#    或 CI 里用 API（见 http-api.md 的 community install 端点）
```

### 6.1 `build` 会替你做的两项检查

- **裸模块说明符扫描**：`frontend.js` 里残留 `from "react"` 这类非相对/绝对导入 → 直接 `exit 1`。
  原因：远程插件前端跑在不透明源 iframe，没有 React / `window.HostSharedDeps` / importmap，
  加载方式是 `Blob` + 动态 `import()`。裸说明符「构建能过、装上正常、一激活就崩」，
  且报错不指向根因。
- **ZIP 内容固定为三件套**：根级 `index.js` + `manifest.json` +（可选）`frontend.js`。

```{danger}
**`migrations/`、`assets/`、`README.md` 不进包**。
声明式 `migrations/*.sql` 只对内置插件、源码目录直装生效。
ZIP 插件建表/升级只能用 `ctx.db.ensureTable()` + `ctx.db.migrate(version, fn)`。
这是 L1 完全测不出来的差异（Mock 里 migrations 目录照样能读）。
```

`3.7.1` 已在 npm 弃用（产物残留 `node:` 内置模块静态导入，运行期失败）。
`3.7.0` 生成旧模板（`export default function Component()`），
沙箱加载器要求 `plugin.activate` 是函数 → 装完直接 `missing activate function`。
`3.7.4` 起模板形状与构建守卫都正确；**当前版本是 `3.7.5`**，
它补齐了 SDK 自身缺失的 `uuid` 运行时依赖并加了裸导入构建守卫
（`3.7.4` 及更早的包在某些入口会抛 `ERR_MODULE_NOT_FOUND: Cannot find package 'uuid'`）。
**升到 `3.7.5` 是同时拿到新模板、正确守卫且不踩 uuid 坑的那一个。**

### 6.2 用真实宿主做冒烟

| 工具         | 命令                                                         | 用途                                                                                                                                          |
| :----------- | :----------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| 演示沙盒     | `npx openlearn-next@latest --demo -o`                        | 一次性 `/tmp` 数据，退出即销毁，适合装插件试                                                                                                  |
| 功能巡检     | `pnpm sweep` / `pnpm sweep -- --roles teacher` / `--no-fail` | 起临时演示库 → 5 轮全角色点检 → `artifacts/sweep/report.{md,json}` + 截图；**导航项在运行时从 DOM `aria-label` 发现**，插件页签会自动纳入     |
| 命令审计     | `node scripts/plugin-command-audit.mjs`                      | 枚举所有 handler 与 action，找出「有 handler 但无 action」——这类命令在 default-deny 后会被误伤                                                |
| 文档漂移门禁 | `bash audit-tools/run.sh`                                    | canonical-key 比对、引用完整性、环境变量三方比对、**插件文档代码示例校验**（`plugin_docs_check.py` P1–P4）、槽位覆盖、扩展点覆盖、doc-version |
| 扩展点覆盖   | `python3 audit-tools/extension_points_coverage.py`           | 真值从源码推导（`PLUGIN_RESOLVABLE_TOKENS` + 接口体里的 `register*`）                                                                         |
| 升级回归     | `scripts/upgrade-regression/`（L157474）                     | 用 fixture 验证跨版本数据迁移                                                                                                                 |

`npx openlearn-next plugins` 可在终端速查已装插件与状态；`doctor` / `compat-report` / `check-update`
是只读诊断命令，即便 Node 版本不受支持也照常可用。

---

## 7. 症状 → 定位

| 症状                                                                | 最可能原因                                                                               | 下一步                                                                                                                                                                                                                               |
| :------------------------------------------------------------------ | :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单测全绿，装上报 `manifest.main 必须指定入口文件路径`               | ZIP 里缺 `index.js` 或 manifest 字段被 zod 拒                                            | 看 `manifest-schema.ts` L81517；对照 §6.1                                                                                                                                                                                            |
| `handler.execute is not a function`                                 | 注册了裸函数                                                                             | 改 `{ execute(cmd) }`（§2.4）                                                                                                                                                                                                        |
| `Assertion failed: expected undefined` 且命令名看着没错             | Mock 不补前缀 vs 生产补前缀                                                              | §3.1                                                                                                                                                                                                                                 |
| `No provider registered for token: @openlearn/xxx:IYyy`             | 该 Token 不在 Mock 的 8 个预置里                                                         | `customTokens` 注入                                                                                                                                                                                                                  |
| `require("recharts") is not available in test context`              | Mock 里 `require` 恒抛                                                                   | `customTokens`，生产按白名单                                                                                                                                                                                                         |
| `could not be cloned`                                               | worker/process 下 `provide()` 了函数 / 跨线程传回调                                      | 见 troubleshooting-faq L28956                                                                                                                                                                                                        |
| `no such table: classroom_sessions`，且只偶发                       | 依赖同 worker 其它文件的迁移                                                             | §5.2                                                                                                                                                                                                                                 |
| 测试跑完真实开发库里多了数据                                        | 你自己新建的 Kernel 没走 `vitest.setup` 隔离                                             | 确认 `VITEST` 生效、别自己 set `OPENLEARN_DB_PATH`                                                                                                                                                                                   |
| 插件卡在 `ACTIVATING` 后进 `ERROR`                                  | worker 激活 60s 超时（inline 5s）                                                        | 用 `ctx.services.processManager` 拆分长任务；`OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` 排查。（`ctx.reportProgress()` 能滑动续期，但**只在 worker/process 存在且不在 `PluginContext` 类型里**，inline 下是 `undefined`，需断言 + 判空） |
| `db.transaction(fn)` 在真环境炸、单测不炸                           | worker 下 `IDatabaseToken` 是异步代理，不能用同步回调                                    | 只用 `ctx.db` API                                                                                                                                                                                                                    |
| 命令返回成功、刷新后**库里没数据**                                  | `db.prepare(...).run(...)` 没 `await`，`process` 档它是 Promise；Mock 与 inline 都是同步 | 每处加 `await`，见 {doc}`../tutorial/full-stack` §5                                                                                                                                                                                  |
| 界面空白 / `/plugins/<uuid>/xxx.html` 返回 404，插件状态仍 `active` | HTML 不在 ZIP 的 `storage/` 前缀下（SDK 不自动加资源文件）                               | `unzip -l dist/*.zip` 核对，见 {doc}`../tutorial/sandbox-view` §3                                                                                                                                                                    |
| 本地 `pnpm test` 必红一条 `lti-provider-plugin.test.ts`             | 依赖被 gitignore 的 `v2_plugins/`，属预期                                                | 已被 config `exclude`；单独跑用 `pnpm test:l2i`                                                                                                                                                                                      |

---

## 8. 提交前自检清单

```text
□ 命令 handler 全部用 { execute(cmd) } 对象，不是裸函数
□ 断言里用的是【未加前缀】的命令名（Mock 语义），跨模块联调用全名
□ 不依赖 ctx.config.* 做分支断言（Mock 恒空），需要时手动替换
□ 不依赖 ctx.manifest.contributes / provides / requires（Mock 会丢弃）
□ ensureTable 表名过 /^[A-Za-z_][A-Za-z0-9_]{0,63}$/，schema ≤ 4000 且无分号
  （Mock 不校验，必须人工核）
□ 所有 ctx.provide 的 token.name 都写进了 manifest.provides
  （Mock 不校验，必须人工核）
□ ctx.require 只用白名单共享模块，且 manifest.sharedModules 已声明
□ pointsDimension / pointsLedger 有 null 分支（Mock 与 worker 都是 null）
□ 没有把函数/类实例经 ctx.provide 或命令 payload 跨线程传递
□ 声明式 migrations/*.sql 不指望进 ZIP；ZIP 插件走 ctx.db.migrate
□ 前端入口 export default { activate, deactivate }，不是组件
□ SDK 只用 import type，frontend 产物无裸模块说明符
□ @openlearn/plugin-sdk 版本 >= 3.7.5（绝不装 3.7.1）
□ 已做一次 L3：真实 ZIP 上传 → 安装 → 激活 → 打开使用页面确认
□ （改宿主/内置插件时）pnpm test 全绿 + pnpm test:ratchet 不降
```

---

## 9. 取证

| 结论                                                                              | 来源                                                  | repomix 行      |
| :-------------------------------------------------------------------------------- | :---------------------------------------------------- | :-------------- |
| 测试工具包定位、`createMockContext` 属性表                                        | `docs/sdk/plugin-test-kit.md`                         | L28577–L28630   |
| 全部 14 个 `export`（用 `grep -c '^export'` 复核）                                | `packages/plugin-test-kit/index.ts`                   | L141322–L141969 |
| Mock 与生产差异表（官方口径）                                                     | 同上                                                  | L28631–L28660   |
| 命令命名空间与裸函数报错                                                          | 同上 §4                                               | L28795–L28810   |
| 最佳实践（隔离/生命周期/日志断言）                                                | 同上 §5                                               | L28811–L28823   |
| 选项类型全字段                                                                    | `packages/plugin-test-kit/index.ts`                   | L141362–L141385 |
| `MockCommandBus.execute` 返回 `undefined`、`setInterceptor` no-op                 | 同上                                                  | L141390–L141425 |
| `MockEventBus` 通配与 `await` 派发                                                | 同上                                                  | L141428–L141465 |
| `MockActionRegistry.getAgentTools` 空数组与名称净化                               | 同上                                                  | L141478–L141500 |
| `MockCapability` 构造函数死代码、`check` 前缀通配                                 | 同上                                                  | L141503–L141540 |
| `MockProcessManager.kill` no-op / `registerInterval` 只记 id                      | 同上                                                  | L141545–L141573 |
| `MockStorage` 用 `Map` 不落库                                                     | 同上                                                  | L141578–L141592 |
| `MockAI.generateTextFn` 默认空串                                                  | 同上                                                  | L141596–L141604 |
| manifest 只采纳 name/version/main                                                 | 同上                                                  | L141660–L141667 |
| `overrides` 浅合并、初始 capability 授予 `plugin:<id>`                            | 同上                                                  | L141680–L141695 |
| 内存库预建 `plugin_storage` / `plugin_migrations`                                 | 同上                                                  | L141698–L141712 |
| `ensureTable` 无 SEC 校验、`migrate` 事务语义                                     | 同上                                                  | L141715–L141760 |
| `tokenMap` 8 个预置键                                                             | 同上                                                  | L141763–L141773 |
| `pointsDimension` / `pointsLedger` 恒 null                                        | 同上                                                  | L141782–L141789 |
| `i18n` 回显实现与 Issue #148 注释                                                 | 同上                                                  | L141792–L141801 |
| `config` 全空壳 / `contributions.list()` 恒 [] / `require` 恒抛                   | 同上                                                  | L141803–L141818 |
| `createMockStreamResponse` 语义                                                   | 同上                                                  | L141822–L141888 |
| `runTestPluginMigrations` 与 `'test-checksum'`                                    | 同上                                                  | L141896–L141969 |
| test-kit 版本 3.3.3                                                               | `packages/plugin-test-kit/package.json`               | L141970–L141990 |
| Vitest pool/maxWorkers/include/exclude/alias/timeout/coverage                     | `vitest.config.ts`                                    | L423551–L423647 |
| `OPENLEARN_DB_PATH` 清除理由与实测后果                                            | `vitest.setup.ts`                                     | L423680–L423760 |
| `BACKUP_DIR` 清除、per-worker 库、24h 回收                                        | 同上                                                  | L423760–L423790 |
| `OPENLEARN_DATA_DIR` 与插件目录重定向                                             | 同上                                                  | L423810–L423850 |
| 测试命令、棘轮、e2e、per-worker SQLite 规范                                       | `docs/developer-guide/testing-strategy.md`            | L17866–L17905   |
| `VITEST` 与 `OPENLEARN_ENFORCE_PLUGIN_ISOLATION` 判定                             | `plugin-system-remediation-tracker.md`                | L14902、L16679  |
| CLI 命令表、ZIP 三件套、裸说明符 exit 1、模板契约、3.7.1 弃用                     | `docs/sdk/scaffold-cli.md`                            | L28824–L28923   |
| `EADDRINUSE` / `SQLITE_BUSY` / worker 超时 / `could not be cloned` / manifest zod | `docs/troubleshooting/troubleshooting-faq.md`         | L28925–L28983   |
| sweep 用法、5 轮顺序、DOM 发现导航                                                | `docs/feature-sweep.md`                               | L33456–L33560   |
| `plugin-command-audit.mjs` 用途与用法                                             | `scripts/plugin-command-audit.mjs`                    | L161601–L161630 |
| 扩展点覆盖门禁四条规则与跑法                                                      | `scripts/__tests__/extension-points-coverage.test.ts` | L151984–L152015 |
| audit-tools 8 段门禁清单                                                          | `audit-tools/run.sh`                                  | L6920–L7010     |
| 可编译验证示例最小契约                                                            | `docs/examples/verifiable-examples.md`                | L18164–L18187   |
| `resolvePluginCommandType` 前缀规则                                               | `packages/core/plugin-host/plugin-namespace.ts`       | L111941         |
| 默认拒绝拦截器与 `pending_commands`                                               | `packages/core/kernel/index.ts`                       | L84200–L84340   |
