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

- `XUEAN_ACTIVITY_TYPES`：学案活动类型白名单（reading / submission / quiz / discussion /
  courseware / scratch / form / other）；
- `CLASSROOM_LEGACY_ACTIVITIES`：极速投票、抢答器、听懂了反馈、结课通票。

它们供 `/api/lesson-activities/*` 的入参校验与 `IExtensionCatalog.listActivities()` 的目录发现
共用，新增类型必须同时更新这里与对应表结构。

## 5. 消费方

- HTTP：`GET /api/activity-providers`、`POST /api/activity-providers/:providerId/runs`、
  `GET /api/activity-runs`、`POST /api/activity-runs/:runId/{pause,resume,finish}`
  与 `/api/lesson-activities/*`（旧 `/api/activities*` 为 307 兼容别名）。
- 事件：完成事实经 `packages/core/events/` 的 `publishActivityCompleted()` 统一出口发出，
  详见 [CommandBus & EventBus](command-event-bus.md)。
- 目录：`IExtensionCatalog`（只读）聚合 slot、活动定义、hooks 与弃用元数据。
