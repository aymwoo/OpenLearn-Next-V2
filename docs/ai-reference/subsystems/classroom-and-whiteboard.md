# 子系统：课堂、课节与白板

> 覆盖 `packages/core/classroom-runtime/`、`packages/core/lesson-engine/`、
> `packages/core/whiteboard/`、`packages/core/collaboration-engine/`、
> `src/features/classroom/`、`src/features/whiteboard/`。

---

## 1. 三层职责划分

| 层 | 目录 | 规模 | 答什么问题 |
| --- | --- | --- | --- |
| **课节引擎** | `packages/core/lesson-engine/` | 14 文件 / 2,622 行 | 「这节课现在进行到哪个阶段、哪个环节、谁该看到什么」 |
| **课堂运行时** | `packages/core/classroom-runtime/` | 14 文件 / 1,391 行 | 「课堂会话怎么起停、状态怎么保、资源怎么回收」 |
| **白板** | `packages/core/whiteboard/` + `src/features/whiteboard/` | 2 文件 / 206 行 + 140 文件 / 28,096 行 | 「画布上有什么、怎么同步」 |

**反直觉的事实**：白板的后端只有 206 行，前端 28k 行。白板是**前端主导**的子系统 ——
后端只做元素持久化（`whiteboard_elements` 表）与事件广播，几何计算、渲染、交互全在浏览器。

---

## 2. 课节引擎

### 2.1 状态机与阶段

| 文件 | 作用 |
| --- | --- |
| `state-machine.ts` | 课节状态迁移 |
| `stage-resolver.ts` | 决定当前处于哪个 stage |
| `stage-runtime.ts` | stage 的运行期行为 |
| `stage-guard-pipeline.ts` | 阶段守卫管线（`IStageGuardServiceToken`） |
| `segment-gate.ts` | 教学环节门槛（学生能否进入某环节） |
| `teaching-timeline.ts` | 时间轴（`lessons.timeline` 字段的结构来源） |
| `teaching-context.ts` | 上下文装配 |
| `lesson-runtime.ts` | 课节运行期 |
| `replayer.ts` | 回放 |
| `activity-registry.ts` | 活动注册（与 `activity-ecosystem` 联动） |
| `ai-interface.ts` | 供 AI 能力层调用的窄接口 |
| `whiteboard-stage-adapter.ts` | 白板与大屏展台的桥 |

**两种守卫不是一回事**（`server.ts` L455-458 注释明确）：

```text
transitionStage      → 只跑 stage-guard-pipeline 注册的生命周期守卫
timeline.gates       → 由 SegmentGateService 在学生进入环节、教师广播环节时判定
```

把两者混在一个钩子里会导致「阶段切换时误判环节门槛」。

### 2.2 `lessons.timeline` 的结构

`lessons` 表有一个 `timeline` 字段（TEXT，存 JSON）。示例插件 `lab-seat` 从里面取 `class_ids`
来找课节学生（`[P] src/index.ts` L347-361）。已知两种形态：

```json
{ "class_ids": ["cls_1", "cls_2"] }
{ "classIds": ["cls_1"] }
```

**没有 `class_ids` 的课节取不到学生**。插件若依赖此字段，必须两者都试，
并在解析失败时返回空数组而不是抛错（否则整条命令失败）。

---

## 3. 课堂运行时

`packages/core/classroom-runtime/` 14 个文件，各管一件事：

| 文件 | 职责 |
| --- | --- |
| `kernel.ts` | 运行时内核（装配下面这些） |
| `session-manager.ts` | 会话起停（对应 `classroom_sessions` 表） |
| `state-manager.ts` | 状态机与持久化 |
| `snapshot-recovery.ts` | 断线/崩溃后的状态恢复 |
| `event-bus.ts` | 运行时内部事件 |
| `module-registry.ts` | 模块注册 |
| `hooks-system.ts` | 生命周期钩子 |
| `permission-manager.ts` | 课堂内权限（谁能操作什么） |
| `resource-manager.ts` | 资源分配（在线人数、并发上限） |
| `scheduler.ts` | 定时任务（倒计时、节奏提示） |
| `monitor.ts` | 运行监控 |
| `service-registry.ts` | 运行时可解析服务 |
| `types.ts` / `index.ts` | 类型与出口 |

`ClassroomRuntimeService` 在 `server.ts` L457 构造，并**同时注册两个 Token**：

```ts
await kernelContainer.serviceRegistry.register(IClassroomLifecycleServiceToken, classroomRuntimeService);
await kernelContainer.serviceRegistry.register(IInteractionRuntimeServiceToken, classroomRuntimeService);
```

