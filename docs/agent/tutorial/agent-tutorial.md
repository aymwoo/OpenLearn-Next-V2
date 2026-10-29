# 教程：三档模板怎么走完一遍

本组页面把「接到需求 → 选模板 → 写代码 → 构建 → 装上去 → 确认它真的在跑」串成一条线。
所有示例代码**逐字取证自仓库内的脚手架模板**（`packages/plugin-sdk/scaffold/templates/`），
不是手写的理想样例；模板本身有问题时，本页会明确指出「模板这么写，但你应该那么写」。

```{important}
教程与参考页的分工
- **教程**（本目录）：按顺序做，做完能跑。回答「先写哪一行」。
- **参考**（`reference/`）：按字段查。回答「这个取值合不合法」。
每一节末尾都会链到对应的参考页，遇到需要展开的规则就跳过去，不要靠猜。
```

---

## 1. 三档模板与产物差异

| 模板                  | 生成的源文件                                                 | `dist/` 产物              | ZIP 内容                                     | 适用                                    |
| :-------------------- | :----------------------------------------------------------- | :------------------------ | :------------------------------------------- | :-------------------------------------- |
| `server-only`（默认） | `src/index.ts`                                               | `index.js`                | `index.js` + `manifest.json`                 | 只需命令 / AI 工具 / 定时任务 / 数据    |
| `full-stack`          | `src/index.ts`、`src/frontend.tsx`、`src/contracts/index.ts` | `index.js`、`frontend.js` | `index.js` + `manifest.json` + `frontend.js` | 需要注册扩展点、课堂工具、命令面板条目  |
| `frontend-only`       | `src/index.ts`、`src/frontend.tsx`                           | `index.js`、`frontend.js` | 同上                                         | 只做前端逻辑（toast / 存储 / 订阅事件） |

三条被 CI 钉住的模板差异（`scaffold-frontend-contract.test.ts`、`scaffold-manifest.test.ts`）：

- `server-only` **不带** `src/frontend.tsx`：
  `expect(fs.existsSync(...'server-only/src/frontend.tsx')).toBe(false)`。
  所以它没有任何前端产物，也就没有任何可见入口。
- 三档的 `main` 必须都是 `index.js`，且四个模板 manifest 字面量要能过真实 `manifestSchema`
  （测试直接 `manifestSchema.safeParse(...)`）。
  这条测试的存在理由是历史缺陷：模板曾经**全都漏了 `main`**，插件装不上却看不出来。
- `full-stack` / `frontend-only` 的 `frontend.tsx` 必须能被求值且 `typeof default.activate === 'function'`；
  并且它注册的所有扩展点配置必须能通过 `structuredClone(config)`（不能含函数）。

---

## 2. 选哪一档

按三个问题依次判定，命中即停：

1. **要不要往界面里放东西？**（面板、标签页、命令面板条目、课堂工具按钮）
   → 不要 → `server-only`。
2. **放的是「注册项」还是「一段自定义 HTML 界面」？**
   注册项（图标 + 标题 + 点击发命令）→ `full-stack`；
   自定义界面（表单、图表、按钮布局）→ `full-stack` + `view` HTML，见 {doc}`sandbox-view`。
3. **完全没有后端，只想在页面加载时做点事、弹个提示？**
   → `frontend-only`。

```{danger}
### `frontend-only` 不能声明课堂工具和命令型贡献

模板自己的注释原文：

> 纯前端模板没有服务端命令处理器，因此它**不声明课堂工具 / 命令**——
> 声明了也没有 handler 接，点按钮只会报 "No handler registered"。

对应报错在 `server/routes/plugins.ts` 的 sandbox-command 分支：
`No handler registered for command type "<resolvedType>".`（HTTP 404）。
需要可见入口一律改用 `full-stack`。
```

---

## 3. 创建项目

```bash
npx @openlearn/plugin-sdk init \
  --name exam-helper \
  --description "随堂测验与成绩统计" \
  --author myteam \
  --template full-stack
```

脚手架当场校验的三条约束：

| 约束          | 规则                                                                     | 违反后果                            |
| :------------ | :----------------------------------------------------------------------- | :---------------------------------- |
| `--name`      | `^[a-z][a-z0-9-]*$`（小写字母开头的 kebab-case）                         | 直接报错退出                        |
| `--template`  | `server-only` / `full-stack` / `frontend-only`                           | 直接报错退出                        |
| `manifest.id` | 由脚手架拼成 `@{author}/{name}`，author 段小写化、非 `[a-z0-9]` 换成 `-` | 不可手写覆盖，改 id 要改 `--author` |

### 占位符对照

模板源码里的 `{{...}}` 由脚手架替换，Agent 读模板时容易把它当成字面量：

