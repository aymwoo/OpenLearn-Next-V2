# OpenLearn V2 技术文档

欢迎使用 OpenLearn V2 官方技术文档。OpenLearn V2 是一套全栈、分布式、基于插件化微前端架构的智能教育操作系统（Educational OS）。

---

```{toctree}
:maxdepth: 2
:caption: 入门与指南
:hidden:

getting-started/overview
getting-started/installation-guide
```

```{toctree}
:maxdepth: 2
:caption: 平台核心架构
:hidden:

architecture/platform-kernel
architecture/composition-root
architecture/bootstrap-pipeline
architecture/dependency-injection
architecture/configuration
architecture/service-registry
architecture/command-event-bus
architecture/capability-gateway
architecture/workspace-runtime
architecture/lesson-runtime
architecture/whiteboard-runtime
architecture/presence-collaboration
architecture/security-permissions
```

```{toctree}
:maxdepth: 2
:caption: 插件生态与开发
:hidden:

plugin-ecosystem/plugin-architecture
plugin-ecosystem/extension-registry
plugin-ecosystem/plugin-development-tutorial
plugin-ecosystem/scaffold-cli
plugin-ecosystem/plugin-distribution
```

```{toctree}
:maxdepth: 2
:caption: AI 平台与智能体
:hidden:

ai-platform/ai-runtime
ai-platform/ai-capability
ai-platform/ai-teacher-workspace
```

```{toctree}
:maxdepth: 2
:caption: 学习分析
:hidden:

analytics/learning-analytics-engine
```

```{toctree}
:maxdepth: 2
:caption: SDK 与 API 参考手册
:hidden:

sdk-api/plugin-sdk
sdk-api/plugin-test-kit
sdk-api/core-api-reference
```

```{toctree}
:maxdepth: 2
:caption: 开发者与贡献指南
:hidden:

developer-guide/developer-guide
developer-guide/testing-strategy
developer-guide/contributing
developer-guide/sync-report
```

---

## 快速导航

### 🚀 入门指南
- [平台概述](getting-started/overview) — OpenLearn V2 架构理念与核心能力
- [安装与部署](getting-started/installation-guide) — 环境准备、快速启动与部署配置

### 🏛️ 核心架构 (Source of Truth)
- [Platform Kernel](architecture/platform-kernel) — Kernel 分层架构 (Layer 0~3) 与内核生命周期
- [Composition Root & Server](architecture/composition-root) — 服务组装根、Express/Socket.IO 服务集成
- [Bootstrap Pipeline](architecture/bootstrap-pipeline) — 5 阶段（Startup -> Registration -> Initialization -> Activation -> Ready）引导流水线
- [Dependency Injection](architecture/dependency-injection) — 类型安全的 DI Token 注册与依赖解算
- [Capability Gateway](architecture/capability-gateway) — 权限网关、策略评估与能力治理
- [Workspace & Shell](architecture/workspace-runtime) — 交互式工作区、Widget 布局与 Shell 框架
- [Lesson Runtime](architecture/lesson-runtime) — 课程引擎、Flow/Stage 状态流转与 Session 生命周期
- [Whiteboard Runtime](architecture/whiteboard-runtime) — 白板引擎、Canvas 对象模型与协同渲染

### 🧩 插件生态与开发
- [插件架构与 Worker 沙箱](plugin-ecosystem/plugin-architecture) — Worker Thread 隔离、插件生命周期与 ESM 加载器
- [扩展点机制](plugin-ecosystem/extension-registry) — Extension Points 机制与 Contribution 注册
- [插件开发完全教程](plugin-ecosystem/plugin-development-tutorial) — 基于 `@openlearn/plugin-sdk` 的全流程插件开发指南
- [Scaffold CLI 脚手架](plugin-ecosystem/scaffold-cli) — 使用命令行工具快速初始化、构建与发布插件

### 🤖 AI 平台与智能体
- [AI Runtime Kernel](ai-platform/ai-runtime) — AI 内核、模型适配、Prompt 模板与流式响应
- [AI Capability & Tools](ai-platform/ai-capability) — AI 能力层、Skill 注册表与 Tool 自动化调用
- [AI Teacher Workspace](ai-platform/ai-teacher-workspace) — AI 助教协同、课堂巡视与作业自动批改

### 📦 SDK 与 API 参考
- [Plugin SDK API Reference](sdk-api/plugin-sdk) — `@openlearn/plugin-sdk` 完整 API 与 Token 定义
- [Plugin Test Kit](sdk-api/plugin-test-kit) — `@openlearn/plugin-test-kit` 单元测试与 Mock 工厂
- [Core API Reference](sdk-api/core-api-reference) — Core 核心服务 Token 与系统接口全集

---

> 💡 **提示**：本文档完全与 OpenLearn V2 最新源代码（`packages/core`, `packages/plugin-sdk`, `server.ts`, `src/`）保持严格同步。
