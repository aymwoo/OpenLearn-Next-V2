# 最小可运行插件

**目标**：一个能装上、能激活、能被 AI 调用、能在命令面板看到入口的最小插件。
**不含**：数据库、前端 bundle、`view` 页面。全部代码 4 个文件、约 90 行。

---

## 1. 文件清单

```text
plugin-hello/
├── package.json
├── tsconfig.json
├── manifest.json
└── src/
    └── index.ts
```

---

## 2. `package.json`

```json
{
  "name": "openlearn-plugin-hello",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "openlearn-plugin-sdk build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@openlearn/plugin-sdk": "^3.7.5"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "jszip": "^3.10.1",
    "typescript": "^5.0.0",
    "uuid": "^14.0.1",
    "zod": "^3.23.0"
  }
}
```

---

## 3. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  },
  "include": ["src"]
}
```

---

## 4. `manifest.json`

```json
{
  "id": "@acme/plugin-hello",
  "name": "Hello 插件",
  "version": "0.1.0",
  "description": "最小可运行示例：一个命令 + 一个命令面板入口",
  "author": "acme",
  "main": "index.js",
  "engines": { "openlearn": ">=0.7.0" },
  "requires": ["@openlearn/core:ICommandBusService@^1.0.0", "@openlearn/core:IActionRegistryService@^1.0.0"],
  "capabilitiesProposed": ["lesson:read"],
  "contributes": {
    "command_palette.item": [
      {
        "id": "hello-ping",
        "title": "Hello：连通性自检",
        "category": "extension",
        "description": "回显传入的 msg",
        "commandType": "hello.ping"
      }
    ]
  }
}
```

逐条说明：

| 字段                                  | 为什么这么写                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `main`                                | **必填**，指向 ZIP 内入口；CLI 产出 `index.js`                                             |
| `engines`                             | 用了 `contributes`（0.7.0+）与命令面板，故最低 0.7.0                                       |
| `requires`                            | 用到的两个服务 Token，格式必须过 `^@[\w-]+\/[\w-]+:I\w+…$`                                 |
| `capabilitiesProposed`                | **非空**是关键：`process` 模式下 `actionRegistry.register` 属于非 `get*` RPC，空能力会 500 |
| `lesson:read`                         | 19 条命令能力之一，语义最轻，够用即可                                                      |
| `contributes['command_palette.item']` | A 组严格键；`commandType` 写短名，宿主自动加前缀                                           |

---

## 5. `src/index.ts`

```ts
import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@acme/plugin-hello',
    name: 'Hello 插件',
    version: '0.1.0',
    main: 'index.js',
    engines: { openlearn: '>=0.7.0' },
    requires: ['@openlearn/core:ICommandBusService@^1.0.0', '@openlearn/core:IActionRegistryService@^1.0.0'],
    capabilitiesProposed: ['lesson:read'],
    contributes: {
      'command_palette.item': [
        {
          id: 'hello-ping',
          title: 'Hello：连通性自检',
          category: 'extension',
          description: '回显传入的 msg',
          commandType: 'hello.ping',
        },
      ],
    },
  },

  async activate(ctx: PluginContext): Promise<void> {
    const bus = ctx.services.commandBus;
    const registry = ctx.services.actionRegistry;

    // 9 个服务类型均为 T | null —— 必须判空
    if (!bus || !registry) {
      ctx.log.warn('hello: commandBus/actionRegistry 不可用，跳过注册');
      return;
    }

    // ① 描述符：default-deny 的放行凭据
    await registry.register({
      id: 'hello.ping',
      commandType: 'hello.ping', // 短名；宿主补成 @acme/plugin-hello.hello.ping
      description: '连通性自检：回显传入的 msg',
      inputSchema: {
        type: 'object',
        properties: { msg: { type: 'string', description: '要回显的文本' } },
        required: [],
      },
      capabilityRequired: 'lesson:read', // 必须是 19 条真值之一
      exposeToAgent: true, // 进 AI 工具箱（需 agent:tool 才不降级）
    });

    // ② handler：必须是 { execute } 对象
    await bus.registerHandler('hello.ping', {
      async execute(command) {
        const payload = (command.payload ?? {}) as { msg?: string };
        ctx.log.info('hello.ping 被调用', { actorId: command.actorId });
        return { ok: true, echo: payload.msg ?? 'pong', at: Date.now() };
      },
    });
  },

  async deactivate(): Promise<void> {
    // 本例没有自建资源（定时器/连接），无需清理。
    // 宿主会自动注销 handler 与 descriptor。
  },
};
```

**三个必须**：

1. `manifest` 两处（`manifest.json` 与 `src/index.ts`）要么一致，要么只留 `manifest.json`（CLI 优先读文件）；
2. `register` 与 `registerHandler` 的 `commandType` **逐字一致**；
3. `capabilityRequired` 与 `capabilitiesProposed` 有交集（本例都是 `lesson:read`）。

---

## 6. 构建与验证

```bash
npm install
npx tsc --noEmit                 # 0 error
npx openlearn-plugin-sdk build   # 或 npm run build

