# `PluginContext`（服务端 `ctx`）全集

> `activate(ctx)` 收到的唯一入参。定义在 `packages/core/plugin-host/types.ts`，构建在
> `packages/core/plugin-host/context-builder.ts` 的 `buildContext()`。
> 本页逐字段给出**签名 + 实际行为 + 与类型声明不一致的地方**。

```{important} 先记住三条
1. `ctx.services.*` 的**运行时契约是 `T | null`**，类型层已经写成 `| null`，判空不是可选的。
2. `ctx.pluginId` 是 **`plugins` 表的行 UUID**（安装主键），**不是** `manifest.id`。
   但 `ctx.services.storage` 的键空间用 `manifest.id`，命令命名空间前缀也用 `manifest.id`。
3. `ctx` 上**没有** `auth` / `user` / `role` / `socket` 字段。身份只经 `req.actor`（HTTP）或命令的 `actorId` 传入。
```

---

## 1. 完整签名

```typescript
export interface PluginContext {
  services: {
    commandBus: ICommandBusService | null;
    eventBus: IEventBusService | null;
    actionRegistry: IActionRegistryService | null;
    capability: ICapabilityService | null;
    processManager: IProcessService | null;
    storage: IStorageService | null;
    ai: IAIService | null;
    pointsDimension: IPointsDimensionRegistry | null;
    pointsLedger: IPointsLedgerService | null;
  };
  pluginId: string; // plugins 表行 UUID，不是 manifest.id
  manifest: Manifest;
  resolve<T>(token: Token<T>): Promise<T>;
  provide<T>(token: Token<T>, instance: T): Promise<void>;
  db: PluginDatabaseAPI;
  log: IPluginLogger;
  contributions: ContributionAccessor;
  config: IConfigService;
  http: IPluginHttpRouter;
  i18n: PluginI18nAPI;
  require(moduleName: string): any; // 仅 PLUGIN_SHARED_MODULES 白名单
}
```

`ctx.services` 被 `Object.freeze()` 冻结，且各包装器原型链被切断（`Object.setPrototypeOf(wrapped, null)`）。
所以 **`ctx.services.commandBus.constructor` 是 `undefined`**，别指望反射。

---

## 2. `services` 的 `null` 语义（审计 E-4 / D-12）

`buildContext()` 里两个来源会把某个 key 置为 `null`：

| 触发条件                                                                                              | 涉及 key  |
| :---------------------------------------------------------------------------------------------------- | :-------- |
| `pointsDimension` / `pointsLedger` 走 `tryResolve`，未注册即 `null`（测试或部分部署不启用积分子系统） | 这 2 个   |
| `skipTokens`：`manifest.optional` 里声明的 Token 与被替换实现 **SemVer 不兼容** 时                    | 任意 9 个 |

`skipTokens → services key` 映射表（键是完整 token 名）：

```
'@openlearn/core:ICommandBusService'        → commandBus
'@openlearn/core:IEventBusService'          → eventBus
'@openlearn/core:IActionRegistryService'    → actionRegistry
'@openlearn/core:ICapabilityService'        → capability
'@openlearn/core:IProcessService'           → processManager
'@openlearn/core:IStorageService'           → storage
'@openlearn/core:IAIService'                → ai
'@openlearn/core:IPointsDimensionRegistry'  → pointsDimension
'@openlearn/core:IPointsLedgerService'      → pointsLedger
```

````{danger} 判空是硬要求
早期类型层不含 `null`，插件按类型直接写 `ctx.services.pointsLedger.addPoints(...)`
会在运行时踩空。正确写法：

```typescript
const ledger = ctx.services.pointsLedger;
if (!ledger) {
  ctx.log.warn('积分子系统不可用，降级为不计数');
  return;
}
await ledger.addPoints(studentId, classId, 'participation', 2, '主动回答');
```
````

---

## 3. `pluginId` vs `manifest.id`（最容易踩的一条）

同一份代码里两个标识各有分工，**混用会导致表名/命令名找不到**：

