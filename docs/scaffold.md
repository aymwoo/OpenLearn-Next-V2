# OpenLearn Plugin 脚手架开发指南

本指南面向第三方开发者，介绍如何使用 `@openlearn/plugin-sdk` CLI 工具从零开始创建、构建和发布 OpenLearn 插件。

## 目录

1. [快速开始](#1-快速开始)
2. [模板说明](#2-模板说明)
3. [项目结构](#3-项目结构)
4. [开发流程](#4-开发流程)
5. [构建与打包](#5-构建与打包)
6. [安装与调试](#6-安装与调试)
7. [发布到 npm](#7-发布到-npm)
8. [CLI 命令参考](#8-cli-命令参考)
9. [常见问题](#9-常见问题)

---

## 1. 快速开始

### 前提条件

- Node.js >= 18
- npm >= 9

### 3 分钟创建第一个插件

```bash
# 1. 脚手架生成项目
npx @openlearn/plugin-sdk init --name hello-world

# 2. 安装依赖
cd hello-world
npm install

# 3. 构建插件 ZIP
npx @openlearn/plugin-sdk build

# 4. 产物位于 hello-world.zip
# 上传到 OpenLearn 插件中心即可安装
```

### 交互式创建

不传参数，CLI 会引导你逐步填写：

```bash
npx @openlearn/plugin-sdk init
```

```
? Plugin package name (kebab-case): my-voting-tool
? Description (default: "my-voting-tool plugin"): 课堂投票工具
? Author (default: "OpenLearn Developer"): teacher-li

  server-only   — Backend plugin (commands, events, AI tools)
  full-stack    — Full plugin (server + React frontend)
  frontend-only — Pure UI extension (React component)

? Template (default: server-only): full-stack

✔ Scaffolded my-voting-tool/
```

---

## 2. 模板说明

提供三种模板，覆盖不同的插件类型：

### server-only — 纯后端插件

适用于只需注册 AI 工具和命令处理器的插件。没有前端界面。

**特点：**
- 注册 AI Action（`actionRegistry.register()`）
- 注册命令处理器（`commandBus.registerHandler()`）
- 发布事件（`eventBus.publish()`）
- 无前端组件

**生成文件：**
```
├── src/index.ts          # 服务端入口（manifest + activate）
├── package.json
├── tsconfig.json
└── .gitignore
```

### full-stack — 全栈插件

最完整的模板，包含服务端逻辑和 React 前端组件。适用于需要教师/学生界面的插件。

**特点：**
- 服务端：AI 工具 + 命令 + 事件 + 数据库表
- 前端：React 组件，通过宿主共享依赖运行
- 自动注入 `classroomTools` 声明
- 前端外部化 react/react-dom/recharts/lucide-react（宿主提供）

**生成文件：**
```
├── src/
│   ├── index.ts          # 服务端入口
│   └── frontend.tsx       # 前端 React 组件
├── package.json
├── tsconfig.json
└── .gitignore
```

### frontend-only — 纯前端插件

只需一个 UI 面板或课堂工具的插件。没有服务端命令处理。

**特点：**
- 仅含 frontend.tsx React 组件
- `manifest.requires` 为空
- 适合：白板小工具、仪表盘小部件、学生视图扩展

**生成文件：**
```
├── src/
│   ├── index.ts          # 最小化 manifest（仅 frontend 声明）
│   └── frontend.tsx       # 前端 React 组件
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## 3. 项目结构

脚手架生成的完整项目结构：

```
my-plugin/
├── package.json              # 插件元信息 + 依赖声明
├── tsconfig.json             # TypeScript 编译配置
├── .gitignore                # Git 忽略规则
├── README.md                 # （手动添加）插件文档
│
├── src/
│   ├── index.ts              # ★ 服务端入口
│   │                         # export default { manifest, activate, deactivate? }
│   │
│   └── frontend.tsx          # ★ 前端入口（full-stack / frontend-only 模板）
│                             # export default function MyComponent() { ... }
│
└── dist/                     # 构建产物（build 命令自动生成）
    ├── index.js              # 打包后的服务端代码
    ├── frontend.js           # 打包后的前端代码（如有）
    └── my-plugin.zip         # ★ 最终发布产物
```

### package.json 关键字段

```json
{
  "name": "openlearn-plugin-hello-world",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@openlearn/plugin-sdk": "^3.2.0"
  }
}
```

### TypeScript 配置

脚手架生成的 `tsconfig.json` 已配置好 `bundler` 模块解析和严格模式：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx"
  }
}
```

---

## 4. 开发流程

### 4.1 理解入口文件

`src/index.ts` 是插件的唯一入口，必须 default export 一个包含 `manifest` 和 `activate` 的对象：

```typescript
import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
} from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@yourname/my-plugin',          // 全局唯一标识
    name: '我的插件',                    // 显示名称
    version: '0.1.0',
    description: '插件描述',
    author: '你的名字',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read', 'lesson:write'],
    classroomTools: [{                    // 可选：前端课堂工具
      id: 'my-tool',
      name: '我的工具',
      icon: 'Puzzle',
      commandType: 'myplugin.open_tool',
    }],
    engines: { openlearn: '>=5.0.0' },
  },

  async activate(ctx: PluginContext) {
    // 在这里注册 AI 工具和命令处理器
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    // 1. 注册 AI Action
    await actionRegistry.register({
      id: 'myplugin-hello',
      commandType: 'myplugin.hello',
      description: '打招呼',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '名字' },
        },
        required: ['name'],
      },
    });

    // 2. 注册命令处理器
    await commandBus.registerHandler('myplugin.hello', {
      async execute(command) {
        const payload = command.payload as any;
        return { message: `Hello, ${payload.name}!` };
      },
    });
  },

  async deactivate() {
    // 清理资源
  },
};
```

### 4.2 可用的服务接口

在 `activate(ctx)` 中，通过 `ctx.services` 访问 7 个内核服务：

| 服务 | 访问方式 | 用途 |
|------|---------|------|
| CommandBus | `ctx.services.commandBus` | 注册/执行命令 |
| EventBus | `ctx.services.eventBus` | 发布/订阅事件 |
| ActionRegistry | `ctx.services.actionRegistry` | 注册 AI 工具 |
| Capability | `ctx.services.capability` | 权限管理 |
| Process | `ctx.services.processManager` | 后台进程 |
| Storage | `ctx.services.storage` | K-V 存储 |
| AI | `ctx.services.ai` | 文本生成 |

通过 DI 解析更多服务：

```typescript
import { IDatabaseToken } from '@openlearn/plugin-sdk';
const db = await ctx.resolve(IDatabaseToken);
```

### 4.3 开发前端组件（full-stack / frontend-only）

`src/frontend.tsx` 导出一个 React 组件，在宿主应用中渲染：

```typescript
import React, { useState } from 'react';

export default function MyPluginUI() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: 16 }}>
      <h2>我的插件</h2>
      <p>计数器: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
    </div>
  );
}
```

**重要：** 前端不打包 `react`、`react-dom`、`recharts`、`lucide-react`。这些库由宿主应用通过 `window.HostSharedDeps` 提供，CLI build 命令会自动将它们标记为 external。

### 4.4 使用插件数据库

每个插件有独立的数据库命名空间：

```typescript
// 创建表
await ctx.db.ensureTable('polls', `
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  options TEXT NOT NULL
`);

// 获取带命名空间的表名
const tableName = ctx.db.table('polls');
// → "plugin_@yourname_my-plugin_polls"

// 通过 DI 拿到 raw better-sqlite3 Database 操作
const db = await ctx.resolve(IDatabaseToken);
db.prepare(`INSERT INTO ${tableName} ...`).run(...);
```

---

## 5. 构建与打包

### 构建命令

```bash
# 在插件项目根目录运行
npx @openlearn/plugin-sdk build

# Watch 模式（文件变动自动重新构建）
npx @openlearn/plugin-sdk build --watch
```

### 构建流程

CLI `build` 命令自动完成以下步骤：

1. **验证** — 检查 `src/index.ts` 是否存在
2. **esbuild 打包** — 将 `src/index.ts` 打包为 `dist/index.js`
   - `@openlearn/plugin-sdk` 作为 external（运行时由宿主提供）
   - 其他依赖打包进产物
3. **前端打包**（可选）— 将 `src/frontend.tsx` 打包为 `dist/frontend.js`
   - `react`、`react-dom`、`recharts`、`lucide-react` 作为 external（宿主提供）
4. **manifest 提取** — 从构建产物或 `manifest.json` 提取 manifest
5. **ZIP 打包** — 将 `index.js` + `manifest.json` + `frontend.js`（可选）打包为 ZIP

产物输出：
```
dist/
├── index.js          # 服务端 bundle
├── frontend.js       # 前端 bundle（如有）
└── my-plugin.zip     # 可直接上传到插件中心
```

### 手动 manifest.json

如果需要在 ZIP 中包含自定义的 manifest，在项目根目录创建 `manifest.json`：

```json
{
  "id": "@yourname/my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "...",
  "author": "...",
  "requires": ["..."],
  "capabilitiesProposed": ["..."],
  "classroomTools": [{ "id": "...", "name": "...", "icon": "...", "commandType": "..." }]
}
```

CLI build 会优先使用此文件，而不是从构建产物中提取。

---

## 6. 安装与调试

### 在 OpenLearn 中安装

1. 打开 OpenLearn 管理后台
2. 进入「系统设置」→「插件中心」
3. 选择「上传插件」，上传 `my-plugin.zip`
4. 在插件列表中找到你的插件，点击激活
5. 如果插件声明了 `classroomTools`，进入白板后可在工具栏看到

### 调试技巧

**查看日志：**
服务端 `console.log` 输出会显示在 OpenLearn 服务器日志中（带 `[Plugin:<id>]` 前缀）。

**查看事件：**
```sql
SELECT * FROM events WHERE type LIKE 'myplugin.%' ORDER BY created_at DESC;
```

**重新激活：**
修改代码后，重新构建 ZIP，在插件中心点击「更新」上传新版本。

### 测试

使用 `@openlearn/plugin-test-kit` 进行单元测试：

```bash
npm install --save-dev @openlearn/plugin-test-kit vitest
```

```typescript
// __tests__/index.test.ts
import { describe, it, expect } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';
import plugin from '../src/index';

describe('my-plugin', () => {
  it('should activate and register handler', async () => {
    const ctx = createMockContext();
    await plugin.activate(ctx);

    const handlers = ctx.services.commandBus._getHandlers();
    expect(handlers).toContain('myplugin.hello');
  });
});
```

---

## 7. 发布到 npm

如果希望你的插件能被其他开发者通过 npm 安装和二次开发：

```bash
# 确保 package.json 中 "private" 已移除或设为 false
npm publish --access public
```

其他开发者可以：

```bash
npm install openlearn-plugin-my-tool
```

---

## 8. CLI 命令参考

### init — 脚手架创建

```
npx @openlearn/plugin-sdk init [options]
```

**选项：**

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--name <name>` | 插件包名（kebab-case） | （交互式输入） |
| `--description <desc>` | 插件描述 | `"{name} plugin"` |
| `--author <author>` | 作者名 | `"OpenLearn Developer"` |
| `--template <tpl>` | 模板类型 | `server-only` |

**模板类型：** `server-only` | `full-stack` | `frontend-only`

**非交互式示例：**

```bash
npx @openlearn/plugin-sdk init \
  --name class-polls \
  --description "Classroom polling tool" \
  --author "teacher-wang" \
  --template full-stack
```

### build — 构建打包

```
npx @openlearn/plugin-sdk build [options]
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--watch`, `-w` | 监听文件变更，自动重新构建 |

**行为：**

- 必须在插件项目根目录运行（需存在 `package.json` 和 `src/index.ts`）
- 构建产物输出到 `dist/` 目录
- ZIP 文件同时输出到 `dist/` 和项目根目录

---

## 9. 常见问题

### Q: 构建报错 "esbuild not found"

`@openlearn/plugin-sdk` 的 `dependencies` 中已包含 esbuild，但如果你使用 `--template` 生成的旧项目，请手动安装：

```bash
npm install --save-dev esbuild jszip
```

### Q: 前端组件中的 React hooks 不工作？

确认 `package.json` 中有 `"peerDependencies": { "react": ">=17" }`，且 build 命令会自动将 react 作为 external。不要在前端组件中打包 React。

### Q: 如何让 AI Agent 发现我的插件功能？

在 `activate()` 中调用 `actionRegistry.register()`。AI Agent 会自动从 `ActionRegistry` 获取所有注册的工具。`description` 是 AI 理解工具用途的关键，**用中文写清楚**。

### Q: 插件间如何通信？

通过事件总线：插件 A 发布事件，插件 B 订阅事件。事件命名规则：`{pluginId}.{action}_done`（过去式）。

### Q: 我的插件需要访问文件系统？

使用 VFS（虚拟文件系统）插件提供的 API，而不是直接使用 `fs` 模块。在 manifest 中声明 `vfs:read` / `vfs:write` 权限。

### Q: 数据库表如何命名？

使用 `ctx.db.ensureTable()` 和 `ctx.db.table()`，系统会自动添加 `plugin_{pluginId}_` 前缀。不要手动拼接表名。

### Q: 上传 ZIP 报错 `Import of "crypto" is not allowed` ⚠️

**这是最常见的打包错误。** OpenLearn 在接收 ZIP 后会用 `openlearn-token-enforcer` 对产物 `index.js` 进行安全扫描，**只允许相对路径导入和 `@openlearn/*` Token 服务**，所有 Node.js 内置模块（`crypto`、`fs`、`path`）和第三方 npm 包的裸 specifier 导入都会被拒绝。

**原因**：构建脚本（如 `esbuild`）在打包时没有把这些模块 inline 进 `index.js`，而是保留了裸导入语句。

**最常见修复（`crypto.randomUUID`）：**

```typescript
// ❌ 错误 — 保留了 Node.js 裸导入
import { randomUUID } from 'crypto';

// ✅ 正确 — 使用全局 Web Crypto API（Node.js 20+ 和浏览器均内置，无需任何 import）
const id = crypto.randomUUID();
```

**上传前自检：**

```bash
# 检查 dist/index.js 中是否有不在白名单内的裸导入
grep -E '^import .+ from "[^@\./]' dist/index.js
# 有输出 = 有问题；无输出 = 通过
```

完整替换方案见 [插件开发完全指南 §10.4](./plugin-development-tutorial.md)。

---

> 本文档基于 OpenLearnV2 plugin-sdk v3.2.0 CLI 工具。
> 完整 API 参考见 [插件开发完全指南](./plugin-development-tutorial.md)。
