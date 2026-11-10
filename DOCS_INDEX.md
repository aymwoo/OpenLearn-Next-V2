# 根目录文档索引

> 本文件说明仓库根目录 Markdown 文档各自的用途与阅读顺序。最后更新：2026-11-08。

根目录只保留**长期有效的常驻文档**与**运行时依赖的参考手册**；带日期的审计、整改计划与台账快照不放在根目录。

## 常驻文档

| 文档                                         | 作用                                                                                                                                  | 何时读                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| [README.md](README.md)                       | 项目门面：核心特性、技术栈、快速上手与在线文档库入口、双平台（GitHub 主仓 / Gitee 镜像）说明、构建运行命令                            | 第一次接触项目             |
| [CHANGELOG.md](CHANGELOG.md)                 | 版本变更日志（Keep a Changelog），含 `## [Unreleased]` 草稿区；平台版号独立于 `@openlearn/plugin-sdk` / `plugin-test-kit`             | 发版、查某改动落在哪个版本 |
| [AGENTS.md](AGENTS.md)                       | 所有 AI Agent 的协作规范：项目结构、质量门禁、Issue-First / PR-Driven 流程、禁止直推 main、禁止擅自合并、Release 规范                 | 任何 AI 辅助开发之前       |
| [CLAUDE.md](CLAUDE.md)                       | 给 Claude Code 的专属指引：项目概述、常用命令、技术栈、目录结构                                                                       | 使用 Claude Code 时        |
| [docs_plugin_guide.md](docs_plugin_guide.md) | 自包含的第三方插件 SDK 权威参考（API 契约、类型声明、安全规范、DB 设计、UI 槽位、双运行时），可整篇作为提示词上下文喂给大模型生成插件 | 写第三方插件、查 API 契约  |

> ⚠️ `docs_plugin_guide.md` 由 `server/routes/plugins.ts` 的 `GET /api/docs/plugin-guide` 读取，解析顺序为：发布包根目录（`dist/../`）→ 源码仓库根目录 → 进程工作目录。该文件已列入 `package.json` 的 `files`，**请勿移动或改名**。另注意 `docs/reference/plugin-host-shared-deps.md` 已指出其中部分内容（如 `HostSharedDeps.socketService` / React UI 扩展）与运行时不符，契约请以代码与 `docs/` 官方教程为准。

## 阅读顺序建议

1. 新成员 / 新 Agent：`README.md` → `AGENTS.md` → `docs/getting-started/quickstart-handbook.md`
2. 写插件：`docs/` 官方教程 → `docs_plugin_guide.md`（API 速查）→ 对照 `packages/plugin-sdk/`
3. 查现状：读代码与 `docs/` 权威页面，**不要**把带日期的历史报告当作当前事实
