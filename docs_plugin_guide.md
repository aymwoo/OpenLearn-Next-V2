# OpenLearn 插件开发指南

欢迎来到 OpenLearn 插件开发中心。本指南将带你从零开始，创建一个功能完整的 OpenLearn 插件。

> **平台架构参考：** [doc: plugin-development-tutorial.md]
> **脚手架工具：** [doc: docs/scaffold.md]

---

## 1. 快速开始：3 分钟创建插件

使用 `@openlearn/plugin-sdk` CLI 脚手架，三分钟生成完整项目骨架：

```bash
# 创建插件项目
npx @openlearn/plugin-sdk init --name hello-world

# 进入项目
cd hello-world

# 安装依赖
npm install

# 构建 ZIP 包
npx @openlearn/plugin-sdk build

# 产物：hello-world.zip → 上传到 OpenLearn 插件中心
```

**三种模板：**

| 模板 | 说明 | 包含 |
|------|------|------|
| `server-only` | 纯后端插件 | AI 工具 + 命令 + 事件 |
| `full-stack` | 全栈插件 | 后端 + React 前端组件 |
| `frontend-only` | 纯前端插件 | React UI 扩展 |

**交互式创建：**

```bash
npx @openlearn/plugin-sdk init
```

CLI 会逐步询问插件名称、描述、作者和模板类型。

---

## 2. 项目结构

```
my-plugin/
├── package.json          # 插件元信息和依赖
├── tsconfig.json         # TypeScript 配置
├── src/
│   ├── index.ts          # ★ 服务端入口
│   │                     # export default { manifest, activate, deactivate? }
│   └── frontend.tsx      # ★ 前端组件（full-stack / frontend-only）
│                         # export default function MyComponent() { }
└── dist/                 # 构建产物（build 命令自动生成）
    ├── index.js          # 打包后的服务端代码
    ├── frontend.js       # 打包后的前端代码（如有）
    └── my-plugin.zip     # 最终发布包
```

---

## 3. 插件入口详解

### 3.1 服务端入口 `src/index.ts`

插件是一个 ESM 模块，必须 default export 一个对象：

```typescript
import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
} from '@openlearn/plugin-sdk';

export default {
  // ── Manifest: 插件的身份信息 ──
  manifest: {
    id: '@yourname/my-plugin',          // 全局唯一 ID
    name: '我的插件',                    // 显示名称
    version: '0.1.0',
    description: '插件功能描述',
    author: '你的名字',
    requires: [                          // 依赖的服务（SemVer）
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: [              // 申请的权限
      'lesson:read',
      'lesson:write',
    ],
    // 前端课堂工具声明（可选）
    classroomTools: [{
      id: 'my-tool',
      name: '我的工具',
      icon: 'Puzzle',                    // lucide-react 图标名
      commandType: 'myplugin.open_tool',
    }],
    engines: { openlearn: '>=5.0.0' },
  },

  // ── Activate: 插件激活时执行 ──
  async activate(ctx: PluginContext) {
    // ctx 披露了所有可用的服务接口
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;

    // 注册 AI 工具，让 AI Agent 可以发现和调用
    await actionRegistry.register({
      id: 'myplugin-hello',
      commandType: 'myplugin.hello',
      description: '向指定的人打招呼，返回问候语。',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '姓名' },
        },
        required: ['name'],
      },
    });

    // 注册命令处理器，执行具体的业务逻辑
    await commandBus.registerHandler('myplugin.hello', {
      async execute(command) {
        const payload = command.payload as any;
        const message = `Hello, ${payload.name}!`;

        // 发布事件通知其他系统
        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'myplugin.hello_executed',   // 过去式命名
          source: 'plugin.myplugin',
          payload: { message },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { message };
      },
    });

    ctx.log.info('插件已激活');
  },

  // ── Deactivate: 插件停用时执行（可选） ──
  async deactivate() {
    console.log('插件已停用');
  },
};
```

### 3.2 前端入口 `src/frontend.tsx`

前端组件是一个 React 组件，在宿主 OpenLearn 应用中渲染：

```typescript
import React, { useState } from 'react';

export default function MyPluginUI() {
  const [data, setData] = useState<string[]>([]);

  return (
    <div style={{ padding: 16 }}>
      <h2>我的插件</h2>
      <p>欢迎使用 OpenLearn 插件系统</p>
      {data.map((item, i) => (
        <div key={i}>{item}</div>
      ))}
    </div>
  );
}
```

**重要提示：** 构建时 `react`、`react-dom`、`recharts`、`lucide-react` 不会被打包进插件。这些库由宿主应用通过 `window.HostSharedDeps` 提供，CLI `build` 命令自动处理外部化。

---

## 4. 核心概念

### 4.1 命令-事件-Action 三件套

每个业务功能由三个部分组成：

