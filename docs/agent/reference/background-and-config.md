# 配置服务与后台任务

> **覆盖**：`ctx.config`（`IConfigService`）与 `ctx.services.processManager`（`IProcessService`）
> **权威源码**：`packages/core/plugin-host/config-service.ts`、`packages/core/process-manager/index.ts`、
> `packages/core/plugin-host/context-builder.ts`（`wrapProcessManager`）、`docs/architecture/configuration.md`

---

## 0. 先纠正三个先验

````{danger}
### `PluginContext` 上**没有** `ctx.background`、没有 `ctx.schedule`、没有 Cron

`PluginContext` 的全部成员只有 12 个（见 [PluginContext 参考](plugin-context.md)）：

```text
services · pluginId · manifest · resolve · provide · db
log · contributions · config · http · i18n · require
```

后台周期任务的**唯一**入口是 `ctx.services.processManager.registerInterval(...)`；
后台异步一次性任务是 `ctx.services.processManager.spawn(...)` + `registerHandler(...)`。
平台**没有内置 Cron 调度器**（`docs/architecture/configuration.md` §5 明确写出）。

模型常见的幻觉 API（`ctx.background.every(...)`、`ctx.schedule.cron(...)`、
`setInterval` 裸用后不管）在这里都**不存在或不被追踪**。
````

```{warning}
### 裸 `setInterval` 不会自动清理

平台用 `ResourceTracker` 回收**经过包装层**注册的资源。
你若在 `activate()` 里直接写 `setInterval(...)`（Node 环境）或 `setTimeout`，
宿主不知道它的存在，`deactivate()` 后**定时器继续跑**，插件卸载即泄漏。
正确做法见 §3；确实需要裸定时器时，必须自己存 handle 并在 `deactivate()` 里 `clearInterval`
（更规范的是用 `ctx.services.processManager.registerInterval`）。
```

```{important}
### 配置面有三层，彼此独立，不要混

| 层 | 声明处 | 存值处 | 插件如何读 | 热更新 |
| --- | --- | --- | --- | --- |
| **插件配置** | `manifest.configuration.properties` | `plugin_config` 表（三级作用域） | `ctx.config.get(key, opts?)` | ✅ 即时 |
| **插件 KV** | 无需声明 | `plugin_storage` 表 | `ctx.services.storage` | ✅ 即时 |
| **平台环境变量** | `.env` / compose / PM2 | 不入库 | **读不到**（见 §4） | ❌ 须重启 |

历史上第一层曾塞在 `plugin_storage` 的 `config:<key>` 里（Issue #151 之前），
现在 `ConfigService.KEY_PREFIX = 'config:'` 仅作为**旧库回退**保留。
不要主动往 `plugin_storage` 写 `config:` 前缀的键 —— 会和配置服务的回退读取撞车。
```

---

## 1. 平台没有集中的配置子系统

`docs/architecture/configuration.md` §0 的结论，插件作者需要知道的部分：

```{danger}
早期仓库存在 `packages/core/configuration/`（`PlatformConfiguration` /
`ConfigurationRegistry` / `ConfigurationProvider` / `ConfigurationLoader` …），
**已于 2026-10-01 作为死代码整体删除**（提交 `207ca36`，说明为「无生产消费方」）。

因此 `PlatformConfiguration`、`ConfigManager` 一类符号在 `packages/`、`server/`、
`server.ts`、`src/` **零命中**。若你在生成插件代码时引用它们，那是幻觉。
唯一残留痕迹是 `docs/release-notes/v0.2.6.md` 里的一次历史引用。
```

---

## 2. `ctx.config` —— `IConfigService`

### 2.1 完整签名

```typescript
export interface IConfigService {
  get<T = unknown>(key: string, options?: ConfigReadOptions): T;
  getAll(options?: ConfigReadOptions): Record<string, unknown>;
  set(key: string, value: unknown, scope?: ConfigWriteScope): Promise<void>;
  onChange(callback: ConfigChangeCallback): () => void; // 返回取消订阅函数
}

export interface ConfigReadOptions {
  classId?: string;
  schoolId?: string;
}
export interface ConfigWriteScope {
  scopeType?: ConfigScopeType; // 'platform' | 'school' | 'class'，默认 'platform'
  scopeId?: string;
}
export type ConfigChangeCallback = (key: string, newValue: unknown, oldValue: unknown) => void;
```

`get` **同步**、`set` **异步**。这个不对称是真实的：读走内存缓存，写要落库。

### 2.2 声明：`manifest.configuration.properties`

```json
{
  "configuration": {
    "properties": {
      "weight": {
        "type": "number",
        "default": 10,
        "minimum": 0,
        "maximum": 100,
        "description": "该插件在本班的评分权重",
        "scope": ["platform", "class"]
      }
    }
  }
}
```

注意路径是 `configuration.properties`（**嵌套一层**），不是顶层 `config`。
`configuration` 与其内部 `properties` 均可选。

合法字段**恰好 7 个**：

| 字段          | 类型     | 约束                                                             |
| ------------- | -------- | ---------------------------------------------------------------- |
| `type`        | 必填     | `'string' \| 'number' \| 'boolean' \| 'integer'`                 |
| `default`     | 任意     | `z.unknown()`，可选                                              |
| `description` | `string` | 可选                                                             |
| `enum`        | 任意数组 | 可选                                                             |
| `minimum`     | `number` | 可选，**仅数值分支生效**                                         |
| `maximum`     | `number` | 可选，**仅数值分支生效**                                         |
| `scope`       | 枚举数组 | 可选，取 `'platform' \| 'school' \| 'class'`；**缺省只有平台层** |

