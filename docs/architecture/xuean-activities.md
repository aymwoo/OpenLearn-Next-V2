# Xuean Activities（学案活动）

学案（xuean）是课时的第二种交付面：教师按顺序编排阅读、作品提交、测验、调查、填表与讨论，
学生在课堂或课后逐项完成。本页说明活动数据模型、内置模块、教师端与学生端行为、HTTP 接口
以及第三方插件扩展方式。活动契约的共享词汇见 [Activity Contract](activity-contract.md)，
内容宿主见 [LearningSurface](learning-surface.md)。

## 1. 数据模型

课时活动存放在 `lesson_activities`，按 `order_index` 排序。活动与课时的 `timeline` 环节并列，
活动完成**不会**自动推进环节门禁或课堂阶段。

| 列                      | 作用                                                     |
| ----------------------- | -------------------------------------------------------- |
| `type`                  | 活动类型，取内置白名单或插件命名空间类型                 |
| `title`                 | 活动标题，同时用于导航与学生端卡片                       |
| `config_json`           | 类型专属配置（阅读正文、调查题目、表单字段、试卷引用等） |
| `required` / `visible`  | 必做与对学生可见                                         |
| `submission_type`       | 提交物类型提示（作品提交会写入 `text,link` 等组合）      |
| `rubric_json`           | 评价量规，教师批阅时参考                                 |
| `release_at` / `due_at` | 发布时间与截止时间（epoch ms，可空）                     |
| `peer_review`           | 是否开启互评                                             |
| `surface_id`            | 可选绑定的 LearningSurface（一个活动最多一个）           |

学生的完成情况存放在 `activity_progress`，主键 `(activity_id, student_id)`。状态为
`not_started` / `in_progress` / `submitted` / `graded`，教师批阅写入 `verified=1`、`score` 与
`graded_at`。结构化答案写入 `submission_json`；讨论帖子单独存放在 `lesson_discussions`。
字段级说明见 [平台数据表](../reference/platform-data-tables.md)。

## 2. 内置活动类型

`XUEAN_ACTIVITY_TYPES` 是服务端白名单的唯一事实源（`packages/core/activity-contract/builtins.ts`）：

| 类型         | 教师配置                                   | 学生端模块                                   |
| ------------ | ------------------------------------------ | -------------------------------------------- |
| `reading`    | 阅读正文、外部链接                         | 展示正文，点击「标记为已读」回写 `submitted` |
| `submission` | 练习要求、允许文字 / 链接                  | 文字作答或提交作品链接，可更新提交           |
| `quiz`       | 引用现有试卷（`assessmentId` / `classId`） | 复用 `AssessmentRunner` 作答                 |
| `survey`     | 单选 / 多选 / 填空题与选项、必答开关       | 提交结构化答案                               |
| `form`       | 文本 / 数字 / 下拉 / 勾选字段、必填开关    | 按字段填写并提交                             |
| `discussion` | 讨论话题、是否允许回复                     | 发帖 / 回复，帖子存入 `lesson_discussions`   |
| `courseware` | 互动课件或资源绑定                         | 由统一 LearningSurface 宿主渲染              |
| `scratch`    | 图形化编程配置                             | 由对应工作区渲染                             |
| `other`      | 通用活动                                   | 基础活动卡片                                 |

### 2.1 配置格式

各类型把配置写入 `config_json`。以下字段是教师编辑器实际写入的契约：

```json
// reading
{ "content": "阅读材料正文", "url": "https://example.com/article" }

// submission
{ "instructions": "写出实验结论", "acceptText": true, "acceptLink": true }

// survey
{
  "description": "请如实填写",
  "questions": [
    { "id": "q1", "title": "你每天阅读多久？", "type": "single", "options": ["少于 30 分钟", "30 分钟以上"], "required": true }
  ]
}

// form
{
  "description": "实验记录",
  "fields": [{ "id": "f1", "label": "实验现象", "type": "text", "options": [], "required": true }]
}

// discussion
{ "prompt": "你如何理解这一现象？", "allowReplies": true }

// quiz（由引用试卷接口写入）
{ "assessmentId": "asm_1", "classId": "class_1", "assignmentId": "asg_1", "title": "单元测验" }
```

`survey.questions[].type` 取 `single` / `multiple` / `text`；`form.fields[].type` 取 `text` /
`textarea` / `number` / `select` / `checkbox`。选项只在 `single`、`multiple` 与 `select` 中使用。

### 2.2 提交格式

除 `quiz` 由测评域管理外，学生端统一通过 `POST /api/lesson-activities/:id/progress` 上报：

```json
// 阅读、作品提交、讨论
{ "type": "text", "content": "学生作答或作品链接" }

// 调查、填表：answers 的键为题目或字段 id
{ "type": "text", "content": "{\"answers\":{\"q1\":\"30 分钟以上\",\"f1\":\"溶液变蓝\"}}" }

// 作品链接
{ "type": "link", "content": "https://example.com/student-work" }
```

进度接口同时接受 `status` 与 `progressPercent`；学生只能写自己的行，教师 / 管理员可以显式传
`studentId`。教师批阅走 `POST /api/lesson-activities/:id/progress/verify`，写入 `verified`、
`score` 与 `status=graded`。

> **批阅 ≠ 进成绩册**：`verify` 只写 `activity_progress`。要让学案成绩进入学期总评，教师还需
> 显式同步到平台成绩册：`POST /api/lessons/:lessonId/activities/:activityId/sync-grade`（单活动）
> 或 `POST /api/lessons/:lessonId/activity-grades/sync`（整课批量）。同步只取 `verified=1` 且有
> 分数的记录，按 `xuean-activity:<activityId>` 写入 `assignments` / `assignment_submissions`，
> 复用 grade-writer 的审计与手动分保护，重复同步幂等。