| 场景                                     | 用哪个                                          | 结果示例                                            |
| :--------------------------------------- | :---------------------------------------------- | :-------------------------------------------------- |
| `ctx.pluginId` 字段                      | DB 行 UUID（安装主键 `scopeId`）                | `019f6029-884d-71dd-a4f1-31f815fa9698`              |
| `ctx.db.table(name)` 表前缀              | **DB 行 UUID**（`pluginTablePrefix(pluginId)`） | `plugin_019f6029_884d_71dd_a4f1_31f815fa9698_notes` |
| `ctx.services.storage` 的 `plugin_id` 列 | **`manifest.id`**                               | `@courseware-hub/plugin`                            |
| 命令命名空间前缀                         | **`manifest.id`**                               | `@courseware-hub/plugin.courseware.query`           |
| ActionDescriptor 的 `commandType` 前缀   | **`manifest.id`**                               | 同上                                                |
| 能力授予 key                             | 两个都传（`keys: [pluginId, manifest.id]`）     | —                                                   |
| 进程归属 `ownerHint`                     | **DB 行 UUID**                                  | —                                                   |

内置插件用规范标识（`@openlearn/plugin-vfs` → 前缀 `plugin__openlearn_plugin_vfs_`），语义清晰；
外部上传插件用安装生成的唯一 UUID，实现物理隔离与防冲突，卸载时能准确识别并彻底清理其自建表。

```{warning} 历史遗留
`listAllowedPluginTablePrefixes(scopeId, manifestId, includeLegacyManifest)` 会返回**多个**前缀，
其中 `manifestId` 版是历史兼容前缀。SQL 守卫按这个集合放行，但**新代码只应拿到 UUID 前缀**。
```

`pluginTablePrefix` 的清洗规则：`plugin_${id.replace(/[^a-zA-Z0-9_]/g, '_')}_`。

---

## 4. `ctx.resolve(token)`

```typescript
resolve<T>(token: Token<T>): Promise<T>;   // 声明签名
// 运行时同时接受 string
```

### 4.1 Token 对象路径

```typescript
import { IActivityRegistryToken } from '@openlearn/plugin-sdk';
const registry = await ctx.resolve(IActivityRegistryToken);
```

不受门禁限制 —— 插件必须 `import` SDK 导出的常量才拿得到对象。

### 4.2 字符串路径（审计 E-2）

只有**白名单内**的名字可解析，否则当场抛错：

```
[PluginHost] Plugin "..." cannot resolve "..." by name.
Use the Token object imported from @openlearn/plugin-sdk, or one of the SDK-exported Token names.
```

白名单是 `PLUGIN_RESOLVABLE_TOKEN_NAMES`，详见 {doc}`token-reference`。

```{danger} 修复前的漏洞
此前字符串入参直接 `resolveByName(token)`，而 `ServiceRegistry.resolveByName` 是纯粹的
`registry.get(name)`、**无门禁**。插件知道任意内部 token 名（LessonEngine / ClassroomRuntime /
Presence 等 20+ 个内核服务）即可拿到实例；inline 模式下没有任何 allowlist
（worker 模式有 `computeAllowedWorkerTokens` 兜底）。
```

### 4.3 两个 token 会被换成代理（Issue #327）

`IClassroomLifecycleService` 和 `IInteractionRuntimeService` **不在 `ctx.services` 的 9 个键里**，
插件拿到它们的唯一途径是 `ctx.resolve(token)`，所以回收拦截只能在 resolve 层做：

- `registerStageGuard(owner, guard)` → 记下插件实际传入的 `owner`，`dispose` 时精确 `unregisterStageGuard(owner)`
- `registerActivityProvider(owner, descriptor)` → 记下 `(owner, id)`，`dispose` 时精确注销

**Token 对象路径和字符串路径都过这个代理。**

