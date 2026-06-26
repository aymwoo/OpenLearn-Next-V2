# OpenLearnV2 插件开发完全指南

## 目录

1. [系统架构概述](#1-系统架构概述)
2. [开发原理](#2-开发原理)
3. [插件结构详解](#3-插件结构详解)
4. [手把手实例项目](#4-手把手实例项目)
5. [API 及接口文档](#5-api-及接口文档)
6. [前端插件系统](#6-前端插件系统)
7. [安全与权限](#7-安全与权限)
8. [高级特性](#8-高级特性)
9. [测试与调试](#9-测试与调试)
10. [发布与分发](#10-发布与分发)

---

## 1. 系统架构概述

### 1.1 设计理念

OpenLearnV2 采用 **插件驱动的命令-事件总线架构**（Plugin-Driven Command-Event Bus）。灵感来源于操作系统内核设计：一个精简的核心内核提供基础能力，所有业务功能通过插件实现。

```
┌──────────────────────────────────────────────────────────────┐
│                      OpenLearnV2 OS                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   AI Agent (Shell)                    │   │
│  │          Gemini / OpenAI 兼容模型作为智能控制器        │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │ 自然语言 → functionCall             │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │                  Command Bus (内核管线)               │   │
│  │    interceptor → capability check → high-risk gate    │   │
│  └──┬──────────┬──────────┬──────────┬──────────┬───────┘   │
│     │          │          │          │          │            │
│  ┌──▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──────┐      │
│  │内置  │  │ VFS  │  │管理  │  │ AI   │  │第三方插件 │      │
│  │插件  │  │插件  │  │插件  │  │规划器│  │ (Plugin)  │      │
│  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘  └────┬──────┘      │
│     │        │        │        │            │              │
│  ┌──▼────────▼────────▼────────▼────────────▼──────┐      │
│  │                   Event Bus                      │      │
│  │        所有事件写入 SQLite 审计日志               │      │
│  └──────────────────────┬───────────────────────────┘      │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────┐      │
│  │              SQLite Database (30+ 表)              │      │
│  └───────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 核心子系统

| 子系统 | 文件 | 职责 |
|--------|------|------|
| **Kernel** | `packages/core/kernel/index.ts` | 全局单例容器，组装所有子系统 |
| **CommandBus** | `packages/core/command-bus/index.ts` | 命令执行管线：注册 handler → 拦截器链 → 执行 |
| **EventBus** | `packages/core/event-bus/index.ts` | 发布/订阅事件，支持通配符 `*` |
| **ActionRegistry** | `packages/core/registry/index.ts` | 注册 AI Agent 可发现的工具 |
| **CapabilityGuard** | `packages/core/capability-system/index.ts` | 基于字符串的 RBAC 权限控制 |
| **ProcessManager** | `packages/core/process-manager/index.ts` | 后台进程和定时任务管理 |
| **PluginHost** | `packages/core/plugin-host/index.ts` | 插件生命周期管理：安装/激活/停用/卸载/热重载 |
| **ServiceRegistry** | `packages/core/di/service-registry.ts` | 依赖注入容器，Token 驱动 |

### 1.3 数据流

```
用户发送消息 → POST /api/agent/chat
  → AI 模型返回 functionCall（如 lesson.create）
  → executeAgentToolCall() 通过 ActionRegistry 查找对应 action
  → CommandBus.execute() 执行拦截器管线
    → CapabilityGuard 权限检查
    → 高危操作 → 写入审批网关（pending_commands 表）
  → Handler 执行业务逻辑
  → EventBus.publish() 发布事件
  → Socket.IO 推送给在线客户端
```

---

## 2. 开发原理

### 2.1 插件即 ESM 模块

插件是一个导出了 `manifest` 和 `activate` 函数的 JavaScript/TypeScript 模块：

```typescript
// 插件的最小结构
export default {
  manifest: { ... },
  activate: async (ctx: PluginContext) => { ... },
  deactivate: async () => { ... },  // 可选
};
```

### 2.2 双运行时架构

```
┌─ 服务端（Node.js） ─────────────────────┐
│  PluginHost → inline/worker 执行模式     │
│  • inline: 直接在同一进程中运行          │
│  • worker: 独立 Worker Thread 隔离运行   │
│  • legacy: 旧的 vm 沙箱模式（废弃中）    │
└─────────────────────────────────────────┘

┌─ 前端（浏览器） ────────────────────────┐
│  FrontendPluginHost → import() 动态加载  │
│  • 扩展点注册（UI 面板/工具/视图）       │
│  • 浏览器 API 服务注入                   │
└─────────────────────────────────────────┘
```

### 2.3 依赖注入

插件通过 **Token** 声明依赖，由 ServiceRegistry 自动解析注入：

```typescript
import {
  ICommandBusServiceToken,
  IDatabaseToken,
} from '../core/di/interfaces.js';

// 在 activate 中解析依赖
const commandBus = await ctx.resolve(ICommandBusServiceToken);
const db = await ctx.resolve(IDatabaseToken);
```

可用的服务 Token 列表见 [§5.2](#52-服务-token-依赖注入)。

### 2.4 生命周期状态机

```
INSTALLED ──→ ACTIVATING ──→ ACTIVE ──→ DEACTIVATING ──→ INACTIVE
                                  │                           │
                                  └──── ERROR ←───────────────┘
                                                        │
INACTIVE ──→ ACTIVATING (重新激活)                      │
ERROR ──→ ACTIVATING (重试)          UNINSTALLED ←──────┘
```

状态说明：

- **INSTALLED**：源码已存入数据库，尚未激活
- **ACTIVATING**：正在执行 `activate()` 函数（瞬态）
- **ACTIVE**：正常运行中
- **INACTIVE**：已停用，可通过 toggle 重新激活
- **ERROR**：激活失败，可重试或卸载
- **UNINSTALLED**：已从数据库删除

---

## 3. 插件结构详解

### 3.1 Manifest 规范

```typescript
interface Manifest {
  id: string;                    // 唯一标识，推荐格式 @scope/name
  name: string;                  // 显示名称
  version: string;               // SemVer 版本号（如 "1.0.0"）
  main?: string;                 // 入口文件名，默认 "index.js"
  description?: string;          // 描述
  author?: string;               // 作者
  requires: string[];            // 依赖的服务 Token（格式 @openlearn/core:TokenName@^1.0.0）
  optional?: string[];           // 可选依赖
  capabilitiesProposed: string[]; // 申请的权限（如 "lesson:write", "vfs:read"）
  classroomTools?: ClassroomTool[]; // 前端课堂工具声明
}

interface ClassroomTool {
  id: string;        // 工具 ID
  name: string;      // 工具名称
  icon: string;      // 图标 emoji 或 lucide icon name
  commandType: string; // 关联的命令类型
  payload?: any;     // 默认 payload
}
```

### 3.2 PluginContext — 插件上下文的完整 API

插件通过 `activate(ctx)` 接收上下文对象，包含以下能力：

```typescript
interface PluginContext {
  // 7 个内核服务接口
  services: {
    commandBus: ICommandBusService;       // 命令总线
    eventBus: IEventBusService;           // 事件总线
    actionRegistry: IActionRegistryService; // Action 注册表
    capability: ICapabilityService;       // 权限管理
    processManager: IProcessService;       // 后台进程
    storage: IStorageService;             // Key-Value 存储
    ai: IAIService;                       // AI 文本生成
  };

  pluginId: string;           // 插件 ID（manifest.id）
  manifest: Manifest;         // 插件 manifest

  // 依赖注入：从 ServiceRegistry 解析服务
  resolve<T>(token: Token<T>): Promise<T>;

  // 插件专用数据库 API（v5.1）：命名空间隔离的 SQLite 操作
  db: {
    ensureTable(tableName: string, schema: string): Promise<void>;
    table(tableName: string): string;          // 返回 plugin_{pluginId}_{tableName}
    dropAllTables(): Promise<void>;
  };

  // 引用主应用共享模块（v5.1）
  require(moduleName: string): any;
}
```

### 3.3 命令-事件-Action 三件套

这是插件开发的核心模式。每个业务功能需要三样东西：

#### 3.3.1 Action 注册（AI Agent 可调用）

```typescript
await actionRegistry.register({
  id: 'my-plugin-action',         // 唯一 ID
  commandType: 'myplugin.action',  // 对应的命令类型
  description: '用中文描述此工具的功能和参数',
  capabilityRequired: 'myplugin:write',  // 所需权限
  isHighRisk: false,              // 是否高危（需教师审批）
  inputSchema: {                  // JSON Schema（Google GenAI 格式）
    type: 'OBJECT',
    properties: {
      param1: { type: 'STRING', description: '参数说明' },
      param2: { type: 'NUMBER', description: '参数说明' },
    },
    required: ['param1'],
  },
});
```

#### 3.3.2 Command Handler（业务逻辑）

```typescript
await commandBus.registerHandler('myplugin.action', {
  async execute(command) {
    const payload = command.payload as any;
    const { param1, param2 } = payload;

    // 业务逻辑...
    const result = await doSomething(param1, param2);

    // 发布事件通知其他模块
    await eventBus.publish({
      id: generateId(),
      type: 'myplugin.action_done',    // 过去式命名
      source: 'plugin.myplugin',        // 来源标识
      payload: { param1, result },
      timestamp: Date.now(),
      correlationId: command.id,
    });

    return { success: true, result };
  },
});
```

#### 3.3.3 Event 发布

事件命名规则：**过去式**，点号分隔，如 `lesson.created`、`assignment.graded`。

```typescript
await eventBus.publish({
  id: crypto.randomUUID(),
  type: 'myplugin.action_done',
  source: 'plugin.myplugin',
  payload: { /* 业务数据 */ },
  timestamp: Date.now(),
  correlationId: command.id,  // 关联原始命令
});
```

---

## 4. 手把手实例项目

### 4.1 项目：随堂投票插件

我们将创建一个完整的"随堂投票"插件，教师可以在白板上创建投票，学生提交选票，实时显示结果。

#### 4.1.1 创建数据库表

```typescript
// poll-plugin.ts
export default {
  manifest: {
    id: '@openlearn/plugin-poll',
    name: '随堂投票插件',
    version: '1.0.0',
    main: 'index.js',
    description: '在课堂上创建实时投票，收集学生回答',
    author: 'Your Name',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:IProcessService@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:write', 'poll:write', 'poll:read'],
    classroomTools: [
      {
        id: 'poll-tool',
        name: '📊 投票',
        icon: 'BarChart3',
        commandType: 'poll.create',
        payload: { type: 'single_choice' },
      },
    ],
  },

  activate: async (ctx) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;

    // DI 解析数据库访问
    const { IDatabaseToken } = await import('../core/di/interfaces.js');
    const db = await ctx.resolve(IDatabaseToken);

    // ── 1. 创建投票表 ──
    await ctx.db.ensureTable('polls', `
      id          TEXT PRIMARY KEY,
      lesson_id   TEXT NOT NULL,
      title       TEXT NOT NULL,
      options     TEXT NOT NULL,   -- JSON: ["选项A", "选项B", ...]
      is_active   INTEGER DEFAULT 1,
      created_at  INTEGER NOT NULL
    `);

    await ctx.db.ensureTable('poll_votes', `
      id          TEXT PRIMARY KEY,
      poll_id     TEXT NOT NULL,
      student_id  TEXT NOT NULL,
      choice      TEXT NOT NULL,
      voted_at    INTEGER NOT NULL,
      UNIQUE(poll_id, student_id)
    `);

    const pollsTable = ctx.db.table('polls');
    const votesTable = ctx.db.table('poll_votes');

    // ── 2. Action: 创建投票 ──
    await actionRegistry.register({
      id: 'poll-create',
      commandType: 'poll.create',
      description: '在课程中创建一个随堂投票，教师可选择单选或多选模式',
      capabilityRequired: 'poll:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          title: { type: 'STRING', description: '投票标题/问题' },
          options: { type: 'STRING', description: '选项列表 JSON，如 ["同意","不同意","弃权"]' },
          mode: { type: 'STRING', description: '投票模式：single_choice 或 multiple_choice' },
        },
        required: ['lessonId', 'title', 'options'],
      },
    });

    // ── 3. Handler: 创建投票 ──
    await commandBus.registerHandler('poll.create', {
      async execute(command) {
        const payload = command.payload as any;
        const pollId = crypto.randomUUID();
        const options = typeof payload.options === 'string'
          ? payload.options
          : JSON.stringify(payload.options);

        db.prepare(`INSERT INTO ${pollsTable} (id, lesson_id, title, options, created_at)
                    VALUES (?, ?, ?, ?, ?)`)
          .run(pollId, payload.lessonId, payload.title, options, Date.now());

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'poll.created',
          source: 'plugin.poll',
          payload: { pollId, lessonId: payload.lessonId, title: payload.title },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { pollId, message: `投票「${payload.title}」已创建` };
      },
    });

    // ── 4. Action: 学生投票 ──
    await actionRegistry.register({
      id: 'poll-vote',
      commandType: 'poll.vote',
      description: '学生对投票进行选择',
      capabilityRequired: 'poll:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          pollId: { type: 'STRING', description: '投票 ID' },
          choice: { type: 'STRING', description: '选择的选项文本' },
        },
        required: ['pollId', 'choice'],
      },
    });

    // ── 5. Handler: 学生投票 ──
    await commandBus.registerHandler('poll.vote', {
      async execute(command) {
        const payload = command.payload as any;
        const voteId = crypto.randomUUID();

        db.prepare(`INSERT OR REPLACE INTO ${votesTable}
                    (id, poll_id, student_id, choice, voted_at)
                    VALUES (?, ?, ?, ?, ?)`)
          .run(voteId, payload.pollId, command.actorId, payload.choice, Date.now());

        // 查询实时统计
        const stats = db.prepare(`
          SELECT choice, COUNT(*) as count
          FROM ${votesTable}
          WHERE poll_id = ?
          GROUP BY choice
        `).all(payload.pollId);

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'poll.vote_cast',
          source: 'plugin.poll',
          payload: { pollId: payload.pollId, stats },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { success: true, stats };
      },
    });

    // ── 6. Action: 查询投票结果 ──
    await actionRegistry.register({
      id: 'poll-results',
      commandType: 'poll.get_results',
      description: '查询指定投票的实时统计结果',
      capabilityRequired: 'poll:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          pollId: { type: 'STRING', description: '投票 ID' },
        },
        required: ['pollId'],
      },
    });

    await commandBus.registerHandler('poll.get_results', {
      async execute(command) {
        const payload = command.payload as any;

        const poll = db.prepare(`SELECT * FROM ${pollsTable} WHERE id = ?`)
          .get(payload.pollId) as any;
        if (!poll) throw new Error('投票未找到');

        const stats = db.prepare(`
          SELECT choice, COUNT(*) as count
          FROM ${votesTable}
          WHERE poll_id = ?
          GROUP BY choice
        `).all(payload.pollId);

        return {
          pollId: poll.id,
          title: poll.title,
          options: JSON.parse(poll.options),
          results: stats,
          total: stats.reduce((sum: number, s: any) => sum + s.count, 0),
        };
      },
    });

    // ── 7. Action: 关闭投票 ──
    await actionRegistry.register({
      id: 'poll-close',
      commandType: 'poll.close',
      description: '教师关闭投票，不再接受新选票',
      capabilityRequired: 'poll:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          pollId: { type: 'STRING', description: '投票 ID' },
        },
        required: ['pollId'],
      },
    });

    await commandBus.registerHandler('poll.close', {
      async execute(command) {
        const payload = command.payload as any;
        db.prepare(`UPDATE ${pollsTable} SET is_active = 0 WHERE id = ?`)
          .run(payload.pollId);

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'poll.closed',
          source: 'plugin.poll',
          payload: { pollId: payload.pollId },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { success: true, message: '投票已关闭' };
      },
    });

    console.log('[Poll Plugin] Activated successfully');
  },

  deactivate: async () => {
    // ctx.db.dropAllTables() 由 PluginHost 自动调用
    console.log('[Poll Plugin] Deactivated');
  },
};
```

#### 4.1.2 在系统设置中安装

1. 进入「系统设置」→「插件中心」
2. 将上述代码粘贴到代码编辑器
3. 点击「安装插件」
4. 在插件列表中找到 `@openlearn/plugin-poll`，点击激活

#### 4.1.3 使用 AI Agent 调用

安装后，AI Agent 自动获得以下工具：

```
poll.create   — 创建随堂投票
poll.vote     — 学生投票
poll.get_results — 查询结果
poll.close    — 关闭投票
```

教师可以直接对 AI 说：**"在今天的物理课上创建一个投票，问题是'光速是否为宇宙中最快的速度？'，选项为：是、否、不确定"**

---

## 5. API 及接口文档

### 5.1 命令定义

```typescript
interface PlatformCommand<T = unknown> {
  id: string;           // UUID v7
  type: string;         // 命令类型，点号分隔如 "lesson.create"
  actorId: string;      // 操作者 ID
  payload: T;           // 命令载荷
  timestamp: number;    // Unix 毫秒时间戳
  metadata?: {
    correlationId?: string;     // 关联 ID
    agentDelegated?: boolean;   // 是否由 AI Agent 代理
    undoable?: boolean;         // 是否可撤销
    [key: string]: unknown;
  };
}
```

### 5.2 服务 Token（依赖注入）

| Token 常量 | 标识符 | 返回类型 | 用途 |
|-----------|--------|---------|------|
| `ICommandBusServiceToken` | `@openlearn/core:ICommandBusService` | `ICommandBusService` | 命令执行、注册 |
| `IEventBusServiceToken` | `@openlearn/core:IEventBusService` | `IEventBusService` | 事件发布/订阅 |
| `IActionRegistryServiceToken` | `@openlearn/core:IActionRegistryService` | `IActionRegistryService` | AI 工具注册 |
| `ICapabilityServiceToken` | `@openlearn/core:ICapabilityService` | `ICapabilityService` | 权限管理 |
| `IProcessServiceToken` | `@openlearn/core:IProcessService` | `IProcessService` | 后台进程 |
| `IStorageServiceToken` | `@openlearn/core:IStorageService` | `IStorageService` | K-V 存储 |
| `IAIServiceToken` | `@openlearn/core:IAIService` | `IAIService` | AI 文本生成 |
| `IDatabaseToken` | `@openlearn/core:IDatabase` | `Database` (better-sqlite3) | 直接 SQL 访问 |
| `IPluginHostToken` | `@openlearn/core:IPluginHost` | `PluginHost` | 插件主机管理 |

在 `manifest.requires` 中使用格式：`@openlearn/core:TokenName@^1.0.0`

在代码中解析：
```typescript
import { IDatabaseToken } from '../core/di/interfaces.js';
const db = await ctx.resolve(IDatabaseToken);
```

### 5.3 ICommandBusService

```typescript
interface ICommandBusService {
  execute<T>(command: PlatformCommand<T>): Promise<unknown>;
  registerHandler(commandType: string, handler: { execute(cmd: PlatformCommand): Promise<any> }): Promise<void>;
  unregisterHandler(commandType: string): Promise<void>;
  createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): Promise<PlatformCommand<T>>;
  setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): Promise<void>;
}
```

### 5.4 IEventBusService

```typescript
interface IEventBusService {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: string, subscriber: (event: PlatformEvent) => void | Promise<void>): Promise<void>;
  unsubscribe(eventType: string, subscriber: (event: PlatformEvent) => void | Promise<void>): Promise<void>;
}
```

**重要**: `subscribe('*', handler)` 可订阅所有事件。事件订阅器在插件 deactivate 时由 ResourceTracker 自动取消。

### 5.5 IActionRegistryService

```typescript
interface ActionDescriptor {
  id: string;                // 唯一 ID
  commandType: string;        // 对应命令类型
  description: string;        // 对 AI Agent 的功能描述（中文）
  inputSchema: any;           // JSON Schema（Google GenAI 格式）
  capabilityRequired: string; // 所需权限
  isHighRisk?: boolean;       // 高危操作需审批
}

