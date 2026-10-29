# 教程二：full-stack 插件（前端入口 + 课堂工具 + 落库）

**目标**：在 {doc}`server-only` 的基础上加三样东西 ——
课堂工具按钮、命令面板条目、以及**真正可靠的数据库写入**。

起点：

```bash
npx @openlearn/plugin-sdk init \
  --name record-helper \
  --description "课堂记录插件" \
  --author myteam \
  --template full-stack
```

---

## 1. 三个源文件各管什么

> 下表里的文件路径是**插件工程脚手架**内的路径（你本地插件仓库的 `src/`），不是 OpenLearn 仓库路径。

| 文件                     | 运行位置                                        | 硬契约                                                             |
| :----------------------- | :---------------------------------------------- | :----------------------------------------------------------------- |
| `src/index.ts`           | 服务端（`process` 子进程，若是第三方 ZIP）      | `export default { manifest, activate, deactivate }`                |
| `src/frontend.tsx`       | **隐藏**不透明源 iframe `/plugin-sandbox/frame` | `default.activate` 必须是函数；注册的配置必须可 `structuredClone`  |
| `src/contracts/index.ts` | 只参与类型 / Token 共享                         | `Token` 的 name 若要 `provide`，必须完整出现在 `manifest.provides` |

```{danger}
### `frontend.tsx` 渲染不出任何界面

它跑在 `display: none` 的隐藏帧里，那个帧的 CSP 是 `connect-src 'none'`。
你在里面 `document.body.appendChild(...)` 不会报错，用户也永远看不见。
**可见 UI 只有一条路**：`contributes[*].view` 指向你自己的 HTML 文件 → {doc}`sandbox-view`。
模板注释「它不渲染任何用户可见 UI」是对的，但「iframe 内没有 DOM」是错的 ——
帧有自己的 `document`，只是看不见。详见 {doc}`../reference/frontend-sandbox` §0、§1。
```

---

## 2. manifest：课堂工具与 `$lessonId`

模板的服务端 manifest 比 `server-only` 多了 `classroomTools`：

```typescript
capabilitiesProposed: ['lesson:read', 'lesson:write'],
classroomTools: [
  {
    id: 'record-helper-tool',
    name: 'record-helper',
    icon: 'Puzzle',
    commandType: '@myteam/record-helper.open_tool',
    // $lessonId / $classId 由宿主在点击瞬间替换成当前课堂上下文
    payload: { lessonId: '$lessonId', classId: '$classId' },
  },
],
```

三条要点：

1. **`payload` 里的 `$lessonId` / `$classId` 是工具按钮拿到课堂上下文的唯一通道**。
   宿主在派发前做字符串替换，别自己编字段名（`$currentLesson`、`{{lessonId}}` 都不存在）。
2. `commandType` 写**全限定名** `<manifest.id>.open_tool`，理由见
   {doc}`server-only` §3.2。
3. `classroomTools` 是声明式贡献，仍然需要一个**服务端 handler**。
   只声明不注册 → 点按钮报 `No handler registered for command type "<resolvedType>".`（404）。

`icon: 'Puzzle'` 取自 `lucide-react` 的图标名。宿主渲染图标，插件不 import React。
槽位全集与每个槽位的字段：{doc}`../reference/contributes-slots`。

---

## 3. 服务端 `activate`：四个服务都要判空

模板原文（占位符已替换）：

```typescript
async activate(ctx: PluginContext) {
  const commandBus = ctx.services.commandBus;
  const actionRegistry = ctx.services.actionRegistry;
  const eventBus = ctx.services.eventBus;
  const db = await ctx.resolve(IDatabaseToken);
  // ...
}
```

改写后的最小可用版：

```typescript
async activate(ctx: PluginContext) {
  const commandBus = ctx.services.commandBus;
  const actionRegistry = ctx.services.actionRegistry;
  const eventBus = ctx.services.eventBus;
  if (!commandBus || !actionRegistry || !eventBus) {
    throw new Error('required kernel services unavailable');
  }

  await ctx.db.ensureTable(
    'data',
    `id TEXT PRIMARY KEY,
     content TEXT NOT NULL,
     created_at INTEGER NOT NULL`,
  );

  const rawDb = await ctx.resolve(IDatabaseToken);
  // ...注册 action 与 handler（见 §4、§5）
  ctx.log.info('record-helper activated (full-stack)');
}
```

