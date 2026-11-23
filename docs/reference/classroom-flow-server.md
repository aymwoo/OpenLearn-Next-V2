# ClassroomFlowServer 开发指南：通讯协议 / 学分 / 成绩采集 / 双端工作区

<!-- doc-version: sdk=3.8.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.8.0` + 平台 `dev/classroom-flow`（Gitee PR #15）
> 本文说明第三方插件如何基于现有总线与扩展槽，实现**不用白板的 Moodle / 学案式教学模式**：自定义师生工作区、课堂内收发数据、发放与兑换学分、把作答接入统一成绩面板。

---

## 1. 这套基座解决什么

平台原有的上课视图是有状态单体，插件只能往白板里塞内容。ClassroomFlowServer 提供四块可复用能力，插件按需取用，**不自建流程引擎、不另造传输层**：

| 能力       | 一句话                                         | 入口                                                 |
| :--------- | :--------------------------------------------- | :--------------------------------------------------- |
| 通讯协议   | 师生/平台之间可靠传数据，插件自定义 channel    | `ctx.resolve(IClassroomMessageServiceToken)`         |
| 学分体系   | 发学分、建奖励目录、事务兑换自由活动           | `/api/classroomflowserver/*` + DI Token              |
| 成绩采集   | 把插件作答投影为统一提交，进成绩面板与学期成绩 | `ctx.resolve(ISubmissionRegistryToken)`              |
| 双端工作区 | 接管教师/学生课中主视图，不用白板              | `classroom.active_segment.main` / `.student_main` 槽 |

> **设计取舍**：本方案是"一等实例服务 + 槽位约定"，**不引入 TeachingModeProvider 整机抽象**，`teachingModeId` 仍是会话标签。模式差异由插件工作区组件自行解释。

---

## 1.1 Mode Pack（交付引擎）契约

> **Issue #546 / #547**：白板与学案将迁入 ClassroomFlow 时，统一以 Mode Pack 声明交付引擎。

| 概念             | 是什么                       | 是否驱动课中工作区          |
| ---------------- | ---------------------------- | --------------------------- |
| `teachingModeId` | 门户风格标签（讲授/探究/…）  | **否**                      |
| Mode Pack        | 白板 / 学案 / 第三方交付引擎 | **是**（按 `segment.type`） |

Manifest 贡献键：`contributes['mode.pack']`（见 `@openlearn/plugin-sdk` 的 `ModePackContribution`）。

宿主灰度开关（默认关，只影响**没有学案交付模式**的课）：

管理员在「站点信息设置 → 运行时策略」打开 Mode Pack。未配置时关闭。构建期变量和 `window` 调试旗标不再控制此开关。已打开的页面在重新获得焦点或刷新后生效，不需要重启进程。

课程交付模式写在课节 `lessons.delivery_mode`（`whiteboard` 或 `xuean`）。它不是门户 `teachingModeId`。

- 未写入或 `whiteboard`：按白板。全局开关关闭时仍走既有白板中栏；开关打开时才进入白板 Mode Pack。
- `xuean`：建课走学案向导（预习 / 研读 / 练习），上课注册并使用 `@openlearn/mode-xuean`。不需要再打开全局 Mode Pack 开关。
- 绑定第三方模式包（`lessons.mode_pack_id` 非内置包）：自动启用 Mode Packs，不依赖全局开关；备课面 / 大纲 / 工作区按插件贡献渲染，缺失时回退白板路径。

启用 Mode Pack 路径后，宿主必须先调用 `normalizeSegmentType()`（空 type → `whiteboard`），再按 `segment.type` 匹配 Mode Pack / `classroom.active_segment.*`。学案课的环节类型使用 `xuean` 前缀。

内置白板包 id：`@openlearn/mode-whiteboard`（`isDefault: true`，认领 `whiteboard`）。

课中画布：宿主经 `WhiteboardHostBridgeProvider` 注入与旧中栏相同的 `LazyWhiteboard` props（含 `broadcastFullscreen` / `onFullscreenSync` / `activeSegmentId` / `onPagesStateChange`）。flag 开启时教师白板 tab 与双端 `active_segment.*` 工作区消费该桥；关闭时仍直挂 `LazyWhiteboard`。

内置学案包 id：`@openlearn/mode-xuean`（认领前缀 `xuean`，非 default）。flag 开启时：

- timeline 注册 `xuean` 与 `xuean:preview|study|drill`；扩展点 `targetType` 经 `extensionCoversSegmentType` 做前缀匹配（与 Mode Pack 契约一致）。
- 教师 `active_segment.main` → `ProgressPanel`；学生 `student_main` primary → `StudentXueanView`；隐藏学生平行「学案」tab。
- 服务端注册共享通道 `xuean:task` 与 SubmissionAdapter `xuean-adapter`（只读投影 `activity_progress` 进统一成绩面板；`modeId=xuean`）。
- 作答真值仍写 `POST /api/activities/:id/progress`；工作区在写库成功后 `flow.sendMessage({ channel: 'xuean:task' })` 通知。
- **不变式**：环节门禁仍由 lesson-engine 裁决；学案自报进度**不会**自动放行 timeline。

flag 关闭时行为与既有平行 tab / 无适配器路径一致。

### 1.1.1 备课面统一（P3）

flag 开启时：

- Mode Pack 声明 `prepContributionId`（白板 `prep-whiteboard` / 学案 `prep-xuean`）。第三方包声明自定义 id 时，宿主渲染 `classroom.prep` 槽位；没有匹配贡献则回退白板备课面并记录告警。
- `TeacherView` 不再以 `lesson_editor` / `xuean_editor` 双硬编码为主路径；两者均进入 `ModePackPrepShell`，按当前 `activeSegment.type` 决议备课面。
- 侧栏「学案编辑器」入口并入「备课」（`lesson_editor`）；关闭 flag 时仍为平行双入口。
- Timeline 新建环节默认取当前绑定包的第一个 `segmentTypes`；旧课再回落 `whiteboard` / `lecture`。环节类型选择列出已注册类型（含插件 `mode.pack.segmentTypes` 自动注册项）。
- **活动与 timeline 不并表**：`lesson_activities` 仍独立存储；用 `segment.type` + `activity.config_json.segmentId`（或白板 `page_meta.segmentId`）关联。跨包拖放经 `routePrepDrop()`：白板环节 → page_meta/元素；学案环节 → 学案存储（拦截白板元素误写入）。

flag 关闭 = 旧双编辑器路径，零行为变化。

### 1.1.2 削壳与大纲贡献（P4）

- 教师中栏 → 学生 tab 广播映射统一为 `mapTeacherMiddleTabToStudentTab()`（删除重复内联映射）。
- Mode Pack 声明 `outlineContributionId`；课中侧栏按环节类型渲染白板页大纲或学案活动大纲。第三方包渲染 `classroom.outline` 槽位；没有匹配贡献时回退白板页面大纲。
- `/api/mode-packs` 对插件包声明的 `adapterIds` / `channels` 做能力诊断：当前未注册时条目带 `warnings`，课中提交面板只聚合当前包的适配器。
- flag 开时学生平行「学案」tab 默认隐藏；同一设置页可打开「显示学生平行学案页」。
- `LiveClassroomView` 编排壳目标 ≤ ~1.5k LOC（逻辑外移到 hooks / 子组件）；第三方接入见 [mode-pack-third-party.md](../tutorials/mode-pack-third-party.md)。

### 1.1.3 学生进课后的两套页面

学生从看板进入课节后，`StudentLessonView` 读取该课 `lessons.delivery_mode`，用 `resolveStudentClassroomMode()` 选页面。未写入、空值或其他非 `xuean` 的值都进白板页。

两套页面不是同一套双栏换皮：

| 对比       | 白板页 `student-whiteboard-classroom`                                                        | 学案页 `student-xuean-classroom`                                                              |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 怎么进来   | 交付模式为白板，或旧课没有该字段                                                             | 交付模式为 `xuean`                                                                            |
| 主学习面   | 整幅白板画布（`@openlearn/mode-whiteboard` 的 primary 工作区命中时用它，否则直接挂现有画布） | 居中的学案正文（`@openlearn/mode-xuean` 的 `XueanStudentModeWorkspace` / `StudentXueanView`） |
| 课题       | 页面主标题。有当前环节标题时用环节名，否则用课节名                                           | 同上，读的是学案正文而不是画布                                                                |
| 侧栏工具   | 底部一排：大纲、课件、作业、签到、工具                                                       | 左侧竖排：环节、签到、笔记                                                                    |
| 没有的东西 | 不再把大纲和画布并排占满首屏                                                                 | 没有白板标签栏，也不把画布当作主面                                                            |

侧栏是页面内的 `<aside>`，用 `hidden` 关掉，不用模态对话框，所以关掉之后课题和主学习面仍可操作。点当前已打开的工具或侧栏里的「关闭」都会收起。大纲和环节列表只提示「请跟随课堂」，不改全班当前环节。

学生页上的 `flow.setActiveSegment` / `flow.advanceStage` 在本地直接拒绝，不向全班环节或阶段接口发请求。本地指针只跟随课堂会话轮询（教师推进后的 `current_segment_id`）。环节门禁仍由 lesson-engine 决定。

### 1.1.4 白板课堂的默认界面

白板课（含没有 `delivery_mode` 的旧课）的教师端和学生端默认只留课题和画布。学案课的教师顶栏保持原来的一排按钮。

教师端默认能看到：课节标题、班级、计时、全班专注 / 答题锁定、当前阶段。进行中的投票和抢答也留在这条上，方便当场结束。

收进面板、点开才出现：

| 入口             | 里面有什么                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 顶栏「更多」     | 返回门户、会话档案、课中设置、切换课节、编辑、学生预览，以及告警、学情、协作、投屏、互评、家校通知、宏、硬件和插件快捷动作 |
| 「课堂工具」     | 阶段切换、极速投票、抢答、通票、大屏展台、随机抽问、积分榜、节奏晴雨表                                                     |
| 中栏「课堂面板」 | 演示白板、学生提交、作业成绩、随堂测验榜、环节工作区、完成授课                                                             |

学生白板页默认只有画布、课题和一个「工具」按钮。大纲、课件、作业、签到、笔记都在这个菜单里，选中后打开侧栏，关掉侧栏画布还在。全屏同步仍走原来的 `ClassroomSyncChannel`，学生不能改全班环节或阶段。

---

## 2. 通讯协议（ClassroomMessage）

### 2.1 核心概念

一条消息是一个 `ClassroomMessage`，跑在**现有** EventBus / Socket.IO 之上：

```ts
interface ClassroomMessage<T = unknown> {
  channel: string; // 插件命名空间，如 'xuean:task'
  type: 'request' | 'response' | 'event' | 'state';
  lessonId?: string;
  classId?: string;
  targetUserIds?: string[]; // 空 = 房间广播
  payload: T;
  messageId: string; // uuid，幂等 + 前端去重键
  correlationId?: string; // 请求-响应关联
  ttlMs?: number;
}
```

**分级投递**（按 `type`，平台自动分流，插件不感知）：

| type                   | 通道                              | 持久化             | 断线行为                        |
| :--------------------- | :-------------------------------- | :----------------- | :------------------------------ |
| `event` / `state`      | EventBus → Socket.IO 实时         | 无                 | 即丢；靠后续 `state` 最新值覆盖 |
| `request` / `response` | 落 `classroom_messages` 表 + 事件 | 有（seq 单调游标） | 补投（见 2.4）                  |

### 2.2 注册 channel

```ts
import { IClassroomMessageServiceToken, type PluginContext } from '@openlearn/plugin-sdk';

export async function activate(ctx: PluginContext) {
  const msg = await ctx.resolve(IClassroomMessageServiceToken);
  msg.registerChannel({
    name: 'xuean:task', // 全局唯一，建议带命名空间前缀
    // owner 由宿主按 pluginId 注入 —— 插件无法冒用他人 channel
    shared: false, // true = 允许多插件协作
    rolesAllowed: ['teacher', 'student'],
    requiredPayloadFields: ['step'], // 顶层必填字段校验
  });
}
```

`registerChannel` 在插件停用时由宿主按 owner 自动注销（`ResourceTracker`）。

### 2.3 发送消息

师生工作区的 `flow.sendMessage` 走 `POST /api/classroomflowserver/messages`。发送者由会话派生，并校验课节读取权或班级成员身份；channel 的 `rolesAllowed` 决定该角色能否发。这条路由不要求 `lesson:write`，因此学生可以提交自己的作答。

服务端插件仍可调用全局命令（`ctx.invokeCommand('classroom.sendMessage')` 不会被加上插件前缀）：

```ts
await ctx.invokeCommand('classroom.sendMessage', {
  channel: 'xuean:task',
  msgType: 'request',
  payload: { step: 2, answer: 'A' },
  targetUserIds: ['stu-1'],
  messageId: 'xuean:les1:stu1:step2', // 幂等键；内容不同的重发返回冲突
});
```

`commandType` 固定为 `classroom.sendMessage`，要求 `lesson:write`，`exposeToAgent: false`。经命令进入时 actor 为 `plugin:<id>`，宿主强制 `senderPluginId`，插件只能往自己拥有的 channel（或 `shared` 通道）发。用户经 HTTP 进入时不带 `senderPluginId`，改由 `rolesAllowed` 约束。`targetUserIds` 非空时 socket 只进入这些用户的房间和教师房间。

**学生 self 身份（P0，`ctx.services.classroomSelfMessage`）**：第三方插件若只是要替当前学生发一条课堂消息，不必（也不应）申请 `lesson:write`。声明 `classroom:message:self` 后调用 `sendAsSelf(input)`，宿主会把 sender 派生为 `user:<studentId>:student`，并校验：channel 已注册且 `rolesAllowed` 包含 `student`、学生属于 `classId`、定向 `targetUserIds` 与发送者同班；`messageId` 幂等语义与 `IClassroomMessageService.send` 一致。教师会话、无会话调用与非本班目标都会被拒绝。

### 2.4 接收与断线补投

- **在线**：监听 socket `classroom:message`，payload 带 `_meta.correlationId = messageId`，前端按 messageId 短窗去重（通知类）。
- **断线重连**：双路径补投
  - 服务端：socket 发 `message-resume { lessonId, lastSeq }`，服务端按 `seq > lastSeq` 查未确认消息定向 push；
  - 客户端兜底：`GET /api/classroomflowserver/messages?lessonId=&since=<seq>` 拉取。
- **确认**：处理完 `POST /api/classroomflowserver/messages/:id/ack`。回执按收件人写入 `classroom_message_receipts`，只停止该用户自己的补投。非收件人确认会得到 404。
- 同时传入 `lessonId` 与 `classId` 时，补投必须两条都匹配，避免同一课节的不同班级串消息。

> 补投的历史消息**不重复校验 channel 归属**——合法性在 send 时刻已校验并随 payload 落库（Q15=C 口径）。

### 2.5 失败补偿

`request` 消息的 `classroom.message` 事件发布失败时，不回滚主写入，改为入 `pending_side_effects`（`source='classroom.message'`, `op='emitEvent'`）。`SideEffectWorker` 在服务启动后按间隔重试，成功后把行标为 `resolved`。

---

## 3. 学分体系

### 3.1 统一发学分（`awardCredits`）

经门面或 DI：`ICreditAwardService.award(input)`。约束：

- **来源白名单**：内置 `attendance/assignment/quiz/interaction/courseware/ai_practice/manual/system/reward_refund`，插件来源须 `plugin:<id>`；
- **幂等**：`idempotencyKey` 唯一，重放返回原流水不重复加分；
- **归属**：学生须在指定班级；
- `deltaPoints` 负数表示扣回（撤销误发）。

`points.awarded` 事件 fire-and-forget 发布，失败进补偿队列。

### 3.2 奖励目录与兑换（管理员/服务端）

`/api/classroomflowserver/rewards`：

- `POST /rewards`（admin）创建：价格、库存、资格 JSON（`minPoints` / `roles` / `classIds`）、有效期；
- `POST /rewards/:id/status`（admin）上下架；
- `GET /rewards` 列出上架项。

`POST /api/classroomflowserver/redeem`（学生，`studentId` 从会话派生）：**事务内**校验余额 ≥ 价格 → 写负流水 → 写兑换记录 → 扣库存，全成或全败；`idempotencyKey` 防重复兑换。

### 3.3 余额查询

`GET /api/classroomflowserver/credits/summary?classId=&studentId=`。学生查本人；他人须教师/管理员。

---

## 4. 成绩采集（SubmissionAdapter）

### 4.1 接入方式

```ts
import { ISubmissionRegistryToken, type PluginContext, type SubmissionAdapter } from '@openlearn/plugin-sdk';

export async function activate(ctx: PluginContext) {
  const reg = await ctx.resolve(ISubmissionRegistryToken);
  const adapter: SubmissionAdapter = {
    descriptor: { id: 'xuean-adapter', owner: 'my-plugin', kinds: ['artifact'] },
    // owner 由宿主按 pluginId 注入，插件不可自报
    listSubmissions: (filter) => myStore.list(filter).map(toNormalized),
    toGradeInput: (s) => ({
      assignmentId: s.segmentId!,
      studentId: s.studentId,
      score: s.score ?? null,
      source: 'plugin',
      reason: 'xuean-step',
    }),
  };
  reg.register(adapter); // 停用时宿主按 owner 自动注销
}
```

`toNormalized` 把插件自有作答投影为 `NormalizedSubmission`（见 SDK 类型）：`id = <adapterId>:<externalId>` 天然幂等；`lessonId` / `classId` / `studentId` / `kind` / `status` / `score` / `completion` 必填，原始数据在插件存储里只留 `rawRef`。

### 4.2 消费与批改

- 教师成绩面板调 `GET /api/classroomflowserver/submissions?lessonId=&classId=&modeId=`，聚合器合并官方课件提交与所有插件提交，按 id 去重、失败隔离；
- 面板内批改调 `POST /api/classroomflowserver/submissions/:adapterId/grade`，经 `grade-writer` 唯一入口写回（守手动分保护与审计）。

插件**不必写平台 `courseware_attempts` 表**。

---

## 5. 双端授课工作区（不用白板）

### 5.1 教师端

`classroom.active_segment.main`；学生端 `classroom.active_segment.student_main`。两槽对称，均按当前 `segment.type` 分发：

```ts
ctx.ui.registerExtensionPoint('classroom.active_segment.main', {
  id: 'xuean-teacher',
  label: '学案工作台',
  targetType: 'xuean:task', // 与环节 type 匹配才渲染
  component: XueanTeacherWorkspace,
  slotProps: { primary: true }, // 命中环节时自动切到工作区 tab
  pluginId: ctx.pluginId,
});
```

未声明 `targetType` 的扩展对所有环节可见（向后兼容旧插件）。

### 5.2 工作区控制器 `flow`

宿主注入 `slotProps.flow: ClassroomFlowController`，插件复用现成流程状态与动作：

```ts
interface ClassroomFlowController {
  snapshot: {
    lessonId;
    classId;
    stage;
    activeSegmentId;
    segments;
    students;
    onlineStudentIds;
    attempts;
  };
  setActiveSegment(id: string): void; // 走宿主持久化 + socket 广播
  advanceStage(stage: string): void; // 服务端守卫裁决
  sendMessage(input): Promise<unknown>; // POST /api/classroomflowserver/messages
  refresh(): void;
}
```

`primary: true` 且环节类型命中时，白板课的学生主画布改用该工作区。未声明 `primary` 的扩展放在「工具」侧栏里，不盖住画布。学案课的主学习面固定是学案学生工作区。学生端 `setActiveSegment` / `advanceStage` 在页面内直接拒绝，不发全班环节或阶段请求，也不改本地指针；指针对齐只来自课堂会话轮询。`snapshot.stage` 来自当前课堂会话。

### 5.3 示例流程（学案模式）

1. 插件 `registerSegmentType` 注册 `xuean:preview` / `xuean:study` / `xuean:drill` 等自定义环节类型；
2. 教师搭教案时选用这些环节；学生端按 `segment.type` 渲染对应学案页；
3. 学生作答 → `classroom.sendMessage` 提交 → 插件自有存储 + `SubmissionAdapter` 投影；
4. 教师在统一成绩面板看到学案提交并批改 → 学期成绩；
5. 学分经 `awardCredits` 发放，奖励经 `redeem` 兑换。

---

## 6. 与既有机制的关系

- **总线**：命令走 `CommandBus`（default-deny），事件走 `EventBus` + `SOCKET_ROUTES` 声明式路由，详见[命令总线与事件总线](../agent/reference/command-and-event.md) §10。
- **权限**：`lesson:write` 覆盖消息发送；`grades:write` / `student-data:read|write` 见[能力权限矩阵](plugin-capability-matrix.md)。
- **槽位**：扩展槽清单与 props 见[UI 扩展槽位上下文](plugin-ui-extension-slots.md)。
- **成绩唯一入口**：`grade-writer`（`packages/core/db/assignment-grade-writer.ts`）。
- **补偿队列**：`pending_side_effects`（迁移 060），与 `pending_commands`（等人审批）语义不同，独立成表。

---

> 2026-11-18 建立，配套 dev/classroom-flow（PR #15）。源码真值：`packages/core/di/classroom-message-service.ts`、`packages/core/submission-adapter/`、`packages/plugins/classroom-flow-server.ts`、`src/components/LiveClassroomView.tsx`、`src/features/student/StudentLessonView.tsx`。