interface IActionRegistryService {
  register(descriptor: ActionDescriptor): Promise<void>;
  unregister(id: string): Promise<void>;
  getAllActions(): Promise<ActionDescriptor[]>;
  getAgentTools(): Promise<unknown[]>;
  getActionByToolName(toolName: string): Promise<ActionDescriptor | undefined>;
  getActionByCommandType(commandType: string): Promise<ActionDescriptor | undefined>;
}
```

### 5.6 inputSchema 格式规范

遵循 Google GenAI `functionDeclarations` 格式：

```typescript
{
  type: 'OBJECT',
  properties: {
    stringParam:  { type: 'STRING',  description: '字符串参数说明' },
    numberParam:  { type: 'NUMBER',  description: '数值参数说明' },
    boolParam:    { type: 'BOOLEAN', description: '布尔参数说明' },
    arrayParam:   { type: 'ARRAY',   description: '数组参数说明',
                    items: { type: 'STRING' } },
  },
  required: ['stringParam'],  // 必填参数
}
```

### 5.7 IAIService

```typescript
interface IAIService {
  generateText(
    prompt: string,
    options?: {
      systemInstruction?: string;   // 系统指令
      temperature?: number;         // 温度 (0-1)
    },
  ): Promise<string>;
}
```

使用示例：
```typescript
const summary = await ctx.services.ai.generateText(
  `请分析以下学生作业并给出评分：\n${homework}`,
  {
    systemInstruction: '你是一位教学助手，请用中文回复。',
    temperature: 0.3,
  }
);
```

### 5.8 IStorageService

```typescript
interface IStorageService {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
```

底层使用 SQLite `plugin_storage` 表，自动按插件 namespace 隔离。

### 5.9 PluginDatabaseAPI（v5.1）

```typescript
interface PluginDatabaseAPI {
  ensureTable(tableName: string, schema: string): Promise<void>;
  table(tableName: string): string;     // 返回完整表名
  dropAllTables(): Promise<void>;
}
```

示例：`ctx.db.table('polls')` 返回 `plugin_@openlearn/plugin-poll_polls`。

### 5.10 共享模块 require（v5.1）

插件可通过 `ctx.require()` 引用白名单中的 npm 包，无需自行打包：

```typescript
const recharts = ctx.require('recharts');
const pdf = ctx.require('jspdf');
const markdown = ctx.require('react-markdown');
const xlsx = ctx.require('xlsx');
const icons = ctx.require('lucide-react');
const uuid = ctx.require('uuid');
```

### 5.11 权限字符串规范

```
格式: {resource}:{action}
示例:
  lesson:read        — 读取课程
  lesson:write       — 创建/编辑课程
  lesson:delete      — 删除课程
  whiteboard:read    — 读取白板
  whiteboard:write   — 编辑白板
  vfs:read           — 读取虚拟文件系统
  vfs:write          — 写入虚拟文件系统
  process:write      — 创建后台进程
  assignment:write   — 编辑作业
  management:read    — 读取管理数据
  management:write   — 写入管理数据

通配符: lesson:* 匹配 lesson:read, lesson:write, lesson:delete
```

---

## 6. 前端插件系统

### 6.1 FrontendPluginHost

前端插件运行在浏览器中，通过动态 `import()` 加载 ESM 模块：

```typescript
// 前端插件结构
export default {
  manifest: {
    id: '@scope/frontend-plugin',
    name: '前端插件',
    version: '1.0.0',
    author: 'Author',
    capabilitiesProposed: [],
    classroomTools: [
      {
        id: 'my-tool',
        name: '🔧 我的工具',
        icon: 'Wrench',
        commandType: 'myplugin.tool_action',
        payload: {},
      },
    ],
  },

  activate: async (ctx: FrontendPluginContext) => {
    // ctx.services.frontendApi   — HTTP API 调用
    // ctx.services.socketService  — WebSocket 通信
    // ctx.services.uiService      — Toast/Modal UI
    // ctx.services.storageService  — localStorage
    // ctx.ui.registerExtensionPoint() — 注册 UI 扩展

    ctx.ui.registerExtensionPoint('teacher.tab', {
      id: 'my-tab',
      label: '我的面板',
      icon: 'Layout',
      component: () => import('./MyPanel'),
      position: 10,
      pluginId: ctx.pluginId,
    });
  },
};
```

### 6.2 前端服务接口

```typescript
interface IFrontendAPI {
  get<T>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
  post<T>(path: string, body?: any): Promise<{ success: boolean; result?: T; error?: string }>;
  del<T>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
}

interface ISocketService {
  emit(event: string, ...args: any[]): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  disconnect(): void;
}

interface IUIService {
  showToast(title: string, message: string, type: 'info' | 'success' | 'warning'): void;
  showModal(title: string, content: React.ReactNode): void;
  closeModal(): void;
  downloadFile(data: Blob | string, filename: string, mimeType?: string): void;
}
```

### 6.3 可用的 UI 扩展槽位

| Slot | 用途 |
|------|------|
| `teacher.tab` | 教师标签页 |
| `teacher.panel` | 教师独立管理面板（v5.1） |
| `teacher.dashboard.widget` | 教师仪表盘小部件 |
| `student.view` | 学生视图 |
| `student.fullscreen` | 学生全屏视图（v5.1） |
| `student.lesson.tool` | 学生学习工具 |
| `classroom.tool` | 课堂工具 |
| `global.setting` | 全局设置页扩展（v5.1） |

---

## 7. 安全与权限

### 7.1 高危操作审批

设置 `isHighRisk: true` 的 Action，AI Agent 执行时会进入审批流程：

```typescript
await actionRegistry.register({
  id: 'dangerous-op',
  commandType: 'lesson.delete',
  description: '删除课程。高风险操作。',
  capabilityRequired: 'lesson:delete',
  isHighRisk: true,  // ← 需要教师审批
  inputSchema: { ... },
});
```

执行流程：
1. AI Agent 调用此工具
2. 命令被写入 `pending_commands` 审批表
3. 教师收到审批通知
4. 教师可选择批准、拒绝或修改参数
5. 批准后才实际执行

**注意**：`administrator` 角色执行时自动绕过高危审批。

### 7.2 权限模型

- 插件通过 `capabilitiesProposed` 声明所需权限
- 教师/管理员在安装时可审查权限
- 运行时通过 CapabilityGuard 拦截检查
- 支持通配符匹配（如 `lesson:*` 匹配所有课程操作）

---

## 8. 高级特性

### 8.1 Worker Thread 隔离模式

在生产环境中，插件可在独立 Worker Thread 中运行：

```typescript
// 数据库设置 execution_mode
db.prepare("UPDATE plugins SET execution_mode = 'worker' WHERE id = ?").run(pluginId);
```

Worker 模式的特点：
- 独立线程隔离，崩溃不影响主进程
- 通过 RPC 代理访问内核服务
- 10 秒激活超时
- 崩溃后自动清理

### 8.2 热重载（开发模式）

在 `NODE_ENV=development` 时，PluginHost 自动启用文件监听：

1. 修改插件源文件
2. PluginHost 检测文件变更（debounce 300ms）
3. 自动停用旧版本 → 激活新版本
4. 无需重启服务器

### 8.3 异步后台任务

```typescript
// 注册任务处理器
await processManager.registerHandler('my_task_type', async (
  processId, payload, state, log, updateState
) => {
  log('任务开始...');
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    updateState({ progress: i / 10 });
    log(`进度: ${i * 10}%`);
  }
  log('任务完成');
});

