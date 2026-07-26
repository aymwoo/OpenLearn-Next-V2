# Version Migration Guide 版本迁移指南

帮助开发者将插件与数据迁移至 OpenLearn V2 (`v0.1.12`) 最新架构：

- **0.1.11 -> 0.1.12 架构迁移**:
  - **学生积分与学期总分 (Points & Semester Grading)**：引入 `IPointsDimensionRegistryToken` 和 `IPointsLedgerServiceToken`。插件可通过 `IPointsDimensionRegistry` 动态注册自定义积分维度，并通过 `IPointsLedgerService.addPoints` 写入积分流水。
  - **互动白板多页系统 (Whiteboard Multi-Page Isolation)**：白板 `currentPage` 强隔离渲染，元素 `data` 中新增 `page` 与 `pageId` 绑定，避免跨页覆盖。
- **DI Token 转换**: 从字符串描述迁移至声明式 `Token<T>` 实例。
- **自定义服务暴露**: 使用 `ctx.provide(Token, instance)` 替代全局挂载。
- **SQLite 增量迁移**: 使用 `ctx.db.migrate(targetVersion, upgradeFn)` 自动执行。