```{note}
`ctx.db`（`PluginDatabaseAPI`）与 `ctx.resolve(IDatabaseToken)`（原生 Database 形状）是两样东西：
前者只有 4 个方法且帮你管前缀，后者是裸 SQL 通道。
`PluginDatabaseAPI` = `ensureTable` / `table` / `dropAllTables` / `migrate`
（``packages/core/plugin-host/types.ts` → `PluginDatabaseAPI`（L99–L109））。
```

---

## 4. 建表：`ensureTable` 的输入是**不可信 SQL 片段**

```typescript
await ctx.db.ensureTable('data', `id TEXT PRIMARY KEY, content TEXT NOT NULL, created_at INTEGER NOT NULL`);
const tableName = ctx.db.table('data'); // → 'plugin_<id>_data' 形式
```

宿主侧的两道 SEC 校验（worker 垫片里逐字可见，inline 模式保持一致）：

```javascript
if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String(tableName))) {
  throw new Error('[SEC] Invalid SQL identifier for ensureTable: ' + String(tableName));
}
if (typeof schema !== 'string' || schema.length === 0 || schema.length > 4000 || schema.indexOf(';') !== -1) {
  throw new Error('[SEC] Invalid CREATE TABLE schema fragment: must be non-empty and contain no semicolon');
}
```

由此得四条硬约束：

| 约束                                 | 原因                                                              | 违反后果                                          |
| :----------------------------------- | :---------------------------------------------------------------- | :------------------------------------------------ |
| 表名只能是合法标识符，≤ 64 字符      | 标识符白名单                                                      | 抛 `[SEC] Invalid SQL identifier for ensureTable` |
| schema 片段**不能有分号**            | 禁多语句注入                                                      | 抛 `[SEC] Invalid CREATE TABLE schema fragment`   |
| schema 片段**不要写 `CREATE TABLE`** | 宿主自己拼 `CREATE TABLE IF NOT EXISTS <prefix><name> (<schema>)` | 拼出语法错的 DDL                                  |
| schema ≤ 4000 字符                   | 长度上限                                                          | 抛同类错误                                        |

前缀由 `packages/core/plugin-host/plugin-tables.ts` 的 `pluginTablePrefix(scopeId, _manifestId?)`
统一给出，`scopeId` 是 **`plugins` 表的主键**（内置插件用其规范标识，上传插件用安装生成的 UUID，
非 `[A-Za-z0-9_]` 一律换成 `_`）；`_manifestId` 形参**不参与拼接**，
只在 `listAllowedPluginTablePrefixes(..., includeLegacyManifest)` 里作为历史兼容前缀出现。
worker/process 档拿到的是同一个值（`workerData.tablePrefix`）。

**所以表名里带的是 UUID 而不是你的 `manifest.id`，长度也可能远超直觉** ——
永远用 `ctx.db.table('data')` 拼 SQL，不要硬编码、也不要按 `manifest.id` 推导。
核心表黑名单与 `sql-guard` 的 6 条操作正则见 {doc}`../reference/database`。

---

## 5. 写库：模板这一行在 `process` 档不可靠

模板原文：

```typescript
const tableName = ctx.db.table('data');
const id = crypto.randomUUID();
db.prepare(`INSERT INTO ${tableName} (id, content, created_at) VALUES (?, ?, ?)`).run(id, input, Date.now()); // ← 模板没有 await
```

同一行代码在两个档位**语义不同**：

| 模式                 | `ctx.resolve(IDatabaseToken)` 返回什么 | `prepare(...).run(...)` 的返回    | 不 `await` 的后果                                                          |
| :------------------- | :------------------------------------- | :-------------------------------- | :------------------------------------------------------------------------- |
| `inline`             | 真 `better-sqlite3` Database           | `Statement`（同步，**已经写完**） | 无害                                                                       |
| `worker` / `process` | RPC 垫片 `{ exec, prepare }`           | **Promise**                       | 写入 fire-and-forget；失败变 unhandled rejection；命令先返回、数据可能后到 |

垫片的实现（`worker-runtime/bootstrap/sections/message-handler.ts`）：

```javascript
prepare: function(sql) {
  return {
    run: function() { return svc.prepareAndRun(sql, Array.prototype.slice.call(arguments)); },
    get: function() { return svc.prepareAndGet(sql, ...); },
    all: function() { return svc.prepareAndAll(sql, ...); },
  };
}
```

而主线程侧的 RPC 白名单**只有 4 个方法**
（`exec` / `prepareAndRun` / `prepareAndGet` / `prepareAndAll`），
每个入口都先过 `assertDatabaseAccessAllowed(sql)`；
调用其它方法得到 `Method "<m>" not supported on IDatabase RPC`。

````{danger}
### 正确写法只有一种：`await`

```typescript
await db.prepare(`INSERT INTO ${tableName} (id, content, created_at) VALUES (?, ?, ?)`)
  .run(id, input, Date.now());