// 启动任务
const processId = await processManager.spawn(
  '我的后台任务',
  'my_task_type',
  { input: 'some data' }
);

// 进程事件
eventBus.subscribe('process.completed', (event) => {
  console.log('任务完成:', event.payload.processId);
});
```

### 8.4 生命周期中间件

PluginHost 支持在生命周期各阶段插入中间件（洋葱模型）：

```typescript
pluginHost.registerMiddleware('beforeActivate', async (ctx, next) => {
  console.log(`[Auth] 检查插件 ${ctx.pluginId} 的激活权限`);
  await next();  // 继续执行
});
```

可用阶段：`beforeActivate`、`afterActivate`、`beforeDeactivate`、`afterDeactivate`、`beforeCommand`、`afterCommand`。

---

## 9. 测试与调试

### 9.1 日志输出

插件激活时日志自动带 `[Plugin:<id>]` 前缀：

```typescript
console.log('[MyPlugin] 初始化完成');
console.error('[MyPlugin] 数据库连接失败:', error);
```

### 9.2 查看进程状态

```bash
# 查看插件列表
curl http://localhost:9000/api/plugins

# 查看后台进程
# 在应用 UI：系统设置 → 进程管理
```

### 9.3 事件审计

所有事件自动写入 SQLite `events` 表：

```sql
SELECT * FROM events WHERE type LIKE 'poll.%' ORDER BY created_at DESC;
```

---

## 10. 发布与分发

### 10.1 打包为 ZIP

插件源码可以打包为 ZIP 文件分发：

```bash
# 插件目录结构
my-plugin/
  index.js          # 入口（export default { manifest, activate }）
  package.json      # 可选：声明依赖
  README.md         # 文档

