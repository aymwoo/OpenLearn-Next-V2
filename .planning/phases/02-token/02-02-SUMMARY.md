---
phase: 02-token
plan: 02
subsystem: kernel + plugin-runtime
tags: [IService-registration, DI-container, AIService-delegation, PluginRuntime-refactor]
tech-stack:
  added: [StorageService, AIService, IService注册到ServiceRegistry]
  patterns: [Token DI注册模式, 双路径兼容模式, 安全包装委托模式]
key-files:
  created: []
  modified:
    - packages/core/kernel/index.ts
    - packages/core/plugin-runtime/index.ts
decisions:
  - "D-14: 7个IService在Kernel构造函数中注册，ServiceRegistry初始化后、拦截器设置前"
  - "D-15: 按Layer 0->1->2依赖层级顺序创建子系统和注册IService"
  - "D-16: 注册时不声明requires/optional，依赖通过构造函数传参"
  - "D-07: wrappedStorage保持直接访问DB（per-plugin隔离），wrappedAI委托给AIService"
  - "D-09: 5个现有子系统使用as any类型断言注册，无需创建适配器类"
requires: [02-01]
provides: [IService注册到ServiceRegistry, wrappedAI->AIService委托]
affects: [Kernel构造函数, PluginRuntime.evaluateAndActivate]
metrics:
  duration: 90s
  completed_date: 2026-06-18
---

# Phase 2 Plan 2: Kernel IService 注册 + PluginRuntime AIService 委托 总结

将 7 个 IService 注册到 ServiceRegistry DI 容器，完成 Kernel 构造函数重构，并在 PluginRuntime 中将 wrappedAI 委托给独立的 AIService 实例。现有代码路径完全保持不变。

## 执行结果

### Task 1: Kernel 构造函数中注册 7 个 IService + 添加存储/AI 公共属性

**状态:** 完成
**提交:** 2d41739

**变更内容:**
- 导入 7 个 Service Token 实例、StorageService 类、AIService 类
- 新增 `public readonly storageService: StorageService` 和 `public readonly aiService: AIService` 属性声明
- 按 D-15 Layer 0->1->2 层级重排构造函数初始化顺序
- Layer 0: EventBus、CapabilityGuard、StorageService
- Layer 1: CommandBus（依赖 EventBus）、ActionRegistry
- Layer 2: ProcessManager、AIService、PluginRuntime
- 7 个 `serviceRegistry.register()` 调用按层级分组，在拦截器设置之前执行
- 5 个现有子系统使用 `as any` 类型断言注册（方法签名同步但 IService 声明 async）
- StorageService 和 AIService 直接注册无需类型断言（已 `implements IService`）

### Task 2: PluginRuntime evaluateAndActivate 中切换存储/AI 引用方式

**状态:** 完成
**提交:** 781e823

**变更内容:**
- wrappedAI.generateText 委托给 `this.kernel.aiService.generateText(prompt, options)`
- 移除约 75 行内联 AI 调用逻辑（provider 检查、Gemini fallback）
- 保留 createSafeFunction 安全包装层、try-catch 错误处理、`[Plugin:${manifest.id}]` 日志标签
- wrappedStorage 完全不变——继续直接访问 `this.kernel.db` 做 per-plugin 隔离（通过 `manifest.id` 作为 plugin_id）

## 验证结果

- **tsc --noEmit:** 无新增类型错误。32 个已有前端错误（InteractiveWhiteboard.tsx、TimetableManager.tsx 等）与本次修改完全无关
- **kernel/index.ts 结构:** 7 个 `serviceRegistry.register()` 调用全部存在，按 Layer 0->1->2 分组，在拦截器前执行
- **plugin-runtime/index.ts:** wrappedAI 使用 `this.kernel.aiService.generateText()` 委托调用，createSafeFunction 包装保持完整
- **现有属性兼容:** kernelContainer.commandBus、eventBus 等公开属性全部保留

## 偏差

无偏差——计划完全按照 PLAN.md 执行。

## 已知 Stubs

无。所有功能已完整实现，无 placeholder 或未完成的代码。

## 威胁标志

无新增威胁表面。wrappedAI 通过 createSafeFunction 包装委托给 AIService，安全层完整保留。ServiceRegistry.register 的 `as any` 类型断言仅在 Kernel 构造函数内部使用（受信任代码），不暴露给外部 API。

## 自检: PASSED

- [x] packages/core/kernel/index.ts — 文件存在，修改已提交（2d41739）
- [x] packages/core/plugin-runtime/index.ts — 文件存在，修改已提交（781e823）
- [x] 提交 2d41739 存在于 git log
- [x] 提交 781e823 存在于 git log
