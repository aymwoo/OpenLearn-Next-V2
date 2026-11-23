# Activity Contract（活动契约）

> 📌 **本文为唯一真源**：`packages/core/activity-contract/` 只允许放类型与纯函数，禁止 import
> `server/` 或 `packages/core/` 下的运行时模块，避免在 kernel / plugin-host / activity-ecosystem
> 之间形成环。

## 1. 为什么单独成包

平台同时存在四套活动体系：provider 活动、学案活动（xuean）、lesson-engine 活动与课堂旧互动
（classroom-legacy）。它们各有自己的存储表与路由，但「活动」的对外身份、角色、运行状态必须
统一，否则前端、插件与统计口径会各说各话。`activity-contract` 就是这层共享词汇表。

## 2. ID 命名空间

`ActivityKind` 固定为 `provider` / `xuean` / `lesson-engine` / `classroom-legacy`；
`ActivityId` 是模板字符串类型 `` `${ActivityKind}:${string}` ``：

- `provider:official_quiz` —— provider 定义 ID；
- `xuean:type:reading` —— 学案**类型**定义；未来的行实例使用 `xuean:<uuid>`；
- `classroom-legacy:exit-ticket` —— 课堂旧互动定义。

`makeActivityId()` / `parseActivityId()` / `isActivityId()` 是唯一的拼装与校验入口。路由层
（如 lesson-activities 的旧别名）遇到不带命名空间的历史 ID 时，需先判断再补全，不能自行
拼接字符串。

## 3. 定义与运行分离

- **定义**：`ActivityDescriptorBase`，携带 `kind` / `activityId` / `title` / `category` /
  `roles` / `capabilities` / `deprecated` 等只读元数据。
- **运行**：`ActivityRunRef`，以 `runId` 为主键，记录 `activityId`、`lessonId`、`classId`、
  `state` 与起止时间。

`ActivityRunState` 为 `created` / `running` / `paused` / `interrupted` / `finished` /
`failed` / `cancelled`。其中 `interrupted` 是**终态**：服务重启后未能恢复的运行会被标记为
`interrupted`，既不能恢复也不能结束（生命周期接口会返回 409），避免把「假运行」继续投给课堂。

providers 已实现统一生命周期 `ActivityLifecycle`；其余体系按需适配。

## 4. 内置定义

`packages/core/activity-contract/builtins.ts` 收敛了两份原先散落在路由里的清单：

- `XUEAN_ACTIVITY_TYPES`：学案活动类型白名单（reading / submission / quiz / survey /
  discussion / courseware / scratch / form / other）；
- `CLASSROOM_LEGACY_ACTIVITIES`：极速投票、抢答器、听懂了反馈、结课通票。

它们供 `/api/lesson-activities/*` 的入参校验与 `IExtensionCatalog.listActivities()` 的目录发现
共用，新增类型必须同时更新这里与对应表结构。

### 4.1 学案内置活动模块

教师端「新增活动」按以下内置类型渲染专属配置，配置写入 `lesson_activities.config_json`：

| 类型         | 教师配置                                   | 学生端交互                                   |
| ------------ | ------------------------------------------ | -------------------------------------------- |
| `reading`    | 阅读正文、外部链接                         | 阅读材料，点击「标记为已读」回写 `submitted` |
| `submission` | 练习要求、允许文字 / 链接                  | 文字作答或提交作品链接，可更新提交           |
| `quiz`       | 引用现有试卷（`assessmentId` / `classId`） | 复用 `AssessmentRunner` 作答                 |
| `survey`     | 单选 / 多选 / 填空题与选项、必答开关       | 提交结构化答案                               |
| `form`       | 文本 / 数字 / 下拉 / 勾选字段、必填开关    | 按字段填写并提交                             |
| `discussion` | 讨论话题、是否允许回复                     | 发帖 / 回复，帖子存入 `lesson_discussions`   |

除 `quiz`（复用试卷布置）外，学生端答案统一写入 `activity_progress.submission_json`：

```json
{ "type": "text", "content": "{\"answers\":{\"q1\":\"A\"}}" }
```

`survey` / `form` 的 `content` 是 JSON 字符串，`answers` 的键为题目或字段 `id`；教师端进度
面板与批阅接口无需感知类型差异。

第三方插件仍通过 `xuean.activity.type` / `.editor` / `.student` 扩展新类型；类型 id 必须使用
`<manifest.id>:` 命名空间，不能覆盖内置类型。完整的活动数据模型、教师 / 学生端行为与接口见
[Xuean Activities](xuean-activities.md)。

## 5. 消费方

- HTTP：`GET /api/activity-providers`、`POST /api/activity-providers/:providerId/runs`、
  `GET /api/activity-runs`、`POST /api/activity-runs/:runId/{pause,resume,finish}`
  与 `/api/lesson-activities/*`（旧 `/api/activities*` 为 307 兼容别名）。
- 事件：完成事实经 `packages/core/events/` 的 `publishActivityCompleted()` 统一出口发出，
  详见 [CommandBus & EventBus](command-event-bus.md)。
- 目录：`IExtensionCatalog`（只读）聚合 slot、活动定义、hooks 与弃用元数据。
