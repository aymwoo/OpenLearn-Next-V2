# 陷阱与反例

本页是**改写用的**：每条给出 ❌ 常见写法、✅ 平台真正接受的写法、以及为什么。
编号 `P-xx` 可被其它页面引用。概念解释在各自的参考页，这里不重复。

排序依据：**Agent 生成代码时踩中的概率**（按 LLM 语料里 React/Express/NestJS/JSON-Schema
的通识与本平台的实际契约冲突程度估算），不是按严重程度。

---

## A. manifest 声明层

### P-01 把 `@openlearn/` 前缀当信任凭据

❌

```json
{ "id": "@openlearn/my-community-plugin", "executionMode": "inline" }
```

✅ 第三方插件请用自己的 scope，并接受实际档位是 `process`：

```json
{ "id": "@acme/poll", "executionMode": "process" }
```

`@openlearn/` **不是**信任依据。进程内执行只来自三处：内核预加载的内置代码、
`OPENLEARN_TRUSTED_INLINE_PLUGINS` 里的精确 id、入口文件真实位于 `packages/plugins`。
其余请求 `inline`/`worker` 一律被 `resolvePluginExecutionMode()` 改写为 `process`，
响应带 `executionModeCoerced: true`。详见 [隔离与安全](../reference/isolation-and-security.md) §0。

### P-02 `executionMode` 字段被静默改写，却按 inline 写代码

❌ 假设 `ctx` 上能拿到任何服务、`Function` 能跨边界传递。
✅ 按 `process` 写：不跨边界传函数、`IDatabaseToken` 全部 `await`、不用 `db.transaction(fn)`。

改写的**唯一可见信号是接口返回的 `executionModeCoerced`**；manifest 本身不会报错。

### P-03 `requires` 少写 scope，或版本号用错分隔

❌

```json
{ "requires": ["core:ICommandBusService", "@openlearn/core:IEventBusService:1.0.0"] }
```

✅

```json
{ "requires": ["@openlearn/core:ICommandBusService", "@openlearn/core:IAuthSessionBridge@1.0.0"] }
```

校验正则（当前生效的 Phase 6+ `manifestSchema`，逐字）：

```text
/^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$/
```

失败消息（逐字）：
`requires/optional 条目格式无效。需要 @scope/domain:IServiceName 或 @scope/domain:IServiceName@^x.y.z`

版本号用**第二个 `@`** 引出，不是 `:`（`:1.0.0` 会被当成 Token 名的一部分从而不匹配）；
支持 `^x.y.z` / `~x.y.z` / `x.y.z` / `x.y.z-pre`。
仓库里还留着 Phase 3-5 的 `manifestSchemaV3`，它的正则更严（`/^@[\w-]+\/[\w-]+:I\w+$/`，
**完全不允许版本段**）—— 装不上时先确认你被打到的是哪个 schema。
详见 [Token 总表](../reference/token-reference.md) §1 与 [manifest 规范](../reference/manifest.md)。

### P-04 `capabilitiesProposed` 写杜撰的能力名或 `*`

❌ `["*"]`、`["admin:write"]`、`["database:read"]`、`["network"]`
✅ 从 19 个内置值里选（`quiz:read` / `quiz:write` / `lesson:read` / `vfs:read` / …）

杜撰的能力不会让安装失败，但会在运行时永远拿不到授权；`*` 在
`plugin_capability_grants` 的通配匹配里是**前缀**语义（`quiz:*` 匹配 `quiz.read`），
不是「超能力」，而且 `hasCapability` **不把 `*` 当超级值**。
完整取值集见 [Token 总表](../reference/token-reference.md) §5，判定链见 [能力与授权](../reference/capabilities.md)。

### P-05 把 `api.baseRoute` 当路由前缀

❌ `api: { baseRoute: "/api/v1/poll", routes: [...] }` 然后请求 `/api/v1/poll/list`
✅ 真实路径固定为 `/api/plugins/{manifest.id}/<route>`，`baseRoute` **无任何路由作用**

