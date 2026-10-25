# 平台数据表参考（Platform Data Tables）

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0`
> 插件通过 `ctx.resolve(IDatabaseToken)` 拿到**整个平台共享数据库**的裸 SQLite 句柄（SDK 类型 `SqliteDatabase`，运行时为 better-sqlite3 `Database`），可读写任意表。本页覆盖**平台核心表**（当前 82 张，完整清单见文末自动生成段），作为插件跨表查询/读写时的参考。
>
> ⚠️ **权限边界待澄清（文档层矛盾，非本页可单方面裁定）**：`docs/architecture/security-permissions.md` §1 的 RBAC 表把「访问 SQLite 数据库」对 Plugin 标为 ❌「只能用 Plugin DB」，而本页描述的 `IDatabaseToken` 能力恰好是**整个平台共享数据库句柄**。两处口径冲突：**在你依赖本页做跨表读写前，请先确认平台是否对插件开放 `IDatabaseToken`**。保守做法是优先用 `ctx.db`（自动加 `plugin_{pluginId}_` 前缀）或 `ctx.services.storage`。
>
> ⚠️ **本页不是完整字典**：插件安装后会按需动态创建 `plugin_{pluginId}_*` 私有表（数量随安装的插件而变），且各类表仍可能随迁移加列。**结构权威清单是 `migrations/schema-golden.json`（金样）与 `sqlite_master`**——改迁移后跑 `pnpm db:gen-golden && pnpm db:gen-tables` 同步金样与本页文末清单：
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

| 来源                                | 表数       | 说明                                                                                |
| ----------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `migrations/*.sql`（唯一结构 SSOT） | **82**     | 空库顺序跑完 `000`–`043` 全部迁移后的核心表（`migrations/schema-golden.json` 实测） |
| 插件私有表（运行时动态创建）        | 随安装而变 | `plugin_{scopeId}_*`，不在金样/本页清单内                                           |

> 早期的「内核内联 schema / bootstrap-db 建表」来源已收敛：`packages/core/db/index.ts` 模块加载即跑全量迁移，`server/bootstrap-db.ts` 只做旧插件升级与过期会话清理，不建表。逐迁移职责见 `migrations/README.md`。

---

## 1. 内核 / 插件宿主表

### `plugins`

插件注册表。

| 列               | 类型    | 说明                                                                         |
| ---------------- | ------- | ---------------------------------------------------------------------------- |
| `id`             | TEXT PK | 插件 UUID（**不是** `manifest.id`，见[插件数据库 API](plugin-database-api)） |
| `name`           | TEXT    | 名称                                                                         |
| `manifest`       | TEXT    | manifest JSON 字符串                                                         |
| `source_code`    | TEXT    | 源码                                                                         |
| `status`         | TEXT    | `active` / `inactive` / `error` 等                                           |
| `created_at`     | INTEGER | 时间戳                                                                       |
| `execution_mode` | TEXT    | `inline` / `worker` / `process`（第三方插件强制 `process`）                  |
| `version`        | TEXT    | 插件版本（迁移 `019`）                                                       |
| `loader_version` | TEXT    | 加载器版本（迁移执行器选择与兼容性判定用）                                   |
| `zip_package`    | TEXT    | 原始 ZIP 包的 base64；**in-place update 依赖此列**定位回滚源                 |
| `file_path`      | TEXT    | 磁盘源码路径（`plugins/{uuid}/index.js`）                                    |
| `updated_at`     | INTEGER | 最后更新时间                                                                 |

> `version`（迁移 `019`）等增量列均经由迁移 `ALTER TABLE plugins ADD COLUMN` 加入。按本文清单做 INSERT 会丢更新时刻与 ZIP 来源；装插件时**务必带上 `zip_package`**，否则 in-place 更新无法回滚。

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

受控后台进程。`id` / `name` / `plugin_id`（归属插件，迁移 `018`） / `status` / `task_type` / `payload` / `state` / `logs` / `created_at` / `updated_at`。

### `pending_commands`

高危命令审批队列。`id` / `command_type` / `payload` / `actor_id` / `created_at`。

### `vfs_nodes`

虚拟文件系统节点。`id` / `parent_id` / `type` / `name` / `content` / `created_at` / `updated_at`。

### `events`

事件总线持久化。`id` / `type` / `source` / `payload` / `timestamp` / `correlationId` / `lesson_id`（迁移 `006` 补课堂维度，配套 `(type,timestamp)` / `correlationId` / `(lesson_id,timestamp)` 索引）。

### `_migrations`

核心 schema 迁移记录（SSOT 在 `packages/core/db/migrator.ts`）。

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

`id` / `name` / `description` / `class_passcode` / `class_passcode_expires_at` / `lab_id` / `owner_user_id` / `created_at`。`class_passcode` 落库为 AES-256-GCM 密文（前缀 `olenc1:`），教师接口解密后返回原文；`owner_user_id` 用于班级归属授权（迁移 `021`）。

### `students`

`id` / `student_number`(UNIQUE) / `name` / `email` / `password` / `locked_lesson_id` / `private_notes` / `avatar` / `lock_mode` / `lock_target` / `created_at`（`avatar` 见迁移早期；`lock_mode`/`lock_target` 见迁移 `033` 学生锁定模式）。

### `class_students`

班级-学生关系。`class_id` + `student_id` 复合主键，`joined_at`。

### `lessons`

| 列                          | 类型    | 说明                                                                        |
| --------------------------- | ------- | --------------------------------------------------------------------------- |
| `id`                        | TEXT PK | 课节 ID                                                                     |
| `title`                     | TEXT    | 标题                                                                        |
| `content`                   | TEXT    | 内容                                                                        |
| `timeline`                  | TEXT    | 时间轴 JSON。环节可含 `gates: [{ id?, type, params? }]`                     |
| `progress_mode`             | TEXT    | **已废弃**。仅当环节没有自己的 `gates` 且不是第一环时，`gated` 仍作兼容回退 |
| `progress_conditions`       | TEXT    | **已废弃**。已知字段会映射为内置环节条件，新课请写在 `timeline.gates`       |
| `created_at` / `updated_at` | INTEGER | 时间戳                                                                      |

### `segment_visits`

学生在某一环节上的停留。`id` / `lesson_id` / `segment_id` / `student_id` / `entered_at` / `left_at`。教师推进全班环节时，其他环节上仍打开的访问会被写上 `left_at`。`dwell_seconds` 读取已结束区间，以及仍打开的访问直到当前时刻。

### `segment_gate_overrides`

教师对「学生 × 环节」的放行。主键 `(lesson_id, segment_id, student_id)`，另有 `actor_id` / `reason` / `created_at`。写入与撤销分别发布 `segment.gate_overridden` 与 `segment.gate_override_revoked`。

### `lesson_checkins`

课节级签到。主键 `(lesson_id, student_id)`，`checked_in_at`。没有排课行时，课堂签到仍写这里，供 `checked_in` 条件读取。有排课且考勤为 `present` 时同样视为已签到。

### `whiteboard_elements`

白板元素。`id` / `lesson_id` / `type` / `data`(JSON) / `created_at`。

### `student_lesson_progress`

`student_id` + `lesson_id` 复合主键，`completed` / `progress_percent` / `completed_segments` / `assigned_at`。迁移 `032` 起新增 `verified`（1 = 教师/课件/受信插件已验证，成绩只采用该部分）与 `verified_progress_percent`（验证时的进度值，学生自报只改 `progress_percent`，不覆盖此列）。

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

课堂会话主表。`id` / `lesson_id` / `class_id` / `teacher_id` / `stage` / `current_segment_id` / `checkin_code` / `focus_mode` / `started_at` / `ended_at` / `settings_json` / `created_at` / `teaching_mode_id` / `academic_year`（迁移 `027`）。

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

| 表                                 | 关键列                                                                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classroom_peer_rubric_dimensions` | `id` / `session_id` / `lesson_id` / `label` / `color_class` / `bar_color_class` / `max_score` / `weight` / `sort_order` / `created_at`                                                                                                          |
| `classroom_peer_review_tasks`      | `id` / `session_id` / `lesson_id` / `class_id` / `reviewer_id` / `reviewer_name` / `target_student_id` / `target_student_name` / `target_attempt_id` / `target_work_title` / `target_score` / `tier` / `status` / `created_at` / `submitted_at` |
| `classroom_peer_reviews`           | `id` / `session_id` / `lesson_id` / `reviewer_id` / `reviewer_name` / `target_student_id` / `target_attempt_id` / `score` / `max_score` / `comment` / `dimension_scores_json` / `created_at` / `updated_at`                                     |
| `classroom_peer_nominations`       | `id` / `session_id` / `lesson_id` / `nominator_id` / `nominated_student_id` / `nominated_student_name` / `honor_key` / `created_at`                                                                                                             |
| `classroom_peer_badges`            | `id` / `session_id` / `lesson_id` / `sender_id` / `sender_name` / `receiver_id` / `receiver_name` / `badge_key` / `created_at`                                                                                                                  |

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

| 表                           | 用途与关键列                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin_assignments`         | 作业中枢主表；`class_id` / `lesson_id` / `element_id` / `title` / `instructions` / `due_at` / `allow_late` / `allow_text` / `allow_link` / `max_files` / `max_file_size` / `allowed_ext` / `peer_review_mode` / `peer_review_count` / `peer_review_due_at` / `teacher_weight` / `peer_weight` / `status` / `created_by` |
| `plugin_submission_versions` | 提交版本历史；`submission_id` / `assignment_id` / `student_id` / `version` / `files_json` / `text_content` / `link_url` / `is_late` / `submitted_at`                                                                                                                                                                    |
| `plugin_assignment_files`    | 作业/提交附件；`assignment_id` / `submission_id` / `version_id` / `student_id` / `original_name` / `stored_path` / `size` / `mime` / `sha256` / `uploaded_at` / `deleted_at`                                                                                                                                            |
| `plugin_peer_review_tasks`   | 同伴互评任务；`assignment_id` / `submission_id` / `reviewer_id` / `anonymous` / `status` / `due_at` / `created_at`                                                                                                                                                                                                      |

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

| 列                           | 说明                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `courseware_id`              | 课件 ID（主键）；`GLOBAL_SCORE_CONFIG_KEY` 即 `'*'`   |
| `courseware_name`            | 课件名（便于识别）                                    |
| `score_policy`               | `LATEST`（默认）/ `MAX` / `AVERAGE` / `FIRST`         |
| `score_fields`               | 分数所在字段路径，逗号分隔，如 `score,data.points`    |
| `raw_full_score`             | 课件原始满分                                          |
| `target_full_score`          | 归集后的目标满分                                      |
| `weight_percentage`          | 该课件在总评中的权重（百分比）                        |
| `lesson_id`                  | 关联课节（可选）                                      |
| `auto_record_enabled`        | 是否开启「自动录入成绩」（迁移 `012`）                |
| `auto_record_min_completion` | 自动录入的完成度门槛（0~1，迁移 `012`）               |
| `auto_record_strategy`       | 自动录入的更新策略 `latest` / `highest`（迁移 `013`） |
| `updated_at`                 | 更新时间                                              |

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

MFE 远端登记。MFE 执行边界已移除，表保留作历史数据兼容。`created_at` / `entry` / `meta` / `name` / `updated_at`

---

## 9. 测评与题库表（迁移 `031` / `038` / `039`）

### `assessments`

测评主表（试卷/测验）。`academic_year` / `created_at` / `description` / `id` / `kind` / `owner_id` / `published_at` / `settings_json` / `status` / `title` / `updated_at`。

### `assessment_items`

测评条目。`answer_key_json` / `assessment_id` / `bank_item_id` / `config_json` / `id` / `max_score` / `section` / `sort_order` / `stem` / `type`（`bank_item_id` 关联题库条目）。

### `assessment_assignments`

测评指派。`academic_year` / `assessment_id` / `class_id` / `closes_at` / `created_at` / `created_by` / `duration_sec` / `exam_id` / `id` / `lesson_id` / `opens_at` / `schedule_id` / `score_released` / `session_id` / `status`。

### `assessment_attempts`

测评作答。`academic_year` / `anon_key` / `assignment_id` / `attempt_no` / `deadline_at` / `id` / `max_score` / `needs_manual_review` / `paper_json` / `proctor_json` / `score` / `started_at` / `status` / `student_id` / `submitted_at`（`anon_key` 支持匿名批改；`proctor_json` 记录监考事件，见 `PUT /api/assessment-attempts/:id/proctor`）。

### `assessment_answers`

逐题作答。`ai_suggestion_json` / `answer_json` / `attempt_id` / `feedback` / `graded_at` / `graded_by` / `grader` / `is_correct` / `item_id` / `manual_override` / `max_score` / `score` / `updated_at`（`ai_suggestion_json` 为 AI 批改建议，迁移 `038`）。

### `question_bank_items`（迁移 `039`）

题库条目（跨测评复用，`visibility` 控制共享范围）。

`answer_key_json` / `config_json` / `created_at` / `difficulty` / `id` / `owner_id` / `stem` / `tags_json` / `type` / `updated_at` / `visibility`

---

## 10. 插件治理与配置表（迁移 `022` / `026` / `034` / `037`）

### `plugin_config`

插件配置键值（`scope_type` 见 [ADR-001](../architecture/adr-001-tenant-and-db-abstraction)：`school` 为预留枚举位，一校一实例下无自动来源）。

`key` / `plugin_id` / `scope_id` / `scope_type` / `updated_at` / `value`

### `plugin_public_routes` / `plugin_network_grants` / `plugin_capability_grants`

插件公开路由、出站域名、能力授权的**管理员批准记录**（R-02 出站授权闭环）。

- `plugin_public_routes`: `approved_at` / `method` / `path` / `plugin_key`
- `plugin_network_grants`: `approved_at` / `host` / `plugin_key`
- `plugin_capability_grants`: `approved_at` / `capability` / `plugin_key`

### `plugin_orphan_data`（迁移 `034`）

卸载插件时的数据导出登记（便于事后追溯/恢复）。

`last_export_path` / `manifest_id` / `migration_version` / `plugin_id` / `plugin_name` / `plugin_version` / `row_count` / `storage_keys` / `table_names` / `table_prefixes` / `uninstalled_at`

---

## 11. 其余平台表

### `assignment_grade_history`（迁移 `040`）

成绩变更审计（重交内容留痕，Issue #248）。

`actor_id` / `actor_role` / `assignment_id` / `created_at` / `id` / `new_score` / `new_source` / `new_status` / `old_content` / `old_score` / `old_source` / `old_status` / `reason` / `student_id`

### `icebreaker_checkins`（迁移 `035`）

课前心态打卡（破冰基线统计的数据源）。

`checkin_date` / `class_id` / `created_at` / `id` / `lesson_id` / `mood` / `scope_key` / `student_id` / `updated_at`

### `demo_data_registry`（迁移 `015`）

演示数据登记（`pnpm dev:demo` 播种、`PURGE_DEMO_DATA` 清理的依据）。

`created_at` / `entity_id` / `entity_type`

### 迁移标记表 `_academic_year_backfill` / `_class_passcode_encryption` / `_lesson_think_cleanup`

一次性数据回填/清理迁移的**完成标记**（行存在即表示该迁移已执行，勿当业务表读写）。

---

## 12. 完整表清单（自动生成，勿手改）

由 `migrations/schema-golden.json` 生成。改迁移后先 `pnpm db:gen-golden`（再生成金样），再 `pnpm db:gen-tables`（刷新本段）；两步都跑，数据字典就不会随迁移漂移。

<!-- AUTO-GENERATED:table-inventory BEGIN -->

共 **82** 张表（迁移 44 个，金样生成于 2026-10-25T04:30:00.287Z）。列清单为列名（类型与约束见迁移 SQL）：

- `_academic_year_backfill`: backfilled_at, id
- `_class_passcode_encryption`: id, note
- `_lesson_think_cleanup`: id, note
- `_migrations`: applied_at, checksum, name
- `agent_conversations`: content, conv_key, created_at, id, role
- `ai_providers`: api_key, api_url, created_at, id, model_name, name, updated_at
- `assessment_answers`: ai_suggestion_json, answer_json, attempt_id, feedback, graded_at, graded_by, grader, is_correct, item_id, manual_override, max_score, score, updated_at
- `assessment_assignments`: academic_year, assessment_id, class_id, closes_at, created_at, created_by, duration_sec, exam_id, id, lesson_id, opens_at, schedule_id, score_released, session_id, status
- `assessment_attempts`: academic_year, anon_key, assignment_id, attempt_no, deadline_at, id, max_score, needs_manual_review, paper_json, proctor_json, score, started_at, status, student_id, submitted_at
- `assessment_items`: answer_key_json, assessment_id, bank_item_id, config_json, id, max_score, section, sort_order, stem, type
- `assessments`: academic_year, created_at, description, id, kind, owner_id, published_at, settings_json, status, title, updated_at
- `assignment_grade_history`: actor_id, actor_role, assignment_id, created_at, id, new_score, new_source, new_status, old_content, old_score, old_source, old_status, reason, student_id
- `assignment_submissions`: academic_year, assignment_id, content, feedback, graded_at, graded_by, score, source, status, student_id, submitted_at
- `assignments`: academic_year, class_id, content, created_at, description, id, lesson_id, title
- `attendance`: academic_year, recorded_at, schedule_id, status, student_id
- `class_grade_weights`: assignment_weight, attendance_weight, class_id, exam_weight, progress_weight, updated_at
- `class_groups`: class_id, color, created_at, id, is_default, leader_id, member_ids, name, name_en, sort_order, updated_at
- `class_students`: class_id, joined_at, student_id
- `classes`: class_passcode, class_passcode_expires_at, created_at, description, id, lab_id, name, owner_user_id
- `classroom_buzzers`: created_at, id, lesson_id, session_id, status, title, winner_response_time_ms, winner_student_id, winner_student_name
- `classroom_danmaku`: created_at, id, lesson_id, sender_id, sender_name, session_id, text, top_percent, type, voice_duration_seconds
- `classroom_exit_tickets`: challenge_answer, core_answer, created_at, feedback, id, is_correct, lesson_id, puzzled_concept, rating, session_id, student_id, student_name, tier_level
- `classroom_feed`: actor_id, actor_name, class_id, created_at, id, lesson_id, message, session_id, source, type
- `classroom_pacing_signals`: created_at, id, segment_id, session_id, signal_type, student_id
- `classroom_peer_badges`: badge_key, created_at, id, lesson_id, receiver_id, receiver_name, sender_id, sender_name, session_id
- `classroom_peer_nominations`: created_at, honor_key, id, lesson_id, nominated_student_id, nominated_student_name, nominator_id, session_id
- `classroom_peer_review_tasks`: class_id, created_at, id, lesson_id, reviewer_id, reviewer_name, session_id, status, submitted_at, target_attempt_id, target_score, target_student_id, target_student_name, target_work_title, tier
- `classroom_peer_reviews`: comment, created_at, dimension_scores_json, id, lesson_id, max_score, reviewer_id, reviewer_name, score, session_id, target_attempt_id, target_student_id, updated_at
- `classroom_peer_rubric_dimensions`: bar_color_class, color_class, created_at, id, label, lesson_id, max_score, session_id, sort_order, weight
- `classroom_poll_votes`: id, poll_id, selected_option, student_id, student_name, voted_at
- `classroom_quick_polls`: correct_option, created_at, id, lesson_id, options_json, question_type, session_id, status, title
- `classroom_sessions`: academic_year, checkin_code, class_id, created_at, current_segment_id, ended_at, focus_mode, id, lesson_id, settings_json, stage, started_at, teacher_id, teaching_mode_id
- `client_sessions`: expires_at, id, session_data, updated_at
- `computer_labs`: cols, created_at, id, room_number, rows
- `courseware`: created_at, entry, id, name, type, uuid
- `courseware_attempt`: courseware_id, finished_at, id, started_at, status, student_id
- `courseware_score_config`: auto_record_enabled, auto_record_min_completion, auto_record_strategy, courseware_id, courseware_name, lesson_id, raw_full_score, score_fields, score_policy, target_full_score, updated_at, weight_percentage
- `demo_data_registry`: created_at, entity_id, entity_type
- `events`: correlationId, id, lesson_id, payload, source, timestamp, type
- `exam_scores`: academic_year, exam_id, notes, recorded_at, score, student_id
- `exams`: academic_year, class_id, created_at, description, id, max_score, title
- `icebreaker_checkins`: checkin_date, class_id, created_at, id, lesson_id, mood, scope_key, student_id, updated_at
- `lesson_checkins`: checked_in_at, lesson_id, student_id
- `lesson_preset_polls`: correct_option, created_at, id, lesson_id, options_json, question_type, sort_order, title, updated_at
- `lesson_quiz_submissions`: answer, element_id, id, is_correct, lesson_id, score, student_id, student_name, submitted_at, time_spent_ms
- `lessons`: content, created_at, creator_id, id, progress_conditions, progress_mode, source_package_hash, source_package_id, source_package_key, timeline, title, updated_at
- `mfe_remotes`: created_at, entry, meta, name, updated_at
- `pending_commands`: actor_id, command_type, created_at, id, payload
- `plugin_assignment_files`: assignment_id, deleted_at, id, mime, original_name, sha256, size, stored_path, student_id, submission_id, uploaded_at, version_id
- `plugin_assignments`: allow_late, allow_link, allow_text, allowed_ext, class_id, created_at, created_by, description, due_at, element_id, id, instructions, lesson_id, max_file_size, max_files, peer_review_count, peer_review_due_at, peer_review_mode, peer_weight, status, teacher_weight, title, updated_at
- `plugin_capability_grants`: approved_at, capability, plugin_key
- `plugin_config`: key, plugin_id, scope_id, scope_type, updated_at, value
- `plugin_grades`: assignment_id, calculated_final_score, graded_at, graded_by, id, peer_average_score, peer_weight, published_at, source, status, submission_id, teacher_comment, teacher_score, teacher_weight
- `plugin_network_grants`: approved_at, host, plugin_key
- `plugin_orphan_data`: last_export_path, manifest_id, migration_version, plugin_id, plugin_name, plugin_version, row_count, storage_keys, table_names, table_prefixes, uninstalled_at
- `plugin_peer_review_tasks`: anonymous, assignment_id, created_at, due_at, id, reviewer_id, status, submission_id
- `plugin_peer_reviews`: anonymous, assignment_id, comment, created_at, id, reviewer_id, score, status, submission_id, task_id, updated_at
- `plugin_public_routes`: approved_at, method, path, plugin_key
- `plugin_storage`: key, plugin_id, updated_at, value
- `plugin_submission_versions`: assignment_id, files_json, id, is_late, link_url, student_id, submission_id, submitted_at, text_content, version
- `plugin_submissions`: assignment_id, created_at, file_path, id, lesson_id, student_id, updated_at, version
- `plugins`: created_at, execution_mode, file_path, id, loader_version, manifest, name, source_code, status, updated_at, version, zip_package
- `processes`: created_at, id, logs, name, payload, plugin_id, state, status, task_type, updated_at
- `question_bank_items`: answer_key_json, config_json, created_at, difficulty, id, owner_id, stem, tags_json, type, updated_at, visibility
- `schedules`: academic_year, class_id, created_at, id, lesson_id, notes, scheduled_date, status, time_slot
- `segment_gate_overrides`: actor_id, created_at, lesson_id, reason, segment_id, student_id
- `segment_visits`: entered_at, id, left_at, lesson_id, segment_id, student_id
- `site_settings`: academic_start_month, current_academic_year, id, logo_url, site_name, slogan, upload_max_file_mb
- `student_lesson_progress`: academic_year, assigned_at, completed, completed_segments, lesson_id, progress_percent, student_id, verified, verified_progress_percent
- `student_point_logs`: class_id, created_at, delta_points, dimension_id, id, plugin_id, reason, student_id
- `student_read_notifications`: created_at, notification_id, student_id
- `student_rollcalls`: class_id, difficulty, id, lesson_id, picked_time, rating, reward_coins, score, student_id
- `student_seats`: class_id, col_idx, lab_id, row_idx, student_id
- `student_semester_reports`: academic_year, ai_evaluation, assignment_score, attendance_score, class_id, created_at, dimension_scores, exam_score, grade_level, id, progress_score, semester_name, student_id, teacher_evaluation, total_score, updated_at
- `students`: avatar, created_at, email, id, lock_mode, lock_target, locked_lesson_id, name, password, private_notes, student_number
- `submission_raw`: attempt_id, created_at, event_type, id, payload_json
- `submission_result`: attempt_id, comment, completion, extra_json, id, score
- `system_resources`: content, created_at, id, name, type
- `teaching_modes`: color, created_at, description, description_en, icon, id, is_builtin, name, name_en, sort_order, updated_at
- `users`: avatar, created_at, id, must_change_password, name, password_hash, role, status, username
- `vfs_nodes`: content, created_at, id, name, parent_id, type, updated_at
- `whiteboard_elements`: created_at, data, id, lesson_id, type

<!-- AUTO-GENERATED:table-inventory END -->
