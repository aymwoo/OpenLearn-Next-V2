# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

OpenLearnV2 是一个教育操作系统（Educational OS / LMS）平台。基于"OS 内核"设计理念：一个插件驱动的命令-事件总线架构，AI Agent 作为 Shell 控制器，通过调用工具命令来完成教学管理操作。

## 常用命令

| 命令 | 用途 |
| ---- | ---- |
| `pnpm dev` | 启动开发服务器（Express + Vite HMR，端口 9000） |
| `pnpm lint` | TypeScript 类型检查 (`tsc --noEmit`) |
| `pnpm lint:eslint` | ESLint 静态代码检查 |
| `pnpm format` | Prettier 自动代码格式化 |
| `pnpm test` | 运行 Vitest 测试套件（支持并行 worker 隔离 SQLite） |
| `pnpm build` | 生产构建（Vite 前端构建 → 插件构建 → esbuild 打包 server.ts → `dist/server.cjs`） |
| `pnpm start` | 生产环境运行 `node dist/server.cjs` |
| `pnpm clean` | 清理构建产物与临时文件 |

环境要求：AI 功能完全由管理后台的「AI 提供商管理」动态配置第三方 AI（OpenAI 兼容接口，支持 DeepSeek、Qwen、Ollama、OpenAI 等），系统不再依赖任何静态 API Key 环境变量。

## 技术栈

- **前端**：React 19, Vite 6, TailwindCSS 4, TypeScript 5.8
- **状态管理**：Zustand 5.0（模块化 stores 位于 `src/store/`）
- **后端**：Express 4, better-sqlite3, tsx（开发运行时）, esbuild（生产打包）
- **测试框架**：Vitest（jsdom 环境，支持按 worker 隔离的临时 SQLite 数据库）
- **实时通信**：Socket.IO（WebSocket）
- **AI 集成**：OpenAI 兼容 API（多 Provider 动态网关与 AES-256 加密凭据存储）
- **关键库**：konva/react-konva（交互白板）, recharts（图表）, jspdf（PDF导出）, react-markdown, jszip, reveal.js, lucide-react, motion

## 项目结构

```
├── server.ts              # 后端启动入口与核心集成（模块化重构为 ~670 行）
├── server/                # 服务端模块化子系统
│   ├── middleware/        # 认证 (auth.ts) 与安全/速率限制中间件
│   ├── routes/            # 领域路由拆分 (agent, auth, courseware, export, exams, etc.)
│   └── utils/             # 服务端工具集与沙箱 Bridge SDK Proxy
├── src/                   # React 19 前端架构
│   ├── App.tsx            # 主应用框架壳（~130 行，无冗余 useState）
│   ├── components/        # 通用 UI 组件（PascalCase）
│   ├── features/          # 领域功能特性模块（activity-ecosystem, courseware, teacher, whiteboard, etc.）
│   ├── services/          # API 客户端与通信适配层
│   ├── hooks/             # 共享自定义 React Hooks
│   ├── store/             # Zustand 全局与领域状态 Store
│   └── types/             # 前端 TypeScript 类型定义
├── packages/
│   ├── core/              # OS 内核子系统
│   │   ├── kernel/        # 内核容器：组装各子系统，拦截器处理权限和高危审批
│   │   ├── command-bus/   # 命令总线：注册 handler，拦截管线与执行
│   │   ├── event-bus/     # 事件总线：发布/订阅，支持内存及持久化审计
│   │   ├── registry/      # Action 注册表：供 AI Agent 发现可用工具
│   │   ├── capability-system/ # 权限守卫与 RBAC 控制
│   │   ├── worker-runtime/    # 插件 Worker 线程运行时与沙箱隔离
│   │   ├── plugin-host/       # 插件宿主环境与生命周期管理器
│   │   ├── process-manager/   # 进程与定时任务管理器
│   │   └── db/            # SQLite 数据库核心、30+ 数据表迁移与备份灾备管理器
│   ├── plugin-sdk/        # 插件开发类型与 DI 依赖注入 Token
│   ├── plugin-test-kit/   # 插件测试 Mock 上下文套件
│   ├── plugins/           # 平台内置插件（builtin, vfs, process, management, ai-planner 等）
│   └── mfe-*/             # 微前端包（whiteboard, courseware 等）
├── docs/                  # 架构设计、报告与插件开发教程
├── migrations/            # 数据库结构版本迁移脚本
├── assets/                # 静态资源（插件 zip 等）
└── storage/               # 课件文件存储与数据运行时存储
```

## 核心架构

### 内核设计

`kernelContainer` 是全局单例，组装了 6 个核心子系统：

1. **EventBus** — 发布/订阅事件，所有事件自动写入 SQLite 审计日志（`events` 表）
2. **CommandBus** — 命令执行管线。注册 handler → 执行命令。内置拦截器做权限检查和高危操作审批
3. **ActionRegistry** — 注册可被 AI Agent 调用的工具。每个 action 有 commandType、description、inputSchema
4. **CapabilityGuard** — 基于字符串能力的权限控制（如 `lesson:write`, `management:read`）
5. **WorkerRuntime / PluginHost** — 插件运行时：Worker Thread 隔离 + ESM 动态导入。插件通过包装器访问内核 API
6. **ProcessManager** — 管理后台进程和定时任务
7. **BackupManager** — 数据库自动备份、轮转与灾难恢复（Restore）管理机制

