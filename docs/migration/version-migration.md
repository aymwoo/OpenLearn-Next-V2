# Version Migration Guide 版本迁移指南

帮助开发者将插件与数据迁移至 OpenLearn V2 (`0.1.10`) 架构：

- **DI Token 转换**: 从字符串描述迁移至声明式 `Token<T>` 实例。
- **自定义服务暴露**: 使用 `ctx.provide(Token, instance)` 替代全局挂载。
- **SQLite 增量迁移**: 使用 `ctx.db.migrate(targetVersion, upgradeFn)` 自动执行。