````{danger}
### 该 schema **没有** `.passthrough()` ⇒ 拼错字段名会被 Zod **静默 strip**

`manifestSchema` 用 Zod 定义这个属性对象，未列出的字段**不报错，直接剔除**。

```json
"min": 0,          // ← 想写 minimum，结果被静默丢弃，minimum 变成未设置
"maximum": "100",  // ← 字符串，类型不符会报错；但 "max": 100 不会
"title": "权重",   // ← 想写 description，被丢弃
```

后果：写错约束名 ⇒ 约束**不存在** ⇒ `set()` 校验放行。这是**不产生任何错误的失效**，
只能靠交付前用 `GET /api/plugins/:id/config` 回读 `schema` 核对。
````

`scope` 的语义是「**允许**在哪一层覆盖」：`platform` 始终隐含允许；
`class` / `school` 必须显式声明，否则 `set()` 抛错。缺省 `['platform']`。

TS 侧 `ConfigProperty` 定义在 `config-service.ts`；`ConfigDeclaration` 是
`NonNullable<Manifest['configuration']>`，直接从 Zod schema 推导（避免手写类型与 schema 漂移）。

### 2.3 存储：`plugin_config` 表

```sql
CREATE TABLE plugin_config (
  plugin_id   TEXT NOT NULL,
  scope_type  TEXT NOT NULL DEFAULT 'platform',
  scope_id    TEXT NOT NULL DEFAULT '',
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, scope_type, scope_id, key)
);
```

（迁移 `037_plugin_config_scopes.sql`）

| 事实                             | 说明                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 主键含作用域                     | 同一 key 可在平台 / 学校 / 班级各存一份                                                                                          |
| `plugin_id` 取 **`manifest.id`** | **不是**数据库主键 UUID；与插件私有表的 `plugin_<uuid>_` 前缀规则无关，别混用（对照 [PluginContext 参考](plugin-context.md) §3） |
| `value` 落库前 `JSON.stringify`  | 读回 `JSON.parse`；**解析失败则原样返回字符串**（不抛错）                                                                        |
| 旧值兼容                         | 迁移把 `plugin_storage.key = 'config:<key>'` 的行搬到平台层；迁移未执行时 `ConfigService` 仍回退读旧位置                         |
| 懒建表                           | `ensureTable()` 首次写入 `CREATE TABLE IF NOT EXISTS`，兼容未跑 037 的旧库与单测夹具                                             |
| 预热                             | `loadFromDB()` 一次性把**全部作用域**行（含旧 `plugin_storage` 行）读进内存缓存                                                  |

### 2.4 解析顺序：班级 > 学校 > 平台 > manifest 默认 > `undefined`

```typescript
const weight = ctx.config.get<number>('weight'); // 平台有效值
const classWeight = ctx.config.get<number>('weight', { classId }); // 班级覆盖优先
const all = ctx.config.getAll({ classId });
```

链路固定为 `class(classId)` → `school(schoolId)` → `platform('')` → schema `default` → `undefined`。
未传 `classId` / `schoolId` 时**自动跳过对应层**。

```{warning}
- `school` 层依赖多租户模型（Issue #149）。在其落地前，调用方**可以**显式传 `schoolId`
  触发该层解析，但**没有自动来源**；一校一实例部署下 `school` 等价于平台层。
- `get()` 对**未在 schema 声明**的 key 直接返回 `undefined`（连默认值都没有，因为 schema 里
  根本没有这一项）。只有「已声明但无任何作用域记录」才回落到 `default`。
  所以键名拼错的表现是 `undefined`，不是报错。
```

### 2.5 `onChange` 的三个易错点

```typescript
const off = ctx.config.onChange((key, newValue, oldValue) => {
  if (key !== 'weight') return; // ← 必须自己按 key 过滤
  applyWeight(newValue as number);
});
ctx.log.info('已订阅配置变更');
// deactivate() 里：off();
```

1. **单参**：`onChange(callback)`。**没有** `onChange(key, callback)` 的 per-key 重载
   （旧文档写错过）。按 key 过滤要在回调体内自己判。
2. **回调不带作用域参数**：签名只有 `(key, newValue, oldValue)`。
   同一个 key 在班级层改与在平台层改，回调看起来**一模一样**。需要区分时必须自己记录写入来源。
3. 返回的取消函数若不消费，订阅会一直挂着；`ConfigService` 用 `WeakRef` 登记实例，
   插件卸载后**其 `ConfigService` 可被回收**，广播不会送进已废弃的上下文 ——
   但同一实例内的回调仍然累积。

`oldValue` 是**共享缓存里的上一个值**，不是数据库历史值；此前从未缓存过则为 `undefined`。

### 2.6 写入顺序与失败语义

```text
validate() → assertScopeAllowed() → 更新共享缓存 → 写库 → 广播给所有活跃实例的监听器
```

| 情况                   | 行为                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| key 未在 manifest 声明 | `validate()` **抛错**，提示去 manifest 声明                             |
| `type: 'integer'`      | 额外要求 `Number.isInteger(v)`                                          |
| `minimum` / `maximum`  | **只在数值分支检查**（对 string 值不生效）                              |
| `enum`                 | 在类型检查之后单独校验                                                  |
| 向未声明的层写入       | `assertScopeAllowed()` 抛错，回显「manifest 声明允许：platform, class」 |
| 非平台层没给 `scopeId` | `normalizeWriteScope()` 抛错；平台层 `scopeId` 一律归一为空串           |
| **DB 写入失败**        | **回滚内存缓存**再抛出（旧值不存在时删除该键）                          |
| 监听器回调抛错         | **静默吞掉** —— 单个插件的回调异常不会中断配置写入                      |

