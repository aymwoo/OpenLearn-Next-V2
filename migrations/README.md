# Database Migrations

本目录包含 OpenLearnV2 的版本化数据库迁移文件。

## 约定

- 文件名格式：`NNN_description.sql`（NNN 为三位序号）
- 每个文件包含 `-- UP`（应用迁移）和 `-- DOWN`（回滚迁移）两部分
- 迁移由 `server/utils/migrate.ts` 在服务启动时自动执行
- 已应用的迁移记录在 `_migrations` 表中

## 当前迁移列表

| 序号 | 文件                              | 描述                                                                                                                                                                                          |
| ---- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 000  | 000_initial_schema.sql            | 初始完整 Schema（30+ 表与核心索引）                                                                                                                                                           |
| 001  | 001_add_execution_mode.sql        | plugins 表添加 execution_mode                                                                                                                                                                 |
| 002  | 002_add_client_session_expiry.sql | client_sessions 添加 expires_at                                                                                                                                                               |
| 003  | 003_classroom_runtime.sql         | 课堂工具与 AI 对话记忆表（student_rollcalls, site_settings, agent_conversations）                                                                                                             |
| 004  | 004_courseware_score_config.sql   | 互动课件成绩归集策略表（courseware_score_config，宿主侧按策略从样本历史算最终分）                                                                                                             |
| 005  | 005_assignment_hub.sql            | 作业中心（plugin_assignments / plugin_submission_versions / plugin_assignment_files / plugin_peer_review_tasks，并重建 plugin_submissions 支持按作业唯一）                                    |
| 006  | 006_classroom_event_bus.sql       | `events` 审计表补课堂维度：`lesson_id` 列与 (type,timestamp) / correlationId / (lesson_id,timestamp) 索引，让课堂事件可按时间窗口、业务流串联与课节重放查询                                   |
| 007  | 007_interactive_classroom.sql     | 互动课堂与课节生命周期（lesson_quiz_submissions / classroom_sessions / classroom_quick_polls / classroom_poll_votes / classroom_buzzers / classroom_exit_tickets / classroom_pacing_signals） |
| 008  | 008_teaching_modes.sql            | 教学模式表 teaching_modes 与 classroom_sessions.teaching_mode_id（课堂启动门户的模式选择器数据源）                                                                                            |
| 009  | 009_classroom_peer_review.sql     | 课中互评（classroom_peer_review_groups / classroom_peer_review_submissions）                                                                                                                  |
| 010  | 010_class_groups.sql              | 小组（class_groups）                                                                                                                                                                            |
| 011  | 011_classroom_feed.sql            | 课堂动态流（classroom_feed）                                                                                                                                                                     |
| 012  | 012_auto_record_score.sql         | `courseware_score_config` 补自动录入规则列（auto_record_enabled / auto_record_min_completion），把「学生提交数据」页的逐条手动「录入成绩」升级为按规则自动录入 |
| 013  | 013_score_source_strategy.sql     | `assignment_submissions` 补 source 列（manual/auto 来源分流，自动路径遇 manual/缺考行受保护）+ `courseware_score_config` 补 auto_record_strategy（latest/highest 更新策略）                |
| 014  | 014_performance_indexes.sql       | 五个高频查询索引（vfs_nodes.parent_id、plugin_submissions.lesson_id、student_point_logs.student_id、student_rollcalls.class_id/student_id）                                                |
| 015  | 015_demo_data_registry.sql        | `demo_data_registry`：演示数据精确登记，清理时只删登记行 |
| 016  | 016_preset_polls_and_passcode_expiry.sql | 课程预设投票 `lesson_preset_polls`、班级口令有效期与点名奖赏字段 |
| 017  | 017_pacing_signals_segment.sql    | `classroom_pacing_signals.segment_id` 及会话分段索引 |
| 018  | 018_processes_plugin_owner.sql    | `processes.plugin_id`，后台任务可判定归属 |
| 019  | 019_plugins_version.sql           | `plugins.version`，版本可在 SQL 层查询 |
| 020  | 020_upload_max_file_mb.sql        | `site_settings.upload_max_file_mb`，课件上传上限改为管理员可配置 |
| 021  | 021_class_owner_and_password_gate.sql | `classes.owner_user_id`（教师仅能管理自己的班；空值仅管理员可见）与 `users.must_change_password`。空归属用 `node scripts/backfill-class-owners.mjs --assign <教师用户名>`，或 `UPDATE classes SET owner_user_id = '<教师用户 id>' WHERE owner_user_id IS NULL` |
| 022  | 022_plugin_public_routes.sql      | `plugin_public_routes`：管理员显式批准的插件公开路由。`auth: false` 本身不再匿名放行。升级后需重新批准 |
