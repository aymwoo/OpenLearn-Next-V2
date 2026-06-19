# Phase 8: 现有插件迁移 - Research Report

## 1. 现有内置与第三方插件现状分析

### 1.1 内置插件 (Built-in Plugins)
目前系统共有 6 个核心内置插件文件，位于 `packages/plugins/` 目录中：
1. **`builtin.ts`**：
   - **职责**：基础课堂教学能力，包括课件/课件库管理（课件列表、上传 HTML/ZIP 格式课件、成绩提交与成绩图表分析）以及交互白板绘制操作（点、矩形、橡皮擦等基本图形的 draw/update/delete/clear）。
   - **核心命令**：`lesson.create`, `lesson.update`, `lesson.delete`, `whiteboard.draw`, `whiteboard.update`, `whiteboard.delete`, `whiteboard.clear`。
   - **外部依赖**：直接引用了 `better-sqlite3`（通过全局 `kernelContainer.db`）和 VFS 静态存储路径。
2. **`vfs.ts`**：
   - **职责**：虚拟文件系统，通过命令接口安全访问主机文件资源，向 AI Agent 暴露工具链。
   - **核心命令**：`vfs.write_file`, `vfs.read_file`, `vfs.list_dir`, `vfs.mkdir`。
3. **`process.ts`**：
   - **职责**：轻量级后台进程管理，由 AI Agent 调度后台任务，支持进程日志记录与健康监视。
   - **核心命令**：`process.spawn`, `process.kill`, `process.list`, `process.logs`。
4. **`management.ts`**：
   - **职责**：教务与教学现场行政管理（班级、学生名册、排课日程、考勤记录、课程作业发布与批改）。
   - **核心命令**：`class.create`, `student.create`, `class.add_student`, `class.get_students`, `schedule.create`, `attendance.record`, `assignment.create`, `assignment.submit`, `assignment.grade`。
5. **`ai-planner.ts`**：
   - **职责**：后台 AI 教案与教学计划排定任务，带高危操作审批队列（Approve/Reject 拦截）。
   - **核心命令**：`ai.plan_lesson`, `approval.approve`, `approval.reject`, `approval.list`。
6. **`ai-submit-injector.ts`**：
   - **职责**：监听课件上传事件，如果检测到上传的 HTML 课件包含评分组件但缺少提交逻辑，会自动调用 Gemini 模型生成并注入成绩提交通信 Bridge 脚本。
   - **核心事件订阅**：`courseware.uploaded`。

### 1.2 第三方插件 (Third-Party Plugins)
在 `server.ts` 启动时硬编码模板生成的插件：
1. **`Quiz Component Plugin`** (智能随堂测验)：
   - **职责**：在当前课时白板上投影一道多选择随堂测验，供学生完成。
   - **命令**：`quiz.create` (调用 `whiteboard.draw` 进行投影渲染)。
2. **`Random Student Picker`** (随机学生提问)：
   - **职责**：随机抽取一名班级内的学生进行提问。
   - **命令**：`rollcall.pick` (调用 `class.get_students` 和 `whiteboard.draw` 同步效果)。

---

## 2. 内置插件 Inline 加载与 Kernel 集成设计

### 2.1 依赖获取与重构
旧代码中：
```typescript
import { kernelContainer } from '../kernel/index.js';
// 之后直接调用：kernelContainer.commandBus.execute(...)
```
重构后，每个内置插件将直接导出标准的插件配置对象，不直接引用全局 `kernelContainer`：
```typescript
import { ICommandBusServiceToken, ... } from '../di/interfaces.js';

export const VfsPlugin = {
  manifest: {
    id: "@openlearn/plugin-vfs",
    name: "Virtual File System Plugin",
    version: "1.0.0",
    requires: [
      "@openlearn/core:ICommandBusService@^1.0.0",
      "@openlearn/core:IActionRegistryService@^1.0.0"
    ]
  },
  activate: async (ctx) => {
    const commandBus = ctx.services.resolve(ICommandBusServiceToken);
    const actionRegistry = ctx.services.resolve(IActionRegistryServiceToken);
    // 注册 action 与 command handlers
  },
  deactivate: async () => {
    // 清理资源
  }
};
```