| 占位符                           | 取值示例              | 出现位置                                                       |
| :------------------------------- | :-------------------- | :------------------------------------------------------------- |
| `{{name}}`                       | `exam-helper`         | `package.json` 的 `name`、action 的 `id` 后缀                  |
| `{{pluginId}}`                   | `@myteam/exam-helper` | `manifest.id`、命令类型前缀、`source`                          |
| `{{pluginName}}`                 | 人类可读名            | `manifest.name`、日志与 toast 文案                             |
| `{{description}}` / `{{author}}` | 原样                  | `manifest.description` / `author`                              |
| `{{sdkVersion}}`                 | `3.7.5`               | `package.json` 的 `"@openlearn/plugin-sdk": "^{{sdkVersion}}"` |

```{warning}
### 模板里的 `{{pluginId}}-hello` 用的是 `pluginId`，`{{name}}-process` 用的是 `name`

`server-only` 的 action id 是 `'{{pluginId}}-hello'`，
`full-stack` 的两个 action id 是 `'{{name}}-process'` / `'{{name}}-open-tool'`。
两者都合法（action `id` 只要求非空字符串），但**跨插件唯一性**靠命名空间段。
自己扩展时统一选一种，别混用 —— `id` 重复会撞 `actionRegistry` 的注册表。
详见 {doc}`../reference/ai-actions`。
```

---

## 4. 三档共同的硬契约

这四条不分模板，违反任一条都会在「装得上 / 构建得过」之后才炸：

| 契约                                                           | 校验点                             | 失败形态                                         |
| :------------------------------------------------------------- | :--------------------------------- | :----------------------------------------------- |
| `manifest.main` 必填且为 `index.js`                            | zod `z.string().min(1)`            | 安装期报 `manifest.main 必须指定入口文件路径`    |
| 服务端入口 `export default { manifest, activate, deactivate }` | 加载器取 `mod.default ?? mod`      | 激活报 `missing activate function`，状态 `ERROR` |
| 前端入口 `default.activate` 是函数                             | `plugin-sandbox-frame.ts` 逐字判据 | 同上，且**界面全部入口带红色告警**               |
| 扩展点配置可结构化克隆                                         | `postMessage`                      | `DataCloneError`（函数穿不过 iframe）            |

```{note}
`deactivate()` **收不到 ctx**。三档模板都写成
`async function deactivate() { console.log('{{pluginName}} deactivated'); }`
—— 用 `console.log` 不是疏忽，是因为签名里没有 `ctx.log` 可用。
插件停用后的清理必须由宿主兜底（`ResourceTracker` 回收定时器与扩展点），
不要在 `deactivate` 里访问服务。
```

---

## 5. 模板代码里必须改写的四处

模板能装、能激活、能过 CI，但不代表可以直接抄进生产插件。以下是**逐条回源核验过**的四处：

### 5.1 `ctx.services.*` 未判空

模板写：

```typescript
const commandBus = ctx.services.commandBus;
await commandBus.registerHandler('{{pluginId}}.hello', {/* ... */});
```

运行时契约是每个 key 都是 `T | null`（审计 E-4）：`buildContext` 的 D-12 降级机制会把
`manifest.optional` 里版本不兼容的 Token 对应 key 置为 `null`。
而 SDK 的 `openlearn.d.ts` 里 `commandBus: ICommandBusService` **不带 `| null`**，
所以 `tsc` 不会拦你 —— 只有运行时踩空。

应当写成：

```typescript
const commandBus = ctx.services.commandBus;
if (!commandBus) throw new Error('commandBus unavailable');
```

### 5.2 `db.prepare(...).run(...)` 的同步假设

`full-stack` 模板在命令处理器里写：

```typescript
db.prepare(`INSERT INTO ${tableName} (id, content, created_at) VALUES (?, ?, ?)`).run(id, input, Date.now()); // 模板没有 await
```

- **inline 档**：`db` 是真 `better-sqlite3` Database，这一句同步落库，返回值是 Statement。
- **worker / `process` 档**：`ctx.resolve(IDatabaseToken)` 返回的是 RPC 垫片，
  `prepare(sql)` 返回一个 `{ run, get, all }` 普通对象，其中 `run(...)` 返回的是 **Promise**。
  不 `await` → 写入是 fire-and-forget，失败变成 unhandled rejection，
  命令已经返回结果而数据可能还没落库。

第三方 ZIP 插件被 `resolvePluginExecutionMode()` **强制**降到 `process` 档，
所以这条对 ZIP 交付的插件**总是**成立。修法：`await db.prepare(...).run(...)`，
或改用 `db.prepareAndRun(sql, args)`（RPC 的原生命名，inline 档反而没有）。
详见 {doc}`full-stack` §4 与 {doc}`../reference/database`。

