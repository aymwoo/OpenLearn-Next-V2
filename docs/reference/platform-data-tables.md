# 平台数据表参考（Platform Data Tables）

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0`
> 插件通过 `ctx.resolve(IDatabaseToken)` 拿到**整个平台共享数据库**的裸 SQLite 句柄（SDK 类型 `SqliteDatabase`，运行时为 better-sqlite3 `Database`），可读写任意表。本页覆盖**平台核心表**（实测 62 张中的绝大部分），作为插件跨表查询/读写时的参考。
>
> ⚠️ **权限边界待澄清（文档层矛盾，非本页可单方面裁定）**：`docs/architecture/security-permissions.md` §1 的 RBAC 表把「访问 SQLite 数据库」对 Plugin 标为 ❌「只能用 Plugin DB」，而本页描述的 `IDatabaseToken` 能力恰好是**整个平台共享数据库句柄**。两处口径冲突：**在你依赖本页做跨表读写前，请先确认平台是否对插件开放 `IDatabaseToken`**。保守做法是优先用 `ctx.db`（自动加 `plugin_{pluginId}_` 前缀）或 `ctx.services.storage`。
>
> ⚠️ **本页不是完整字典**：插件安装后会按需动态创建 `plugin_{pluginId}_*` 私有表（实测某开发库中 34 张），且 `courseware_score_config`、`teaching_modes` 这类表仍可能随迁移加列。**权威清单始终以 `sqlite_master` 为准**：
>
> ```sql
> -- 核心表（排除插件私有表与影子表）
> SELECT name FROM sqlite_master
> WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
>   AND name NOT LIKE 'plugin\_%' ESCAPE '\'
>   AND name NOT LIKE '%\_\_rollback' ESCAPE '\'
> ORDER BY name;
> ```
>
> ⚠️ 若只想做插件私有数据，优先用 `ctx.db`（自动加 `plugin_{pluginId}_` 前缀）或 `ctx.services.storage`（`plugin_storage` 键值），见[插件数据库 API](plugin-database-api)。

---

## 0. 表的来源与计数（实测）

| 来源                                       | 表数 | 说明                                                             |
| ------------------------------------------ | ---- | ---------------------------------------------------------------- |
| `packages/core/db/index.ts`                | 41   | 内核 schema 初始化（`CREATE TABLE IF NOT EXISTS`）                |
| `server/bootstrap-db.ts`                   | 3    | `student_rollcalls` / `site_settings` / `agent_conversations`     |
| `server/utils/migrate.ts`                  | 1    | `_migrations`（另含 2 张 `*__rollback` 影子表，仅迁移回滚用）     |
| `migrations/000_initial_schema.sql`        | 36   | 全新安装的初始 schema                                            |
| `migrations/003`–`013`（11 个脚本）        | 28   | 课堂运行时 / 成绩归集 / 作业中枢 / 互动课堂 / 教学模式 / 同伴互评 / 分组 / 课堂信息流 / 自动录入 / 分数来源策略 |
| `migrations/014_performance_indexes.sql`   | 0    | 只建索引，不建表                                                  |
| **去重后核心表**                           | **62** | 上述全部来源去重的并集                                           |
| 插件私有表（运行时动态创建）               | 34   | `plugin_{pluginId}_*`，**数量随安装的插件而变**                   |

> 复核命令：`migrations/` 共 **15 个** SQL 脚本（`000`–`014`），外加 `README.md`。测试库 `server/__tests__/canary/` 中的 `plugin_submissions_new` / `plugin_submissions_legacy` 是测试夹具，不计入上表。

---

## 1. 内核 / 插件宿主表

### `plugins`

插件注册表。

| 列               | 类型    | 说明                                                        |
| ---------------- | ------- | ----------------------------------------------------------- |
| `id`             | TEXT PK | 插件 UUID（**不是** `manifest.id`，见[插件数据库 API](plugin-database-api)） |
| `name`           | TEXT    | 名称                                                        |
| `manifest`       | TEXT    | manifest JSON 字符串                                        |
| `source_code`    | TEXT    | 源码                                                        |
| `status`         | TEXT    | `active` / `inactive` / `error` 等                          |
| `created_at`     | INTEGER | 时间戳                                                      |
| `execution_mode` | TEXT    | `inline` / `worker`                                          |
| `loader_version` | TEXT    | 加载器版本（迁移执行器选择与兼容性判定用）                    |
| `zip_package`    | TEXT    | 原始 ZIP 包的 base64；**in-place update 依赖此列**定位回滚源  |
| `file_path`      | TEXT    | 磁盘源码路径（`plugins/{uuid}/index.js`）                    |
| `updated_at`     | INTEGER | 最后更新时间                                                |

> `execution_mode` / `loader_version` / `zip_package` / `file_path` / `updated_at` 五列均由 `ALTER TABLE plugins ADD COLUMN` 增量加入（`packages/core/db/index.ts` 的 `ensureColumn` 调用）。按本文清单做 INSERT 会丢更新时刻与 ZIP 来源；装插件时**务必带上 `zip_package`**，否则 in-place 更新无法回滚。

### `plugin_storage`

插件 KV 存储（`ctx.services.storage` 后端），按 `plugin_id` 隔离。

| 列           | 类型    | 说明     |
| ------------ | ------- | -------- |
| `plugin_id`  | TEXT    | 复合主键 |
| `key`        | TEXT    | 复合主键 |
| `value`      | TEXT    | 值       |
| `updated_at` | INTEGER | 时间戳   |

### `plugin_migrations`

插件 `ctx.db.migrate` 的版本追踪（`plugin_id` 主键 + `version INTEGER`）。

### `processes`

受控后台进程。`id` / `name` / `status` / `task_type` / `payload` / `state` / `logs` / `created_at` / `updated_at`。

### `pending_commands`

高危命令审批队列。`id` / `command_type` / `payload` / `actor_id` / `created_at`。

### `vfs_nodes`

虚拟文件系统节点。`id` / `parent_id` / `type` / `name` / `content` / `created_at` / `updated_at`。

### `events`

事件总线持久化。`id` / `type` / `source` / `payload` / `timestamp` / `correlationId`。

### `_migrations`

核心 schema 迁移记录（`server/utils/migrate.ts`）。

---

## 2. 用户 / 鉴权表

### `users`

| 列              | 类型        | 说明                                       |
| --------------- | ----------- | ------------------------------------------ |
| `id`            | TEXT PK     | 用户 ID                                    |
| `username`      | TEXT UNIQUE | 用户名                                     |
| `password_hash` | TEXT        | 密码哈希                                   |
| `role`          | TEXT        | `administrator` / `teacher` / `student` 等 |
| `name`          | TEXT        | 姓名                                       |
| `status`        | TEXT        | `active` 等                                |
| `created_at`    | INTEGER     | 时间戳                                     |

### `client_sessions`

会话。`id` / `session_data` / `updated_at` / `expires_at`。

---

## 3. 课程 / 班级 / 学生表

### `classes`

`id` / `name` / `description` / `class_passcode` / `created_at`。

### `students`

`id` / `student_number`(UNIQUE) / `name` / `email` / `password` / `locked_lesson_id` / `private_notes` / `created_at`。

### `class_students`

班级-学生关系。`class_id` + `student_id` 复合主键，`joined_at`。

### `lessons`

| 列                          | 类型    | 说明        |
| --------------------------- | ------- | ----------- |
| `id`                        | TEXT PK | 课节 ID     |
| `title`                     | TEXT    | 标题        |
| `content`                   | TEXT    | 内容        |
| `timeline`                  | TEXT    | 时间轴 JSON |
| `progress_mode`             | TEXT    | `manual` 等 |
| `progress_conditions`       | TEXT    | 进度条件    |
| `created_at` / `updated_at` | INTEGER | 时间戳      |

### `whiteboard_elements`

白板元素。`id` / `lesson_id` / `type` / `data`(JSON) / `created_at`。

### `student_lesson_progress`

`student_id` + `lesson_id` 复合主键，`completed` / `progress_percent` / `completed_segments` / `assigned_at`。

### `schedules`

排课。`id` / `class_id` / `lesson_id` / `scheduled_date` / `time_slot` / `status` / `notes` / `created_at`。

### `attendance`

考勤。`schedule_id` + `student_id` 复合主键，`status` / `recorded_at`。

### `student_rollcalls`

随机点名记录（`server/bootstrap-db.ts`）。`id` / `student_id` / `class_id` / `lesson_id` / `picked_time`。

### `computer_labs` / `student_seats`

机房与座位。`computer_labs`: `id` / `room_number` / `rows` / `cols`；`student_seats`: `class_id`+`student_id` 主键，`lab_id` / `row_idx` / `col_idx`。

### `class_groups`（迁移 `010`）

班级内自定义分组。`id` / `class_id` / `name` / `name_en` / `color` / `member_ids` / `leader_id` / `is_default` / `sort_order` / `created_at` / `updated_at`。成员直接存在 `member_ids`（JSON 数组），**不**经 `class_students.group_id` 关联。

### `teaching_modes`（迁移 `008`）

教学模式字典（内置 + 教师自建）。`id` / `name` / `name_en` / `description` / `description_en` / `icon` / `color` / `is_builtin` / `sort_order` / `created_at` / `updated_at`。被 `classroom_sessions.teaching_mode_id` 引用。

---

## 3.1 课堂运行时表（迁移 `003` / `007` / `008` / `009` / `011`）

本节是此前完全缺失的一组表（13 张 `classroom_*` + `lesson_quiz_submissions` + `lesson_preset_polls`）。

### `classroom_sessions`

课堂会话主表。`id` / `lesson_id` / `class_id` / `teacher_id` / `stage` / `current_segment_id` / `checkin_code` / `focus_mode` / `started_at` / `ended_at` / `settings_json` / `created_at` / `teaching_mode_id`。

> `stage = 'IN_CLASS_TEACHING'` 是「正在进行中的课节」的判据，`server/utils/auto-record-score.ts` 的 `findActiveLessonForStudent` 用它决定学生提交时是否实时录入成绩。
> `focus_mode` 承载全班锁屏 / 解锁。

### `classroom_quick_polls` / `classroom_poll_votes`

课堂快问快答。`classroom_quick_polls`: `id` / `session_id` / `lesson_id` / `question_type` / `title` / `options_json` / `correct_option` / `status` / `created_at`；`classroom_poll_votes`: `id` / `poll_id` / `student_id` / `student_name` / `selected_option` / `voted_at`。

### `lesson_preset_polls`

课节预置投票（开课前备好的题目）。`id` / `lesson_id` / `title` / `question_type` / `options_json` / `correct_option` / `sort_order` / `created_at` / `updated_at`。

### `lesson_quiz_submissions`

白板随堂练习作答的**唯一权威表**（迁移 `007` 引入）。`id` / `lesson_id` / `element_id` / `student_id` / `student_name` / `answer` / `score` / `is_correct` / `time_spent_ms` / `submitted_at`；`UNIQUE(lesson_id, element_id, student_id)`。

> ⚠️ 历史包袱：早期实现把作答写回 `whiteboard_elements.data.submissions` JSON，那是读-改-写，同题多名学生并发提交会互相覆盖丢成绩。已根治，`whiteboard_elements.data.submissions` 现在**仅作为存量历史数据保留展示兜底**。

### `classroom_buzzers`

抢答。`id` / `session_id` / `lesson_id` / `title` / `status` / `winner_student_id` / `winner_student_name` / `winner_response_time_ms` / `created_at`。

### `classroom_danmaku`

课堂弹幕。`id` / `session_id` / `lesson_id` / `sender_id` / `sender_name` / `text` / `type` / `voice_duration_seconds` / `top_percent` / `created_at`。

### `classroom_pacing_signals`

学生课堂节奏信号（过快 / 过慢 / 困惑等）。`id` / `session_id` / `student_id` / `signal_type` / `created_at`。

### 同伴互评一组（迁移 `009`）

| 表                            | 关键列                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `classroom_peer_rubric_dimensions` | `id` / `session_id` / `lesson_id` / `label` / `color_class` / `bar_color_class` / `max_score` / `weight` / `sort_order` / `created_at` |
| `classroom_peer_review_tasks`     | `id` / `session_id` / `lesson_id` / `class_id` / `reviewer_id` / `reviewer_name` / `target_student_id` / `target_student_name` / `target_attempt_id` / `target_work_title` / `target_score` / `tier` / `status` / `created_at` / `submitted_at` |
| `classroom_peer_reviews`          | `id` / `session_id` / `lesson_id` / `reviewer_id` / `reviewer_name` / `target_student_id` / `target_attempt_id` / `score` / `max_score` / `comment` / `dimension_scores_json` / `created_at` / `updated_at` |
| `classroom_peer_nominations`      | `id` / `session_id` / `lesson_id` / `nominator_id` / `nominated_student_id` / `nominated_student_name` / `honor_key` / `created_at` |
| `classroom_peer_badges`           | `id` / `session_id` / `lesson_id` / `sender_id` / `sender_name` / `receiver_id` / `receiver_name` / `badge_key` / `created_at` |

### `classroom_feed`（迁移 `011`）

课堂信息流条目。`id` / `session_id` / `lesson_id` / `class_id` / `type` / `message` / `actor_id` / `actor_name` / `source` / `created_at`。配合 `server/services/classroom-feed-service.ts` 使用；该服务内置一张 `classroom_feed` → 前端事件名的映射表（如 `whiteboard.quiz_answered` → `quiz_answered`）。

### `classroom_exit_tickets`（迁移 `007`）

下课条。`id` / `session_id` / `lesson_id` / `student_id` / `student_name` / `rating` / `puzzled_concept` / `feedback` / `created_at` / `core_answer` / `is_correct` / `tier_level` / `challenge_answer`。

---

## 4. 作业 / 考试 / 成绩表

### `assignments`

`id` / `class_id` / `lesson_id` / `title` / `description` / `content` / `created_at`。

### `assignment_submissions`

`assignment_id` + `student_id` 复合主键，`content` / `score` / `feedback` / `submitted_at` / `graded_at` / `status`（`submitted` / `graded` / `absent`）、`source`（`manual` / `auto`，迁移 `012`）。

> `source` 决定保护语义：`manual` 行（教师手动录入 / 标记缺考）**受自动录入规则保护**，自动路径遇 manual/absent 行一律跳过（见 `server/utils/auto-record-score.ts` 的 `promoteAttemptToGrade`）。
>
> 课件自动录入会把 `content` 写成 `attempt.extra_json`（原始作答明细），`feedback` 写成「由<来源>。课件完成度: <X>%。课件原始反馈: <comment>」。

### 作业中枢四表（迁移 `005`，`packages/core/db/index.ts`）

⚠️ 这四张表名字带 `plugin_` 前缀，但它们是**内核表**（在 `packages/core/db/index.ts` 与 `migrations/005_assignment_hub.sql` 中创建），**不是**插件私有表。插件私有表的判据是 `plugin_{pluginId}_`（UUID 或 manifestId 前缀，见[插件数据库 API](plugin-database-api)）。

| 表                          | 用途与关键列                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `plugin_assignments`        | 作业中枢主表；`class_id` / `lesson_id` / `element_id` / `title` / `instructions` / `due_at` / `allow_late` / `allow_text` / `allow_link` / `max_files` / `max_file_size` / `allowed_ext` / `peer_review_mode` / `peer_review_count` / `peer_review_due_at` / `teacher_weight` / `peer_weight` / `status` / `created_by` |
| `plugin_submission_versions`| 提交版本历史；`submission_id` / `assignment_id` / `student_id` / `version` / `files_json` / `text_content` / `link_url` / `is_late` / `submitted_at` |
| `plugin_assignment_files`   | 作业/提交附件；`assignment_id` / `submission_id` / `version_id` / `student_id` / `original_name` / `stored_path` / `size` / `mime` / `sha256` / `uploaded_at` / `deleted_at` |
| `plugin_peer_review_tasks`  | 同伴互评任务；`assignment_id` / `submission_id` / `reviewer_id` / `anonymous` / `status` / `due_at` / `created_at`       |

### `exams` / `exam_scores`

`exams`: `id` / `class_id` / `title` / `description` / `max_score`；`exam_scores`: `exam_id`+`student_id` 主键，`score` / `notes` / `recorded_at`。

### `class_grade_weights`

`class_id` 主键，`attendance_weight` / `progress_weight` / `assignment_weight` / `exam_weight` / `updated_at`。

### `student_semester_reports`

学期总评归档。`id` / `student_id` / `class_id` / `semester_name` / `attendance_score` / `progress_score` / `assignment_score` / `exam_score` / `total_score` / `grade_level` / `teacher_evaluation` / `ai_evaluation` / `dimension_scores`(JSON) / `created_at` / `updated_at`；`UNIQUE(student_id, class_id, semester_name)`。

---

## 5. 积分表（Points Ledger）

### `student_point_logs`

积分流水（`IPointsLedgerService.addPoints` 后端）。

| 列             | 类型    | 说明             |
| -------------- | ------- | ---------------- |
| `id`           | TEXT PK | 流水 ID          |
| `student_id`   | TEXT    | 学生 ID          |
| `class_id`     | TEXT    | 班级 ID          |
| `dimension_id` | TEXT    | 积分维度 ID      |
| `plugin_id`    | TEXT    | 来源插件（可空） |
| `delta_points` | REAL    | 变动分值         |
| `reason`       | TEXT    | 原因             |
| `created_at`   | INTEGER | 时间戳           |

> 积分维度（`IPointsDimensionRegistry`）注册于内存，无独立维度表；维度 ID 由插件自定。

---

## 6. 课件（Courseware）表

### `courseware`

`id` / `uuid`(UNIQUE) / `name` / `type` / `entry` / `created_at`。

### `courseware_attempt`

`id` / `courseware_id` / `student_id` / `started_at` / `finished_at` / `status`。

### `submission_raw` / `submission_result`

课件提交原始事件与结果。`submission_raw`: `id` / `attempt_id` / `event_type` / `payload_json` / `created_at`；`submission_result`: `id` / `attempt_id` / `score` / `comment` / `completion` / `extra_json`。

### `courseware_score_config`（迁移 `004` / `012` / `013`）

互动课件的**原生成绩归集策略**配置。`courseware_id` 为主键，`'*'` 表示全局默认配置。

| 列                          | 说明                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `courseware_id`             | 课件 ID（主键）；`GLOBAL_SCORE_CONFIG_KEY` 即 `'*'`                        |
| `courseware_name`           | 课件名（便于识别）                                                          |
| `score_policy`              | `LATEST`（默认）/ `MAX` / `AVERAGE` / `FIRST`                                |
| `score_fields`              | 分数所在字段路径，逗号分隔，如 `score,data.points`                          |
| `raw_full_score`            | 课件原始满分                                                                |
| `target_full_score`         | 归集后的目标满分                                                            |
| `weight_percentage`         | 该课件在总评中的权重（百分比）                                              |
| `lesson_id`                 | 关联课节（可选）                                                            |
| `auto_record_enabled`       | 是否开启「自动录入成绩」（迁移 `012`）                                      |
| `auto_record_min_completion`| 自动录入的完成度门槛（0~1，迁移 `012`）                                     |
| `auto_record_strategy`      | 自动录入的更新策略 `latest` / `highest`（迁移 `013`）                       |
| `updated_at`                | 更新时间                                                                    |

逻辑实现见 `packages/plugins/courseware-score.ts`（`resolveScoreConfig` / `aggregateAttemptScore` / `normalizeScorePolicy` / `describeAggregation`）。

---

## 7. 插件扩展数据表（示例插件自建）

以下表由内置示例插件创建（非内核），供参考其范式：

### `plugin_submissions`（作业提交插件）

`id` / `lesson_id` / `student_id` / `file_path` / `version` / `created_at` / `updated_at`；`UNIQUE(lesson_id, student_id)`。

### `plugin_peer_reviews`（同伴互评）

`id` / `submission_id` / `reviewer_id` / `score` / `comment` / `created_at`；`UNIQUE(submission_id, reviewer_id)`。

### `plugin_grades`（综合评分）

`id` / `submission_id`(UNIQUE) / `teacher_score` / `teacher_comment` / `teacher_weight` / `peer_weight` / `calculated_final_score` / `status` / `graded_at`。

---

## 8. 其他系统表

### `ai_providers`

AI Provider 配置。`id` / `name` / `api_url` / `api_key` / `model_name` / `created_at` / `updated_at`。

### `agent_conversations`

AI 助手对话记忆。`id` / `conv_key` / `role` / `content` / `created_at`。

### `site_settings`

站点设置。`id` / `site_name` / `slogan` / `logo_url`。

### `system_resources`

系统资源库。`id` / `name` / `type` / `content` / `created_at`。

### `student_read_notifications`

学生通知已读。`student_id` + `notification_id` 复合主键。

### `mfe_remotes`

微前端远程。`name` / `entry` / `meta` / `created_at` / `updated_at`。

> **提示（实测）**：
>
> - 核心 schema 初始化于 `packages/core/db/index.ts`（41 张 `CREATE TABLE IF NOT EXISTS`）
> - `server/bootstrap-db.ts` 补 3 张：`student_rollcalls` / `site_settings` / `agent_conversations`
> - `server/utils/migrate.ts` 维护 `_migrations`，另建 2 张 `*__rollback` 影子表（仅迁移回滚用，勿当业务表读）
> - 增量迁移在 `migrations/`，**共 15 个脚本 `000`–`014`**（`014_performance_indexes.sql` 只建索引不建表）
> - 上述来源去重后，核心表 **62 张**
> - 另有插件私有表 `plugin_{pluginId}_*`，数量随安装的插件而变（某开发库实测 34 张），不计入核心表
>
> 复核方式：见本文 §0 开头给出的 `sqlite_master` 查询。**本文不是完整字典**，以 `sqlite_master` 为准。

> 最后更新：2026-10-03（表清单与列结构按 `packages/core/db/index.ts`、`migrations/000`–`014` 及本地 `educational_os.db` 实测校准）