`routes[].method` 也不支持 `"ALL"`（zod 拒绝）。
`baseRoute` 声明时**安装会输出一次告警**（不是完全静默），但字段本身仍被保留 ——
源码注释写明「将来若实现按 baseRoute 挂载，告警与注释同步移除」。
见 [HTTP API](../reference/http-api.md) 与 [manifest 规范](../reference/manifest.md)。

### P-06 `contributes.slots[].component` 写函数或组件

❌

```json
{ "contributes": { "slots": [{ "slot": "teacher_dashboard.plugins", "component": "MyPanel" }] } }
```

✅

```json
{ "contributes": { "slots": [{ "slot": "teacher_dashboard.plugins", "view": "panel" }] } }
```

manifest 是 JSON，装不下函数；`component` 字段会被 **zod 静默 strip**（不报错、不保留）。
可见 UI 只有一条路：声明 `view`，实现落到 `view` 沙箱页。
见 [前端沙箱](../reference/frontend-sandbox.md) §8 与 [槽位与贡献](../reference/contributes-slots.md)。

### P-07 杜撰槽位名

❌ `"slot": "classroom_plugin_toolbar"`（看起来很像，但不在集合里）
✅ 从 `ExtensionSlot` 的 120 个字面量 + `anchor:*` 里选

**未知槽位不会报错**：渲染器对匹配不到的 slot 直接返回 `null`，
插件状态仍是 `active`，界面只是不出现。全集见 [槽位与贡献](../reference/contributes-slots.md)。

### P-08 依赖 `rolesAllowed` / `group` / `badge` 控制显示

❌ 写了 `rolesAllowed: ["teacher"]` 就以为学生看不到
✅ 服务端自己判角色

这三个字段**没有任何消费者**（前端渲染层不读它们）。它们是纯装饰字段。
见 [前端沙箱](../reference/frontend-sandbox.md) §9。

---

## B. 服务端运行时

### P-09 `ctx.logger` / `ctx.commandBus` / `ctx.events`

❌

```typescript
ctx.logger.info('hi');
await ctx.commandBus.execute(cmd);
ctx.events.on('lesson.started', h);
```

✅

```typescript
ctx.log.info('hi');
await ctx.services.commandBus.execute(cmd);
await ctx.services.eventBus.subscribe('lesson.started', h);
```

`PluginContext` 的成员是封闭的 **12 个**：`services` `pluginId` `manifest` `resolve`
`provide` `db` `log` `config` `contributions` `http` `i18n` `require`。
`services` 下 9 个键：`commandBus` `eventBus` `actionRegistry` `capability`
`processManager` `storage` `ai` `pointsDimension` `pointsLedger`。
`ctx.services` 被 `Object.freeze()`，写新键会静默失败。见 [PluginContext 契约](../reference/plugin-context.md)。

```{danger}
**没有 `ctx.reportProgress`**。`reportProgress?(stage?, message?)` 不在任何
`PluginContext` 类型定义里，只由 `worker-runtime/bootstrap/sections/message-handler.ts`
在组装 worker / 子进程侧 `ctx` 时**动态注入**（向父进程发 `activate-progress`）。
后果：`activate(ctx)` 里直接写 `ctx.reportProgress(...)` **会类型报错**；
即使加 `as any` 绕过，**inline 模式下该字段是 `undefined`，调用即抛 `TypeError`**。
正确写法是先判空：`(ctx as any).reportProgress?.('init', 'loading…')`。
```

```{danger}
**`ctx.pluginId !== manifest.id`**。前者是 `plugins` 表的行 UUID（v7），
后者是作者选的标识。命令前缀、存储 key、表前缀用的**都是 `manifest.id`**。
拿 `ctx.pluginId` 去拼命令名会得到 `019f6029-….poll.create`，前端永远调不到。
```

### P-10 命令 handler 传裸函数

❌ `registerHandler('poll.create', async (cmd) => ({ ... }))`
✅

```typescript
await ctx.services.commandBus.registerHandler('poll.create', {
  async execute(command) {
    return { pollId: 'poll-101' };
  },
});
```

inline 宿主兼容裸函数，但 **worker / process 与 Mock 都只读 `.execute`**，
第三方插件默认落在 `process` → 运行期 `handler.execute is not a function`。
见 [测试与自检](../reference/testing.md) §2.4。