# 产物
ls dist/
# index.js  manifest.json  acme-plugin-hello.zip  （无 frontend.js —— 合法）
```

```bash
# ZIP 内容必须是三件套平铺
unzip -l dist/acme-plugin-hello.zip
#   index.js
#   manifest.json
```

### 6.1 装到宿主

```text
① 后台 → 插件中心 → 上传 dist/acme-plugin-hello.zip
② 勾选「确认授予清单申请的能力」（第三方插件必须勾，否则 lesson:read 未授予 → 激活 500）
③ 激活 → 状态应为 active，execution_mode 应为 process
④ Ctrl+K → 搜「Hello：连通性自检」→ 应出现
⑤ 点击 / 让 AI 执行 → 返回 { ok:true, echo:'pong' }
```

### 6.2 直接测命令（绕过 UI）

```bash
curl -X POST http://localhost:9000/api/plugins/execute-command \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <你的 edu_os_token>' \
  -d '{"type":"@acme/plugin-hello.hello.ping","payload":{"msg":"hi"}}'
```

期望：`{"success":true,"result":{"ok":true,"echo":"hi","at":...}}`

---

## 7. 常见偏差

| 偏差                                                 | 结果                                         | 修法                |
| ---------------------------------------------------- | -------------------------------------------- | ------------------- |
| 删掉 `actionRegistry.register`                       | 403 `COMMAND_NOT_REGISTERED`                 | 加回来              |
| `capabilitiesProposed` 留空数组                      | 激活 500 `only 'get' methods allowed`        | 至少一条真实能力    |
| `commandType` 写 `@acme/plugin-hello.hello.ping`     | 也能工作（已带前缀分支），但不要混用两种写法 | 统一短名            |
| 只写 `manifest.json` 不写 `src/index.ts` 的 manifest | **可以**（CLI 优先读文件）                   | —                   |
| 只写 `src/index.ts` 的 manifest                      | CLI 会从源码提取；但提取失败会告警           | 建议两份都写        |
| 用 `lesson:read` 做写操作                            | 语义不符但不拦（命令闸门只看字符串）         | 换成 `lesson:write` |

---

## 8. 从最小插件往下走的下一步

| 需求           | 追加内容                                                              | 文档                                                                  |
| -------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 存数据         | `await ctx.db.ensureTable('notes', 'id TEXT PRIMARY KEY, body TEXT')` | [context-and-services](../plugin-system/context-and-services.md) §4   |
| 出 UI          | 加 `storage/panel.html` + 自写打包                                    | [ui-extension-guide](../development/ui-extension-guide.md) §3         |
| 被其他插件调用 | `Token` + `provides` + `ctx.provide()`                                | [context-and-services](../plugin-system/context-and-services.md) §3.2 |
| 写测试         | `createMockContext()`                                                 | [testing-guide](../development/testing-guide.md) §2                   |