### 2.2 Kernel 层自动加载与 SQLite 初始化
Kernel 构造函数在初始化底层 DI 服务（如 `CommandBus`, `EventBus`, `ServiceRegistry`）后，应当负责内置插件的生命周期：
1. 在 `packages/core/kernel/index.ts` 导入重构后的内置插件模块。
2. 依次调用 `pluginHost.installPlugin(pluginModule)`。
3. 调用 `pluginHost.activatePlugin(pluginId)` 激活它们。
4. **SQLite 备份系统记录**：
   在 `installPlugin` 逻辑中，应当在 `plugins` 表中检查是否存在对应的内置插件记录。若无，则插入该记录（其中 `is_system` 或类似于 `execution_mode = 'inline'`，且禁止通过外部 API 卸载该插件）。
   为支持这一特性，本阶段需要在 `db/index.ts` 的 `plugins` 建表语句或启动期中加入对 `system` / `is_system` / `execution_mode` 的健壮支持，或者以 `try/catch ALTER TABLE` 加固方式升级。

---

## 3. 第三方插件 ZIP 自动打包与 Worker 线程运行

### 3.1 独立开发结构与打包脚本
第三方插件将作为标准的 ZIP 包 ESM 插件进行管理：
- Quiz 插件结构：
  ```
  packages/plugins/quiz/
  ├── manifest.json
  └── index.ts (编译后生成 index.js)
  ```
- 打包构建脚本 `scripts/build-plugins.mjs` 流程：
  1. 使用 Vite/esbuild 编译每个外部插件的 TypeScript 代码，输出为单文件 `index.js`。
  2. 使用 `jszip` 读取 `manifest.json` 与 `index.js`。
  3. 将文件压缩为 `dist/plugins/ext-quiz-generator.zip` 与 `dist/plugins/ext-roll-call.zip`。
  4. 将 `dist/plugins/` 写入 `.gitignore`。
  5. 整个步骤集成在 `pnpm build` 命令执行时。

### 3.2 启动期 Seeding
在 Express 服务器启动或 Kernel 初始化阶段，Kernel 检测 `dist/plugins/` 目录下的 `.zip` 文件，读取为 Buffer，然后利用新版 `PluginHost.installPluginFromZip(buffer, { executionMode: 'worker' })` 进行自动安装，如果数据库中已有新版本的同名插件则跳过或覆盖。
此时，`Quiz` 和 `Rollcall` 插件的 `execution_mode` 必须设定为 `'worker'`，迫使它们使用 `WorkerManager` + `NodeWorkerTransport` 产生独立的 Worker 线程运行。
它们与主线程的所有通信都必须通过 `ServiceProxy` 跨边界 RPC 通道，完全遵循 `PLUG-05` 声明的 capability 进行访问校验。

---

## 4. 彻底物理清除旧版 `plugin-runtime` 与 Legacy 路由

### 4.1 物理删除遗留文件
- 删除 `packages/core/plugin-runtime/index.ts`。
- 删除 `packages/core/plugin-runtime/` 下的其余相关 helper 模块。
- 清理 `tsconfig.json` 等配置中对旧路径的映射。

### 4.2 清理 Express 层 API 路由
- 搜索并移除 `server.ts` 中涉及旧版 VM 沙箱实例化、旧版插件安装/加载方法（例如不再调用 `pluginRuntime.loadFromDB()`，而是由 Kernel 在初始化时调用 `PluginHost`）。
- 移除只支持 legacy 格式的旧版 `/api/plugins/install-legacy` 路由，系统将只接收标准的 ZIP ESM 插件。

---

## 5. 验证与单元测试架构 (Dimension 8)

为了达到 Nyquist 高标准验证的要求，必须建立在 DI 服务级别下的插件层单元测试体系。

### 5.1 验证工具与用例
在 `packages/plugins/__tests__/` 下为这 8 个插件编写专门的 `vitest` 测试用例：
1. **内置插件测试**：
   - 模拟一个空的 `ServiceRegistry` 并注册好 Mock 版的 `CommandBus` / `EventBus` / `Database` 等核心服务。
   - 调用内置插件的 `activate(ctx)` 激活插件。
   - 验证其是否将对应的指令注册到了 CommandBus，且是否注册了正确的 Action 声明。
   - 直接发送 Command 到插件 Handler，验证返回值是否正常。
2. **第三方 Worker 插件测试**：
   - 检验 ZIP 打包后 `manifest.json` 的规范性（是否包含 `@openlearn/core:*@^1.0.0` 兼容版本配置）。
   - 实例化 `NodeWorkerTransport`，验证通过 RPC 代理方式跨进程获取核心服务的能力。

## 6. 验证架构与技术规范 (## Validation Architecture)

### 6.1 测试命令
```bash
npx vitest run packages/plugins/
```
### 6.2 覆盖率要求
重构后的 `builtin.ts`, `management.ts`, `vfs.ts`, `process.ts`, `ai-planner.ts`, `ai-submit-injector.ts` 代码，所有指令分支和核心事件流的测试覆盖率必须达到 90% 以上。