```
       AI Agent 调用
            │
    ┌───────▼────────┐
    │  Action 注册     │  ← actionRegistry.register()
    │  (工具描述+参数)  │     告诉 AI 这个工具能做什么
    └───────┬────────┘
            │
    ┌───────▼────────┐
    │  Command 处理    │  ← commandBus.registerHandler()
    │  (业务逻辑)       │     执行实际的业务代码
    └───────┬────────┘
            │
    ┌───────▼────────┐
    │  Event 发布     │  ← eventBus.publish()
    │  (通知其他系统)   │     广播执行结果
    └────────────────┘
```

### 4.2 权限体系

OpenLearn 使用字符串 RBAC 进行权限控制：

```
格式: {资源}:{操作}

示例:
  lesson:read        — 读取课程
  lesson:write       — 创建/编辑课程
  whiteboard:read    — 读取白板
  vfs:read           — 读取虚拟文件系统
  process:write      — 创建后台进程

通配符: lesson:* 匹配所有课程操作
```

### 4.3 插件数据库

每个插件有独立的命名空间，互不干扰：

```typescript
// 创建表
await ctx.db.ensureTable('polls', `
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  options TEXT NOT NULL
`);

// 获取带命名空间的表名（如 plugin_@yourname_my-plugin_polls）
const tableName = ctx.db.table('polls');

// 通过 DI 获取 raw better-sqlite3 Database
const db = await ctx.resolve(IDatabaseToken);
db.prepare(`INSERT INTO ${tableName} ...`).run(...);
```

### 4.4 Action 注册最佳实践

**inputSchema 格式** — 必须遵循 Google GenAI `functionDeclarations` 规范：

```typescript
inputSchema: {
  type: 'OBJECT',
  properties: {
    stringParam: { type: 'STRING', description: '字符串参数说明' },
    numberParam: { type: 'NUMBER', description: '数值参数说明' },
    boolParam:   { type: 'BOOLEAN', description: '布尔参数说明' },
    arrayParam:  { type: 'ARRAY', items: { type: 'STRING' }, description: '数组参数说明' },
  },
  required: ['stringParam'],
}
```

**description** — 是 AI 理解工具功能的唯一途径，**必须用中文清楚描述**：
- 说明工具的用途和使用场景
- 简要描述每个参数的含义
- 说明返回值的格式

**isHighRisk** — 设为 `true` 时，AI 调用此工具需要教师审批：

```typescript
{
  id: 'lesson-delete',
  commandType: 'lesson.delete',
  description: '删除整个课程及其所有内容。高风险操作。',
  capabilityRequired: 'lesson:delete',
  isHighRisk: true,  // ← 需要教师审批
  inputSchema: { ... },
}
```

---

## 5. 前端开发

### 5.1 可用的 UI 扩展槽位

通过 `classroomTools` 声明课堂工具，或通过 `contributes` 声明更丰富的 UI 扩展：

| 槽位 | 用途 |
|------|------|
| `classroom.tool` | 课堂工具（白板工具栏按钮） |
| `teacher.tab` | 教师标签页 |
| `teacher.dashboard.widget` | 教师仪表盘部件 |
| `student.view` | 学生视图 |
| `student.lesson.tool` | 学生学习工具 |
| `global.setting` | 全局设置页扩展 |

### 5.2 宿主共享依赖

前端插件无需自己打包 React 生态库。宿主通过 `window.HostSharedDeps` 暴露：

```javascript
// 构建时自动外部化，无需手动处理
window.HostSharedDeps = {
  React:       // react
  ReactDOM:    // react-dom
  Recharts:    // recharts
  LucideReact: // lucide-react
};
```

如果你的插件需要其他共享库，通过 `ctx.require()` 引用：

```typescript
const pdf = ctx.require('jspdf');
const xlsx = ctx.require('xlsx');
const uuidLib = ctx.require('uuid');
```

---

## 6. 构建与调试

### 6.1 构建命令

```bash
# 生产构建
npx @openlearn/plugin-sdk build

# Watch 模式（文件变动自动重新构建）
npx @openlearn/plugin-sdk build --watch
```

构建流程：
1. 验证 `src/index.ts` 存在
2. esbuild 打包服务端代码（`@openlearn/plugin-sdk` 外部化）
3. 如果有 `src/frontend.tsx`，esbuild 打包前端（react 等外部化）
4. 从构建产物提取 `manifest`，生成 `manifest.json`
5. 打包为 ZIP：`index.js` + `manifest.json` + `frontend.js`（可选）

### 6.2 自定义 manifest

若需手动指定 manifest，在项目根目录创建 `manifest.json`：

```json
{
  "id": "@yourname/my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "requires": ["@openlearn/core:ICommandBusService@^1.0.0"],
  "capabilitiesProposed": ["lesson:read"]
}
```

CLI `build` 会优先使用此文件。

### 6.3 安装到 OpenLearn