### 2.7 生命周期与时序（无异步刷新窗口）

`ConfigService` 由 `packages/core/plugin-host/context-builder.ts` 的 `buildContext()` 创建，
顺序固定：**构造 → `loadFromDB()` → 作为 `ctx.config` 挂到上下文**。

```{important}
因此插件 `activate()` 里读到的值**已经是 DB 合并后的最终值**，
不存在「先读到默认值、随后被异步刷新」的窗口。
不要在 `activate()` 里为了「等配置就绪」而 `setTimeout` 重读 —— 那是无效代码。
```

缓存作用域与刷新：

- 缓存由**同一 `db` 对象 + `manifest.id` 的所有实例共享**（模块级
  `WeakMap<db, Map<manifestId, { values, instances }>>`）；
- 管理端通过临时实例写入后，运行中插件实例的缓存**立即刷新**，`get()` 马上读到新值；
- 写入会**广播给所有活跃实例**，运行中插件的 `onChange` 因此也会被触发；
- 激活时**尚不存在**的作用域行，会在首次 `get(key, { classId })` 缓存未命中时查库，
  所以后来新增的班级覆盖能被读到；
- `loadFromDB()` **清空并以 DB 为准重建**共享缓存：重装插件、恢复备份、直接改库后，
  下次管理端读取或重启插件都不残留旧缓存。

`ConfigService` 类上还有几个**不属于 `IConfigService` 接口**但宿主在用的公开方法，
`ctx.config` 上通常拿不到（类型层不暴露），需要时请通过管理端 REST：
`loadFromDB()`、`setSync()`、`allowedScopes(key)`、`hasKey()`、`getSchema()`、`cachedEntryCount()`。

### 2.8 平台侧访问与 REST

| 方法   | 路径                          | 权限                           | 作用域参数                                    | 行为                                               |
| ------ | ----------------------------- | ------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| `GET`  | `/api/plugins/:id(\*)/config` | 仅 `teacher` / `administrator` | `?classId=&schoolId=`（可选，返回该层有效值） | 返回 `{ schema, values }`                          |
| `POST` | `/api/plugins/:id(\*)/config` | 仅 `administrator`             | `?scopeType=platform\|school\|class&scopeId=` | 请求体为键值对对象，逐键 `setSync()`；缺省写平台层 |

- `scopeType` 非法 → `400`（文案：`scopeType 必须是 platform / school / class`）；
- 非平台层缺 `scopeId` → `400`（`非平台作用域必须提供 scopeId`）；
- 路径参数 `:id(*)` 允许 `manifest.id` 带斜杠的作用域形式（`@scope/name`）；
- 读写收紧的原因（审计 R-5）：配置值可能含第三方服务密钥，此前「登录即可读」
  允许**学生**读走任意插件全部配置值。

```{danger}
### `POST` 无事务性

`setPluginConfig()` 是普通的 `for...of` 顺序循环，一旦某个键校验失败就抛出中断，
而**排在它之前的键已经落库**。一次失败的批量更新会留下**部分生效**的配置，没有自动回滚。

前端做「保存全部设置」时要么逐键提交并展示每键结果，要么先在前端全量 `validate` 再提交。
```

宿主侧两个入口（插件不用调，但解释了缓存共享）：

- `getPluginConfig(pluginId, manifest?, options?)` —— 内部**临时 new 一个 `ConfigService`**、
  `loadFromDB()`、返回 `getAll(options)`，不持有内存引用；
- `setPluginConfig(pluginId, manifest, updates, scope?)` —— 同样临时实例，逐个 `setSync()`。

两者与运行中插件的 `ctx.config` **共享同一份缓存与变更广播**（按 `db` + `manifest.id` 归属）。
`resolvePluginUuid()` 负责把「DB UUID 或 manifest.id 别名」解析为真实主键
（先直查主键，再回退 SQLite `json_extract(manifest, '$.id')`）。

---

## 3. 后台任务：`ctx.services.processManager`

### 3.1 `IProcessService` 签名

```typescript
export interface IProcessService {
  // 两个可选方法：mock 或旧部署可缺省；缺省时归属校验退化为「不拦截」
  getProcessOwner?(processId: string): string | undefined;
  setPluginOwner?(pluginId: string): void;

  spawn(name: string, taskType: string, payload: unknown, ownerHint?: string): string | Promise<string>;
  kill(processId: string): void | Promise<void>;

  registerHandler(taskType: string, handler: ProcessHandler): void | Promise<void>;
  unregisterHandler(taskType: string): void | Promise<void>;

  registerInterval(
    name: string,
    intervalMs: number,
    tickFn: (log: (msg: string) => void) => void,
    ownerHint?: string,
  ): string | Promise<string>;

  restore(): void | Promise<void>;
}

export type ProcessHandler = (
  processId: string,
  payload: any,
  state: any,
  log: (msg: string) => void,
  updateState: (newState: any) => void,
) => Promise<void>;
```

```{danger}
### 插件里**不要**调 `setPluginOwner` / 传 `ownerHint`

- 包装层返回的对象里**根本没有**这两个可选方法（`context-builder.ts` 的字面量只含
  `registerHandler / registerInterval / kill / spawn / unregisterHandler / restore`），
  `ctx.services.processManager.setPluginOwner` 是 `undefined`。
- `ownerHint` 由 per-plugin 包装层**自己填**（填的是本插件 DB UUID）。你传了也会被覆盖。

原因（B-5）：`ProcessManager.currentOwner` 是**全局单值**，只在「激活期内」准确；
插件运行期（HTTP handler、定时器回调）spawn 的任务若不加 hint，会错记到
「最后激活的插件」名下 —— 轻则自己 `kill` 被归属校验拒绝，重则他人可 kill 你的后台任务。
包装层通过显式 `ownerHint` 把归属精度从「激活期」扩展到整个插件生命周期。
```

