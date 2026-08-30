# 平台数据表参考（Platform Data Tables）

> **适用范围**：`@openlearn/plugin-sdk@3.5.0`
> 插件通过 `ctx.resolve(IDatabaseToken)` 拿到**整个平台共享数据库**的裸 `better-sqlite3.Database` 句柄，可读写任意表。本页列出平台实际存在的全部数据表及关键列，作为插件跨表查询/读写时的参考。
>
> ⚠️ 若只想做插件私有数据，优先用 `ctx.db`（自动加 `plugin_{pluginId}_` 前缀）或 `ctx.services.storage`（`plugin_storage` 键值），见[插件数据库 API](plugin-database-api)。

---

## 1. 内核 / 插件宿主表

### `plugins`
插件注册表。
| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 插件 UUID |
| `name` | TEXT | 名称 |
| `manifest` | TEXT | manifest JSON 字符串 |
| `source_code` | TEXT | 源码 |
| `status` | TEXT | `active` / `inactive` / `error` 等 |
| `execution_mode` | TEXT | `inline` / `worker`（ALTER 后加列） |
| `created_at` | INTEGER | 时间戳 |

### `plugin_storage`
插件 KV 存储（`ctx.services.storage` 后端），按 `plugin_id` 隔离。
| 列 | 类型 | 说明 |
|---|---|---|
| `plugin_id` | TEXT | 复合主键 |
| `key` | TEXT | 复合主键 |
| `value` | TEXT | 值 |
| `updated_at` | INTEGER | 时间戳 |

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
| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 用户 ID |
| `username` | TEXT UNIQUE | 用户名 |
| `password_hash` | TEXT | 密码哈希 |
| `role` | TEXT | `administrator` / `teacher` / `student` 等 |
| `name` | TEXT | 姓名 |
| `status` | TEXT | `active` 等 |
| `created_at` | INTEGER | 时间戳 |

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
| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 课节 ID |
| `title` | TEXT | 标题 |
| `content` | TEXT | 内容 |
| `timeline` | TEXT | 时间轴 JSON |
| `progress_mode` | TEXT | `manual` 等 |
| `progress_conditions` | TEXT | 进度条件 |
| `created_at` / `updated_at` | INTEGER | 时间戳 |

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

---

## 4. 作业 / 考试 / 成绩表

### `assignments`
`id` / `class_id` / `lesson_id` / `title` / `description` / `content` / `created_at`。

### `assignment_submissions`
`assignment_id` + `student_id` 复合主键，`content` / `score` / `feedback` / `submitted_at` / `graded_at` / `status`（`submitted` / `graded`）。

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
| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | 流水 ID |
| `student_id` | TEXT | 学生 ID |
| `class_id` | TEXT | 班级 ID |
| `dimension_id` | TEXT | 积分维度 ID |
| `plugin_id` | TEXT | 来源插件（可空） |
| `delta_points` | REAL | 变动分值 |
| `reason` | TEXT | 原因 |
| `created_at` | INTEGER | 时间戳 |

> 积分维度（`IPointsDimensionRegistry`）注册于内存，无独立维度表；维度 ID 由插件自定。

---

## 6. 课件（Courseware）表

### `courseware`
`id` / `uuid`(UNIQUE) / `name` / `type` / `entry` / `created_at`。

### `courseware_attempt`
`id` / `courseware_id` / `student_id` / `started_at` / `finished_at` / `status`。

### `submission_raw` / `submission_result`
课件提交原始事件与结果。`submission_raw`: `id` / `attempt_id` / `event_type` / `payload_json` / `created_at`；`submission_result`: `id` / `attempt_id` / `score` / `comment` / `completion` / `extra_json`。

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

> **提示**：核心 schema 初始化于 `packages/core/db/index.ts`（约 34 张表），另有 `server/bootstrap-db.ts`（3 张：`student_rollcalls` / `site_settings` / `agent_conversations`）与 `server/utils/migrate.ts`（`_migrations`）。

> 最后更新：2026-08-29