# 打包
zip -r my-plugin.zip my-plugin/
```

### 10.2 安装 ZIP 插件

在「系统设置」→「插件中心」上传 ZIP 文件，系统自动：
1. 解压 ZIP
2. 提取 index.js 作为入口
3. 解析 manifest
4. 验证依赖（SemVer 兼容性检查）
5. 存入数据库
6. 可选：立即激活

### 10.3 版本兼容性

插件依赖声明支持 SemVer 范围：
- `^1.0.0` — 兼容 1.x.x
- `~1.2.0` — 兼容 1.2.x
- `>=1.0.0 <2.0.0` — 显式范围

安装时 PluginHost 自动检查兼容性，不兼容则拒绝安装。

---

## 附录 A：完整插件模板

```typescript
// 复制此模板开始开发你的插件
import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../core/di/interfaces.js';
import type { PluginContext } from '../core/plugin-host/types.js';

export default {
  manifest: {
    id: '@you/plugin-name',
    name: '我的插件',
    version: '1.0.0',
    main: 'index.js',
    description: '插件描述',
    author: '作者名',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read'],
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);

    // TODO: 注册 Actions 和 Handlers

    console.log(`[Plugin:${ctx.manifest.id}] 已激活`);
  },

  deactivate: async () => {
    console.log('插件已停用');
  },
};
```

## 附录 B：现有内置插件参考

| 插件 | 文件 | 命令示例 |
|------|------|----------|
| 课堂核心 | `packages/plugins/builtin.ts` | `lesson.create`, `whiteboard.draw`, `whiteboard.query` |
| 虚拟文件系统 | `packages/plugins/vfs.ts` | `vfs.write_file`, `vfs.read_file`, `vfs.list_dir` |
| 管理插件 | `packages/plugins/management.ts` | `class.create`, `student.enroll`, `assignment.create` |
| AI 规划器 | `packages/plugins/ai-planner.ts` | `ai.start_generation`, `ai.apply_recommendation` |
| 进程管理 | `packages/plugins/process.ts` | `process.spawn`, `process.kill`, `process.list` |

---

> 本文档基于 OpenLearnV2 当前代码库（`main` 分支）自动生成。
> 分析工具：Codegraph 知识图谱。
> 最后更新：2026-06-26