### P-11 忘了命令前缀

❌ 前端调 `execute('poll.create')` 并期望命中插件注册的 handler
✅ 让两端都走 `resolvePluginCommandType(type, manifest.id)`（宿主已统一），
自己显式拼时用全名 `@acme/poll.poll.create`

规则：已以 `${pluginId}.` 开头 → 原样；匹配 UUID v7 前缀 → 原样；否则前置。
**参数必须是 `manifest.id`**。见 [命令与事件](../reference/command-and-event.md) §2.1。

### P-12 硬编码表名 / 跨插件表

❌

```typescript
db.exec('SELECT * FROM configs');
db.exec('SELECT * FROM plugin_其他插件_orders');
```

✅

```typescript
const t = ctx.db.table('configs'); // → plugin_<manifest_id>_configs
const rows = ctx.db.prepare(`SELECT * FROM ${t}`).all();
```

`sql-guard` 会拒：40 张核心表硬禁、`plugin_*` 表仅限本插件命名空间、
跨库指令硬禁；**解析不出表名的语句也拒**（fail-closed）。
另外标识符必须匹配 `SQL_IDENTIFIER_PATTERN`，schema ≤ 4000 字符且不含 `;`。
见 [数据库](../reference/database.md) 与 [隔离与安全](../reference/isolation-and-security.md) §6–§7。

### P-13 在 worker/process 里用同步 `db.transaction(fn)`

❌

```typescript
const raw = await ctx.resolve(IDatabaseToken);
raw.transaction(() => {
  raw.prepare('...').run();
})(); // 同步回调
```

✅ 逐条 `await raw.prepare(...).run(...)`，或改用 `ctx.db.migrate(v, fn)`

worker 模式下 `IDatabaseToken` 解析出的是**异步代理**，`exec()` 等需 `await`，
同步事务回调不可用。见 [平台服务](../reference/platform-services.md)。

````{danger}
### 脚手架模板里就有一处不带 `await`

`full-stack` 模板的 handler 写的是：

```typescript
db.prepare(`INSERT INTO ${tableName} (id, content, created_at) VALUES (?, ?, ?)`)
  .run(id, input, Date.now());      // 没有 await
```

inline 档同步落库、看不出问题；`process` 档（第三方 ZIP 一律如此）这一句返回的是
**Promise**，不 `await` 就是 fire-and-forget：命令已返回成功、数据可能没落库、
失败变成 unhandled rejection。

顺带一条限制：worker 侧的 `prepare` 是宿主**手工搭的垫片**，
`IDatabase` RPC 白名单只有 `exec` / `prepareAndRun` / `prepareAndGet` / `prepareAndAll`
四个方法，其余一律 `Method "<m>" not supported on IDatabase RPC`
（`db.function`、`db.backup`、`stmt.iterate` 等在沙箱里都不存在）。

正确写法：`await db.prepare(...).run(...)` —— inline 档 `await` 一个非 Promise 值语义不变，
两种模式都安全。完整推导见 {doc}`../tutorial/full-stack` §5。
````

### P-14 `ctx.resolve` 传字符串

❌ `await ctx.resolve('@openlearn/core:ICommandBusService')`
✅ `await ctx.resolve(ICommandBusServiceToken)`

只接受 `Token<T>` 实例。字符串 resolve 受 `PLUGIN_RESOLVABLE_TOKEN_NAMES`（31 项）门控，
越界**静默返回 `undefined`**（不是抛错），随后在解引用处炸出一条无关的
`Cannot read properties of undefined`。见 [Token 总表](../reference/token-reference.md) §2–§3。

### P-15 `services` 的 9 个键都可能为 `null`，只有 2 个在类型里写了 `| null`

❌ `ctx.services.pointsLedger.addPoints(...)`、`ctx.services.ai.generateText(...)`
✅

```typescript
if (!ctx.services.pointsLedger) {
  ctx.log.warn('积分服务在当前隔离档位不可用');
  return;
}
```