### 5.3 `requires` 声明了不用的 Token

`server-only` 模板的 `requires` 有 4 条（含 `IDatabase`），但代码里一个都没 `resolve`。
`requires` 只参与清单校验与文档语义，**不是** `ctx.resolve` 的准入凭证，
多声明不会报错，但会让审查者以为这个插件要访问数据库。
删掉不用的条目。

### 5.4 `frontend.tsx` 顶部注释里有两句已经过时

模板注释断言「iframe 内也没有 `window.HostSharedDeps` / React」以及
「`component` 是函数，postMessage 无法结构化克隆，传进去直接 DataCloneError」。

- 前半句**成立**（沙箱 realm 内 `HostSharedDeps` 为 `undefined`）。
- 后半句要分两种情况：**manifest 里的 `component` 根本到不了 postMessage** ——
  zod 在 `parse()` 阶段就把未声明键 strip 掉了，你看到的是空白面板而不是 `DataCloneError`；
  `DataCloneError` 只在运行时 `ui.registerExtensionPoint(slot, { component })` 时发生。
- 「隐藏帧里不能碰 DOM」是错的：帧有自己的 `document`，只是它 `display: none`，画了用户也看不见。

完整边界见 {doc}`../reference/frontend-sandbox`（§0、§8）。

---

## 6. 做完以后怎么验

按顺序，前一步不过就别进下一步（三层验证的完整论证见 {doc}`../reference/testing`）：

1. `npm run build` —— esbuild 打包 + `manifestSchema` 校验，产出 `<插件名>.zip`。
2. Mock 测试（`@openlearn/plugin-test-kit`）—— 只验证你自己的分支逻辑，
   **不能**证明插件装得上。见 {doc}`../reference/testing` §3 的 14 项差异表。
3. 平台起服务 + 装 ZIP：`pnpm dev`（9000），必要时 `pnpm dev --demo`。
4. `node scripts/plugin-command-audit.mjs` —— 命令命名空间与 handler 配对审计。
5. 对照 {doc}`../playbook/agent-playbook` §4 自检清单与 {doc}`../playbook/pitfalls` 反例。

---

## 7. 三页教程

| 页面                | 做完你会得到                                             |
| :------------------ | :------------------------------------------------------- |
| {doc}`server-only`  | 一个 AI 可调用的工具 + 一条命令 + 一条事件，全程判空守卫 |
| {doc}`full-stack`   | 上一项，外加课堂工具按钮、命令面板条目、可靠落库         |
| {doc}`sandbox-view` | 一个真正**用户看得见**的自定义 HTML 面板（`view` 通道）  |

## 取证

| 结论                                                              | 位置                                                                                                           |
| :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| 三档模板源码                                                      | `packages/plugin-sdk/scaffold/templates/{server-only,full-stack,frontend-only}/src/*`；repomix L133885–L134449 |
| `server-only` 入口（`requires`/action/handler/事件）              | repomix L134341–L134412                                                                                        |
| `full-stack` 服务端入口                                           | repomix L134165–L134297                                                                                        |
| `full-stack` 前端入口与 `contracts/index.ts`                      | repomix L134044–L134073、L134073–L134164                                                                       |
| `frontend-only` 入口与「不声明命令型贡献」的理由                  | repomix L133885–L134043                                                                                        |
| 模板 manifest 必须过真实 schema、`main === 'index.js'`            | `packages/plugin-sdk/__tests__/scaffold-manifest.test.ts`，repomix L133451–L133552                             |
| `activate` 函数判据、`structuredClone` 判据、server-only 不带前端 | `packages/plugin-sdk/__tests__/scaffold-frontend-contract.test.ts`，repomix L133323–L133450                    |
| `services` 每 key 为 `T \| null`（审计 E-4）                      | ``packages/core/plugin-host/types.ts`→`PluginContext`（L227–L247）                                             |
| `.d.ts` 里 `commandBus` 不带 `null`                               | `packages/plugin-sdk/openlearn.d.ts`（repomix 内相对 L456–459）                                                |
| `resolvePluginCommandType` 统一规则与 UUID v7 透传                | `packages/core/plugin-host/plugin-namespace.ts`，repomix L111941–L112020                                       |
| `IDatabase` RPC 只支持 4 个方法                                   | ``packages/core/worker-runtime/service-host.ts`→`valueStr`（L867–L903）                                        |
| worker 侧 `ctx.resolve(IDatabaseToken)` 的 `prepare` 垫片         | ``packages/core/worker-runtime/bootstrap/sections/message-handler.ts`→`MESSAGE_HANDLER_SECTION`（L445–L473）   |
| sandbox-command 的 `No handler registered for command type`       | ``server/routes/plugins.ts`→`resolvedType`（L1720–L1729）                                                      |
