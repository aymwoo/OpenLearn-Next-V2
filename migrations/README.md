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
| 023  | 023_encrypt_class_passcodes.sql   | 标记班级临时口令改为 AES-256-GCM 密文。启动时 `encryptStoredClassPasscodes()` 把仍是明文的行加密，已带 `olenc1:` 的行跳过 |
| 024  | 024_segment_gates.sql             | 教学环节门槛：`segment_visits`（停留）、`segment_gate_overrides`（教师放行）、`lesson_checkins`（无排课时的签到） |
| 025  | 025_assignment_lookup_indexes.sql | `assignment_submissions(student_id)` 与 `assignments(lesson_id)` 索引，供课节进度聚合作业最高分和学生提交查询。可重复执行 |
| 026  | 026_plugin_grants.sql             | 第三方插件能力授权与出站网络白名单表（`plugin_capability_grants` / `plugin_network_grants`） |
| 027  | 027_academic_year.sql             | 学年维度：为 schedules/assignments/attendance/exams/semester reports 等表增加 `academic_year` 字段与索引；site_settings 增加当前学年配置 |
| 028  | 028_classroom_indexes.sql         | 补齐课堂互动与会话高频查询/级联删除索引（`classroom_buzzers`、`classroom_sessions`） |
| 029  | 029_clean_lesson_think_artifacts.sql | 课程大纲模型思维链残留 (<think>...</think>) 清洗标记与启动期幂等清理 |
| 030  | 030_backfill_academic_year.sql    | 学年历史数据回填：为老数据库中 NULL 学年的排课/作业/考勤等按日期与父级关联平滑补齐 |
| 031  | 031_assessment_core.sql           | 测评子系统核心数据结构（试卷、考试、题库、题目等） |
| 032  | 032_progress_verification.sql      | 学习进度区分「学生自报」与「已验证」：新增 `verified` / `verified_progress_percent`，成绩只计入已验证进度；历史进度回填为已验证以保持既有成绩口径 |
| 033  | 033_student_lock_mode.sql         | 学生端锁定模式 (lock_mode) 与锁定目标 (lock_target) |
| 034  | 034_plugin_orphan_data.sql        | 插件卸载数据语义：孤立插件数据登记表（`plugin_orphan_data`，keep 保留登记 / purge 归档后可清除） |
| 035  | 035_icebreaker_checkins.sql       | 课前破冰心情打卡持久化与去重（`icebreaker_checkins` 表与按学生去重唯一索引） |
| 036  | 036_student_read_notifications_created_at.sql | 保留策略：为 `student_read_notifications` 补齐 `created_at` 以便按 30 天窗口清理 |
| 037  | 037_plugin_config_scopes.sql      | 插件配置分层：`plugin_config` 表（平台/学校/班级），旧 `plugin_storage` 的 `config:*` 值迁移到平台层 |