1. 打开 OpenLearn → 系统设置 → 插件中心
2. 点击「上传插件」，选择 `my-plugin.zip`
3. 在插件列表中找到你的插件，点击「激活」
4. 插件声明了 `classroomTools` 时，白板工具栏会出现相应按钮

### 6.4 调试技巧

**查看服务端日志：** 插件的 `console.log` 输出会带 `[Plugin:<id>]` 前缀出现在服务器日志中。

**查看事件审计：**
```sql
SELECT * FROM events WHERE type LIKE 'myplugin.%' ORDER BY created_at DESC;
```

**重新部署：** 修改代码后重新构建 ZIP，在插件中心点「更新」上传新版本，系统自动重新激活。

---

## 7. 可用服务接口

在 `activate(ctx)` 中，通过 `ctx.services` 可访问 7 个内核服务：

| 服务 | API | 用途 |
|------|-----|------|
| **CommandBus** | `ctx.services.commandBus` | 注册/执行命令 |
| **EventBus** | `ctx.services.eventBus` | 发布/订阅事件 |
| **ActionRegistry** | `ctx.services.actionRegistry` | 注册 AI 工具 |
| **Capability** | `ctx.services.capability` | 权限管理 |
| **Process** | `ctx.services.processManager` | 后台进程/定时任务 |
| **Storage** | `ctx.services.storage` | K-V 键值存储 |
| **AI** | `ctx.services.ai` | 文本生成 |

**通过 DI 解析更多服务：**

```typescript
import { IDatabaseToken } from '@openlearn/plugin-sdk';
const db = await ctx.resolve(IDatabaseToken);
```

**完整 DI Token 列表：**

| Token | 返回类型 | 说明 |
|-------|---------|------|
| `ICommandBusServiceToken` | `ICommandBusService` | 命令总线 |
| `IEventBusServiceToken` | `IEventBusService` | 事件总线 |
| `IActionRegistryServiceToken` | `IActionRegistryService` | AI 工具注册表 |
| `ICapabilityServiceToken` | `ICapabilityService` | 权限守卫 |
| `IProcessServiceToken` | `IProcessService` | 进程管理 |
| `IStorageServiceToken` | `IStorageService` | K-V 存储 |
| `IAIServiceToken` | `IAIService` | AI 文本生成 |
| `IDatabaseToken` | `Database` | 直接 SQLite 访问 |
| `IPluginHostToken` | `PluginHost` | 插件主机管理 |

---

## 8. 进阶主题

### 8.1 后台任务

长时间运行的任务通过 `ProcessManager` 调度：

```typescript
// 注册任务处理器
await ctx.services.processManager.registerHandler('my_task', async (
  processId, payload, state, log, updateState
) => {
  log('开始处理...');
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 100));
    updateState({ progress: i / 100 });
  }
  log('处理完成');
});

// 启动任务
const pid = await ctx.services.processManager.spawn(
  '我的任务',
  'my_task',
  { input: 'data' }
);
```

### 8.2 事件订阅

插件可以监听其他插件的事件：

```typescript
await ctx.services.eventBus.subscribe('lesson.created', (event) => {
  console.log('新课程创建了:', event.payload);
  // 执行跨插件逻辑
});
```

### 8.3 Worker Thread 执行

生产环境中，插件可在独立 Worker Thread 中运行，崩溃不影响主进程：

```sql
UPDATE plugins SET execution_mode = 'worker' WHERE id = 'your-plugin-id';
```

### 8.4 测试

使用 `@openlearn/plugin-test-kit` 编写单元测试：

```bash
npm install --save-dev @openlearn/plugin-test-kit vitest
```

```typescript
import { describe, it, expect } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';
import plugin from '../src/index';

describe('my-plugin', () => {
  it('registers handler on activate', async () => {
    const ctx = createMockContext();
    await plugin.activate(ctx);
    expect(ctx.services.commandBus._getHandlers()).toContain('myplugin.hello');
  });
});
```

---

## 9. 发布与分发

插件以 ZIP 格式分发。构建完成后，通过以下方式发布：

- **插件中心上传** — `my-plugin.zip` 直接上传到 OpenLearn 插件中心
- **npm 发布** — `npm publish --access public` 发布为 npm 包（其他开发者可以 fork 和二次开发）

---

## 参考资源

- [插件开发完全指南](docs/plugin-development-tutorial.md) — 架构原理、安全模型、内置插件参考
- [脚手架开发指南](docs/scaffold.md) — CLI 命令参考、模板详解、常见问题
- [插件 SDK 类型定义](packages/plugin-sdk/openlearn.d.ts) — 完整 TypeScript 类型声明
- [test-kit 使用文档](packages/plugin-test-kit/README.md) — 测试工具用法

---

> OpenLearn Plugin SDK v3.2.0
> 最后更新：2026-07-13
