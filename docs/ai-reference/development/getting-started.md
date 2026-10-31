# 环境准备与上手

**结论先行**：只需要 Node 22 + 一个 `package.json`，用 `npx @openlearn/plugin-sdk init` 生成骨架，
`build` 产出 ZIP，后台上传即可。**不需要** clone 平台仓库，也**不能**依赖主应用源码。

---

## 1. 环境要求

| 项 | 值 | 说明 |
| --- | --- | --- |
| Node | **22.x**（平台 `.nvmrc` 指定 22） | 24/26 会触发原生模块 ABI 与 `localStorage` 兼容问题；插件侧虽无原生模块，但**测试工具链**（`better-sqlite3`）有 |
| 包管理器 | npm / pnpm 均可 | CLI 不假设 workspace |
| TypeScript | ≥ 5.0（可选） | 也可纯 JS 写插件 |
| 宿主平台 | ≥ `manifest.engines.openlearn` 声明的最低版本 | 按**实际用到的 API** 填，不要一律抄旧值 |

### 1.1 依赖版本

```bash
npm i -D @openlearn/plugin-sdk@3.7.5   # 运行时类型 + CLI
npm i -D esbuild jszip                  # CLI 的构建期依赖
npm i -D vitest @openlearn/plugin-test-kit
npm i -D uuid zod                       # SDK 自身运行期引用，必须显式装
```

`uuid` 与 `zod` **不是可选**：SDK 3.7.4 的 `dist/index.js` 引用了未声明的 `uuid`，
不装会在 `import('@openlearn/plugin-sdk')` 时直接 `Cannot find package 'uuid'`。
3.7.5 已补齐声明，但显式安装仍是更稳的做法（`packages/plugin-sdk/CHANGELOG.md` 记录了该修复）。

---

## 2. 生成骨架

```bash
npx @openlearn/plugin-sdk init
# 或非交互
npx @openlearn/plugin-sdk init --name lab-seat --description "机房座位管理" --author aymwoo --template full-stack
```

| 模板 | 生成文件 | 适用 |
| --- | --- | --- |
| `server-only`（默认） | `package.json`、`tsconfig.json`、`src/index.ts` | 只要命令/AI 工具，不要 UI |
| `full-stack` | 上面 + `src/frontend.tsx`、`src/contracts/index.ts` | 需要前端桥接 / 共享 Token |
| `frontend-only` | 上面 + `src/frontend.tsx` | 无后端命令，仅前端能力 |

证据：`packages/plugin-sdk/cli.mjs` 头部注释（L6-14）与 `--template` 取值（L106）。

> CLI 只替换 `name` / `description` / `author` / `pluginId` / `sdkVersion` 等基础占位符；
> 命令前缀、toolId、tabId 需手工改。

---

## 3. 最小工程结构（full-stack）

```text
my-plugin/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            ← 必须有 default export
│   └── frontend.tsx        ← 可选；有则产出 frontend.js
└── storage/                ← 可选；view 页面与静态资源（CLI 不打包，需自写脚本）
    └── panel.html
```

`package.json` 至少要能被 CLI 读到 `name` / `version`：

```json
{
  "name": "openlearn-plugin-lab-seat",
  "version": "0.6.3",
  "type": "module",
  "scripts": { "build": "openlearn-plugin-sdk build" },
  "dependencies": { "@openlearn/plugin-sdk": "^3.7.5" },
  "peerDependencies": { "react": ">=17", "react-dom": ">=17" }
}
```

真实样本：`[P] package.json`。

---

## 4. 写第一个 `activate`

```ts
// src/index.ts
import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@acme/plugin-hello',
    name: 'Hello',
    version: '0.1.0',
    main: 'index.js',
    engines: { openlearn: '>=0.2.3' },
    capabilitiesProposed: ['lesson:read'],   // process 模式必需（非空即可解除只读锁）
  },

  async activate(ctx: PluginContext) {
    const bus = ctx.services.commandBus;
    const registry = ctx.services.actionRegistry;
    if (!bus || !registry) return;           // 9 个服务类型均为 T | null

    ctx.log.info('hello activating');        // 自动带 pluginId 前缀

    await registry.register({
      id: 'hello.ping',
      commandType: 'hello.ping',
      description: '连通性自检，回显 payload',
      inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
      capabilityRequired: 'lesson:read',     // 必须来自 19 条真值
      exposeToAgent: true,
    });

    await bus.registerHandler('hello.ping', {
      async execute(command) {               // 必须是对象，不能是裸函数
        return { ok: true, echo: (command.payload as any)?.msg ?? 'pong' };
      },
    });
  },
};
```