```

`await` 在 inline 档等一个非 Promise 值，语义完全不变（直接拿到该值），
在 worker/process 档才真正等 RPC 回执 —— **两种模式都对**。
读操作同理：`const row = await db.prepare('SELECT ...').get(id);`

第三方 ZIP 一律是 `process` 档，所以这条对交付物**总是**成立。
写成不带 `await` 的模板原样，在本地 inline 开发时看不出问题，
打成 ZIP 就开始丢写入。
````

```{warning}
`migrate(targetVersion, upgradeFn)` 里的 `db` 参数**已经是同步外观**：
worker 垫片的 `dbWrapper.prepare().run()` 会把 Promise 收进 `pendingPromises`，
`upgradeFn` 返回后统一 `await Promise.all(...)`。
所以 migration 回调里不 `await` 是安全的，业务代码里不 `await` 不安全 —— 两者别混。
```

---

## 6. 两对 action + handler

模板注册两个工具，注意**能力分级**：

| action id                 | commandType                       | capabilityRequired | inputSchema 必填 |
| :------------------------ | :-------------------------------- | :----------------- | :--------------- |
| `record-helper-process`   | `@myteam/record-helper.process`   | `lesson:write`     | `input`          |
| `record-helper-open-tool` | `@myteam/record-helper.open_tool` | `lesson:read`      | `lessonId`       |

`open_tool` 的 handler 只做一件事 —— 把课堂上下文回显：

```typescript
await commandBus.registerHandler('@myteam/record-helper.open_tool', {
  async execute(command) {
    const payload = command.payload as { lessonId?: string; classId?: string };
    return {
      opened: true,
      pluginId: '@myteam/record-helper',
      lessonId: payload?.lessonId ?? null,
      classId: payload?.classId ?? null,
    };
  },
});
```

模板注释说明了为什么是回显而不是开面板：

> 第三方插件的前端跑在隐藏 iframe 里，无法渲染面板 —— 课堂工具只能
> 在后端做事（写库、发事件、回一条结果给事件流）。这里把上下文回显，
> 便于在「课堂事件流」里确认占位符替换成功。

想让课堂工具真的打开界面 → 把 `view` 挂到 `student.lesson.tool` 这类
**支持 `view` 字段的槽位**，见 {doc}`sandbox-view` §2。

---

## 7. 前端：`frontend.tsx` 逐段

### 7.1 桥接上下文的**确切**成员

模板自己声明的最小接口就是全清单（SDK 未导出这个类型）：

```typescript
interface SandboxFrontendContext {
  pluginId: string;
  services: {
    frontendApi: {
      get<T>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
      post<T>(path: string, body?: unknown): Promise<{ success: boolean; result?: T; error?: string }>;
      del<T>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
    };
    storageService: {
      get(key: string): Promise<string | null>;
      set(key: string, value: unknown): Promise<boolean>;
      delete(key: string): Promise<boolean>;
    };
  };
  ui: {
    registerExtensionPoint(slot: string, config: Record<string, unknown>): Promise<boolean>;
    showToast(message: string): Promise<boolean>;
  };
  invokeCommand<T>(type: string, payload?: unknown): Promise<T>;
  context: { get(): Promise<{ lessonId: string | null; classId: string | null }> };
}
```

```{danger}
这里**没有** `React`、没有 `socketService`、没有 `uiService.showModal`、
没有 `navigation`、没有 `dispatcher`、没有 `i18n`、没有 `window.HostSharedDeps`。
想订阅事件只能轮询（帧通道没有推送），想做界面只能走 `view`。
op 全表与轮询语义见 {doc}`../reference/frontend-sandbox` §3、§4。
```

### 7.2 数据型扩展点：命令面板条目

```typescript
await hostCtx.ui.registerExtensionPoint('command_palette.item', {
  id: 'record-helper-create',
  label: 'record-helper：新建记录',
  icon: 'Puzzle',
  slotProps: {
    title: 'record-helper：新建记录',
    description: '写入一条记录到 record-helper 的插件表',
    category: 'Plugin',
    commandType: '@myteam/record-helper.process',
    payload: { input: 'created from command palette' },
  },
});
```

三条约束：

1. **配置必须可 `structuredClone`** —— CI 直接对每个注册对象跑
   `expect(() => structuredClone(config)).not.toThrow()`。
   写 `component: MyComp` 或 `render: () => ...` 会得到 `DataCloneError`。
2. `commandType` 写**全限定名**，模板注释原话：
   「运行期注册不经过 manifest 命名空间前缀化」。
3. `payload` 会原样进命令，因此必须满足对应 action 的 `inputSchema`
   （这里是 `{ input: STRING }`，且 `type` 是大写）。

### 7.3 存储与 toast

```typescript
const activations = Number((await hostCtx.services.storageService.get('activations')) ?? 0) + 1;
await hostCtx.services.storageService.set('activations', String(activations));
await ctx?.ui.showToast('提示文案');
```

```{warning}
### 三个存储互不相通

