# 教程一：server-only 插件（命令 + AI 工具 + 事件）

**目标**：做出一个 `@myteam/hello` 插件，让 AI 助手能调用 `hello` 工具，
调用后落一条事件，并且**在 `process` 隔离档下也不崩**。

预计耗时：装脚手架 1 分钟，改代码 10 分钟，验证 5 分钟。

---

## 1. 建项目

```bash
npx @openlearn/plugin-sdk init \
  --name hello \
  --description "打招呼示例插件" \
  --author myteam \
  --template server-only

cd hello && npm install
```

得到：

```
hello/
├── package.json          # "build": "openlearn-plugin-sdk build"
├── tsconfig.json         # ES2022 / ESNext / bundler / strict
└── src/index.ts          # 唯一源文件
```

```{note}
`server-only` 的 `tsconfig.json` 仍带着 `"jsx": "react-jsx"`，`package.json` 里也留着
`react` 的 peerDependency —— 模板共用一套配置，不影响构建，但别据此以为这档能写组件。
```

---

## 2. manifest 逐行

模板产出的 `src/index.ts`（占位符已替换的形式）：

```typescript
import type { PluginContext } from '@openlearn/plugin-sdk';
import { ICommandBusServiceToken, IActionRegistryServiceToken, IEventBusServiceToken } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@myteam/hello',
    name: 'hello',
    version: '0.1.0',
    main: 'index.js',
    description: '打招呼示例插件',
    author: 'myteam',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read'],
    engines: { openlearn: '>=0.2.5' },
  },
  // ...
};
```

| 字段                   | 这一份里为什么这么写                                               | 改它会怎样                                                    |
| :--------------------- | :----------------------------------------------------------------- | :------------------------------------------------------------ |
| `id`                   | 必须是 `@scope/name`，由脚手架用 `--author`/`--name` 拼出来        | 含 `:` 直接装不上                                             |
| `main`                 | 必填，值必须是 `index.js`（esbuild 单文件 bundle 的产物名）        | 缺失报 `manifest.main 必须指定入口文件路径`                   |
| `requires`             | 条目格式受 zod 正则约束，见 {doc}`../reference/token-reference` §1 | 少一个 `@scope/` 报「requires 条目格式无效」                  |
| `capabilitiesProposed` | `'lesson:read'` 是 19 个内建能力名之一，**不是杜撰串**             | 未知能力名不会报错，但命令会被 `COMMAND_CAPABILITY_DENIED` 拒 |
| `engines.openlearn`    | `'>=0.2.5'`，平台实际 `0.7.8`                                      | 写高了会在安装期被引擎检查拦                                  |

```{warning}
### 模板声明了 `IDatabase` 却没用

`requires` 里的 `@openlearn/core:IDatabase@^1.0.0` 在这段代码里没有任何 `resolve` 对应。
`requires` 不影响 `ctx.resolve` 的准入（准入靠
[`PLUGIN_RESOLVABLE_TOKENS`](../reference/token-reference.md) 白名单，31 项），
只影响清单校验与人工审查。删掉它，或者真的用上它。

另外：`import { ICommandBusServiceToken, ... }` 三个 Token 在模板里**只 import 未使用**
—— `ctx.services.commandBus` 走的是宿主注入，不需要 Token。
`strict` 模式下这不会被 `tsc` 拦（`noUnusedLocals` 未在模板 tsconfig 里开启），
但 `{cmd, lint}` 类检查会报。清掉未使用的 import。
```

---

## 3. `activate`：注册顺序与成对关系

模板主体（三处按 §5 的结论加了守卫）：

```typescript
async activate(ctx: PluginContext) {
  const commandBus = ctx.services.commandBus;
  const actionRegistry = ctx.services.actionRegistry;
  const eventBus = ctx.services.eventBus;
  if (!commandBus || !actionRegistry || !eventBus) {
    throw new Error('required kernel services unavailable');
  }

  // ① 先声明 AI 可见的工具
  await actionRegistry.register({
    id: '@myteam/hello-hello',
    commandType: '@myteam/hello.hello',
    description: 'Say hello — a starter action for hello',
    capabilityRequired: 'lesson:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Who to greet' },
      },
      required: ['name'],
    },
  });

  // ② 再注册同名命令处理器
  await commandBus.registerHandler('@myteam/hello.hello', {
    async execute(command) {
      const payload = command.payload as any;
      const message = `Hello, ${payload.name}! — from hello`;

      await eventBus.publish({
        id: crypto.randomUUID(),
        type: '@myteam/hello.hello_executed',
        source: 'plugin.@myteam/hello',
        payload: { message },
        timestamp: Date.now(),
        correlationId: command.id,
      });

      return { message };
    },
  });

  ctx.log.info('hello activated successfully');
}
```