权威定义 ``packages/core/plugin-host/types.ts`→`PluginContext`（L227））里 **9 个键全是 `T | null`**
（审计 E-4）：`buildContext`的 D-12 降级机制会在`manifest.optional`声明的 Token
版本不兼容时把对应键置`null`，以 `ctx.services.x === null`作为「该能力不可用」的信号。
但 SDK 的`.d.ts` 快照里 7 个键被写成非空 —— **类型层在这里撒谎**。

`pointsDimension` / `pointsLedger` 更硬：worker / process 模式**恒为 `null`**
（`BASE_WORKER_SERVICE_TOKENS` 白名单不含），Mock 也恒为 `null`。

### P-16 跨线程 `provide()` 函数 / 类实例

❌ `await ctx.provide(IThingToken, { run: () => 1 })`
✅ 只提供纯数据，或把能力包成命令经 `commandBus` 调用

报错形态是 `could not be cloned`（结构化克隆）。且 `provide` 的 token.name
必须完整出现在 `manifest.provides`，否则宿主抛错 —— **Mock 不校验这条**，
是最典型的「测试过、装不上」。见 [测试与自检](../reference/testing.md) §3。

### P-17 `ctx.require` 用非白名单模块

❌ `const _ = ctx.require('lodash')`
✅ 只用 7 个：`recharts` `react-markdown` `jspdf` `jspdf-autotable` `exceljs` `lucide-react` `uuid`

`manifest` 顶层 schema 是 `.passthrough()`，但**没有 `sharedModules` 这个字段**：
写进去不报错也不生效，只是原样留在 `ctx.manifest` 里
（对比：嵌套对象如 `network` 是 zod 默认 strip）。
白名单完全由宿主的 `PLUGIN_SHARED_MODULES` 决定，声明不改变结果。
`ctx.require` 读的是宿主内存里的 `sharedModules` 映射，由 `bootstrapSharedModules()`
从**仓库自身**的 `node_modules` 解析 —— 不碰 `plugins/node_modules`，
所以「在插件目录 `npm install` 一个包再 require」是拿不到的。
`ctx.require` 读的是宿主内存里的 `sharedModules` 映射，由 `bootstrapSharedModules()`
从**仓库自身**的 `node_modules` 解析 —— 不碰 `plugins/node_modules`，
所以「在插件目录 `npm install` 一个包再 require」是拿不到的。
注意后端 `PLUGIN_SHARED_MODULES` 是 7 项、前端 `SHARED_MODULE_MAP` 只有 6 项
（审计 E-3），**别在前端 `require('exceljs')`**。见 [前端沙箱](../reference/frontend-sandbox.md) §13。

### P-18 用裸 `setInterval` 做后台任务

❌ `setInterval(() => tick(), 5000)`
✅ `await ctx.services.processManager.registerInterval(name, 5000, (log) => tick(log))`

裸定时器不受 `ResourceTracker` 清理，插件停用后继续跑；
在 `process` 档还会占用 CPU 配额（默认 8000ms / 10000ms 窗口，超限 **SIGKILL** 而不是挂起）。
`spawn(taskType, payload)` 同理，且归属需要 `ownerHint`（`setPluginOwner` 是全局单值）。
见 [隔离与安全](../reference/isolation-and-security.md) §4。

### P-19 服务端直接 `fetch` 外部 API

❌ `await fetch('https://api.example.com/x')`
✅

```json
{ "network": { "outbound": ["api.example.com"] } }
```

```typescript
const r = await fetch('https://api.example.com/x'); // 由宿主代理转发
```

出站不是 `capabilityRequired` 字符串机制的一部分：**`network:*` / `net:*` 这类能力串不存在**
（写进 `capabilitiesProposed` 不会报错，但永远不会命中任何东西）。
真正的通道是 manifest `network.outbound` + 独立的 `plugin_network_grants` 域名白名单，
由宿主代发执行。

````{important}
**写法对，仍可能失败**：预载层从 `OPENLEARN_PLUGIN_NET_ALLOW` 拍允许名单，
随后 `delete process.env[ALLOW_ENV]`（插件改环境变量不能把自己加进名单）。
不在名单里的主机得到的是 `Error` 且 `error.code = 'ERR_ACCESS_DENIED'`；
未获批准时代理回 `network proxy denied`。
`OPENLEARN_PLUGIN_NET_ALLOW` 是**平台内部传递键**（宿主在拉起子进程时写入
`approvedNetHosts`，preload 读完即删），**不是给用户配的配置项**，
`.env` 里设它不会让插件多出权限。

`process` 档下 `plugin-net-preload.cjs` 封锁原始网络；未获批准的域名会被拒。
SSRF 目标（内网、`169.254.169.254`、云元数据等）在 `classifyNetHostProposals` 里硬拒。
`worker`/`inline` 与宿主共享网络栈，**拦不住** —— 这也是第三方被强制 `process` 的原因之一。
见 [隔离与安全](../reference/isolation-and-security.md) §5。

### P-20 `eval` / `new Function` / 动态代码生成

✅ 不存在可行写法。`process` 档带 `--disallow-code-generation-from-strings`，
得到 `EvalError`，且该旗标**独立于** `--permission`，关文件权限也不会放开它。
模板字符串拼 SQL 属于另一类风险，见 P-12。

## C. AI Action 与能力

### P-21 `inputSchema` 用标准 JSON-Schema 的小写 `type`

❌
```typescript
inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
```
✅
```typescript
inputSchema: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] }
```

内核的 `validateJsonSchema` **逐字比较大写名**：
`OBJECT` / `ARRAY` / `STRING` / `NUMBER` / `BOOLEAN` 五种；
其它任何值（`'object'`、`'integer'`、`'GENERIC'`、缺省）走不进任何分支，
`return errors` 返回**空数组 = 全部放行**。
所以小写写法不报错、不校验，脏 payload 会一路打到你的 handler。

```{danger}
这条是**静默失效**的典型：拦截器在权限检查之前先跑 schema 校验，
你以为有校验，其实没有。校验失败时抛的是
`[PayloadValidationError] Invalid command payload for <type>: <errors>`（HTTP 500 而非 403）。
见 [能力与授权](../reference/capabilities.md) §1。
````