| 写入方 | 最终 key | 位置 |
| :--- | :--- | :--- |
| 前端帧通道 `storageService.set('k', v)` | `edu_os_plugin:__app__:<manifest.id>:k` | 父页面 localStorage |
| `view` HTML 的 `OpenLearnPluginBridge.storage.set` | `ol_pv_<pluginId>_k` | 父页面 localStorage（不同前缀） |
| 服务端 `ctx.services.storage.set('k', v)` | `plugin_storage` 表的行 | 数据库，key 用 **`manifest.id`** |

从 `frontend.tsx` 写的值，`view` 页面读不到，服务端也读不到，且不报错。
跨端传数据只能走 `invokeCommand` / HTTP。
```

`deactivate()` 里什么都不用做：宿主停用时会摘掉本插件运行期注册的扩展点并销毁 iframe。

---

## 8. `contracts/index.ts`：想被别的插件消费才需要

模板样例：

```typescript
export interface IMyPluginService {
  doSomething(input: string): Promise<string>;
}

export const MyPluginServiceToken = new Token<IMyPluginService>(
  'REPLACE_WITH_YOUR_PLUGIN_ID:IMyPluginService',
  '1.0.0',
);
```

```{danger}
把 `REPLACE_WITH_YOUR_PLUGIN_ID` 换成**你自己的 manifest.id**，
并在 manifest 里加 `provides: ['@myteam/record-helper:IMyPluginService']`。
`ctx.provide(token, instance)` 会校验 `token.name` 完整出现在 `manifest.provides`，
缺失时宿主抛错 —— **而 Mock 不校验这条**，
于是出现最典型的「测试全绿、装不上」。
另外 `provide` 的实例必须是**纯数据或可结构化克隆**的：
函数穿不过 worker RPC，会 `could not be cloned`。
见 {doc}`../playbook/pitfalls` P-16 与 {doc}`../reference/testing` §3。
```

不需要对外提供服务就删掉这个文件，`server-only` 档也没有它。

---

## 9. 构建、安装、验证

```bash
npm run build       # dist/index.js + dist/frontend.js + dist/manifest.json + record-helper.zip
```

验证顺序（在 {doc}`server-only` §6 的基础上加三条）：

| #   | 动作                                                          | 期望                                                                  |
| :-- | :------------------------------------------------------------ | :-------------------------------------------------------------------- |
| 7   | 进入课堂，工具条出现 `record-helper` 按钮                     | `classroomTools` 声明被识别                                           |
| 8   | 点一次，课堂事件流出现回显的 `lessonId` / `classId`           | `$lessonId` 占位符替换成功；若两个都是 `null`，说明当前不在课堂上下文 |
| 9   | Ctrl+K 出现命令面板条目，执行后**刷新页面再查库**确认写入落库 | 前端注册 + 命令 + `await` 后的写入三者都通                            |

第 9 步是这条教程的关键回归点：**不 `await` 的写入在事件流里看起来是成功的**，
只有回查数据库才发现没落库。

排查入口：`node scripts/plugin-command-audit.mjs`、
{doc}`../reference/testing` §7 症状表、{doc}`../playbook/pitfalls` 组 B / E。

---

## 10. 提交前自检（只列 full-stack 增量）

- [ ] `frontend.tsx` 的 `default` 带 `activate` 函数
- [ ] 所有 `registerExtensionPoint` 的配置里没有函数
- [ ] 运行期注册的 `commandType` 是全限定名
- [ ] `classroomTools[].payload` 用 `$lessonId` / `$classId` 取上下文
- [ ] `ensureTable` 的 schema 片段无分号、无 `CREATE TABLE`、≤ 4000 字符
- [ ] 表名一律经 `ctx.db.table()`，SQL 里没有硬编码前缀
- [ ] **每一处** `db.prepare(...).run/get/all` 前面都有 `await`
- [ ] `ctx.resolve(...)` 只用于 `PLUGIN_RESOLVABLE_TOKENS` 白名单内的 Token
- [ ] `contracts` 里的 Token name 与 `manifest.provides` 完全一致
- [ ] 没有跨端共享 localStorage 的假设
- [ ] 需要可见界面时改走 `view`，而不是在 `frontend.tsx` 里画 DOM

## 取证

| 结论                                                         | 位置                                                                                                         |
| :----------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| 服务端模板全文                                               | `packages/plugin-sdk/scaffold/templates/full-stack/src/index.ts`，repomix L134165–L134297                    |
| 前端模板全文与「唯一硬契约」注释                             | 同目录 `src/frontend.tsx`，repomix L134073–L134164                                                           |
| `contracts/index.ts` 样例                                    | 同目录 `src/contracts/index.ts`，repomix L134044–L134072                                                     |
| `PluginDatabaseAPI` 四个方法                                 | ``packages/core/plugin-host/types.ts`→`PluginDatabaseAPI`（L99–L109）                                        |
| `ensureTable` 标识符与分号 SEC 校验                          | ``packages/core/worker-runtime/bootstrap/sections/message-handler.ts`→`MESSAGE_HANDLER_SECTION`（L352–L365） |
| worker `prepare` 垫片返回 Promise                            | 同上，repomix L125992–L126020                                                                                |
| `migrate` 的 `dbWrapper` 与 `pendingPromises`                | 同上，repomix L125934–L125962                                                                                |
| `IDatabase` RPC 仅 4 个方法 + `assertDatabaseAccessAllowed`  | ``packages/core/worker-runtime/service-host.ts`→`valueStr`（L867–L903）                                      |
| 表前缀取安装主键 `plugins.id`，`manifestId` 仅为历史兼容参数 | `packages/core/plugin-host/plugin-tables.ts`，repomix L112234–L112247                                        |
| 帧通道 ctx 成员与 10 个 op                                   | `server/utils/plugin-sandbox-frame.ts`，见 {doc}`../reference/frontend-sandbox` §3                           |
| 三个存储的 key 形态                                          | `reference/frontend-sandbox.md` §6，测试钉住 `ol_pv_<pluginId>_<key>`                                        |
| `structuredClone` 与 `activate` 判据由 CI 保证               | `packages/plugin-sdk/__tests__/scaffold-frontend-contract.test.ts`，repomix L133323–L133450                  |
| `view` 只在 6 个槽位有效、其它被 strip                       | `packages/core/esm-loader/manifest-schema.ts` v0.7.6 注释，见 {doc}`../reference/frontend-sandbox` §8        |
