# Phase 9: 前端集成 + 过渡期 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 09-前端集成 + 过渡期
**Areas discussed:** Frontend PluginHost Architecture, Extension Points Design, Browser Web Worker Implementation, Dual-System Transition Strategy, Plugin Management UI

---

## Frontend PluginHost 架构

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror backend architecture | ServiceRegistry + PluginHost lifecycle + zustand state + React Context provider | ✓ |
| Minimal — inject services via props | No DI container, pass services directly to plugin activate() | |

**[auto] Selected:** Mirror backend architecture — 复用已验证的后端 PluginHost 模式，使用 zustand 进行状态管理，React Context 避免 prop drilling。前端 Token 使用 `@openlearn/frontend:` 命名空间与后端区分。

**Notes:** zustand 已在依赖中但未使用。前端 ServiceRegistry 可简化（服务依赖扁平，无需完整拓扑排序）。

---

## Extension Points 设计

| Option | Description | Selected |
|--------|-------------|----------|
| Slot-based with React.lazy | 插件注册 component 工厂函数，PluginHost 懒加载渲染 | ✓ |
| iframe 隔离 | 每个插件 UI 组件在独立 iframe 中渲染 | |
| Static import map | 构建时确定所有扩展点，运行时无动态注册 | |

**[auto] Selected:** Slot-based with React.lazy — 最灵活且与 JupyterLab 模式一致。App.tsx 的硬编码 tabs 重构为从 PluginHost 动态渲染。iframe 隔离过于重量级且用户体验差。

---

## Browser Web Worker 实现

| Option | Description | Selected |
|--------|-------------|----------|
| Complete Phase 5 stub | 实现 BrowserWorkerTransport (Blob URL + new Worker()) + 镜像 ServiceHost | ✓ |
| SharedArrayBuffer + Atomics | 使用 SharedArrayBuffer 进行低延迟跨线程通信 | |
| Comlink library | 使用 comlink 库抽象 Worker 通信 | |

**[auto] Selected:** Complete Phase 5 stub — 沿用 Phase 5 已验证的 postMessage + ServiceProxy RPC 模式。Phase 5 已拒绝 comlink（D-05），保持一致。SharedArrayBuffer 需要 COOP/COEP headers，增加部署复杂度。

---

## 新旧系统过渡策略

| Option | Description | Selected |
|--------|-------------|----------|
| Modern-first routing + legacy badge | CommandBus 优先现代 handler，旧格式标记黄色 badge | ✓ |
| Full rewrite — no legacy | 删除所有旧格式插件，强制迁移 | |
| Dual command bus | 新旧完全隔离的两个 CommandBus 实例并行运行 | |

**[auto] Selected:** Modern-first routing + legacy badge — 渐进式策略，ROADMAP 明确要求"新旧插件系统并行运行过渡期"。Phase 8 已迁移所有内置插件，此策略主要用于可能存在的第三方旧格式插件。

---

## 前端 Plugin 管理 UI

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing plugin center | 在现有 teacherTab='plugins' UI 基础上增加 ZIP 拖拽、manifest 预览、legacy badge | ✓ |
| Build new dedicated page | 独立于 App.tsx 构建全新的插件管理页面 | |
| Modal-only approach | 所有插件操作通过弹窗完成，不修改主界面布局 | |

**[auto] Selected:** Extend existing plugin center — 现有 UI 已有 plugin 列表、install/uninstall/toggle 功能。Phase 9 扩展 ZIP 拖拽上传、manifest 预览、legacy 标记显示和迁移提示横幅。

---

## the agent's Discretion

以下领域由开发助手自主决定：
- React Context vs zustand 的具体使用比例
- Extension Point 的类型定义细节
- Blob URL 的缓存策略
- vitest + jsdom 测试策略
- Web Worker 的 mock 方式

## Deferred Ideas

- 前端 App.tsx 拆分为微前端架构 → Out of Scope，独立阶段
- 前端插件市场/商店 → Out of Scope
- 前后端共享 Token 定义（同构 DI）→ 未来探索方向
- PWA / Service Worker 离线支持 → 独立阶段