### P-22 同一 `commandType` 注册两个 action

❌ 两个 `ActionDescriptor` 的 `commandType` 相同（或 `a.b` 与 `a_b` 撞 `SafeName`）
✅ 一个 commandType 只挂一个 action

后者会**静默遮蔽**前者（`Map.set` 覆盖），Agent 侧只看到其中一个工具。
`SafeName` 净化规则是 `replace(/[^a-zA-Z0-9_-]/g, '_')`，
所以 `create.item` 和 `create_item` 在工具名层面是同一个。见 [AI Actions](../reference/ai-actions.md) §3。

### P-23 指望 `exposeToAgent` 之外的路径

`exposeToAgent: false` 是**静默降级**（action 仍可被内部调用，只是不进工具清单），
不是禁用。而 Barrier 3 的方法级能力（8 个）与 `capabilityRequired`（19 个）
是**两套正交字符串**，把前者的值写进后者不会报错、只会永不命中。
见 [Token 总表](../reference/token-reference.md) §0、§6。

### P-24 `isHighRisk: false` 绕审批

❌ 用 `isHighRisk: false` 逃避人工审批
✅ 高危判定另有内核级拦截，descriptor 字段不是唯一开关

且要注意：`pending_commands` 审批通过后**以审批者身份重放**，
因此 capability 检查会被跳过 —— 审批人权限比插件大时，这是提权路径。
见 [能力与授权](../reference/capabilities.md) §2。

---

## D. HTTP 路由

### P-25 路由 handler 用 Express 风格

❌ `(req, res) => res.json({ ok: true })`
✅ `(req) => ({ status: 200, body: { ok: true } })` 或直接返回对象（默认 200）

`PluginHttpRouter` 不是 Express。`req` 提供 `params` / `query` / `body` / `headers` / `actor` / `ip`。
见 [HTTP API](../reference/http-api.md) 与 [测试与自检](../reference/testing.md) §4.3。

### P-26 以为 `auth: false` 就公开

`auth: false` 的路由**默认不公开**；只有安装时传 `approvePublicRoutes: true`
才会写进 `plugin_public_routes`。同理 `capabilitiesProposed` 需要 `approveCapabilities: true`
才落入批准表 —— **「已声明」≠「已授权」**。见 [能力与授权](../reference/capabilities.md) §4。