### 3.2 任务类型命名空间：`${pluginId}::${taskType}`

```{important}
包装层对 `registerHandler` / `spawn` / `unregisterHandler` 的 `taskType`
统一加前缀 `` `${pluginId}::${taskType}` ``，而这里的 **`pluginId` 是 `plugins` 表的行 UUID**
（`wrapProcessManager(processService, tracker, pluginId, ...)`），**不是 `manifest.id`**。

修复前的实测漏洞（注释原文）：`ProcessManager.handlers` 是**全局 Map**，
`registerHandler` 直接 `set(taskType, handler)` ⇒ 后注册者完全顶掉先注册者。
实测两个插件都 `registerHandler('shared-task')` 后 handlers 表大小 = 1，
先注册者的 handler 调用 **0 次** —— 插件 A 的后台任务处理器被插件 B **无声吃掉**。

三条实际约束：

1. 你在代码里写短名（`'sync-grades'`），**永远不要**自己拼 `::`；
2. 前缀含 UUID ⇒ 任务类型串不可硬编码、不可跨插件复用、**不能出现在日志可读性假设里**；
3. `spawn` 侧同步加前缀（且 `taskType.startsWith(`${pluginId}::`)` 时不重复加），
   否则自己 spawn 的任务派发不到自己的 handler。
```

### 3.3 一次性后台任务：`registerHandler` + `spawn`

```typescript
async function activate(ctx) {
  await ctx.services.processManager!.registerHandler(
    'export-batch',
    async (processId, payload, state, log, updateState) => {
      const total = payload.items.length as number;
      let done = (state?.done as number) ?? 0; // ← state 可能是 null（首次）或断点值（restore 后）
      for (let i = done; i < total; i++) {
        const row = (await ctx.services.storage.get(`row:${i}`)) as string;
        await ship(row);
        done = i + 1;
        updateState({ done, total }); // 落库：UPDATE processes SET state = ?
        log(`done ${done}/${total}`); // 落库：追加到 processes.logs
      }
    },
  );

  const processId = await ctx.services.processManager!.spawn('成绩批量导出', 'export-batch', {
    classId: 'cls_1',
    items: [1, 2, 3],
  });
  ctx.log.info('已启动后台任务', processId); // UUID v7 字符串
}
```

执行细节（`ProcessManager.resume()`）：

| 事实           | 说明                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| 异步启动       | `Promise.resolve().then(async () => { await handler(...) })`，`spawn` **立即返回** id，不阻塞                   |
| 成功收尾       | handler 正常返回后**重查** `status`；**只有 `status !== 'killed'` 才**置 `'completed'` 并发 `process.completed` |
| 失败           | `catch` → `log('ERROR: ...')` → `failProcess()` 置 `'failed'` + 发 `process.failed`（payload 含 `error`）       |
| 找不到 handler | `failProcess(processId, \`No handler found for task_type: ${taskType}\`)`                                       |
| 协作式取消     | 平台**不会打断**已在跑的 handler。想支持 kill，必须自己在循环里查 `status === 'killed'` 后 return               |

````{important}
**「已 kill 的任务不会被标成 completed」这一条是靠 handler 自查实现的。**
`ProcessManager` 只在收尾时保护状态不被覆盖，并不会终止你的循环。
参考实现（`packages/plugins/process.ts`）每步都查库：

```typescript
const p = db.prepare('SELECT status FROM processes WHERE id = ?').get(processId);
if (p && p.status === 'killed') { log('Process was killed.'); return; }
```

插件里等价写法是定期 `updateState` 之外自行查询任务状态，或把大任务拆成多段 spawn。
````

广播事件（`source: 'kernel.process_manager'`，走**全局**事件总线）：

| 事件                | payload                |
| ------------------- | ---------------------- |
| `process.spawned`   | `{ processId, name }`  |
| `process.completed` | `{ processId }`        |
| `process.failed`    | `{ processId, error }` |
| `process.killed`    | `{ processId }`        |

```{warning}
`processId` 经全局事件总线广播 ⇒ **任何订阅了 `process.spawned` 的插件都能拿到他人进程 id**。
这正是 B-5 补 `kill()` 归属校验的动因（修复前 `kill()` 只按 id UPDATE，无 owner 校验）。
反过来：不要假设 processId 是秘密。
```

### 3.4 周期任务：`registerInterval`

```typescript
const timerId = await ctx.services.processManager!.registerInterval('attendance-sweep', 60_000, (log) => {
  // 同步体；抛错被包装层捕获并 console.error，不会中断后续 tick
  const n = sweep();
  log(`swept ${n}`);
});
```

`ProcessManager.registerInterval` 实现要点：

| 事实           | 说明                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| 落库行         | `task_type` 写死为 **`'interval'`**，`payload` / `state` 列**不在 INSERT 中**（保持 NULL）              |
| 定时器         | `setInterval(() => { try { tickFn(logger) } catch (e) { logger('ERROR: ' + e.message) } }, intervalMs)` |
| handle 存放    | `this.activeTasks.set(processId, timer)`（**进程内存**，`Map<string, NodeJS.Timeout>`）                 |
| tickFn 抛错    | 记一条 `ERROR:` 日志，**不**把任务标 failed，下一个 tick 照常                                           |
| 包装层再加一层 | `catch (e) { console.error('[Plugin:<id>] Error in interval task <name>:') }`                           |
| 广播           | 同样发 `process.spawned`                                                                                |
| 自动回收       | `tracker.track(pluginId, { dispose: () => processService.kill(processId) })` —— 插件卸载即 kill         |

