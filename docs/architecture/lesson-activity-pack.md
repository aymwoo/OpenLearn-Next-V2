# 课时级学案包（Gitee IKVO15 P0）

在互动白板课堂之外，为同一课节提供可异步自学的学案活动序列。本文件覆盖 IKVO15 的 P0 / P1 / P2，以及随后补齐的编程活动、导入资源重关联和课次归档阈值设置。

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

## 活动类型

| 类型          | 说明                                                                      | 复用                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reading`     | 阅读任务，正文写在 `config_json.body`                                     | 学案内阅读与自报                                                                                                                                                                                                                       |
| `courseware`  | 网页课件，需关联已有 `coursewareId`                                       | 既有课件播放器；学案页一次只挂载当前活动，避免打满 iframe 并发上限                                                                                                                                                                     |
| `quiz`        | 测验，需关联测评中心评估                                                  | 学生跳到既有测评页完成                                                                                                                                                                                                                 |
| `submission`  | 作品提交，需关联作业中心作业                                              | 学生跳到既有作业页提交与批阅                                                                                                                                                                                                           |
| `programming` | 编程活动，`config.kind` 为 `scratch` / `python` / `flowchart` / `mindmap` | 内置 Python 源码编辑、流程图/思维导图最小编辑器；Scratch 不内嵌 scratch.mit.edu，仅在已安装独立离线插件时尝试打开插件视图，否则提交作品说明。学案内作品写入 `activity_progress.artifact_json`，不另建成绩口径，教师确认后才 `verified` |

`lessons.course_id` 为可空列：P0 预留，P2 起挂接 `courses` 一级实体（长周期课程）。

## 主要接口

- `GET /api/lessons/:lessonId/activity-pack`：教师看到全部活动与区块；学生只看到已发布且已到 `release_at` 的活动，并带上本人进度。
- `POST /api/lessons/:lessonId/activities`、`PATCH`、`DELETE`、`PUT .../reorder`
- `PUT /api/lessons/:lessonId/activity-blocks`
- `POST .../start`、`POST .../self-report`
- `GET .../progress`、`POST .../students/:studentId/verify`、`POST .../students/:studentId/grade`
- `GET /api/me/lesson-activity-packs?lessonIds=`：学生看板入口

教师编排入口在备课编辑器顶部的「学案活动」页签；学生入口在看板课程卡片与课节页「打开学案」。

## P1

- **跨课节互评**：一次轮次可覆盖同一课程下多个课节的已提交活动。循环分配评审任务，同一轮次同一活动中一对评审人只能提交一份评价（防刷票）。支持实名或匿名；学生端匿名时不返回对方姓名。评语用 UGC 规则去 HTML、隐藏外链，并支持举报与教师复核（确认 / 覆盖 / 驳回）。互评分数不写入 `activity_progress.score`。
- **进度报告与催办**：教师可查看每个活动的完成率、已验证率与未完成名单，并对未完成学生一键催办。催办 6 小时内不对同一学生重复发送；催办消息进入学生通知列表。
- **学案包导入导出**：zip 内含 `manifest.json` + `activities.json` + `blocks.json` + `assets/`。入口在备课中心课程库工具栏（与 `course.list.toolbar.action` 同排）。导入默认不自动发布，关联测验/作业/课件若在目标实例不存在会保留原 ID、给出警告，并在编排器中列出「需重新关联」；教师用 `POST .../activities/:id/relink` 或编排器选择本实例资源后再发布。
- **教师预览**：`?mode=activity_pack_preview` 打开独立页「教师预览（模拟学生）」，只读预览接口，不写真实进度。与课堂 `student_preview` 以及 `StudentWorkspacePreview`（C 组迁移预览）分开。

## P2

- **课程层 / 长周期课程**：`courses` 为一级实体（`is_long_cycle`、可空的课程级 `auto_archive_after_ms`），`lessons.course_id` / `course_order` 挂接章节，`course_enrollments` 支持按班级或学生选课。教师在「创建新课程」向导第一步选择「长周期课程」后，部署时创建课程实体并把当前教案作为第一章，创建时不绑定班级；课程管理以带「长周期」徽标的卡片展示，打开后可加章节、开课次和进入讨论区。已有常规课可自愿改成长周期。课程跨周保持进行中；在「互动课堂」或「一键开课次」时必须明确指定班级（不会暗默使用列表第一项），开课时再绑定该班级，并复用 IKVNIX 的 `getOrCreateSession`（已归档课次会开新会话）。常规课程不套用长周期语义，课次使用更短的自动归档兜底。
- **讨论区**：最小可用实现，支持发帖、回复、锁定、删除与举报。正文同样去 HTML、隐藏外链。不做投票、分组或富文本编辑器。

## 新增接口（P1 / P2）

- `GET /api/lessons/:lessonId/activity-pack/preview`
- `GET /api/lessons/:lessonId/activity-pack/progress-report`
- `POST /api/lessons/:lessonId/activity-pack/nudge`、`GET /api/me/activity-nudges`
- `GET /api/lessons/:lessonId/activity-pack/export`、`POST /api/lesson-activity-packs/import`
- `POST /api/lessons/:lessonId/peer-reviews/cycles` 及提交 / 复核 / 举报接口
- `GET|POST /api/courses`、挂接课节、选课、`POST /api/courses/:courseId/lessons/:lessonId/start-session`
- `GET|POST /api/discussions`

## 课次自动归档阈值设置（IKVNIX）

僵尸课次自动归档阈值写入 `site_settings.classroom_session_auto_archive_after_ms`（默认 24 小时，下限 3 小时，上限 30 天）。管理员可在后台「站点信息设置」中的「课次自动归档阈值」表单调整，接口仍为 `GET` / `PUT /api/classroom/session-lifecycle-settings`。长周期课程可用 `courses.auto_archive_after_ms` 覆盖站点默认（同样钳制在 3 小时–30 天，空值表示跟站点）；常规课程使用 3 小时兜底阈值，避免「稍后继续」让课次跨周悬挂。实时录成绩仍只认 `IN_CLASS_TEACHING`。
