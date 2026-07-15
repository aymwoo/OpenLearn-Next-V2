# OpenLearnV2 技术文档

```{toctree}
:maxdepth: 2
:hidden:

installation-guide
architecture_review_report
plugin-development-tutorial
scaffold
```

## 文档目录

### 核心架构与设计

- [核心架构与设计](architecture_review_report) — OpenLearnV2 平台架构全景：Kernel、CommandBus/EventBus、PluginHost 生命周期、Worker Thread 隔离、前端插件系统、安全模型、数据存储

### 插件开发指南

- [插件开发完全指南](plugin-development-tutorial) — 从零开始开发 OpenLearnV2 插件：架构概述、开发原理、API 文档、安全与权限、高级特性、测试与调试
- [插件脚手架开发指南](scaffold) — 使用 `@openlearn/plugin-sdk` CLI 工具快速创建、构建和发布插件

### 快速链接

- 插件 SDK npm 包：`@openlearn/plugin-sdk` (v3.2.1)
- 测试工具包：`@openlearn/plugin-test-kit`
- CLI 命令：`npx @openlearn/plugin-sdk init` / `npx @openlearn/plugin-sdk build`

---

> 文档基于 OpenLearnV2 `main` 分支最新代码，通过 Codegraph 知识图谱分析生成。
> 最后更新：2026-07-14