---

## E. 前端沙箱

### P-27 前端入口导出组件

❌

```tsx
export default function MyPanel() {
  return <div />;
}
```

✅

```ts
export default { activate, deactivate };
```

沙箱加载器要求 `plugin.activate` 是函数，否则 `missing activate function`，
插件进 `ERROR`。`Activation timeout (5000ms)` 是另一条固定文案。
脚手架 3.7.0 生成的是旧形状；**3.7.4 起才正确**，3.7.1 已 npm 弃用
（残留 `node:` 静态导入）。见 [测试与自检](../reference/testing.md) §6.1。

### P-28 在 `frontend.js` 里 import React / 用裸说明符

❌ `import React from 'react'`、把 react 配成 external 指望宿主注入
✅ 入口只做桥接；对 SDK 只 `import type`；可见 UI 用声明式 `view` 贡献

远程插件前端跑在**不透明源** iframe（`/plugin-sandbox/frame`，`sandbox="allow-scripts"`，
CSP `connect-src 'none'`），没有 React、没有 `window.HostSharedDeps`、没有 importmap，
加载方式是 `Blob` + 动态 `import()`。`build` 会扫裸说明符并 `exit 1`，
但**如果绕过 CLI 自己打包，则构建能过、装上正常、一激活就崩**。

### P-29 在隐藏帧里画界面

❌ 在 frame 里 `document.createElement` 拼 DOM、期待用户看到
✅ 可见 UI 走 `view` 沙箱页（`/plugins/<id>/<view>`）

隐藏帧**有自己完整的 `document`**（不是「没有 document」），但它 `display:none`、
宿主 DOM 不可达、CSP 也拦样式与图片资源。结果是**界面空白但插件状态 `active`**。
两轨的能力差异（10 ops vs 8 ops、轮询 vs 无 push、view 通道**没有 Barrier 3**）
见 [前端沙箱](../reference/frontend-sandbox.md) §0、§3、§5。

### P-30 在沙箱里 `fetch` / `WebSocket` / 指望推送事件

❌ `await fetch('/api/...')`、`new WebSocket(...)`、指望宿主主动 push
✅ 用桥接 op 经宿主代发；状态变化靠**轮询**获取

frame 的 CSP 是 `connect-src 'none'`；桥只有 10 个 op，未登记的方法报
`Unsupported sandbox bridge op "xxx"`。协议用 `targetOrigin: '*'` 但校验 `event.source`。
详见 [前端沙箱](../reference/frontend-sandbox.md) §3–§4。

### P-31 指望三个存储是同一个

三个互不相通的存储：

| 通道           | key 形态                                    | 位置    |
| :------------- | :------------------------------------------ | :------ |
| frame 桥接存储 | `edu_os_plugin:__app__:<manifest.id>:<key>` | 宿主侧  |
| view 沙箱存储  | `ol_pv_<pluginId>_<key>`                    | view 侧 |
| 服务端         | `plugin_storage` 表                         | SQLite  |

在 view 里写的值，frame 或服务端读不到。见 [前端沙箱](../reference/frontend-sandbox.md) §6。

### P-32 注册宿主动作 handler 不管注销

`hostActionDispatcher` 是模块级单例，**handler 不会随插件停用自动清理**；
同一 type 重复注册是**后者覆盖前者**，且没有默认超时 —— 你的 handler 悬挂会一直挂着。
见 [前端沙箱](../reference/frontend-sandbox.md) §11。

---

## F. 测试与交付

### P-33 把 Mock 行为当宿主契约

见 [测试与自检](../reference/testing.md) §3 整表。一句话：Mock **故意**不校验
表名规则、schema 长度与分号、`provides` 声明、`require` 白名单、capability、默认拒绝。

### P-34 `createMockContext({ manifest })` 指望完整 manifest

✅ Mock 只采纳 `name` / `version` / `main`；`contributes` / `provides` / `requires` /
`executionMode` 全部丢弃。要验 manifest，直接对 JSON 跑 `manifest-schema.ts` 的 zod。

### P-35 依赖 `ctx.config.get()` 做分支断言