## 3. 教师端编排

学案编辑器由 `XueanActivitiesPanel` 与 `ActivityConfigEditor` 组成：

- 新增活动时先选择类型与标题，再按类型渲染专属配置面板；试题类型改为选择试卷与关联班级。
- 阅读、作品提交、调查、填表、讨论保存时把配置写入 `config_json`；作品提交同时写入
  `submission_type`。
- 活动可拖拽排序、编辑、删除，并设置必做、可见、互评、发布时间、截止时间与评价量规。
- 需要富内容时，可为活动绑定 LearningSurface（`surface` 字段），学生端由统一宿主渲染。
- 学案首页块（`lesson_activity_blocks`）与活动分开管理，首页块类型包括学习目标、重难点、
  资源准备、操作要点、作品赏析、反思、自由 HTML、互动课件与学案首页。

## 4. 学生端学习

`StudentXueanView` 顶部提供活动导航（`tablist`），一次只渲染当前活动，并显示完成进度。各类型
的交互如下：

- **阅读**：正文按纯文本展示，链接在新标签页打开；点击「标记为已读」写入 `submitted`。
- **作品提交**：根据教师配置显示文字或链接输入；已提交后可更新。
- **测验**：绑定试卷时嵌入 `AssessmentRunner`，交卷后回写活动进度。
- **调查**：按单选、多选、填空作答，必答题未完成时阻止提交。
- **填表**：按字段类型渲染输入控件，必填字段使用原生校验与 `aria-invalid`。
- **讨论**：加载 `lesson_discussions` 帖子，可发帖与回复；首次发帖会同步标记活动完成。

活动卡片上的状态、催办提示、得分与进度条来自 `activity_progress`；绑定 Surface 时卡片内嵌
统一内容宿主。

## 5. HTTP 接口

canonical 路由位于 `server/routes/lesson-activities.ts`；旧 `/api/activities/:id/*` 为 307 兼容
别名，响应头带 `Deprecation` 与 `Link`。

| 端点                                                | 鉴权          | 作用                             |
| --------------------------------------------------- | ------------- | -------------------------------- |
| `GET /api/xuean/activity-types`                     | authenticated | 内置 + 已激活插件的活动类型目录  |
| `GET /api/lessons/:lessonId/activities`             | authenticated | 列出可见活动                     |
| `POST /api/lessons/:lessonId/activities`            | class-staff   | 新增活动                         |
| `PUT /api/lesson-activities/:id`                    | class-staff   | 更新活动                         |
| `DELETE /api/lesson-activities/:id`                 | class-staff   | 删除活动并清理进度               |
| `POST /api/lessons/:lessonId/activities/reorder`    | class-staff   | 批量重排                         |
| `POST /api/lessons/:lessonId/activities/assessment` | class-staff   | 试题活动：复用或发布试卷         |
| `GET /api/lessons/:lessonId/xuean`                  | authenticated | 学生端聚合：块 + 活动 + 我的进度 |
| `POST /api/lesson-activities/:id/progress`          | authenticated | 上报进度与提交                   |
| `POST /api/lesson-activities/:id/progress/verify`   | class-staff   | 批阅 / 验证（只写活动进度）      |
| `POST /api/lesson-activities/:id/sync-grade`        | class-staff   | 单活动成绩同步到成绩册           |
| `POST /api/lessons/:lessonId/activity-grades/sync`  | class-staff   | 整课批量同步已批阅成绩到成绩册   |
| `POST /api/lesson-activities/:id/nudge`             | class-staff   | 催办                             |
| `GET/POST /api/lesson-activities/:id/discussions`   | class-member  | 讨论列表与发帖 / 回复            |

`GET /api/lessons/:lessonId/xuean` 对学生只返回 `visible=1` 且已到发布时间的活动；教师与管理员
可预览所有可见活动。讨论列表返回 `author_name`（优先学生档案，回退用户表）；发帖内容截断到
2000 字符，`parentId` 必须属于同一活动。

## 6. 插件扩展

第三方插件通过三个槽位扩展学案活动：

| 槽位                     | 消费端             | 作用                                  |
| ------------------------ | ------------------ | ------------------------------------- |
| `xuean.activity.type`    | 服务端类型目录     | 声明新类型（`id` / `label` / `icon`） |
| `xuean.activity.editor`  | 教师端活动编辑弹窗 | 该类型的配置面板                      |
| `xuean.activity.student` | 学生端活动卡片     | 该类型的作答 / 展示组件               |

类型 id 必须使用 `<manifest.id>:` 命名空间，例如 `@acme/virtual-lab:experiment`。插件不能覆盖
内置类型；活动行仍由宿主接口保存。槽位 props 与示例见
[插件 UI 扩展槽位](../reference/plugin-ui-extension-slots.md) §12.9。

## 7. 代码位置

| 层       | 路径                                                                              |
| -------- | --------------------------------------------------------------------------------- |
| 契约     | `packages/core/activity-contract/builtins.ts`                                     |
| 服务端   | `server/routes/lesson-activities.ts`、`server/services/xuean-activity-types.ts`   |
| 教师端   | `src/features/teacher/xuean/XueanActivitiesPanel.tsx`、`ActivityConfigEditor.tsx` |
| 学生端   | `src/features/student/xuean/StudentXueanView.tsx`、`activities/`                  |
| 配置工具 | `src/features/xuean/activity-config.ts`                                           |
| 数据表   | [平台数据表](../reference/platform-data-tables.md)                                |