```{danger}
### 定时器**不会跨重启恢复**，且重启后会被标成 `failed`

`tickFn` / `timer` 只活在 `activeTasks` 内存 Map 里，进程一退就没了。
而 `restore()` 会 `SELECT * FROM processes WHERE status='running'`，对每一行按
`task_type` 找 handler：interval 行的 `task_type` 是字面量 `'interval'`
（未加命名空间前缀），`handlers.get('interval')` 命中不了插件注册的
`` `${uuid}::...` `` handler ⇒ 走 `failProcess()` ⇒ 该行被改写为 `'failed'`
并发一条 `process.failed`。

**结论**：`registerInterval` 的周期任务必须在每次 `activate()` 里重新注册；
数据库里遗留的 `running` interval 行不是状态，重启后会自然变成 `failed`。
不要写「查询 `processes` 表发现已有 interval 就跳过注册」这种逻辑。
```

### 3.5 `kill` 的归属校验（B-5）

```typescript
kill: createSafeFunction((processId: string) => {
  if (!isOwnProcess(processId)) {
    return Promise.reject(new Error(`[Plugin:${pluginId}] 无权终止不属于本插件的进程 ${processId}`));
  }
  return processService.kill(processId);
}),

const isOwnProcess = (processId: string): boolean => {
  if (!ownerLookup) return true;
  const owner = ownerLookup(processId);
  return owner === undefined || owner === pluginId;   // 查不到归属时**保守放行**
};
```

判定口径：**仅在明确查到他人 owner 时拒绝**。查不到（进程表已清理、存量行 `plugin_id` 为 NULL、
mock 缺 `getProcessOwner`）按「不是他人」放行，避免误杀插件自己的进程。
`ownerLookup` 缺省走 `IProcessService.getProcessOwner`（内存 Map + `processes.plugin_id` 列）；
注释明确说明：不注入就会**静默退化成「不拦截」，等于把校验关掉了**。

`ProcessManager.kill` 本身：`clearInterval` + `activeTasks.delete` + `processOwners.delete`

- `UPDATE processes SET status='killed'` + 广播 `process.killed`。

> ⚠ kill 只改状态和清定时器，**不会中断一个已在执行的 `spawn` handler**（见 §3.3 协作式取消）。

### 3.6 `processes` 表

```sql
-- 列（按 INSERT 反推）
id  name  status  task_type  payload  state  logs  created_at  updated_at  plugin_id
```

| 列          | 语义                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `id`        | UUID v7，即 `processId`                                               |
| `status`    | `'running'` → `'completed'` / `'failed'` / `'killed'`                 |
| `task_type` | **已加命名空间** `<pluginDbUuid>::<短名>`；interval 固定 `'interval'` |
| `payload`   | `JSON.stringify(payload)`                                             |
| `state`     | `updateState()` 整体覆盖写入的 JSON                                   |
| `logs`      | **纯文本追加**（`logs + msg + '\n'`），无结构化、无长度上限截断       |
| `plugin_id` | 归属插件（ownerHint / currentOwner 写入），kill 归属校验依据          |

```{warning}
`log(msg)` 每次调用都跑两条 SQL（`SELECT logs` + `UPDATE processes`）。
**在紧循环里高频 `log()` 会把 SQLite 写放大成性能瓶颈**。
按里程碑打日志（每 N 步一次），不要每个元素一行。

同理 `updateState()` 也是同步全量 `JSON.stringify` + UPDATE。
```

### 3.7 `restore()`

```typescript
public restore() {
  const runnings = this.kernel.db.prepare('SELECT * FROM processes WHERE status = ?').all('running');
  for (const p of runnings) {
    if (p.task_type) this.resume(p.id, p.task_type, p.payload ? JSON.parse(p.payload) : {}, p.state ? JSON.parse(p.state) : null);
  }
}
```

- 只捞 `status = 'running'`；
- `spawn` 型任务能正确恢复：DB 里存的 `task_type` 已带前缀，`registerHandler` 注册时也用同一
  前缀（同一 DB UUID）——**前提是 `plugins` 行没被重建**（重装 ZIP 会产生新 UUID ⇒
  旧行 `task_type` 前缀对不上 ⇒ 被标 `failed`）；
- `state` 会以「上次 `updateState` 的值」传入 handler 第 3 参 ⇒ **handler 必须支持从断点续跑**
  （示例里的 `let done = state?.done ?? 0`）；
- interval 行见 §3.4 的坑；
- 平台**不会自动调 `restore()` 帮你**。参考插件是在 `activate()` 里自己调
  （`packages/plugins/process.ts`：`// RESTORE EXISTING TASKS` → `await processManager.restore()`）。
  你的插件若需要断点续跑，也要显式调用；注意它会把**所有** `running` 行都尝试 resume，
  包括他人的 —— 但对他人 `task_type` 找不到 handler，结果是把他人的行标 `failed`
  并广播 `process.failed`。

```{danger}
最后一句是真实副作用：`restore()` 的过滤条件只有 `status='running'`，**不校验 `plugin_id`**。
一个插件在自己的 `activate()` 里调 `restore()`，可能把别的插件正在运行的任务行
改写成 `'failed'`（因为该插件内存里没有别人的 handler）。
在没有把握时，宁可自己实现「按 `plugin_id` 过滤 + 逐段重新 spawn」的恢复逻辑。
```

### 3.8 权限与命令面

后台任务的命令通道（内核自带，`packages/plugins/process.ts` 注册）：