```{note} 为什么不能"停用时按 owner 批量清"
`registerStageGuard(owner, guard)` 的 owner 是**插件自选**的字符串，宿主无法枚举"这个插件注册了哪些 owner"。
`QuickActivityDescriptor` 更硬：内部键是 `${owner}:${id}`，但 descriptor **不带 owner 字段**，
`listActivityProviders()` 只返回 descriptor 值 —— 宿主拿到它无法反查归属。
所以只能拦截记录。

已知歧义：两个插件若用了同一个 owner 字符串，后注册者覆盖先注册者；先注册者停用时会把后者的门禁一并注销。
```

---

## 5. `ctx.provide(token, instance)`

对应 `manifest.provides`。**必须先声明**，否则：

```
[PluginHost] Plugin "..." attempted to provide "..." which is not declared in manifest.provides.
Add it to manifest.provides: [...]
```

```typescript
// manifest.json
{ "id": "@myteam/srs", "provides": ["@myteam/srs:ISpacedRepetitionService"], ... }

// contracts/index.ts
export const ISpacedRepetitionServiceToken =
  new Token<ISpacedRepetitionService>('@myteam/srs:ISpacedRepetitionService', '1.0.0');

// index.ts
async activate(ctx) {
  await ctx.provide(ISpacedRepetitionServiceToken, { /* impl */ });
}
```

注册进 `serviceRegistry.register(token, instance)`（使用插件传入的 Token，**含其 version**，不硬编码 `1.0.0`），
并登记 disposer —— 插件停用后自动 `unregister`。其他插件经 `ctx.resolve(token)` 消费。

---

## 6. `ctx.db`（`PluginDatabaseAPI`）

```typescript
interface PluginDatabaseAPI {
  ensureTable(tableName: string, schema: string): Promise<void>; // 幂等，自动加前缀
  table(tableName: string): string; // 取带前缀的完整表名
  dropAllTables(): Promise<void>; // uninstall 时宿主自动调用
  migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void): Promise<void>;
}
```

详见 {doc}`database`。

---

## 7. `ctx.http`（`IPluginHttpRouter`）

`get / post / put / patch / delete / route / stream / isStream`，详见 {doc}`http-api`。