同一实例两个身份：生命周期管理与交互运行时。插件若要介入课堂，用哪个 Token 取决于目的。

### 3.1 视图状态同步端点

`POST /api/classroom/sessions/:id/view-state` 走**独立的 `viewStateLimiter`**
（`server.ts` L291-293），不占全站写限流配额。原因是这个端点在断网/切页恢复时会被高频调用。

---

## 4. 白板

### 4.1 后端只有两件事

`packages/core/whiteboard/index.ts`（约 200 行）：

1. 把元素写进 `whiteboard_elements` 表。
2. 发事件（`whiteboard.element_drawn` / `element_updated` / `batch_drawn` / `element_deleted` / `cleared`）。

`quiz-answer.ts` 处理白板上的答题交互（事件 `whiteboard.quiz_answered`）。

### 4.2 前端的五个引擎

`src/features/whiteboard/` 下的子目录按引擎划分：

| 目录 | 职责 |
| --- | --- |
| `canvas-model/` | 画布数据模型 |
| `rendering-engine/` | 渲染 |
| `interaction-engine/` | 命中测试、拖拽、缩放 |
| `courseware/` | 课件元素（PDF/图片/视频） |
| `fullscreen/` | 全屏与展台 |
| `stage-view-bridge.ts` | 与 `StageDisplayView`（大屏）的桥 |
| `properties/` | 属性面板 |
| `events/` | 事件适配 |
| `services/` | 与后端交互 |

主组件 `InteractiveWhiteboard.tsx` 有 **4,555 行**。改动前先确认落在哪个引擎，
直接改主组件会导致渲染与交互耦合。

### 4.3 广播的三条经验规则

1. **只改布局的元素类型不要触发重绘** —— 登记进
   `server/event-routing.ts → LAYOUT_ONLY_ELEMENT_TYPES`（L157）。
2. **`whiteboard-sync` 是历史事件名**，前端监听的是它，不是 `whiteboard.element_drawn`。
   新增白板事件时改 `SOCKET_ROUTES` 的 `socketEvent`，不要改前端监听名。
3. **跨课节同步**要显式加 `WHITEBOARD_BROADCAST_ROOM`（`lessonAndBroadcastRooms`，L102）。

---

## 5. 前端课堂与教师/学生壳

| 目录 | 文件 | 行数 | 说明 |
| --- | --- | --- | --- |
| `src/features/classroom/` | 102 | 27,544 | 课堂内视图（含 `stage-display/` 大屏展台） |
| `src/features/teacher/` | 66 | 15,005 | 教师壳 |
| `src/features/student/` | 64 | 10,711 | 学生壳 |
| `src/features/student-workspace/` | 10 | 867 | C 组迁移预览壳（`?studentShell=workspace`） |
| `src/features/whiteboard/` | 140 | 28,096 | 白板 |
| `src/features/assessment/` | 21 | 5,539 | 测评作答与批阅 |
| `src/features/modals/` | 19 | 4,462 | 全局弹窗 |
| `src/features/command-palette/` | 9 | 852 | Cmd/Ctrl+K 命令面板 |
| `src/features/quick-insert/` | 8 | 642 | 快速插入 |
| `src/features/lesson-engine/` | 8 | 747 | 前端课节运行时 |

**大屏展台是独立 URL**：`App.tsx` 检测到 `isStageDisplayMode` 时**不渲染任何平台外壳**
（`App.tsx` L89-95），直接全屏渲染 `StageDisplayView`。这是唯一一个绕过 `AppShell` 的分支。

---

## 6. 改动决策表

| 我要做的事 | 改哪 | 不要改哪 |
| --- | --- | --- |
| 加一种课堂互动（投票/抢答/弹幕类） | 新表 + `classroom-runtime` 模块 + 路由 + `SOCKET_ROUTES` 一行 | 不要塞进 `classroom.ts` 单文件 |
| 加一种白板元素 | `canvas-model` + `rendering-engine` + `LAYOUT_ONLY_ELEMENT_TYPES` | 不要改 `InteractiveWhiteboard.tsx` 的 switch |
| 改课节阶段判定 | `stage-guard-pipeline.ts` | 不要在路由里 `if (stage === ...)` |
| 加一种题型 | 实现评分器 → 注册 `IAssessmentGraderRegistryToken` | 不要改 `assessment/question-types/builtin.ts` |
| 让学生端看到新视图 | 注册 `student.view` 槽位 | 不要在 `StudentView` 里加 if 分支 |

最后一行是本仓库的核心约定：**前端页面的扩展靠槽位，不靠条件分支**。