| 命令            | 需要的能力      |
| --------------- | --------------- |
| `process.spawn` | `process:write` |
| `process.kill`  | `process:write` |
| `process.list`  | `process:read`  |
| `process.logs`  | `process:read`  |

`process:read` / `process:write` 属于 19 个真实能力名之一（见 [能力清单](capabilities.md)）。
用 `ctx.services.processManager` 直接调用时**不经过 CommandBus**，因此不看这两个能力，
但仍受包装层的归属校验约束。

### 3.9 与 `http` 超时的配合

`ctx.http` handler 的派发超时固定 5000ms（inline 与 worker 都是，见
[HTTP API 参考](http-api.md) §9.2）。**超过 5 秒的工作不要放在 handler 里等** ——
`spawn` 出去、handler 立刻回 `{ accepted: true, processId }`，
用 SSE 或轮询 `process.logs` 汇报进度。

---

## 4. 环境变量：插件读不到，但会改变你的插件行为

```{danger}
### `process` 隔离模式下**没有** `process.env`

第三方插件（manifest id 不在 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 白名单、
文件不在内置目录 `packages/plugins`）会被
`packages/core/plugin-host/execution-policy.ts` 的 `resolvePluginExecutionMode()`
**强制改写为 `process`**（`coerced: true`），运行在 `child_process` + **最小环境变量白名单**。
manifest id 以 `@openlearn/` 开头**不构成**信任依据。

后果：

- ❌ 在插件代码里写 `process.env.MY_PLUGIN_TOKEN` 取不到值（`process` 模式下甚至拿不到
  `process` 对象的全部能力）；
- ✅ 秘密类配置的正确落点是 `manifest.configuration.properties` + `plugin_config`，
  由管理员在设置页写入；
- ✅ 出站域名不是 env 能开的面：`fetch` 仅放行 `plugin_network_grants` 中已批准的域名。
```

管理员侧、会影响插件运行时表现的变量（**部署时定型，改后必须重启**）：

| 变量                                           | 默认             | 对插件的意义                                                                                                                                              |
| ---------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENLEARN_TRUSTED_INLINE_PLUGINS`             | 空               | 逗号分隔 `manifest.id`。名单内才可按 manifest 使用 inline/worker；其余非内置插件强制 `process`。名单出现在生产环境时启动日志必留告警                      |
| `OPENLEARN_PLUGIN_PERMISSION`                  | `rw`             | 子进程 Node 权限档位 `rw`/`ro`/`off`。`off` **同时**放开文件权限和出站网络入口脚本                                                                        |
| `OPENLEARN_PLUGIN_MAX_HEAP_MB`                 | `128`            | 子进程 V8 **老生代**上限（MB），`0`/`off` 关闭。⚠ 仅老生代；Buffer 等 external 内存不受约束                                                               |
| `OPENLEARN_PLUGIN_MAX_RSS_MB`                  | `512`            | 子进程 RSS 上限，**仅 Linux `/proc` 采样**，超限 `SIGKILL` 后走崩溃看门狗                                                                                 |
| `OPENLEARN_PLUGIN_CPU_QUOTA_MS` / `_WINDOW_MS` | `8000` / `10000` | 每窗口 CPU 毫秒配额，超限 `SIGKILL`                                                                                                                       |
| `OPENLEARN_PLUGIN_QUOTA`                       | 开启             | `off` 同时关闭 RSS 与 CPU 采样（不影响 V8 堆上限）                                                                                                        |
| `OPENLEARN_WORKER_ISOLATE`                     | —                | Worker 隔离开关                                                                                                                                           |
| `ALLOW_UNSAFE_PLUGIN_SCRIPTS`                  | 关闭             | **非 `true` 时，manifest 声明的 `deploy.script` 被拦截**（SEC-RCE-02），仅打印 `[SECURITY WARNING]` 不执行。读取点 `packages/core/plugin-host/install.ts` |
| `ROUTE_SCOPE_ENFORCE`                          | 未设             | `true` 时平台自身路由若未声明 scope 直接抛错拒绝启动（不影响插件路由）                                                                                    |

```{warning}
### 变量名拼错 = 静默回落默认值（甚至更宽策略）

这是本平台配置体系**最需要知道的工程特性**（TB-03）：
`OPENLEARN_PLUGIN_PERMISSION=rw-only`、`OPENLEARN_WORKER_LIVENESS=flase`、
`OPENLEARN_PLUGIN_MAX_HEAP_MB=128MB` 这类非法值，解析器**静默回落**。