### 3.1 三条必须遵守的成对关系

| 关系                                                          | 约束                       | 违反后的现象                                              |
| :------------------------------------------------------------ | :------------------------- | :-------------------------------------------------------- |
| `action.commandType` ↔ `registerHandler(type, ...)`           | 两处必须是**同一个字符串** | AI 选中工具 → `No handler registered for command: <type>` |
| `action.capabilityRequired` ↔ `manifest.capabilitiesProposed` | 前者是后者的子集           | `COMMAND_CAPABILITY_DENIED`，且插件状态可能被降级         |
| `registerHandler` 的类型 ↔ 命名空间                           | 见下一小节                 | 命令注册到 `@myteam/hello.x`，调用方找 `x`，两边对不上    |

```{danger}
### 只 `registerHandler` 不 `register` action，命令根本派发不了

CommandBus 的默认拒绝拦截器：`actionRegistry.getActionByCommandType(command.type)`
查不到 `ActionDescriptor` 时直接抛 `COMMAND_NOT_REGISTERED`（`err.status = 403`）。
所以「先注册 action，再注册 handler」不是风格问题，而是**派发前置条件** ——
模板里成对出现 `actionRegistry.register(...)` + `commandBus.registerHandler(...)` 就是这个原因。

另外，`registerHandler` 对**同一 type 重复注册会抛错**
`Command handler for <type> is already registered.`
—— 两个插件撞了同一个命令名时，第二个激活直接失败。命令名必须落在自己的命名空间下。
```

### 3.2 命令命名空间：为什么模板写了全限定名

`resolvePluginCommandType(type, pluginId)` 的规则（单一事实源）：

```typescript
export function resolvePluginCommandType(type: string, pluginId: string): string {
  const prefix = pluginId + '.';
  if (type.startsWith(prefix)) return type; // 已限定 → 原样
  if (UUID_V7_PREFIX.test(type)) return type; // DB UUID 前缀 → 原样
  return prefix + type; // 否则补前缀
}
```

模板注册的是 `'{{pluginId}}.hello'`，即**已经带前缀**，命中第一条分支原样入库；
调用方（沙箱前端、`sandbox-command` 路由）传裸 `'hello'` 也会被补成同一个 key。
两种写法都走得通，但要记住：

```{danger}
### 前缀用的是 `manifest.id`，不是 `ctx.pluginId`

`ctx.pluginId` 是 `plugins` 表的行 UUID（v7），**不是** `manifest.id`。
两侧（注册点与执行点）都必须用 `manifest.id` 调这个函数，
否则前缀对前端不可见，CommandBus 报
`No handler registered for command: <type>`。

自己写代码时最稳的做法就是模板的做法：**注册与调用都用全限定名**
`<manifest.id>.<local>`，让 `startsWith` 分支直接命中，绕开两侧取值不一致的风险。
```

### 3.3 handler 的形状

`registerHandler` 收的是**对象** `{ async execute(command) {...} }`，不是函数。

```{warning}
❌ `commandBus.registerHandler(type, async (cmd) => ...)` —— 类型上可能被 overload 容忍，
运行时按 `handler.execute` 取，取到 `undefined`。
✅ `commandBus.registerHandler(type, { execute: async (cmd) => ... })`
```

### 3.4 事件的五个必填字段

模板发布的 `PlatformEvent` 形状：`id` / `type` / `source` / `payload` / `timestamp`，
外加 `correlationId: command.id`（把事件挂回触发它的那条命令，链路可追）。

```{note}
`source: 'plugin.@myteam/hello'` 在 worker / process 档会被宿主**改写**：
`IEventBusService.publish` 的 RPC 处理器把 `source` 重写成
`plugin:<pluginId>.<event.source>`。
所以**不要**在事件消费侧对 `source` 做精确字符串匹配，
用 `type` 匹配、用 `correlationId` 关联。
见 {doc}`../reference/command-and-event`。
```

### 3.5 `inputSchema` 的 `type` 是大写的

