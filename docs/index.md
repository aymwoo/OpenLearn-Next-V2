# OpenLearn V2 官方文档中心 (Official Documentation Center)

欢迎使用 **OpenLearn V2** 官方技术文档中心。OpenLearn V2 是一套全栈、分布式、基于插件化微前端与 Worker Thread 沙箱隔离架构的智能教育操作系统（Educational OS）。

本文档中心为 OpenLearn V2 平台的**唯一官方事实来源 (Single Source of Truth, SSOT)**，与当前开源代码库（`packages/core`, `packages/plugin-sdk@3.3.1`, `packages/plugin-test-kit@3.3.1`, `server.ts`, `src/`）保持 100% 同步。

---

```{toctree}
:maxdepth: 2
:caption: 🚀 快速入门 (Getting Started)
:hidden:

getting-started/overview
getting-started/installation-guide
getting-started/quickstart
```

```{toctree}
:maxdepth: 2
:caption: 🏛️ 平台架构 (Architecture)
:hidden:

architecture/system-overview
architecture/platform-kernel
architecture/composition-root
architecture/bootstrap-pipeline
architecture/layer-topology
architecture/capability-gateway
architecture/command-event-bus
architecture/configuration
architecture/dependency-injection
architecture/lesson-runtime
architecture/presence-collaboration
architecture/security-permissions
architecture/service-registry
architecture/whiteboard-runtime
architecture/workspace-runtime
architecture/architecture-synchronization-report
architecture/platform-foundation-audit-report
architecture/navigation-audit-report
```

```{toctree}
:maxdepth: 2
:caption: ⚙️ 内核与基础设施 (Core)
:hidden:

core/platform-kernel
core/bootstrap-pipeline
core/dependency-injection
core/service-registry
core/command-event-bus
```

```{toctree}
:maxdepth: 2
:caption: 🧩 插件生态与宿主 (Plugin)
:hidden:

plugin/plugin-architecture
plugin/plugin-lifecycle
plugin/plugin-registry
plugin/extension-registry
plugin/plugin-documentation-report
```

```{toctree}
:maxdepth: 2
:caption: 📦 SDK & 开发者工具 (SDK)
:hidden:

sdk/plugin-sdk
sdk/plugin-test-kit
sdk/scaffold-cli
```

```{toctree}
:maxdepth: 2
:caption: 🤖 AI 平台与智能体 (AI)
:hidden:

ai/ai-runtime
ai/ai-capability
ai/ai-teacher-workspace
ai/ai-documentation-report
```

```{toctree}
:maxdepth: 2
:caption: 🖥️ 工作区引擎 (Workspace)
:hidden:

workspace/workspace-runtime
workspace/layout-manager
```

```{toctree}
:maxdepth: 2
:caption: 📚 课程引擎 (Lesson)
:hidden:

lesson/lesson-runtime
lesson/lesson-lifecycle
```

```{toctree}
:maxdepth: 2
:caption: 🎨 白板与画布 (Whiteboard)
:hidden:

whiteboard/whiteboard-runtime
whiteboard/canvas-object-model
```

```{toctree}
:maxdepth: 2
:caption: 📊 学习分析引擎 (Analytics)
:hidden:

analytics/learning-analytics-engine
```

```{toctree}
:maxdepth: 2
:caption: 🚢 部署与运维 (Deployment)
:hidden:

deployment/production-guide
deployment/docker-nginx
```

```{toctree}
:maxdepth: 2
:caption: 🔧 系统配置规范 (Configuration)
:hidden:

configuration/system-configuration
```

```{toctree}
:maxdepth: 2
:caption: 📖 API 参考手册 (API Reference)
:hidden:

api/typescript-interfaces
api/di-tokens
api/api-coverage-report
```

```{toctree}
:maxdepth: 2
:caption: 💻 开发者指南 (Developer Guide)
:hidden:

developer-guide/developer-guide
developer-guide/testing-strategy
developer-guide/sync-report
```

```{toctree}
:maxdepth: 2
:caption: 🛡️ 管理员手册 (Administrator Guide)
:hidden:

administrator-guide/admin-manual
```

```{toctree}
:maxdepth: 2
:caption: 🎓 完全教程 (Tutorials)
:hidden:

tutorials/plugin-development-tutorial
```

```{toctree}
:maxdepth: 2
:caption: 💡 编译示例 (Examples)
:hidden:

examples/verifiable-examples
```

```{toctree}
:maxdepth: 2
:caption: 🗺️ 产品路线图 (Roadmap)
:hidden:

roadmap/documentation-roadmap
```

```{toctree}
:maxdepth: 2
:caption: 📋 发布日志 (Release Notes)
:hidden:

release-notes/v0.1.10
release-notes/v0.1.11
release-notes/v0.1.12
```

```{toctree}
:maxdepth: 2
:caption: 🔄 迁移指南 (Migration)
:hidden:

migration/version-migration
```

```{toctree}
:maxdepth: 2
:caption: 🎯 插件精准开发参考 (Plugin Dev Reference)
:hidden:

api/di-tokens
reference/plugin-capability-matrix
reference/plugin-ui-extension-slots
reference/plugin-database-api
reference/plugin-host-shared-deps
reference/plugin-update-distribution
```

```{toctree}
:maxdepth: 2
:caption: 🤝 社区与贡献 (Contributing)
:hidden:

contributing/contributing
```

```{toctree}
:maxdepth: 2
:caption: 🔍 故障排查 (Troubleshooting)
:hidden:

troubleshooting/troubleshooting-faq
troubleshooting/broken-reference-report
```

```{toctree}
:maxdepth: 2
:caption: ⚖️ 架构治理 (Governance)
:hidden:

governance/architecture-governance
```

---

## 全局模块速查

### 核心子系统导览

- **[Platform Kernel](core/platform-kernel)**: 4 层递进初始化 (Layer 0~3)，零依赖基础设施到 Worker 宿主管理器。
- **[Composition Root](architecture/composition-root)**: `server.ts` 统一组装根，Express API 路由与 Socket.IO 服务整合。
- **[Bootstrap Pipeline](core/bootstrap-pipeline)**: 5 阶段启动流水线（Startup -> Registration -> Initialization -> Activation -> Ready）。
- **[Plugin Host & Sandbox](plugin/plugin-architecture)**: Worker Thread 进程隔离、ESM 加载器与完整生命周期状态机。
- **[Plugin SDK](sdk/plugin-sdk)**: `@openlearn/plugin-sdk@3.3.1` 强类型定义、`Token<T>` DI 支持与 `ctx.provide()` 服务共享。
- **[AI Runtime & Tools](ai/ai-runtime)**: 原生集成 Google GenAI (Gemini 2.5/3.0)、Prompt 模板与 Function Calling 工具调用。

> 最后更新：2026-07-26