✅ Mock 的 `config` 是空壳（`get` → `undefined`、`getAll` → `{}`、`set` → no-op、
`onChange` → 空注销）。断言配置分支要手动替换 `ctx.config`。

### P-36 指望声明式 `migrations/*.sql` 进 ZIP

ZIP 只有 `index.js` + `manifest.json` +（可选）`frontend.js`。
`migrations/` **不进包**，声明式迁移只对内置插件 / 源码目录直装生效。
ZIP 插件建表只能用 `ctx.db.ensureTable()` + `ctx.db.migrate(version, fn)`。
见 [测试与自检](../reference/testing.md) §6.1。

---

## G. 一页速查：静默失效清单

以下情况**全部不报错**，是最难排查的一类：

| 你写了                                 | 平台做了                                                    | 唯一可见信号                                 |
| :------------------------------------- | :---------------------------------------------------------- | :------------------------------------------- |
| `manifest.executionMode: "inline"`     | 改写为 `process`                                            | 接口返回 `executionModeCoerced: true`        |
| `contributes.slots[].component`        | zod strip 掉                                                | 无                                           |
| 未知槽位名                             | 渲染 `null`                                                 | 无（状态仍 `active`）                        |
| `rolesAllowed` / `group` / `badge`     | 无人读取                                                    | 无                                           |
| `api.baseRoute`                        | 无路由作用                                                  | 安装时**一次**告警（之后无信号）             |
| `inputSchema` 小写 `type`              | 不校验、放行                                                | 无（脏数据进 handler）                       |
| 重复 `commandType`                     | 后者遮蔽前者                                                | 工具清单少一个                               |
| `resolve('字符串')` 越界               | 返回 `undefined`                                            | 下一条 `Cannot read properties of undefined` |
| 未声明的 `ctx.provide`                 | Mock 容忍 / 宿主抛错                                        | 只在真机出现                                 |
| `exposeToAgent: false`                 | 静默降级                                                    | 无                                           |
| `capabilitiesProposed` 已写            | 未 `approveCapabilities` 即无效                             | 首次调用才 `COMMAND_CAPABILITY_DENIED`       |
| 裸 `setInterval`                       | 停用后继续跑                                                | CPU 配额打满才 SIGKILL                       |
| `db.prepare(...).run(...)` 不 `await`  | inline 同步、`process` 档返回 Promise                       | 无（命令返回成功，库里没数据）               |
| ZIP 里 `storage/` 之外的自定义资源文件 | 只写 `index.js`/`manifest.json`/`package.zip`/`frontend.js` | view 面板 404 且无报错                       |
| 装完 ZIP 后删掉插件目录里的 `storage/` | 重启只补 `frontend.js`                                      | 永久 404，直到重装                           |

---

## H. 取证