**这两处必须成对出现**：`actionRegistry.register({ commandType })` + `commandBus.registerHandler(同名)`。
少任一条 → 403 `COMMAND_NOT_REGISTERED` / `COMMAND_HANDLER_NOT_REGISTERED`。

---

## 5. 构建

```bash
npx @openlearn/plugin-sdk build
# 产物：
#   dist/index.js       ← esbuild bundle（@openlearn/plugin-sdk 保持 external）
#   dist/frontend.js    ← 有 src/frontend.tsx 时
#   dist/<name>.zip     ← 含 index.js + manifest.json (+ frontend.js)
```

| 行为 | 说明 | 证据 |
| --- | --- | --- |
| `manifest.json` 来源 | 优先读项目根 `manifest.json`；缺失则从 `src/index.ts` 的 `manifest` 提取 | `cli.mjs`（L480-525） |
| `storage/**` | **不打包** | `cli.mjs`（L546-553） |
| 裸说明符守卫 | `frontend.js` 出现 `from 'x'` 等即构建失败 | `cli.mjs`（L272-324） |
| 签名 | `--key <pem> --publisher <name>` 产出 `signature.json` | `cli.mjs`（L557-574） |
| watch | `build --watch` | `cli.mjs`（L393） |

需要 `storage/` 的插件必须自写打包脚本把目录补进 ZIP（示例见 [ui-extension-guide.md](ui-extension-guide.md) §4.2）。

---

## 6. 安装与验证

```text
① 管理后台 → 系统设置 → 插件中心 → 上传插件（.zip）
② 若出现「确认授予清单申请的能力」→ 必须勾选（不勾 = 授予集合为空 = 非 get RPC 全被拒）
③ 激活 → 观察服务日志是否出现 [Plugin:<id>] 错误
④ 验证入口：
   · 声明了 classroomTools → 进课堂白板看按钮
   · 声明了 contributes → 看对应 Tab / 工具栏
   · 声明了 api.routes → curl /api/plugins/<manifest.id>/<path>
⑤ 停用 → 再启用（验证幂等）
```

### 6.1 安装后自检（不要靠肉眼）

```bash
# 三个静默失败点：view 被 strip / storage 未进包 / ZIP 与 DB 不一致
unzip -l dist/<name>.zip | grep -E 'index.js|manifest.json|frontend.js|storage/'
sqlite3 packages/core/db/educational_os.db \
  "SELECT id,status,execution_mode,manifest FROM plugins WHERE json_extract(manifest,'$.id')='@acme/plugin-hello'"
```

判据：

| 检查 | 通过标准 |
| --- | --- |
| ZIP 三件套 | `index.js` + `manifest.json` 必有；`frontend.js` 按需 |
| ZIP 含 `storage/` | 若用了 `view` 则必须有 |
| DB `manifest` 里 `contributes.*.view` 还在 | 被 strip 时该字段消失 |
| `execution_mode` | 第三方应为 `process`；`inline` 说明命中了白名单 |
| `status` | `active` |

---

## 7. 开发期最小验证循环

```bash
# 1. 类型检查（不需要平台仓库）
npx tsc --noEmit

# 2. 构建
npx @openlearn/plugin-sdk build

# 3. 单测（mock 上下文）
npx vitest run

# 4. 上传 → 激活 → 点入口 → 停用 → 再启用
```

四步里 **第 4 步不可省**：Mock 没有能力审批、没有子进程隔离、没有真实网关限流。

---

## 8. 常见起步错误

| 错误 | 原因 | 修法 |
| --- | --- | --- |
| `manifest.main 必须指定入口文件路径` | manifest 缺 `main` | 补 `"main": "index.js"` |
| `Cannot find package 'uuid'` | 未装 `uuid` | `npm i -D uuid zod` |
| `✖ frontend 产物里有裸模块说明符` | 前端 `import React` / 第三方包 | 删掉，或让 bundler 内联（相对路径不受限） |
| 构建成功但后台「装不上」 | ZIP 根目录多套了一层目录 | ZIP 根必须直接是 `index.js` + `manifest.json` |
| 激活 500 `only 'get' methods allowed` | `capabilitiesProposed` 为空 | 声明至少一条真实能力 |
| 插件列表有、点开空白 | `contributes.*.view` 被 strip 或 `storage/` 没进包 | 见 §6.1 |