### 插件系统（V3.0）

插件是 ESM 模块，源码存储在文件系统（`plugins/{uuid}/index.js`），元数据在 SQLite 的 `plugins` 表中。格式示例：

```typescript
import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: 'ext-my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    main: 'index.js',
    engines: { openlearn: '>=0.2.5' },
    capabilitiesProposed: ['lesson:read', 'whiteboard:write'],
    requires: ['@openlearn/core:ICommandBusService@^1.0.0'],
    pluginDependencies: ['ext-grade-calculator'],
    provides: ['ext-my-plugin:IMyService'],
    configuration: {
      properties: {
        maxQuestions: { type: 'number', default: 50, description: '最大题目数' },
      },
    },
    contributes: {
      'classroom.tool': [{ id: 'tool-1', name: 'My Tool', icon: 'Sparkles', commandType: 'my.tool' }],
      'teacher.tab': [{ id: 'tab-1', label: 'My Tab', position: 10 }],
    },
  },

  activate: async (ctx: PluginContext) => {
    ctx.log.info('Plugin activated');
    const limit = ctx.config.get<number>('maxQuestions');
    ctx.actionRegistry.register({ id: 'my-action', commandType: 'my.tool', description: 'Sample tool' });
    ctx.commandBus.registerHandler('my.tool', { execute: async (cmd) => { /* 执行逻辑 */ } });
    await ctx.provide('ext-my-plugin:IMyService', { /* 服务实现 */ });
  },

  deactivate: async () => {
    // ResourceTracker 自动清理所有注册的 handler/subscriber/intervals
  },
};
```

### 插件 SDK 与测试工具

- **`@openlearn/plugin-sdk`** — 插件开发的类型定义包，re-export 所有公开 API 类型和 Token
- **`@openlearn/plugin-test-kit`** — mock 工具包，提供 `createMockContext()` 一键创建测试上下文

```typescript
import { createMockContext, MockCommandBus } from '@openlearn/plugin-test-kit';

const ctx = createMockContext({ pluginId: 'ext-test', capabilities: ['lesson:read'] });
await myPlugin.activate(ctx);
expect((ctx.services.commandBus as MockCommandBus).handlers.has('my.command')).toBe(true);
```

### AI Agent 流程

1. 前端发送聊天消息 → `POST /api/agent/chat`
2. 服务端根据选择或激活的 AI 提供商，调用 OpenAI 兼容 API
3. AI 返回 functionCall → 通过 CommandBus 执行对应 action
4. 工具执行结果返回给 AI → AI 继续思考或产出最终回复
5. 最多循环 5 轮

`systemInstruction` 定义了 AI 的角色（教育 OS 内核助手）和可用工具的引导。

### 数据库与灾难恢复

- 引擎：SQLite (`better-sqlite3`)，主数据库位于 `packages/core/db/educational_os.db`。包含 30+ 张表。
- 灾备机制：内置 `BackupManager`（`packages/core/db/backup-manager.ts`），支持 SQLite 在线热备（VACUUM INTO）、完整性预检（PRAGMA integrity_check）与安全恢复（Restore 回滚保证）。CLI 提供 `pnpm exec tsx scripts/backup-db.ts` 与 `scripts/restore-db.ts`。
- 默认用户：admin/admin（administrator）, teacher/teacher（teacher）。

### 登录与权限

基于 Cookie 的 Session 认证（`edu_os_token`）。角色：`student`, `teacher`, `administrator`。认证中间件位于 `server/middleware/auth.ts`。admin 角色在执行 AI Agent 工具调用时会自动绕过高危审批。

### 课件沙箱与 Bridge SDK

- 交互式课件在严密沙箱 `<iframe>` (`sandbox="allow-scripts allow-forms allow-downloads"`) 中运行。
- 服务端通过 `server/utils/bridge-sdk.ts` 注入 Proxy 代理与归一化逻辑，安全规避同源限制并将数据通过 `lms-bridge.ts` 与总线交互。

### 前端状态架构

前端彻底摆脱早期巨石单体设计：
- `App.tsx` 保持极简装配（~130 行），根据当前用户角色和路由渲染对应的 Feature 容器。
- 状态集中于 `src/store/` 的各个 Zustand Store（如 `useUserStore`, `useClassroomStore`, `useThemeStore` 等）。
- 复杂业务模块高度自治在 `src/features/` 下。

## 测试与代码规范

- **测试套件**：Vitest 运行于 jsdom 环境，全面覆盖核心内核、总线、插件宿主与各前端功能模块。
- **并发测试隔离**：Vitest 配置利用独立的临时数据库（根据 `VITEST_POOL_ID` 分配于 `/tmp/openlearn_test_dbs/`）实现完全零干扰的并行测试。
- **代码规范**：统一遵循 Prettier 格式化（2 空格缩进，单引号）与 ESLint 规范。
- **Git 提交**：严格遵守 Conventional Commits 标准，如 `feat:`, `fix:`, `refactor:`, `test:`, `docs:`。
