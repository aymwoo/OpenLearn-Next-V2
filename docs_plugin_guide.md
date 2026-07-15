# OpenLearn 插件开发权威参考指南 (Edu-OS Plugin SDK Reference Guide)

本指南是 OpenLearnV2（基于命令-事件总线微内核架构的教育实验操作系统）的第三方插件开发完整手册。本文档旨在提供自包含的、详尽无遗的 API 契约、类型声明、安全规范、数据库设计、UI 扩展槽位定义以及双运行时交互机制。可以直接作为提示词上下文提供给 AI 大模型，帮助其百分之百正确地生成可直接运行的第三方插件。

---

## 目录
1. [架构概述与核心机制](#1-架构概述与核心机制)
2. [编码规范与命名约定](#2-编码规范与命名约定)
3. [快速开始与项目结构](#3-快速开始与项目结构)
4. [完整 API 类型契约 (TypeScript)](#4-完整-api-类型契约-typescript)
5. [后端核心服务详解 (Backend Services)](#5-后端核心服务详解-backend-services)
6. [指令隔离与数据库隔离 (Namespace Sandboxing)](#6-指令隔离与数据库隔离-namespace-sandboxing)
7. [前端核心服务与视图扩展 (Frontend SDK)](#7-前端核心服务与视图扩展-frontend-sdk)
8. [完整的全栈插件开发范例](#8-完整的全栈插件开发范例)
9. [单元测试与调试指南](#9-单元测试与调试指南)

---

## 1. 架构概述与核心机制

### 1.1 命令-事件总线架构
OpenLearn 采用 **微内核 (Microkernel) + 命令事件总线** 架构。核心仅提供底层的通用能力（依赖注入、用户管理、基本路由等），所有具体的业务功能（如白板绘制、作业管理、虚拟文件系统、AI 助手规划等）均以插件的形式挂载。

- **Action (AI 描述体)**：定义了 AI Agent 可以理解和调用的工具，并绑定了它需要触发的命令类型 (`commandType`)。描述采用 Google GenAI Schema 语法。
- **Command (平台指令)**：对系统状态进行修改的唯一手段。每个命令由全局命令总线 (`CommandBus`) 路由到已注册的对应 Handler 执行。
- **Event (平台事件)**：指令执行完毕后，由 Handler 广播发布。事件以过去式命名（如 `quiz.created`），允许其他插件解耦监听，并会自动通过 Socket.IO 推送给在线前端。

```
       AI Agent 调用
            │
    ┌───────▼────────┐
    │  Action 注册   │  ← ctx.services.actionRegistry.register()
    │  (工具描述+参数)│     声明工具与 commandType
    └───────┬────────┘
            │ 转化为
    ┌───────▼────────┐
    │  Command 指令  │  ← ctx.services.commandBus.execute()
    │  (执行业务逻辑)│     调用对应的 CommandHandler
    └───────┬────────┘
            │ 触发发布
    ┌───────▼────────┐
    │  Event 事件    │  ← ctx.services.eventBus.publish()
    │  (系统事件广播)│     推送给订阅者与前端在线客户端
    └────────────────┘
```

### 1.2 双运行时架构 (Dual Runtime)
- **服务端运行时 (Node.js)**：运行插件的后台逻辑，使用 `inline`（直接在主进程中执行）或 `worker`（在独立 Worker Thread 中隔离执行）模式。可以使用 `better-sqlite3` 数据库。
- **前端运行时 (浏览器)**：由 `FrontendPluginHost` 动态加载编译后的 `frontend.js` 模块，执行 `activate(ctx)` 并将插件的前端 React 组件注册到系统预置的各个 UI 扩展槽位。

---

## 2. 编码规范与命名约定

为确保第三方插件与主应用完美兼容，大模型在生成代码时必须严格遵守以下规范：

- **命名约定 (Naming Conventions)**：
  - **命令类型 (Command Type)**：点号分隔的层级命名空间，全部小写。如 `quiz.create`、`whiteboard.draw`。
  - **事件类型 (Event Type)**：以过去式命名，点号分隔。如 `quiz.created`、`assignment.submitted`。
  - **插件 ID (Plugin ID)**：采用 `snake_case` 或 `@scope/kebab-case` 格式，且唯一。
  - **常量**：使用大写蛇形命名法 (`UPPER_SNAKE_CASE`)。
- **构建约定**：
  - 前端组件文件使用 `.tsx` 扩展名，使用 **PascalCase** 命名，且**必须 default export** 扩展组件本身。
  - 服务端入口文件使用 `.ts` 扩展名，**必须 default export** 包含 `manifest`、`activate` 和可选 `deactivate` 的对象。
  - 依赖注入服务（DI Service）仅通过定义的 **Token** 进行解析。

---

## 3. 快速开始与项目结构

### 3.1 命令行脚手架工具
使用官方 SDK 快速创建和打包插件：

```bash
# 交互式初始化项目
npx @openlearn/plugin-sdk init

# 非交互式快速创建 full-stack 项目
npx @openlearn/plugin-sdk init --name ext-exam-helper --template full-stack --author myname

# 构建打包项目
npx @openlearn/plugin-sdk build

# 构建打包并开启热监听 (Watch Mode)
npx @openlearn/plugin-sdk build --watch
```

### 3.2 插件项目 file 结构
```
ext-exam-helper/
├── package.json          # 插件元信息和打包依赖配置
├── tsconfig.json         # TypeScript 配置文件
├── src/
│   ├── index.ts          # 服务端入口 (Export default { manifest, activate })
│   └── frontend.tsx      # 前端 React 界面组件 (Default Export React.Component)
└── dist/                 # 自动生成的构建输出目录
    ├── index.js          # 服务端打包编译后产物
    ├── frontend.js       # 前端打包编译后产物
    └── ext-exam-helper.zip # 最终发布的插件压缩包 (包含 index.js + manifest.json + frontend.js)
```

---

## 4. 完整 API 类型契约 (TypeScript)

以下是 `@openlearn/plugin-sdk` 的核心接口类型定义，大模型生成代码时可直接参考此契约：

```typescript
// ── 基础 Token 定义 ──
export declare class Token<T> {
  readonly name: string;
  readonly version: string;
  constructor(name: string, version?: string);
}

// ── 状态枚举 ──
export declare enum PluginState {
  INSTALLED = 'installed',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  INACTIVE = 'inactive',
  ERROR = 'error',
  UNINSTALLED = 'uninstalled',
}

// ── Manifest 配置描述 ──
export interface Manifest {
  id: string;                               // 唯一标识 (建议以 ext- 或 @scope/ 开头)
  name: string;                             // 人类可读名称
  version: string;                          // SemVer 版本号 (如 "1.0.0")
  main: string;                             // 服务端入口文件名 (通常为 "index.js")
  requires?: string[];                      // 强依赖的服务 Token 列表 (带版本区间，例如 "@openlearn/core:IDatabase@^1.0.0")
  optional?: string[];                      // 可选依赖的服务 Token 列表
  capabilitiesProposed?: string[];          // 声明申请的权限 (如 ["lesson:write", "whiteboard:read"])
  engines?: { openlearn: string };          // OpenLearn 宿主版本兼容性 (如 ">=2.5.0")
  pluginDependencies?: string[];            // 依赖的其他插件 ID 列表
  configuration?: {                         // 插件的可配置项定义
    properties?: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'integer';
      default?: unknown;
      description?: string;
      enum?: unknown[];
      minimum?: number;
      maximum?: number;
    }>;
  };
  classroomTools?: Array<{                  // 自动桥接的前端课堂白板工具栏按钮
    id: string;
    name: string;
    icon?: string;                          // Lucide React 图标名称
    description?: string;
    commandType: string;                    // 触发的后台命令类型
    payload?: Record<string, unknown>;      // 默认负载参数
  }>;
}

// ── 平台底层命令与事件 ──
export interface PlatformCommand<T = unknown> {
  id: string;                               // 命令唯一 UUID (V7)
  type: string;                             // 命令类型 (如 "quiz.create")
  actorId: string;                          // 执行命令的用户 ID 或系统别名
  payload: T;                               // 具体参数载荷
  timestamp: number;                        // Unix 时间戳 (毫秒)
  metadata?: Record<string, unknown>;       // 额外元数据 (如 approved: 审批状态)
}

export interface CommandHandler {
  execute(command: PlatformCommand): Promise<unknown>;
}

export interface PlatformEvent<T = unknown> {
  id: string;                               // 事件唯一 UUID
  type: string;                             // 事件类型 (如 "quiz.created")
  source: string;                           // 事件来源 (通常为 "plugin.插件ID")
  payload: T;                               // 广播事件的内容载荷
  timestamp: number;                        // Unix 时间戳
  correlationId?: string;                   // 触发此事件的原始命令 ID
}

export type EventSubscriber = (event: PlatformEvent) => void | Promise<void>;

// ── AI 接口 Actions 描述 ──
export interface ActionDescriptor {
  readonly id: string;                      // Action 的唯一 ID
  readonly commandType: string;             // 对应命令类型
  readonly description: string;             // 提供给 AI 的自然语言功能描述 (中文)
  readonly inputSchema: unknown;            // Google GenAI 格式的 JSON 校验规范
  readonly capabilityRequired: string;      // 触发此工具必须具备的权限字符串
  readonly isHighRisk?: boolean;            // 是否属于高危操作 (设为 true 时，AI 触发执行需人工审批)
}

// ── 隔离数据库 API ──
export interface PluginDatabaseAPI {
  ensureTable(tableName: string, schema: string): Promise<void>;
  table(tableName: string): string;          // 返回带插件命名空间的表名 plugin_{uuid}_{tableName}
  dropAllTables(): Promise<void>;
  migrate(targetVersion: number, upgradeFn: (db: unknown) => Promise<void> | void): Promise<void>;
}

// ── 插件日志接口 ──
export interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ── 配置管理服务 ──
export interface IConfigService {
  get<T = unknown>(key: string): T;
  getAll(): Record<string, unknown>;
  set(key: string, value: unknown): Promise<void>;
  onChange(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void;
}

// ── 核心服务端上下文 (PluginContext) ──
export interface PluginContext {
  services: {
    commandBus: ICommandBusService;
    eventBus: IEventBusService;
    actionRegistry: IActionRegistryService;
    capability: ICapabilityService;
    processManager: IProcessService;
    storage: IStorageService;
    ai: IAIService;
  };
  pluginId: string;                         // 插件在数据库中的真实 UUID 标识
  manifest: Manifest;                       // 插件原始清单配置
  resolve<T>(token: Token<T>): Promise<T>;   // 依赖注入：解析全局平台级服务
  provide(tokenName: string, instance: unknown): Promise<void>;
  db: PluginDatabaseAPI;                    // 带命名空间隔离的数据库助手
  log: IPluginLogger;                       // 自带插件 ID 前缀的日志打印器
  config: IConfigService;                   // 插件专属参数配置服务
  contributions: {
    list(): Array<{ slot: string; count: number; items: Array<{ id: string; label: string }> }>;
  };
  require(moduleName: string): unknown;      // 导入系统共享的 npm 包组件
}

// ── 平台常用 Token 常量 (服务端) ──
export declare const ICommandBusServiceToken: Token<ICommandBusService>;
export declare const IEventBusServiceToken: Token<IEventBusService>;
export declare const IActionRegistryServiceToken: Token<IActionRegistryService>;
export declare const ICapabilityServiceToken: Token<ICapabilityService>;
export declare const IProcessServiceToken: Token<IProcessService>;
export declare const IStorageServiceToken: Token<IStorageService>;
export declare const IAIServiceToken: Token<IAIService>;
export declare const IDatabaseToken: Token<unknown>; // 解析出 raw better-sqlite3 Database 对象
```

---

## 5. 后端核心服务详解 (Backend Services)

### 5.1 CommandBus (命令总线)
用于注册平台命令处理器或派发执行系统核心指令：
```typescript
const commandBus = ctx.services.commandBus;

// 1. 注册指令处理器 (资源会自动随插件注销而解除绑定)
await commandBus.registerHandler('myplugin.do_work', {
  async execute(command: PlatformCommand) {
    const { arg1 } = command.payload as { arg1: string };
    ctx.log.info(`执行指令，发送人：${command.actorId}`);
    return { success: true, message: `已处理 ${arg1}` };
  }
});

// 2. 调用命令总线执行其他指令 (必须是已注册的系统指令，如 whiteboard.draw)
const result = await commandBus.execute({
  id: crypto.randomUUID(),
  type: 'whiteboard.draw',
  actorId: `plugin:${ctx.manifest.id}`,
  payload: {
    lessonId: 'current-lesson-id',
    type: 'rectangle',
    data: JSON.stringify({ x: 10, y: 10, width: 100, height: 100, fill: '#ff0000' })
  }
});
```

### 5.2 EventBus (事件总线)
订阅核心应用或发布自定义插件事件：
```typescript
const eventBus = ctx.services.eventBus;

// 1. 发布事件 (建议事件类型采用过去式命名，且指明 correlationId)
await eventBus.publish({
  id: crypto.randomUUID(),
  type: 'myplugin.work_completed',
  source: `plugin.${ctx.manifest.id}`,
  payload: { fileId: '123', status: 'done' },
  timestamp: Date.now(),
  correlationId: 'triggering-command-uuid'
});

// 2. 订阅特定事件
await eventBus.subscribe('lesson.created', (event) => {
  ctx.log.info(`检测到新课堂课时创建: ${event.payload.lessonId}`);
});

// 3. 通配符订阅所有事件
await eventBus.subscribe('*', (event) => {
  ctx.log.info(`总线捕获事件: ${event.type}`);
});
```

### 5.3 ActionRegistry (AI 接口注册)
第三方插件注册 AI 助手可感知的 Action。**`inputSchema` 必须使用大写的 Google GenAI 类型描述字符**（`OBJECT`、`STRING`、`NUMBER`、`INTEGER`、`BOOLEAN`、`ARRAY`）：
```typescript
const actionRegistry = ctx.services.actionRegistry;

await actionRegistry.register({
  id: 'ext-quiz-engine',
  commandType: 'quiz.generate',
  description: '根据教师提供的主题与数量，自动调用大模型生成随堂测验题并导入系统。',
  capabilityRequired: 'lesson:write',
  isHighRisk: false, // 设为 true 时，AI 自动执行此工具时会被系统拦截，生成待审批工单，需教师在界面手动批准后才真正执行
  inputSchema: {
    type: 'OBJECT',
    properties: {
      lessonId: { type: 'STRING', description: '当前课堂的 Lesson ID' },
      topic: { type: 'STRING', description: '随堂测试的考核知识点主题' },
      count: { type: 'INTEGER', description: '生成测试题的总题数，默认 3 题' }
    },
    required: ['lessonId', 'topic']
  }
});
```

### 5.4 Database (SQLite 数据库直连)
插件的 `ctx.db` 提供了基础的建表能力，如果需要更灵活的 SQL 拼装或直接查询，需使用平台提供的依赖注入 `IDatabaseToken` 解析为 `better-sqlite3` 数据库对象：
```typescript
import { IDatabaseToken } from '@openlearn/plugin-sdk';

const db = await ctx.resolve(IDatabaseToken); // 返回 raw better-sqlite3 数据库实例

// 使用 ctx.db.table 获得自动带独立 UUID 命名空间前缀的表名
const targetTable = ctx.db.table('student_scores');

// 准备并执行查询
const row = db.prepare(`SELECT * FROM ${targetTable} WHERE student_id = ?`).get('student-112');
```
> [!NOTE]
> `better-sqlite3` 是同步 API，无需在 `prepare` / `run` / `get` / `all` 前面加 `await`。

### 5.5 ProcessManager (后台长任务进程)
插件如果需要异步处理高耗时业务（如大模型批量生成、文件转码等），必须通过平台进程管理器登记，从而避免主进程阻塞并方便监控：
```typescript
const pm = ctx.services.processManager;

// 1. 注册进程处理器
await pm.registerHandler('my_heavy_task', async (processId, payload, state, log, updateState) => {
  log('开始读取数据并转换格式...');
  // 模拟耗时循环
  for (let i = 0; i <= 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    log(`任务执行中: ${i * 10}%`);
    updateState({ progress: i * 10 }); // 更新进度状态，前端会自动监听该进度变化并更新进度条
  }
  log('任务处理全部完成！');
});

// 2. 派发生命周期进程
const pid = await pm.spawn('数据转换进程', 'my_heavy_task', { file: '/path/to/data' });
```

---

## 6. 指令隔离与数据库隔离 (Namespace Sandboxing)

### 6.1 指令隔离安全限制 (Command Namespace Isolation)
内核在激活第三方插件时会强制执行命名空间检查，以防止第三方恶意注册、假冒或拦截敏感的系统/其他插件命令：
1. **点号命名空间指令**：如果插件注册的命令名中含有点号（如 `quiz.create`），总线将直接在全局注册该全名。此类方法一般用于明确语义归属的协作系统。
2. **裸字符指令**：如果注册的命令名不含点号（如 `execute_script`），微内核会自动在注册时为其添加 `[插件ID].` 作为防冲突前缀。
3. **防篡改越权校验**：如果第三方插件试图注册以**非本插件专属 UUID** 开头的带点号指令，例如插件 A 企图调用 `registerHandler` 劫持插件 B 的指令，总线会拒绝注册并直接置插件为 `ERROR` 崩溃状态。

### 6.2 数据库表名防冲突沙箱
插件通过 `ctx.db.ensureTable` 建立本地表，表名会自动映射：
- `ctx.db.ensureTable('configs', ...)`
- 内部表名生成规则：`plugin_` + `插件数据库唯一 UUID` + `_` + `自选表名`。
- 在拼装 SQL 时，必须使用 `ctx.db.table('configs')` 转换获得最终映射后的真实表名：
```typescript
// 错误示范❌:
db.prepare('SELECT * FROM configs').all(); 

// 正确示范✅:
db.prepare(`SELECT * FROM ${ctx.db.table('configs')}`).all();
```

---

## 7. 前端核心服务与视图扩展 (Frontend SDK)

当构建为 `full-stack` 或 `frontend-only` 插件时，打包产生的 `frontend.js` 会在前端被动态 import。前端插件入口对象的 default export 必须包含 `activate(ctx)`：

```typescript
// 前端接口定义
export interface FrontendPluginContext {
  services: {
    frontendApi: IFrontendAPI;          // 前端专用 HTTP 客户端封装
    socketService: ISocketService;      // Socket.IO 事件收发
    uiService: IUIService;              // Toast 气泡、Modal 模态框、文件下载组件
    storageService: IStorageService;    // 基于本地命名空间隔离的 LocalStorage 包装
  };
  pluginId: string;
  manifest: FrontendPluginManifest;
  ui: {
    // 动态注册前端 UI 扩展槽位
    registerExtensionPoint(slot: ExtensionSlot, config: ExtensionPointConfig): void;
    unregisterExtensionPoint(slot: ExtensionSlot, id: string): void;
  };
  // 跨运行时通信：直接异步触发服务端的 Command Handler，支持自动补全命名空间前缀
  invokeCommand<T = any>(type: string, payload?: any): Promise<T>;
}
```

### 7.1 可用 UI 视图扩展槽位 (Extension Slots)
通过 `ctx.ui.registerExtensionPoint` 可将开发的 React 组件无缝渲染进系统的对应面板中：

| 槽位 ID (`ExtensionSlot`) | 渲染位置 / 用途 | 适用场景 |
| :--- | :--- | :--- |
| `classroom.tool` | 白板侧边课堂工具栏按钮 | 课堂互动工具 (如随堂答题器、投票器) |
| `teacher.tab` | 教师主控制台侧边导航 Tab 页签 | 教师核心管理功能面板 |
| `teacher.panel` | 教师独立全宽内容展示区 | 复杂报表看板、大屏控制中心 |
| `teacher.dashboard.widget` | 教师个人仪表盘的快捷卡片组件 | 数据简报、快捷入口卡片 |
| `student.view` | 学生主学习区域内容视图 | 学生端课程内容互动展示 |
| `student.fullscreen` | 学生端全屏沉浸展示区域 | 在线测验、电子问卷、考试场景 |
| `student.lesson.tool` | 包含在课程内部的学生操作小工具 | 课堂笔记区、词典、互动问答 |
| `global.setting` | 系统全局设置页的扩展配置栏 | 配置插件专用的 API Key 或系统设置 |

### 7.2 前端槽位注册规范与参数
注册插槽时，React 组件必须通过懒加载函数声明注入，并指明排序位置：
```typescript
ctx.ui.registerExtensionPoint('teacher.tab', {
  id: 'my-plugin-tab',
  label: '我的后台大屏',
  icon: 'BarChart3', // Lucide 图标名称
  // 打包构建工具会处理此 dynamic import。也可以在外部使用 () => Promise.resolve({ default: Component }) 传入
  component: () => import('./MyTabPanelComponent'), 
  position: 10, // 数值越小排在越前
  pluginId: ctx.pluginId
});
```

### 7.3 侧边栏 Tab 扩展 (`teacher.tab`) 的特殊处理
在 OpenLearn 系统中，`teacher.tab` 槽位是一个双重渲染插槽。它既会在系统侧边导航栏（`NavigationSidebar`）中作为入口按钮进行渲染，也会在主体展示区（`App.tsx`）中作为面板内容页进行渲染。

为了帮助组件识别当前所在的渲染场景，系统会通过 React props（或 DOM 渲染函数的上下文参数）向插件注入 `slotProps.renderType`：
* `renderType === 'button'`：处于侧边栏导航按钮渲染状态，此时应展示轻量级的 Tab 页签按钮，并绑定点击跳转。
* `renderType === 'panel'`：处于主体内容大屏面板渲染状态，此时应展示完整的后台管理、图表统计、打分筛选等功能页面。

此外，前端上下文 `frontendCtx` 提供了 `navigation` 对象用来读取和切换系统当前选中的 Tab：
* `frontendCtx.navigation.getTeacherTab()`：获取当前活动的 Tab ID。
* `frontendCtx.navigation.setTeacherTab(tabId)`：跳转到指定的 Tab ID，激活对应的面板页。
* `frontendCtx.navigation.subscribeTeacherTab((activeTab) => void)`：订阅激活 Tab 的状态变更，常用于高亮选中态的实时更新。

#### 纯 JavaScript DOM 插件的 `teacher.tab` 完整适配示例：
```javascript
export default {
  activate: async (frontendCtx) => {
    frontendCtx.registerPanel({
      slot: 'teacher.tab',
      id: 'homework-tab-view',
      title: '作业大屏',
      render: async (domNode, context) => {
        const { renderType } = context;

        if (renderType === 'button') {
          // 1. 渲染侧边栏导航入口
          domNode.innerHTML = `
            <div id="btn-homework-tab" style="padding: 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background-color 0.2s;">
              <span style="font-size: 16px;">📝</span>
              <span style="font-size: 14px; font-weight: 500; color: #475569;">作业中心</span>
            </div>
          `;
          
          const btn = domNode.querySelector('#btn-homework-tab');
          
          // 2. 点击时触发全局 Tab 导航切换
          btn.addEventListener('click', () => {
            frontendCtx.navigation.setTeacherTab('homework-tab-view');
          });

          // 3. 监听 Tab 状态更新按钮选中高亮态
          frontendCtx.navigation.subscribeTeacherTab((activeTab) => {
            if (activeTab === 'homework-tab-view') {
              btn.style.backgroundColor = '#e0e7ff';
              btn.querySelector('span:last-child').style.color = '#4f46e5';
            } else {
              btn.style.backgroundColor = 'transparent';
              btn.querySelector('span:last-child').style.color = '#475569';
            }
          });
        } else {
          // 4. 渲染完整的大屏内容管理及打分面板
          domNode.innerHTML = `
            <div style="padding: 24px; font-family: sans-serif; display: flex; flex-direction: column; gap: 20px;">
              <h2>📝 作业管理与打分中心</h2>
              <!-- 放置作业列表筛选展示、打分管理、统计图表等具体业务 UI -->
            </div>
          `;
        }
      }
    });
  }
}
```

---

## 8. 完整的全栈插件开发范例

下面给出一个“全栈随堂测验”插件的完整实现源码，展示了如何建表、提供 AI 工具、发布总线指令与事件，以及前端如何拉取数据渲染页面并调用后端命令。

### 8.1 后端服务模块 (`src/index.ts`)
```typescript
import type { PluginContext } from '@openlearn/plugin-sdk';
import { IDatabaseToken } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: 'ext-classroom-quiz',
    name: '全栈随堂小测验',
    version: '1.2.0',
    description: '允许教师一键下发测验题目，学生实时作答并进行简单的统计排名。',
    author: 'developer-team',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0'
    ],
    capabilitiesProposed: ['lesson:write', 'lesson:read'],
    classroomTools: [{
      id: 'classroom-quiz-tool',
      name: '随堂测验',
      icon: 'ClipboardList',
      commandType: 'ext-classroom-quiz.open_ui'
    }]
  },

  async activate(ctx: PluginContext) {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);

    // 1. 初始化插件自建数据表
    await ctx.db.ensureTable('quiz_questions', `
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,      -- JSON 数组：["选项A","选项B",...]
      correct_answer TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    `);

    await ctx.db.ensureTable('quiz_answers', `
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      answer TEXT NOT NULL,
      is_correct INTEGER NOT NULL,
      submitted_at INTEGER NOT NULL,
      UNIQUE(question_id, student_id)
    `);

    const qTable = ctx.db.table('quiz_questions');
    const aTable = ctx.db.table('quiz_answers');

    // 2. 注册 AI Action：教师可以直接让 AI 助手创建随堂测验
    await actionRegistry.register({
      id: 'ext-quiz-create-action',
      commandType: 'ext-classroom-quiz.create_quiz',
      description: '在指定课堂课时下创建一道测试题，由选项和正确答案组成。',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课堂课时 ID' },
          question: { type: 'STRING', description: '题目描述' },
          options: { type: 'ARRAY', items: { type: 'STRING' }, description: '供选择的选项列表' },
          correctAnswer: { type: 'STRING', description: '正确答案 (如 "选项A")' }
        },
        required: ['lessonId', 'question', 'options', 'correctAnswer']
      }
    });

    // 3. 注册命令：创建测验
    await commandBus.registerHandler('ext-classroom-quiz.create_quiz', {
      async execute(command) {
        const { lessonId, question, options, correctAnswer } = command.payload as any;
        const quizId = crypto.randomUUID();
        const optionsStr = JSON.stringify(options);

        db.prepare(`
          INSERT INTO ${qTable} (id, lesson_id, question, options, correct_answer, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(quizId, lessonId, question, optionsStr, correctAnswer, Date.now());

        // 发布测验已发布事件
        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'ext-classroom-quiz.quiz_created',
          source: `plugin.${ctx.manifest.id}`,
          payload: { quizId, lessonId, question, options },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true, quizId, message: '测验题目已成功下发！' };
      }
    });

    // 4. 注册命令：学生端提交答案
    await commandBus.registerHandler('ext-classroom-quiz.submit_answer', {
      async execute(command) {
        const { questionId, answer } = command.payload as any;
        const studentId = command.actorId;

        // 获取正确答案校验
        const quiz = db.prepare(`SELECT correct_answer FROM ${qTable} WHERE id = ?`).get(questionId) as any;
        if (!quiz) {
          throw new Error('未找到该测试题！');
        }

        const isCorrect = (quiz.correct_answer === answer) ? 1 : 0;
        const answerId = crypto.randomUUID();

        db.prepare(`
          INSERT OR REPLACE INTO ${aTable} (id, question_id, student_id, answer, is_correct, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(answerId, questionId, studentId, answer, isCorrect, Date.now());

        // 发送事件广播，前端通过 WebSocket 收到实时更新数据
        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'ext-classroom-quiz.answer_submitted',
          source: `plugin.${ctx.manifest.id}`,
          payload: { questionId, studentId, isCorrect },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true, isCorrect: isCorrect === 1 };
      }
    });

    // 5. 注册命令：查询答题统计数据 (API 供前端面板直连)
    await commandBus.registerHandler('ext-classroom-quiz.get_stats', {
      async execute(command) {
        const { questionId } = command.payload as any;
        const stats = db.prepare(`
          SELECT answer, COUNT(*) as count 
          FROM ${aTable} 
          WHERE question_id = ? 
          GROUP BY answer
        `).all(questionId);

        return { success: true, stats };
      }
    });

    // 6. 注册白板菜单命令，唤醒 UI
    await commandBus.registerHandler('ext-classroom-quiz.open_ui', {
      async execute(command) {
        return { opened: true, pluginId: ctx.pluginId };
      }
    });

    ctx.log.info('全栈小测验服务端逻辑加载就绪');
  },

  async deactivate() {
    console.log('全栈小测验服务端停用清理完毕');
  }
};
```

### 8.2 前端视图模块 (`src/frontend.tsx`)
```tsx
/**
 * 全栈随堂测验前端 UI 界面组件
 * 
 * 必须 default export 一个 React 组件。
 * React, Recharts, LucideReact 不需要打包在 ZIP 内，由 Host 平台运行时全局注入。
 */
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Play, Award, CheckCircle, XCircle } from 'lucide-react';

export default function ClassroomQuizWidget({ context }: { context: any }) {
  // context 会由宿主渲染插件时传入，例如包含当前 { lessonId, userRole, userId }
  const lessonId = context?.lessonId || 'default-lesson-id';
  const isTeacher = context?.userRole === 'teacher';

  const [activeQuiz, setActiveQuiz] = useState<any>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [resultMsg, setResultMsg] = useState<string>('');
  const [chartData, setChartData] = useState<any[]>([]);

  // 跨运行时通信：使用 window.HostSharedDeps 的 API
  const { uiService, socketService } = (window as any).HostSharedDeps;

  useEffect(() => {
    // 监听实时 WebSocket 推送过来的新题目创建事件
    const handleNewQuiz = (event: any) => {
      if (event.type === 'ext-classroom-quiz.quiz_created' && event.payload.lessonId === lessonId) {
        setActiveQuiz(event.payload);
        setSubmitted(false);
        setSelectedAnswer('');
        setResultMsg('');
        setChartData([]);
      }
    };

    // 监听答题提交更新图表事件
    const handleAnswerCast = async (event: any) => {
      if (event.type === 'ext-classroom-quiz.answer_submitted' && activeQuiz && event.payload.questionId === activeQuiz.quizId) {
        await refreshStats();
      }
    };

    socketService.on('platform_event', handleNewQuiz);
    socketService.on('platform_event', handleAnswerCast);

    return () => {
      socketService.off('platform_event', handleNewQuiz);
      socketService.off('platform_event', handleAnswerCast);
    };
  }, [lessonId, activeQuiz]);

  const refreshStats = async () => {
    if (!activeQuiz) return;
    try {
      // 通过 invokeCommand 执行服务端对应的 Handler
      const res = await (window as any).FrontendHost.invokeCommand('ext-classroom-quiz.get_stats', {
        questionId: activeQuiz.quizId
      });
      if (res && res.stats) {
        const formatted = res.stats.map((s: any) => ({ name: s.answer, 票数: s.count }));
        setChartData(formatted);
      }
    } catch (e: any) {
      console.error('获取统计数据失败', e);
    }
  };

  const handleVote = async () => {
    if (!selectedAnswer) {
      uiService.showToast('警告', '请先选择一个选项！', 'warning');
      return;
    }
    try {
      const res = await (window as any).FrontendHost.invokeCommand('ext-classroom-quiz.submit_answer', {
        questionId: activeQuiz.quizId,
        answer: selectedAnswer
      });
      setSubmitted(true);
      if (res.isCorrect) {
        setResultMsg('回答正确！🎉');
        uiService.showToast('恭喜', '回答正确！', 'success');
      } else {
        setResultMsg('回答错误，继续加油！❌');
        uiService.showToast('很遗憾', '回答错误。', 'info');
      }
    } catch (e: any) {
      uiService.showToast('错误', e.message || '答题提交失败', 'warning');
    }
  };

  return (
    <div style={{ padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 16px 0', color: '#1e293b' }}>
        <Award style={{ color: '#6366f1' }} />
        课堂互动小测试
      </h3>

      {!activeQuiz ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
          <p>⏳ 等待教师下发新的测试题目...</p>
        </div>
      ) : (
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 12 }}>
            Q: {activeQuiz.question}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {activeQuiz.options.map((opt: string) => (
              <label 
                key={opt}
                style={{ 
                  padding: 12, 
                  border: '1px solid #e2e8f0', 
                  borderRadius: 8, 
                  cursor: submitted ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: selectedAnswer === opt ? '#f0fdf4' : '#fff'
                }}
              >
                <input 
                  type="radio" 
                  name="quiz"
                  disabled={submitted}
                  value={opt}
                  checked={selectedAnswer === opt}
                  onChange={(e) => setSelectedAnswer(e.target.value)}
                />
                {opt}
              </label>
            ))}
          </div>

          {!submitted ? (
            <button 
              onClick={handleVote}
              style={{
                width: '100%',
                padding: '12px',
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              提交选择
            </button>
          ) : (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#f8fafc' }}>
              <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: 8 }}>{resultMsg}</div>
              
              {chartData.length > 0 && (
                <div style={{ height: 160, marginTop: 10 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="票数" fill="#818cf8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## 9. 单元测试与调试指南

### 9.1 使用 `@openlearn/plugin-test-kit` 编写单元测试
测试套件基于 `vitest` 与 `jsdom`。SDK 提供 mock 机制来隔离微内核总线，开发者无需启动主应用即可验证插件逻辑：

```typescript
// __tests__/classroom-quiz.test.ts
import { describe, it, expect } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';
import myPlugin from '../src/index';

describe('随堂小测验插件单元测试', () => {
  it('能够成功在激活时注册自定义命令', async () => {
    // 1. 创建仿真的插件运行上下文
    const ctx = createMockContext({
      pluginId: 'test-quiz-uuid',
      manifest: myPlugin.manifest
    });

    // 2. 触发插件的 activate 函数
    await myPlugin.activate(ctx);

    // 3. 校验对应命令处理器是否已注册至 Mock 总线上
    const handlers = ctx.services.commandBus._getHandlers();
    expect(handlers).toContain('ext-classroom-quiz.create_quiz');
    expect(handlers).toContain('ext-classroom-quiz.submit_answer');
  });
});
```

### 9.2 SQL 实时审计
插件执行过程中广播的全部 Event 事件或自建表写入的数据库记录，都可以通过 SQL 命令行直接审计检查：
```sql
-- 查询指定插件的全部事件上报日志
SELECT type, source, payload, created_at 
FROM events 
WHERE source = 'plugin.ext-classroom-quiz' 
ORDER BY created_at DESC;

-- 查看插件自动带命名空间的私有表格数据
SELECT * FROM plugin_test-quiz-uuid_quiz_questions;
```