```{warning}
### `type: 'string'` 会静默放行任意 payload

拦截器在执行前调用 `validateJsonSchema(command.payload, action.inputSchema)`，
它是 `packages/core/kernel/index.ts` 里的模块级递归校验器，
**只认 `OBJECT` / `ARRAY` / `STRING` / `NUMBER` / `BOOLEAN` 五个大写值**；
其他 `type`（含小写的标准 JSON-Schema 写法、`integer`、缺省 `type`）一律返回 `[]` 即放行，
不报错、不告警。

模板写的正是 `type: 'OBJECT'` / `type: 'STRING'` —— 照抄，别「改成标准 JSON Schema」。
失败时报 `[PayloadValidationError] Invalid command payload for <type>: <errors>`。
完整字段语义见 {doc}`../reference/ai-actions`。
```

---

## 4. 前端要不要写点什么？

`server-only` 档**不生成** `frontend.tsx`，CI 断言这个文件不存在。
意味着：

- 没有命令面板条目、没有课堂工具按钮、没有任何可见入口。
- AI 助手仍可调用你的 action（工具面板是宿主自己的），事件也会进课堂事件流。

要可见入口 → {doc}`full-stack`；要自定义界面 → {doc}`sandbox-view`。

---

## 5. 构建与产物

```bash
npm run build
# → openlearn-plugin-sdk build
# → dist/index.js、dist/manifest.json、dist/hello.zip
```

````{danger}
### SDK 只往 ZIP 里放三个文件

`openlearn-plugin-sdk build` 写 ZIP 的全部逻辑是：

```javascript
zip.file('index.js', readFileSync(join(distDir, 'index.js'), 'utf8'));
zip.file('manifest.json', JSON.stringify(manifest, null, 2));
if (hasFrontend) zip.file('frontend.js', readFileSync(join(distDir, 'frontend.js'), 'utf8'));
```

签名时再追加 `signature.json`。也就是说：**你的 `node_modules/`、`src/`、任意资源文件默认都不进 ZIP**。

安装端只额外识别两处（其余条目只在临时目录里供 esbuild 解析，`finally` 里整目录删除）：

| ZIP 条目 | 安装后的落点 | 用途 |
| :--- | :--- | :--- |
| `storage/**`（任意层级） | `<插件目录>/storage/**`，逐条做 Zip Slip 校验 | 静态资源，`view` 的 HTML 就走这里 |
| `manifest.deploy.script` 指向的那一个文件 | `<插件目录>/<deploy.script>` | 部署脚本 |

因此：
- 需要 HTML/CSS/JSON 资源 → 放进项目的 `storage/` 并**自己把它加进 ZIP**（SDK 不会加，见 {doc}`sandbox-view` §3）；
- 需要第三方运行时模块 → 只能用 `ctx.require()` 的 7 个白名单
  （`recharts` `react-markdown` `jspdf` `jspdf-autotable` `exceljs` `lucide-react` `uuid`），
  它读的是**宿主仓库**的 `node_modules`，「在插件目录 `npm install` 再 require」拿不到。
  见 {doc}`../playbook/pitfalls` P-17。
- ZIP 总未压缩体积受 `getMaxUncompressedSize()` 与 `OPENLEARN_MAX_ZIP_SIZE`（默认 300 MB）双重限制，
  超限报 `ZIP bomb prevention: total uncompressed size ... exceeds limit ...`。
````

构建期还会做两件事（详见 {doc}`../reference/testing` §6）：
manifest 过 `manifestSchema`；以及 migration 相关的告警检查。

---

## 6. 装上并确认它在跑

```bash
# 平台侧（仓库根）
pnpm dev                 # http://localhost:9000
pnpm dev --demo          # 需要课堂/学生数据时：storage/demo.db，demo_teacher / Demo@2026
```

安装：管理端 → 插件 → 上传 `dist/hello.zip`。

**第三方 ZIP 一定跑在 `process` 档**：`resolvePluginExecutionMode()` 会把它强制降级，
并在日志里留 `executionModeCoerced: true`。别按 inline 档的行为推理。

验证链，按成本从低到高：

| #   | 手段                                                                                                            | 证明什么                          |
| :-- | :-------------------------------------------------------------------------------------------------------------- | :-------------------------------- |
| 1   | 插件列表状态为 `active`                                                                                         | 装上了、`activate` 没抛           |
| 2   | AI 助手里出现 `hello` 工具，填 `name` 调用                                                                      | action 注册与 schema 校验通过     |
| 3   | 课堂事件流出现 `hello_executed`                                                                                 | 事件发布链路通                    |
| 4   | `node scripts/plugin-command-audit.mjs`                                                                         | 命令命名空间与 handler 配对无缺失 |
| 5   | `curl` 走 `POST /api/plugins/:id/sandbox-command`（`:id(*)` 支持带 scope 的 id，写成 `%40myteam%2Fhello` 最稳） | 从前端视角命令可寻址              |