```{note} 路由前缀
`PluginHttpRouter` 以 `manifest.id` 构造（`new PluginHttpRouter({ pluginId: manifest.id, ... })`），
实际挂载路径是 `/api/plugins/{manifest.id}/*`。
```

未声明数据范围的路由在迁移期**只告警不拒绝**（Issue #140）：

```
[RouteScope] 插件 <id> 的路由 <METHOD> <pattern> 未声明数据范围（迁移期仅告警）
```

---

## 8. `ctx.config`（`IConfigService`）

```typescript
interface IConfigService {
  get<T = unknown>(key: string, options?: ConfigReadOptions): T; // 同步
  getAll(options?: ConfigReadOptions): Record<string, unknown>; // 同步
  set(key: string, value: unknown, scope?: ConfigWriteScope): Promise<void>;
  onChange(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void;
}
```

解析优先级（Issue #151 分层）：

```
班级覆盖 (class, scope_id=<classId>)
  > 学校覆盖 (school, scope_id=<schoolId>)
    > 平台值 (platform, scope_id='')
      > manifest 默认值
```

- `ConfigReadOptions = { classId?, schoolId? }`；`school` 预留给多租户（Issue #149），解析逻辑已就绪但暂无自动来源。
- `ConfigWriteScope = { scopeType?, scopeId? }`，缺省写平台层。
- **哪些 key 允许在哪层覆盖由 manifest 声明**：`configuration.properties.<key>.scope: ['platform','school','class']`。
  未声明时**只允许平台层**（老插件行为不变）。`platform` 始终隐含允许。
- 存储在新表 `plugin_config(plugin_id, scope_type, scope_id, key, value, updated_at)`（迁移 037）；
  新表缺行时仍回退读 `plugin_storage` 的 `config:<key>`，保证"迁移未执行 / 手工恢复"的库也能读到旧配置。
- `ConfigService` 实例由 `buildContext()` 创建，顺序固定为 **构造 → `loadFromDB()` → 挂到 `ctx.config`**。
  所以**插件 `activate()` 里读到的值已经是 DB 合并后的最终值**，不存在"先读默认、后异步刷新"的窗口。
- 同一 `db` + `manifest.id` 的所有 `ConfigService` 实例**共享缓存与实例表**（`WeakRef` 登记）——
  否则管理端写入后，运行中的 `ctx.config` 既读不到新值也不触发 `onChange`。

详见 {doc}`background-and-config`。

---

## 9. `ctx.log`（`IPluginLogger`）

```typescript
interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

内部 logger scope 是 `` `Plugin:${manifest.id || pluginId}` ``，`meta` 被包成 `{ meta }` 一层。

```{warning} 不要用 `system.log` 命令
`IPluginLogger` 是 V2.5 引入来**替代** `system.log` 命令的，V3.0 已移除该命令。

````

---

## 10. `ctx.contributions`（`ContributionAccessor`）

```typescript
interface ContributionAccessor { list(): ContributionSummary[]; }
````

有 `contributionRegistry` 时返回 `registry.summary(manifest.id)`；没有（如测试环境）则从 `manifest.contributes`
直接构建：

```typescript
[{ slot, count, items: [{ id, label: c.label ?? c.name ?? c.id }] }];
```

```{tip} 自检利器
激活后打印 `ctx.contributions.list()`，能立刻看出 manifest 的 `contributes` 有没有被 zod **strip 掉**。
`view` 字段丢失、slot 名拼错，这里就是第一现场。
```

---

## 11. `ctx.i18n`（`PluginI18nAPI`）

```typescript
interface PluginI18nAPI {
  t(key: string, defaultValueOrParams?: string | Record<string, any>, maybeParams?: Record<string, any>): string;
  getLanguage(): string; // 恒为 'zh'
}
```

`t()` 的实际行为（源码级）：

1. **重载归一**：第二参是 `string` → 视为 `defaultValue`，第三参为 `params`；第二参是 `object` → 视为 `params`，并从其 `defaultValue` 字段取默认值。
2. **跨插件命名空间**：key 含 `:` 时，`<pluginId>:<subKey>` —— 冒号前是**目标插件 id**。
3. 查 `contributionRegistry.getLocales(targetPluginId)`，**只取 `lang = 'zh'` 这一份字典**。
4. 命中 → `interpolate(val, params)`；未命中且有 defaultValue → 插值 defaultValue；都没有 → `friendlyFormatKey(subKey)`。

插值语法是 `{name}`（正则 `/\{([^{}]+)\}/g`，key 会 `trim()`）：

```typescript
ctx.i18n.t('greeting', '你好，{name}', { name: '小明' }); // → "你好，小明"
```

`friendlyFormatKey` 兜底：去掉首尾 `%`，取冒号后部分，按 `.` 分段；多于一段时取**最后两段**拼空格，
`_`/`-` 转空格，camelCase 拆词，每词首字母大写。

```typescript
ctx.i18n.t('homework.submit'); // 无字典无默认值 → "Submit Homework"（不是 "homework.submit"）
```

```{warning} 语言是硬编码的
服务端 `getLanguage()` **恒返回 `'zh'`**，`t()` 也只查 `locales['zh']`。
想要多语言请在前端 `ctx.i18n.getLanguage()`（走宿主真实语言）侧处理，别指望服务端切换。
```

---

## 12. `ctx.require(moduleName)`

服务端共享模块白名单（`PLUGIN_SHARED_MODULES`）：

```typescript
export const PLUGIN_SHARED_MODULES = [
  'recharts',
  'react-markdown',
  'jspdf',
  'jspdf-autotable',
  'exceljs', // 可选：需在 package.json dependencies 中
  'lucide-react',
  'uuid',
] as const;
```

不在白名单 → 抛错并列出全部允许值：

```
Plugin "..." cannot require "react". Allowed modules: recharts, react-markdown, jspdf, jspdf-autotable, exceljs, lucide-react, uuid
```

在白名单但未注册 → `Shared module "..." is not registered.`（`exceljs` 属可选，加载失败只 `console.warn` 且不阻塞启动）。

```{danger} 前端专属库不在这份白名单
`konva` / `react-konva` / `react-konva-utils` **通过前端 `FrontendPluginHost` 单独注入** ——
CJS bundle 无法加载纯 ESM 模块。在服务端 `ctx.require('konva')` 一定失败。
```

`bootstrapSharedModules()` 由 Kernel 启动时调用，用 `Promise.allSettled` 逐个 `import()` 并注册。

---

## 13. 安全包装一览（自动生成插件"做不到"的清单）

| 尝试                                                            | 结果                                                                                                |
| :-------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `ctx.services.capability.grant(...)` / `revokeAll(...)`         | 抛 `[Security] Plugins cannot grant capabilities` / `...cannot revoke capabilities`（`check` 可用） |
| `ctx.services.commandBus.setInterceptor(...)`                   | 抛 `[Security] setInterceptor cannot be configured from PluginContext`                              |
| `ctx.services.<any>.constructor`                                | `undefined`（`createSafeFunction` 显式设为不可写不可配置）                                          |
| `Object.getPrototypeOf(ctx.services.commandBus)`                | `null`（`setPrototypeOf(..., null)`）                                                               |
| `ctx.services.storage` 跨插件读别人的 key                       | 不可能 —— SQL 硬带 `WHERE plugin_id = ?`（值为 `manifest.id`）                                      |
| `ctx.db.ensureTable('t (x); DROP TABLE events; --', ...)`       | 抛 `[SEC] Invalid SQL identifier for ensureTable(tableName)`                                        |
| `ctx.db.ensureTable('notes', 'a TEXT); DROP TABLE x; --')`      | 抛 `[SEC] createTable schema must not contain ";"`                                                  |
| `ctx.provide(未声明的 token, ...)`                              | 抛 `... not declared in manifest.provides`                                                          |
| `ctx.resolve('@openlearn/core:LessonEngine')`（非白名单字符串） | 抛 `... cannot resolve ... by name`                                                                 |
| 注册他人 UUID 命名空间的命令                                    | 抛 `... belongs to another plugin's UUID namespace`                                                 |
| `ctx.services.processManager.kill(别人的 processId)`            | reject `无权终止不属于本插件的进程 ...`                                                             |

SQL 标识符规则：`/^[A-Za-z_][A-Za-z0-9_]{0,63}$/`（字母/下划线开头，最长 64 字符）。
`schema` 长度限制 1–4000 字符且**禁止分号**。

---

## 14. 资源自动回收（`ResourceTracker`）

`buildContext` 的每个包装器都把注册动作登记成 `Disposable`，**插件停用/卸载时按插入顺序自动清理**。
以下都不需要手写 `deactivate` 去注销：

| API                                                                            | 自动 dispose 的内容                                                                |
| :----------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| `commandBus.registerHandler`                                                   | `unregisterHandler(prefixed)`                                                      |
| `eventBus.subscribe`                                                           | `unsubscribe(eventType, safeSubscriber)`（经 `WeakMap` 反查原始 fn → 包装后的 fn） |
| `processManager.registerHandler`                                               | `unregisterHandler(scopedTaskType)`                                                |
| `processManager.registerInterval`                                              | `kill(processId)`                                                                  |
| `actionRegistry.register`                                                      | `unregister(id)` + `unregister('<id>__raw_alias')`                                 |
| `pointsDimension.registerDimension`                                            | `unregisterDimension(dimensionId)`（审计 D-1：早期判断"单例无需清理"是错的）       |
| `ai.registerAIContextProvider`                                                 | `unregisterAIContextProvider(id)`                                                  |
| `ai.registerAIPersona`                                                         | `unregisterAIPersona(personaId, pluginId)`                                         |
| `http.get/post/...`                                                            | `httpRouter.clear()`                                                               |
| `ctx.resolve(IClassroomLifecycleServiceToken)` 后的 `registerStageGuard`       | `unregisterStageGuard(owner)`                                                      |
| `ctx.resolve(IInteractionRuntimeServiceToken)` 后的 `registerActivityProvider` | `unregisterActivityProvider(owner, id)`                                            |
| `ctx.provide(token, impl)`                                                     | `serviceRegistry.unregister(token)`                                                |

```{note} 唯一不需要清理的
`ctx.services.pointsLedger` 的写入（`addPoints` 持久化到 `events` 表）—— 账本项不属于
「订阅 / 定时器 / 资源」那一类需清理的资源。
```

**包装后的 handler 异常不会冒泡破坏宿主**：命令 handler 会 `console.error` 后 rethrow；事件订阅者、
进程 handler、interval tick 的错误都被吞掉并 `console.error`。所以事件订阅里抛错**不会**让插件进入 `ERROR`，
只会静默丢日志 —— 排障时记得查 pino 输出。

---

## 15. 弃用告警

`buildContext` 会遍历 `manifest.requires + manifest.optional`，对每个 token 名调
`warnDeprecation('service', tokenName, manifest.id || pluginId)`。
构造发生在 `services` 字面量之前，**9 个 key 恒定存在**（值可能为 `null`），不会 `undefined`。

---

## 取证

| 论断                                                                                                                         | 来源                                                                                                                               |
| :--------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `PluginContext` / `PLUGIN_SHARED_MODULES` / `PluginDatabaseAPI` / `IPluginLogger` / `ContributionAccessor` / `PluginI18nAPI` | `packages/core/plugin-host/types.ts`                                                                                               |
| 9 个 service 的 `T \| null` 契约与 D-12 `skipTokens` 映射表、`Object.freeze`、`setPrototypeOf(null)`                         | `packages/core/plugin-host/context-builder.ts`（`buildContext`、`wrapCapability`、`wrapCommandBus`）                               |
| `pluginId` 是 DB 行 UUID、`storage`/命令前缀用 `manifest.id`                                                                 | 同上（`wrapStorage`、`wrapCommandBus`、`pluginTablePrefix(pluginId, manifest?.id)`）+ `packages/core/plugin-host/plugin-tables.ts` |
| `resolvePluginCommandType` / `stripPluginCommandPrefix` 必须传 `manifest.id`                                                 | `packages/core/plugin-host/plugin-namespace.ts` 文件头与函数注释                                                                   |
| SQL 标识符与 schema 校验                                                                                                     | `context-builder.ts`（`SQL_IDENTIFIER_PATTERN`、`assertSafeSqlIdentifier`、`assertSafeCreateTableSchema`）                         |
| 字符串 resolve 白名单门禁（审计 E-2）                                                                                        | `context-builder.ts`（`PLUGIN_RESOLVABLE_TOKEN_NAMES.has(token)`）                                                                 |
| `IClassroomLifecycleService` / `IInteractionRuntimeService` 的 resolve 层代理（Issue #327）                                  | `context-builder.ts`（`wrapPluginRuntimeService`）                                                                                 |
| `IConfigService` 签名、分层解析、共享缓存                                                                                    | `packages/core/plugin-host/config-service.ts`                                                                                      |
| `i18n.t` 行为、`getLanguage() === 'zh'`、`friendlyFormatKey`                                                                 | `context-builder.ts`（`buildContext` 返回对象的 `i18n` 段）                                                                        |
| `provides` 声明校验                                                                                                          | `context-builder.ts`（`provide`）                                                                                                  |
| `require` 白名单报错文案、`bootstrapSharedModules`                                                                           | `context-builder.ts`                                                                                                               |
| `warnOnMissingActionDescriptor`（Issue #71）                                                                                 | `context-builder.ts`                                                                                                               |
| ResourceTracker 逐项 dispose                                                                                                 | `context-builder.ts` 各 `wrap*` + `packages/core/plugin-host/resource-tracker.ts`                                                  |
