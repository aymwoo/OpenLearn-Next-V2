# Database Migrations

本目录包含 OpenLearnV2 的版本化数据库迁移文件。

## 约定

- 文件名格式：`NNN_description.sql`（NNN 为三位序号）
- 每个文件包含 `-- UP`（应用迁移）和 `-- DOWN`（回滚迁移）两部分
- 迁移由 `server/utils/migrate.ts` 在服务启动时自动执行
- 已应用的迁移记录在 `_migrations` 表中

## 当前迁移列表

| 序号 | 文件 | 描述 |
|------|------|------|
| 000 | 000_initial_schema.sql | 初始完整 Schema（30+ 表） |
| 001 | 001_add_execution_mode.sql | plugins 表添加 execution_mode |
| 002 | 002_add_client_session_expiry.sql | client_sessions 添加 expires_at |