```{tip}
第 5 步能顺带验证命名空间：`body` 里 `{"type":"hello"}` 与
`{"type":"@myteam/hello.hello"}` 应当**都能命中同一个 handler**。
如果只有后者命中，说明注册点用了 DB UUID 做前缀。
```

失败排查顺序见 {doc}`../reference/agent-quickstart` §6 与 {doc}`../playbook/pitfalls` G 组静默失效表。

---

## 7. 提交前自检

- [ ] `manifest.id` 为 `@scope/name`，不含 `:`
- [ ] `main === "index.js"`
- [ ] `requires` 每条匹配 zod 正则；没有声明却不使用的条目
- [ ] `capabilitiesProposed` 里的名字都在 19 个内建能力内
- [ ] `activate` 里每个 `ctx.services.*` 都判过空
- [ ] `action.commandType === registerHandler` 的字符串，且都是全限定名
- [ ] `registerHandler` 传的是 `{ execute }` 对象
- [ ] 事件带 `correlationId`；消费侧不依赖 `source` 精确匹配
- [ ] 没有裸 `setInterval`（用 `ctx.services.processManager.registerInterval`）
- [ ] `deactivate` 里不访问服务
- [ ] ZIP 只含 `index.js` / `manifest.json` / `frontend.js`
- [ ] Mock 测试全绿，**并且**真装过一次 ZIP（Mock 不校验 schema 与 provides）

完整清单：{doc}`../playbook/agent-playbook` §4；反例库：{doc}`../playbook/pitfalls`。

## 取证

| 结论                                                                   | 位置                                                                                                                                |
| :--------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| 本教程主源码                                                           | `packages/plugin-sdk/scaffold/templates/server-only/src/index.ts`，repomix L134341–L134412                                          |
| 模板 `package.json` / `tsconfig.json`                                  | repomix L134413–L134449                                                                                                             |
| `manifestSchema` 字段与正则                                            | `packages/core/esm-loader/manifest-schema.ts`，repomix L81517–L82411                                                                |
| `services` 每 key 为 `T \| null`（E-4）                                | ``packages/core/plugin-host/types.ts`→`PluginContext`（L227–L247）                                                                  |
| `PluginContext` 的 12 个成员（无 `reportProgress`）                    | 同上，repomix L113883–L113955                                                                                                       |
| 命名空间统一规则与 `manifest.id` 警告                                  | `packages/core/plugin-host/plugin-namespace.ts`，repomix L111941–L112020                                                            |
| `No handler registered for command: <type>`                            | ``packages/core/command-bus/index.ts`→`handler`（L123）                                                                             |
| 同一 type 重复 `registerHandler` 抛错                                  | ``packages/core/command-bus/index.ts`→`CommandBus`（L56）                                                                           |
| 默认拒绝拦截器（无 descriptor → 403 `COMMAND_NOT_REGISTERED`）         | ``packages/core/kernel/index.ts`→`err`（L398）                                                                                      |
| `validateJsonSchema` 只认 5 个大写 `type`                              | `packages/core/kernel/index.ts`，repomix L83924–L84674                                                                              |
| `IDatabase` RPC 只支持 4 个方法                                        | ``packages/core/worker-runtime/service-host.ts`→`valueStr`（L867–L903）                                                             |
| worker `ctx.reportProgress` 注入 / `publish not supported from Worker` | ``packages/core/worker-runtime/bootstrap/sections/message-handler.ts`→`MESSAGE_HANDLER_SECTION`（L434–L443）、L126029               |
| sandbox-command 路由与 `resolvedType`                                  | ``server/routes/plugins.ts`→`result`（L1706–L1736）                                                                                 |
| 第三方 ZIP 强制 `process` 档                                           | `packages/core/plugin-host/execution-policy.ts` 的 `resolvePluginExecutionMode()`，见 {doc}`../reference/isolation-and-security` §1 |
| `PLUGIN_SHARED_MODULES` 7 项                                           | ``packages/core/worker-runtime/bootstrap/sections/message-handler.ts`→`MESSAGE_HANDLER_SECTION`（L421）                             |
| 模板 `main` 必须过真实 schema                                          | `packages/plugin-sdk/__tests__/scaffold-manifest.test.ts`，repomix L133451–L133552                                                  |