已修的部分：`server/security/env-validation.ts` 的 `assertStartupEnv()` 在启动期强校验，
非法值直接 `error` **拒绝启动**（覆盖 `OPENLEARN_PLUGIN_PERMISSION` /
`OPENLEARN_PLUGIN_QUOTA` / `OPENLEARN_WORKER_LIVENESS` / `OPENLEARN_PLUGIN_MAX_RSS_MB` /
`OPENLEARN_PLUGIN_CPU_QUOTA_MS` / `OPENLEARN_PLUGIN_CPU_WINDOW_MS` 等）。
**没被 `assertStartupEnv` 覆盖的变量仍然是静默回落** —— 排查「配额没生效」时先确认该项是否在强校验清单里。
```

`OPENLEARN_PLUGIN_NET_ALLOW` 是**内部传递键**（宿主写入 → 交给子进程 → preload 读完即 `delete`），
不是用户配置项，插件更不该尝试读写；`plugin-net-preload.cjs` 加载时就把它删了，
**插件代码改环境变量不能把自己加进允许名单**。

---

## 5. 常见故障定位

| 症状                                                                          | 根因                                                                       | 处置                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ctx.config.get('x')` 恒为 `undefined`                                        | key 没写进 `manifest.configuration.properties`（拼错或写在顶层 `config`）  | 回读 `GET /api/plugins/<id>/config` 看 `schema` 里有没有这项      |
| 配置改了但插件没反应                                                          | 用了 `onChange(key, cb)` 双参写法（不存在），回调其实没注册成功            | 改单参 `onChange(cb)`，回调内按 key 过滤                          |
| `set()` 抛「manifest 声明允许：platform」                                     | 目标层没在 `scope` 里声明                                                  | manifest 加 `"scope": ["platform","class"]`                       |
| `minimum` 不生效                                                              | 该值走的是 string 分支（`type` 写成 `'string'`）                           | `type` 改 `'number'` / `'integer'`                                |
| 批量保存设置部分生效                                                          | `POST /config` 无事务（§2.8）                                              | 前端先全量校验或逐键提交                                          |
| 后台任务从没执行，进程行 `failed` + error `No handler found for task_type: …` | `spawn` 早于 `registerHandler`；或重装后 UUID 变了                         | `activate()` 内先 `await registerHandler` 再 `spawn`              |
| 我的后台任务被别的插件"吃掉"                                                  | 直接用了未包装的 `ProcessManager`（内置插件路径），短名撞车                | 走 `ctx.services.processManager`（包装层自动加 `<uuid>::` 前缀）  |
| `kill()` 被拒 `无权终止不属于本插件的进程`                                    | 试图 kill 他人进程 id（或自己的行 `plugin_id` 为 NULL 的存量数据不在此列） | 只 kill 本插件 `spawn`/`registerInterval` 返回的 id               |
| 定时任务重启后不再跑                                                          | interval 不跨重启恢复（§3.4）                                              | 每次 `activate()` 重新 `registerInterval`                         |
| 插件卸载后定时器还在跑                                                        | 裸 `setInterval`，没经包装层注册                                           | 改用 `registerInterval`，或 `deactivate()` 里自行 `clearInterval` |
| 后台任务越跑越慢 / DB 锁                                                      | 紧循环里高频 `log()` / `updateState()`（每调用两条 SQL）                   | 降频，按里程碑记录                                                |
| `process` 模式插件读不到 env                                                  | 最小 env 白名单（§4）                                                      | 秘密走 `ctx.config`；域名走 `plugin_network_grants` 审批          |
| 配了 `deploy.script` 却没跑                                                   | `ALLOW_UNSAFE_PLUGIN_SCRIPTS` 未设 `true`                                  | 看日志有无 `[SECURITY WARNING]`；这是默认安全策略，不是 bug       |

---

## 6. 交付自检清单

- [ ] 全文 grep 过自己代码：没有 `ctx.background` / `ctx.schedule` / `PlatformConfiguration` / `ConfigManager`
- [ ] 配置项都声明在 `manifest.configuration.properties`（**不是**顶层 `config`），字段名只用那 7 个
- [ ] 需要班级/学校覆盖的项显式写了 `scope`
- [ ] `get()` 结果判空后有兜底行为（未声明 key 返回 `undefined`，不抛错）
- [ ] `onChange` 用单参形态，并在 `deactivate()` 调用返回的取消函数
- [ ] 后台任务 `registerHandler` **先于** `spawn`
- [ ] `taskType` 写短名，没有自己拼 `::` 或 UUID
- [ ] 没有调用 `setPluginOwner` / 传 `ownerHint`
- [ ] 长任务 handler 支持从 `state` 断点续跑（`state` 首值为 `null`）
- [ ] 周期任务在每次 `activate()` 重新注册（不依赖重启恢复）
- [ ] 调用 `restore()` 前考虑了「会把他人 running 行标 failed」的副作用
- [ ] 日志/状态更新降频，不在紧循环里逐元素写库
- [ ] 没有裸 `setInterval`；若有，`deactivate()` 里清理
- [ ] 插件代码不读 `process.env` 取配置
- [ ] HTTP handler 内不做超过 5 秒的工作（改 `spawn` + 轮询/SSE 汇报）

---

## 7. 取证

