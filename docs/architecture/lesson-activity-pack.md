# 课时级学案包（Gitee IKVO15 P0）

在互动白板课堂之外，为同一课节提供可异步自学的学案活动序列。本轮只做 P0，不实现课程层、互评、学案包导入导出、教师预览、讨论区、编程活动，以及进度面板与一键催办。

## 与课堂环节的关系

- 活动存储在 `lesson_activities`，与 `lessons.timeline` **并列**，不嵌进环节。
- 完成活动不会改写 `segment_visits`、`segment_gate_overrides` 或课堂阶段。
- 学生从看板或课节页「打开学案」进入独立学案页，不走课堂 Tab 同步协议。

## 进度口径

- 主口径是 `activity_progress.status`：`not_started` / `in_progress` / `submitted` / `graded`。
- 自报（例如「我已阅读」）只把状态升到 `submitted`，`verified` 必须保持 0。
- 教师确认，或课件 / 测验 / 作业在原系统中已经产生可验证结果时，才把 `verified` 置为 1。
- 课节存在已发布必做活动时，`student_lesson_progress` 只作为汇总：展示进度可含自报，已验证进度与 `completed` 只按 `verified` 聚合。
- 课件、测验、作品的分数仍写在原提交系统，学案进度表只做同步展示，避免成绩双算。积分通过既有 `POST /api/students/:id/points` 发放。

## 活动类型（P0）

| 类型         | 说明                                  | 复用                                                               |
| ------------ | ------------------------------------- | ------------------------------------------------------------------ |
| `reading`    | 阅读任务，正文写在 `config_json.body` | 学案内阅读与自报                                                   |
| `courseware` | 网页课件，需关联已有 `coursewareId`   | 既有课件播放器；学案页一次只挂载当前活动，避免打满 iframe 并发上限 |
| `quiz`       | 测验，需关联测评中心评估              | 学生跳到既有测评页完成                                             |
| `submission` | 作品提交，需关联作业中心作业          | 学生跳到既有作业页提交与批阅                                       |

`lessons.course_id` 为可空预留列，供以后课程层挂接，本轮不创建 `courses` 表。

## 主要接口

- `GET /api/lessons/:lessonId/activity-pack`：教师看到全部活动与区块；学生只看到已发布且已到 `release_at` 的活动，并带上本人进度。
- `POST /api/lessons/:lessonId/activities`、`PATCH`、`DELETE`、`PUT .../reorder`
- `PUT /api/lessons/:lessonId/activity-blocks`
- `POST .../start`、`POST .../self-report`
- `GET .../progress`、`POST .../students/:studentId/verify`、`POST .../students/:studentId/grade`
- `GET /api/me/lesson-activity-packs?lessonIds=`：学生看板入口

教师编排入口在备课编辑器顶部的「学案活动」页签；学生入口在看板课程卡片与课节页「打开学案」。
