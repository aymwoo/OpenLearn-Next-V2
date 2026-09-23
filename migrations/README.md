# Database Migrations

本目录包含 OpenLearnV2 的版本化数据库迁移文件。

## 约定

- 文件名格式：`NNN_description.sql`（NNN 为三位序号）
- 每个文件包含 `-- UP`（应用迁移）和 `-- DOWN`（回滚迁移）两部分
- 迁移由 `server/utils/migrate.ts` 在服务启动时自动执行
- 已应用的迁移记录在 `_migrations` 表中

## 当前迁移列表

| 序号 | 文件                              | 描述                                                                              |
| ---- | --------------------------------- | --------------------------------------------------------------------------------- |
| 000  | 000_initial_schema.sql            | 初始完整 Schema（30+ 表与核心索引）                                               |
| 001  | 001_add_execution_mode.sql        | plugins 表添加 execution_mode                                                     |
| 002  | 002_add_client_session_expiry.sql | client_sessions 添加 expires_at                                                   |
| 003  | 003_classroom_runtime.sql         | 课堂工具与 AI 对话记忆表（student_rollcalls, site_settings, agent_conversations） |
| 004  | 004_courseware_score_config.sql   | 互动课件成绩归集策略表（courseware_score_config，宿主侧按策略从样本历史算最终分）  |
| 005  | 005_assignment_hub.sql            | 作业中心（plugin_assignments / plugin_submission_versions / plugin_assignment_files / plugin_peer_review_tasks，并重建 plugin_submissions 支持按作业唯一） |
| 006  | 006_classroom_event_bus.sql       | `events` 审计表补课堂维度：`lesson_id` 列与 (type,timestamp) / correlationId / (lesson_id,timestamp) 索引，让课堂事件可按时间窗口、业务流串联与课节重放查询 |
| 007  | 007_interactive_classroom.sql     | 互动课堂与课节生命周期（lesson_quiz_submissions / classroom_sessions / classroom_quick_polls / classroom_poll_votes / classroom_buzzers / classroom_exit_tickets / classroom_pacing_signals） |
| 008  | 008_teaching_modes.sql            | 教学模式表 teaching_modes 与 classroom_sessions.teaching_mode_id（课堂启动门户的模式选择器数据源） |