| 论断                                                                       | 来源                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PluginContext` 12 个成员，无 `background`/`schedule`                      | `packages/core/plugin-host/types.ts` 的 `export interface PluginContext`                            |
| `IConfigService` 4 方法与三个类型别名                                      | `packages/core/plugin-host/config-service.ts`（`docs/architecture/configuration.md` §2.4 全文引用） |
| `configuration.properties` 嵌套路径与 7 个合法字段                         | 同上 §2.1                                                                                           |
| 未列字段被 Zod strip 而非报错                                              | 同上 §2.1（「该对象未开启 `.passthrough()`」原文）                                                  |
| `scope` 缺省仅平台层                                                       | 同上 §2.1                                                                                           |
| `ConfigProperty` / `ConfigDeclaration` 定义位置                            | 同上 §2.1                                                                                           |
| `plugin_config` DDL 与主键                                                 | 同上 §2.2（迁移 `037_plugin_config_scopes.sql`）                                                    |
| `plugin_id` = manifest.id、value JSON 化、解析失败原样返回                 | 同上 §2.2                                                                                           |
| 旧 `plugin_storage` `config:` 回退与 `KEY_PREFIX`                          | 同上 §2.2                                                                                           |
| `ensureTable()` 懒建表                                                     | 同上 §2.2                                                                                           |
| 解析链 class>school>platform>default>undefined                             | 同上 §2.3                                                                                           |
| `school` 层无自动来源（Issue #149）                                        | 同上 §2.3                                                                                           |
| 未声明 key 返回 `undefined`                                                | 同上 §2.4 易错点 3                                                                                  |
| `onChange` 单参、无 key 重载、无作用域参数                                 | 同上 §2.4 易错点 1/2                                                                                |
| 写入顺序与八条失败语义（含 DB 失败回滚内存、回调抛错被吞）                 | 同上 §2.5                                                                                           |
| `buildContext` 构造→`loadFromDB`→attach，无异步刷新窗口                    | 同上 §2.6                                                                                           |
| `WeakMap<db, Map<manifestId,{values,instances}>>` 共享缓存、`WeakRef` 登记 | 同上 §2.6                                                                                           |
| 平台侧 `getPluginConfig` / `setPluginConfig` 临时实例                      | 同上 §2.7                                                                                           |
| REST 两行路由、角色限制、`scopeType`/`scopeId` 400 文案                    | 同上 §2.7 + `server/routes/plugins.ts` L1063–L1074                                                  |
| 审计 R-5 收紧读权限                                                        | 同上 §2.7                                                                                           |
| POST 无事务（`for...of`，部分落库）                                        | 同上 §2.7 ⚠️ 段落                                                                                   |
| `PlatformConfiguration` 目录已删除（`207ca36`，2026-10-01）                | 同上 §0 历史包袱说明                                                                                |
| 环境变量就地读取、无 schema、无热更新、改名不报错                          | 同上 §1.1                                                                                           |
| `assertStartupEnv` 清单与 TB-03 / R-03                                     | `docs/architecture/configuration.md` §1.1、`system-configuration.md` §5、审计报告 TB-03/R-03 行     |
| `resolveAuthContext`/`actor` 与 `plugin_config` 无关（本文不外推）         | —                                                                                                   |
| `IProcessService` 完整签名（含两个可选方法、`ownerHint`）                  | `packages/core/plugin-host/types.ts`（另见 `77153` 处 `server` 侧副本）                             |
| `ProcessHandler` 五参签名                                                  | `packages/core/process-manager/index.ts`                                                            |
| `handlers` 全局 Map 撞车实测（表大小 1 / 调用 0 次）                       | `packages/core/plugin-host/context-builder.ts` `wrapProcessManager` 内 B-5 注释                     |
| `scopedTaskType = ${pluginId}::${taskType}`                                | 同上                                                                                                |
| `wrapProcessManager(processService, tracker, pluginId, …)` 用 DB UUID      | `context-builder.ts` L103351–L103360（`buildContext` 第 2 步）                                      |
| `spawn` 侧同步加前缀 + 不重复加                                            | 同上 `spawn` 实现                                                                                   |
| `kill` 归属校验与 `isOwnProcess` 保守放行                                  | 同上                                                                                                |
| `ownerLookup` 缺省退化即关闭校验                                           | 同上注释                                                                                            |
| `setPluginOwner` 须在激活前调用、`currentOwner` 全局单值                   | `process-manager/index.ts` `currentOwner`/`setPluginOwner` 注释                                     |
| `spawn` 立即返回、handler 异步执行、killed 不覆盖为 completed              | `process-manager/index.ts` `spawn` + `resume`                                                       |
| `failProcess` 置 failed 并发 `process.failed`                              | 同上                                                                                                |
| `No handler found for task_type: <x>`                                      | 同上 `resume`                                                                                       |
| interval 行 `task_type='interval'`、payload/state 不写入                   | `process-manager/index.ts` `registerInterval` 的 INSERT 列清单                                      |
| interval tick 抛错仅记日志、包装层再 console.error                         | `registerInterval` + `wrapProcessManager.registerInterval`                                          |
| `activeTasks` 为内存 `Map<string, NodeJS.Timeout>`                         | `ProcessManager` 字段声明                                                                           |
| `kill` 清 timer + 置 killed + 广播                                         | `ProcessManager.kill`                                                                               |
| `restore()` 只按 `status='running'`、不校验 `plugin_id`                    | `ProcessManager.restore`                                                                            |
| `log()` 每次两条 SQL                                                       | `resume`/`registerInterval` 内的 logger 实现                                                        |
| 参考插件在 `activate()` 调 `restore()`、无内置 Cron                        | `packages/plugins/process.ts`（`// RESTORE EXISTING TASKS`）+ 内置插件说明 §5                       |
| `process.spawn/kill/list/logs` 与 `process:read`/`process:write`           | 内置插件说明 §5 + 能力清单                                                                          |
| `ResourceTracker` 自动 kill interval / unregister handler                  | `wrapProcessManager` 内两处 `tracker.track(...)`                                                    |
| 第三方插件强制 `process`（`coerced: true`）、`@openlearn/` 前缀不构成信任  | `execution-policy.ts` 说明 + `docs/reference/plugin-trust-boundary.md`                              |
| `OPENLEARN_PLUGIN_NET_ALLOW` 为内部传递键、preload 读完 delete             | `packages/core/worker-runtime/plugin-net-preload.cjs`                                               |
| 环境变量表 9 行默认值与语义                                                | `docs/configuration/system-configuration.md` §1 行 16680–16689                                      |
| `ALLOW_UNSAFE_PLUGIN_SCRIPTS` 拦截 `deploy.script`（SEC-RCE-02）           | 同上 + 读取点 `packages/core/plugin-host/install.ts`                                                |
| 堆上限仅老生代、`describeHeapLimit` 文案                                   | `packages/core/worker-runtime/plugin-limits.ts`                                                     |
| RSS/CPU 超限 SIGKILL、仅 Linux `/proc`、thread 模式只有 V8 上限            | `packages/core/worker-runtime/plugin-quota.ts` 说明（审计报告 R-03）                                |