| 结论                                                          | 位置                                                                                    | repomix 行                       |
| :------------------------------------------------------------ | :-------------------------------------------------------------------------------------- | :------------------------------- |
| `resolvePluginExecutionMode` 强制改写与三处信任来源           | `packages/core/plugin-host/execution-policy.ts`                                         | L107295–L107434                  |
| `:37` 的 `VITEST` 夹具分支                                    | 同上 + tracker                                                                          | L107350、L14902                  |
| `requires` 校验正则                                           | `packages/core/esm-loader/manifest-schema.ts`                                           | L81517 起                        |
| `PLUGIN_RESOLVABLE_TOKENS` / `_NAMES`（E-2）                  | `packages/core/di/interfaces.ts`                                                        | L77900–L77995                    |
| `PLUGIN_SHARED_MODULES` 7 项                                  | `packages/core/plugin-host/types.ts`                                                    | L113731                          |
| bootstrap 内联副本同为 7 项                                   | `packages/core/worker-runtime/bootstrap/*`                                              | L125968                          |
| `resolvePluginCommandType` 与 UUID v7 短路                    | `packages/core/plugin-host/plugin-namespace.ts`                                         | L112003–L112019                  |
| 三处规则漂移的历史 bug                                        | 同上（模块头注释）                                                                      | L111941–L111990                  |
| 沙箱侧拷贝曾漂移（namespace-parity 测试）                     | `packages/core/worker-runtime/__tests__/namespace-parity.test.ts`                       | L121053 起                       |
| `validateJsonSchema` 只认 5 个大写类型                        | `packages/core/kernel/index.ts`                                                         | L84613–L84675                    |
| `[PayloadValidationError]` 文案与调用点                       | 同上                                                                                    | L22690                           |
| 默认拒绝拦截器 + `pending_commands`                           | 同上                                                                                    | L84200–L84340                    |
| `PluginContext` 的 12 个成员（内核权威定义）                  | `packages/core/plugin-host/types.ts`                                                    | L113883–L113955                  |
| SDK 声明同为 12 个成员，但 `services` 只有 2 个键带 `\| null` | `packages/plugin-sdk/openlearn.d.ts`                                                    | L140107–L140132                  |
| `Object.freeze(ctx.services)`                                 | `packages/core/plugin-host/context-builder.ts` 头注释 D-06                              | L102473                          |
| `ctx.log` 而非 `ctx.logger`                                   | `docs/examples/verifiable-examples.md`                                                  | L18180                           |
| worker `could not be cloned` / `db.transaction` 不可用        | `docs/troubleshooting/troubleshooting-faq.md`                                           | L28956–L28962                    |
| `registerInterval` / `spawn` 与 ownerHint                     | `packages/core/di/interfaces.ts`（B-5）                                                 | L77900 段                        |
| CPU/RSS 配额与 SIGKILL                                        | `packages/core/plugin-limits.ts`、`resource-tracker.ts`                                 | L127896–L127990、L112940         |
| `--disallow-code-generation-from-strings`                     | `packages/core/worker-runtime/child-process-manager.ts`                                 | L126840–126960                   |
| net 三层与 `plugin_network_grants`                            | `packages/core/plugin-host/plugin-grants.ts`、`plugin-net-preload.cjs`                  | L111539–L111856、L128021         |
| `assertPluginSqlAllowed` 与 40 表黑名单                       | `packages/core/plugin-host/sql-guard.ts`                                                | L113087–L113405                  |
| 能力矩阵 19/20 计数冲突                                       | `docs/reference/plugin-capability-matrix.md`                                            | L22411–L22733                    |
| ZIP 三件套 / 裸说明符 exit 1 / 模板契约 / 3.7.1 弃用          | `docs/sdk/scaffold-cli.md`                                                              | L28824–L28923                    |
| `missing activate function`、`Activation timeout (5000ms)`    | `src/plugin-host/sandbox-frame.ts` 及宿主实现                                           | L397461–L397491                  |
| worker `prepare` 垫片返回 Promise / RPC 仅 4 方法             | `packages/core/worker-runtime/bootstrap/sections/message-handler.ts`、`service-host.ts` | L125992–L126020、L129569–L129605 |
| 模板未 `await` 的那一行                                       | `packages/plugin-sdk/scaffold/templates/full-stack/src/index.ts`                        | L134236                          |
| 安装只落盘 4 件套 + `storage/**` + `deploy.script`            | `packages/core/plugin-host/`（`installPluginFromZipExclusive`）                         | L108604–L108650                  |
| 重启仅补 `frontend.js`（不补其它资源）                        | `packages/core/plugin-host/`（restore 分支）                                            | L112466–L112484                  |
| SDK build 只写 `index.js`/`manifest.json`/`frontend.js`       | `packages/plugin-sdk/cli.mjs`                                                           | L135347–L135351                  |
| `PluginDatabaseAPI` 4 个方法与表前缀注释                      | `packages/core/plugin-host/types.ts`                                                    | L113755–L113765                  |
| 表前缀取安装主键、`manifestId` 仅历史兼容                     | `packages/core/plugin-host/plugin-tables.ts`                                            | L112234–L112247                  |
| 双 iframe 与 CSP、op 集合、三套存储、dispatcher               | `src/plugin-host/*`、`server/utils/plugin-view-bridge.ts`                               | L397413–L398853                  |
| Mock 与生产差异官方口径                                       | `docs/sdk/plugin-test-kit.md`                                                           | L28631–L28660                    |
| `ctx.commands` 仅存在于文档、源码无此成员                     | 全仓 grep `ctx\.commands`                                                               | 唯一命中 L28807                  |
