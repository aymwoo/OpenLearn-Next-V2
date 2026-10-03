# Whiteboard Event Slot Contract

<!-- doc-version: sdk=3.7.0 -->

> 白板内**前端事件采集 / 队列 / 分发**层的契约文档。
>
> 对应实现位于 `src/features/whiteboard/events/`：
>
> - `types.ts` — 类型定义 + `toPlatformEvent` + `DEFAULT_QUEUE_CAPACITY`
> - `WhiteboardEventSlot.ts` — 核心单例类（采集 / 队列 / 分发）
> - `useWhiteboardEvents.ts` — React Hook（订阅 + state + emit）
> - `WhiteboardEventPanel.tsx` — 调试面板
> - `RecentSubmissionsCard.tsx` — 教师面板「最近提交」小卡
>
> 本文档约定的事件契约是**白板内任何组件 / iframe / widget** 发布事件时的唯一参考；订阅端按此契约过滤。

---

## 0. 设计动机

白板是 OpenLearn 中最复杂的复合页面之一：一个页面同时承载画布（Konva 图元）、iframe 课件（`html-applet`）、插件 widget（quiz / canvas / rollcall）、AI 助手等。所有这些组件都可能产生需要被外部感知的"事件"：

- **教师**希望看到"学生 X 刚提交了课件分数 85/100"
- **AI 助手**希望根据"quiz 全班通过率 100%"给学生推荐下一题
- **调试面板**需要观察"iframe 内的 LMS.submit 是否真的上报了"
- **批改模块**需要把分数同步到作业列表

如果每个组件各自定义事件协议，订阅端就要写 5 套监听器。`WhiteboardEventSlot` 提供统一抽象：

```
采集层 (HtmlAppletFrame / lms-bridge / useClassroomSocket / manual)
   ↓ ingest({...})
WhiteboardEventSlot (单例, 纯浏览器进程内)
   ├─→ 本地订阅者 (TeacherPanel / AI / 调试面板 / RecentSubmissionsCard / 任何 useWhiteboardEvents 消费者)
   ├─→ frontendEventBus.publish → **仅本进程内订阅者**（无 socket 转发，见 §7）
   └─→ 可选 IndexedDB 持久化 (默认关闭)
```

> ⚠️ **本槽不是跨端通道**。白板事件的跨端传播只走两条**已接线**的通路：状态变更经 REST → 命令总线 → 服务端 EventBus → `server/event-routing.ts` 投递；即时通知直接用 socket。详见 §7。

---

## 1. 事件类型 (`WhiteboardEvent`)

```ts
interface WhiteboardEvent {
  id: string; // uuid v7
  timestamp: number; // Date.now()
  source: WhiteboardEventSource; // 见 §2
  type: string; // 见 §3
  payload: Record<string, unknown>; // 标准化后的字段
  raw?: unknown; // 原始数据
  lessonId?: string;
  elementId?: string; // 白板 shapeId
  coursewareUuid?: string; // courseware.uuid
  attemptId?: string; // courseware_attempt.id
  studentId?: string;
  studentName?: string;
}
```

`payload` 中的字段约定：

| 字段           | 类型      | 含义                                                          |
| -------------- | --------- | ------------------------------------------------------------- |
| `score`        | `number`  | 学生得分（已归一化为 number，不接受字符串）                   |
| `total`        | `number`  | 满分                                                          |
| `completion`   | `number`  | 完成度（0-100，已百分制）                                     |
| `comment`      | `string`  | 评语 / 反馈                                                   |
| `detail`       | `unknown` | 课件 SDK 上报的明细（结构由课件决定）                         |
| `originalType` | `string`  | 仅 `courseware.unknown` 事件使用，记录未识别的 LMS_* 协议类型 |

---

## 2. 事件来源 (`WhiteboardEventSource`)

| 值                   | 含义                                  | 典型采集层                                               |
| -------------------- | ------------------------------------- | -------------------------------------------------------- |
| `iframe.postMessage` | iframe 直接 postMessage（未规范化）   | `HtmlAppletFrame.messageHandler`                         |
| `iframe.bridge`      | 父窗口 LMS Bridge 处理后的协议事件，或 server socket 广播映射 | `src/services/lms-bridge.ts` 的 `emitCoursewareEvent`；`src/hooks/useClassroomSocket.ts` 的 `courseware-attempt-updated` 监听 |
| `applet.score`       | 来自 HtmlAppletFrame 解析后的成绩事件 | `HtmlAppletFrame.messageHandler` (courseware:score 分支) |
| `widget.quiz`        | 原生 quiz widget                      | `useClassroomSocket` 监听 `whiteboard-quiz-answered`（**已接入**，见 §3.2） |
| `widget.canvas`      | 原生画布 widget                       | （待接入）                                               |
| `widget.custom`      | 通用自定义 widget                     | （待接入）                                               |
| `manual`             | 手动 emit（UI / 调试代码 / 业务事件） | 任意代码直接调用 `whiteboardEventSlot.ingest` 或 `useEmitWhiteboardEvent`（缺省 source 即 `'manual'`） |

---

## 3. 事件类型 (`type`)

事件类型用 `<域>.<动作>` 命名空间。**命名空间本身没有任何运行时含义**——槽位不做前缀过滤/转发，只按 §5 的 `EventFilter` 匹配。

### 3.1 `courseware.*` （白板内 HTML 课件 / courseware-hub 插件）

| `type`                       | 触发时机                                                                                                      | `payload` 字段                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `courseware.submitted`       | iframe 内 `LMS.submit` / `OpenLearn.submit` 被调用；或 server `courseware-attempt-updated` type=`submit` 广播 | `score`, `total`, `completion`, `comment`, `source` |
| `courseware.progress_saved`  | iframe 内 `LMS.saveProgress` 被调用                                                                           | `score`, `completion`                               |
| `courseware.finished`        | iframe 内 `LMS.finish` 被调用；或 server 广播 type=`promote` 映射                                              | —                                                   |
| `courseware.config_reported` | iframe 内 `LMS_CONFIG` 上报                                                                                   | （取决于课件；通常包含互动能力清单）                |
| `courseware.event_logged`    | lms-bridge 处理未知协议或杂项时写入；或 server 广播 type=`log` 映射                                            | （取决于 iframe 消息内容）                          |
| `courseware.unknown`         | 未识别的 `LMS_*` 协议事件                                                                                     | `originalType`                                      |

**双路径汇合**：plugin `submitScore` (courseware-hub) 和 LMS Bridge 都会触发 server 的 `courseware-attempt-updated` 广播。`useClassroomSocket`（`src/hooks/useClassroomSocket.ts`）监听该 socket 事件，把 `data.type` 映射后 ingest（`source='iframe.bridge'`）：

| server `data.type` | 映射到槽内 `type`              |
| ------------------ | ------------------------------ |
| `submit`           | `courseware.submitted`         |
| `log`              | `courseware.event_logged`      |
| `promote`          | `courseware.finished`          |
| 其它（含 `adopt`） | 兜底 `courseware.event_logged`  |

> ⚠️ **映射与实际广播值有缺口**：服务端目前只发 `log` / `submit` / `adopt` 三种（见 `publishAttemptUpdated` 的类型签名），**不发 `promote`**。因此 `courseware.finished` 分支在真实链路上不会被触发，而 `adopt` 会落进兜底分支被标成 `courseware.event_logged`。这属于**前端映射表与服务端广播值的漂移**，尚未修复，见 §10。
>
> 该分支 ingest 的 payload 是**最小集**（仅 `attemptId` + `attemptType`），成绩与学生名由面板层二次拉 `GET /api/courseware/attempts` 补全。

### 3.2 `quiz.*` （原生 quiz widget）

| `type`          | 触发时机                                                         | `payload` 字段                                                      |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `quiz.answered` | 学生提交 quiz 答案后，服务端 `/api/lessons/:id/quiz-submit` 成功 | `answer`, `score`, `isCorrect`, `correctAnswer`, `question`, `time` |

**数据流**：学生点击 quiz 答案 → POST `/api/lessons/:id/quiz-submit`（`server/routes/lessons.ts` 的 `quiz-submit` 路由）→ 判定 `isCorrect`/`score`（答对 100 / 答错 0）→ `INSERT ... ON CONFLICT(lesson_id, element_id, student_id) DO UPDATE` 写 `lesson_quiz_submissions` → `publishClassroomEvent(CLASSROOM_EVENTS.WHITEBOARD_QUIZ_ANSWERED, {...})` → 由 `server/event-routing.ts` 投递为 socket 事件 `whiteboard-quiz-answered` → 前端 `useClassroomSocket` 监听 → `whiteboardEventSlot.ingest({ source:'widget.quiz', type:'quiz.answered', ...})`。

> ⚠️ **权威数据源已迁移**：`lesson_quiz_submissions` 是唯一权威表。历史上这里会把 `submissions` 写回 `whiteboard_elements.data` JSON，那是读-改-写，同题多名学生并发提交会互相覆盖丢成绩（已根治）。`whiteboard_elements.data.submissions` 现在**仅作为存量历史数据保留展示兜底**，不要再写入。

另有第二个广播点：`server/routes/classroom.ts` 的 `POST /api/classroom/sessions/:lessonId/simulate-quiz-responses`（教师/管理员，用于演示/压测）用 `emitClassroomEvent` 直接向课堂房间广播同名 socket 事件 `whiteboard-quiz-answered`。它不写 `lesson_quiz_submissions`。

### 3.3 `whiteboard.*` （白板自身 UI 事件，已有）

参考 `src/features/whiteboard/InteractiveWhiteboard.tsx` 中已有的 **34 个** `frontendEventBus.publish` 点（`whiteboard.element_updated` / `whiteboard.element_added` / ...）。这些事件**不经过 `WhiteboardEventSlot`**，直接发 `frontendEventBus`，因此**只被同进程订阅者收到**（§7）。

> **未迁移原因**：迁移涉及 34 处调用点，影响面大；优先解决"成绩静默丢失"的高优问题。

---

## 4. 公共 API

### 4.1 采集 / 发送

```ts
import { whiteboardEventSlot } from '@/features/whiteboard/events';

// 完整形式
whiteboardEventSlot.ingest({
  source: 'iframe.postMessage',
  type: 'courseware.submitted',
  lessonId: 'L-001',
  elementId: 'shape-abc',
  coursewareUuid: 'cw-uuid',
  attemptId: 'att-uuid',
  payload: { score: 85, total: 100, completion: 100 },
  raw: originalMessage,
});

// 快捷形式
whiteboardEventSlot.emit(
  'quiz.answered',
  { questionId: 'q1', answer: 'A' },
  { lessonId: 'L-001', elementId: 'shape-abc', source: 'widget.quiz' },
);
```

返回值是完整的 `WhiteboardEvent`（含 id + timestamp）。

### 4.2 订阅（命令式）

```ts
const unsub = whiteboardEventSlot.subscribe(
  {
    types: ['courseware.submitted'],
    lessonId: 'L-001',
    // 可选：sources / elementId / coursewareUuid / studentId / predicate
  },
  (event) => {
    console.log('学生提交:', event.payload.score);
  },
  { replay: 10 }, // 立即重放最近 10 条匹配历史
);

// 取消订阅
unsub();
```

### 4.3 订阅（React Hook）

```tsx
import { useWhiteboardEvents, useWhiteboardEventListener, useEmitWhiteboardEvent } from '@/features/whiteboard/events';

// 维护 React state（事件列表）
const events = useWhiteboardEvents({ types: ['courseware.submitted'], lessonId }, { replay: 10, maxItems: 50 });

// 仅副作用监听
useWhiteboardEventListener({ coursewareUuid }, (e) => console.log('分数:', e.payload.score));

// 白板组件主动发事件
const emit = useEmitWhiteboardEvent();
emit('quiz.answered', { questionId: 'q1', answer: 'A' }, { lessonId, source: 'widget.quiz' });
```

`useEmitWhiteboardEvent` 返回的 `emit(type, payload, meta?)` 中，`meta.source` 缺省为 `'manual'`。

### 4.4 查询 / 统计

```ts
// 查询历史
const recent = whiteboardEventSlot.query(
  { types: ['courseware.submitted'] },
  { limit: 50, since: Date.now() - 60_000 }, // 最近 1 分钟
);

// 统计
const stats = whiteboardEventSlot.stats();
// { total: 23, byType: { 'courseware.submitted': 5, ... }, bySource: { 'iframe.bridge': 8, ... } }

// 清空（调试）
whiteboardEventSlot.clear();
```

---

## 5. 过滤器语义 (`EventFilter`)

```ts
interface EventFilter {
  types?: string[]; // 任一命中即可
  sources?: WhiteboardEventSource[];
  lessonId?: string; // 精确匹配
  elementId?: string;
  coursewareUuid?: string;
  studentId?: string;
  predicate?: (e: WhiteboardEvent) => boolean;
}
```

所有字段**同时**生效（AND 关系）。`types` / `sources` 数组内是 OR 关系。

---

## 6. 队列语义

- **环形 buffer**，默认容量 200 条（`DEFAULT_QUEUE_CAPACITY`，`src/features/whiteboard/events/types.ts`）
- 超出容量**从头部丢弃**（最老的先丢）
- 默认**不**持久化；启用 `persist: true` 时写入 IndexedDB（数据库名 `whiteboard-event-slot`，`events` object store，`keyPath: 'id'`）
- `query()` 从最新往前扫，返回顺序为**最新 → 最旧**；`since` 之外的事件在扫描到第一个更早的时间戳时 `break`（buffer 已按时间升序维护）
- 构造单例 `whiteboardEventSlot` 时用 `EventSlotOptions` 显式传 `{ capacity: DEFAULT_QUEUE_CAPACITY, persist: false }`

---

## 7. 与 frontendEventBus 的关系（无 socket 转发）

`WhiteboardEventSlot.ingest()` 会**同步构造** `PlatformEvent` 并调用 `frontendEventBus.publish()`（fire-and-forget，不 await，失败仅 `console.warn`，不影响 ingest 主流程）：

```ts
// src/features/whiteboard/events/types.ts 的 toPlatformEvent
function toPlatformEvent(event: WhiteboardEvent): PlatformEvent {
  return {
    id: event.id,
    type: event.type, // 'courseware.submitted' 等
    source: `whiteboard.slot.${event.source}`, // 'whiteboard.slot.iframe.postMessage' 等
    payload: {
      lessonId,
      elementId,
      coursewareUuid,
      attemptId,
      studentId,
      studentName,
      ...event.payload,
      __raw: event.raw, // 原始数据放 payload 末尾
    },
    timestamp: event.timestamp,
    correlationId: event.lessonId,
  };
}
```

### ⚠️ `frontendEventBus` **不会**把这些事件发到服务端

`src/services/event-bus.ts` 的 `FrontendEventBus.publish()` **只通知本浏览器进程内按 `event.type` 注册的订阅者**。文件头注释记录了这段历史包袱：

- 曾经有一个 `setSocketBridge()` 注入点，声称会把 `whiteboard.` / `courseware.` / `quiz.` / `rollcall.` 前缀的事件转发到服务端
- 但该注入点**从未被调用**（全仓库零 `setSocketBridge(...)` 调用）——那段转发是死代码，却让读代码的人误以为这些事件会跨端传播
- 随机点名「教师端已抽中、学生端不同步」的排查正是被它误导的先例，故**已删除**

`src/services/__tests__/event-bus.test.ts` 有一条回归测试断言 `setSocketBridge` / `hasSocketBridge` / `socketBridge` 这三个 API **不得重新出现**。

> 因此，**「`courseware.*` 事件会自动通过 socket 转发到服务端 EventBus，供 AI Agent / 服务端插件订阅」是错误承诺**。AI Agent 与服务端插件**订阅不到**白板槽事件。

### 需要跨端信号时的正确做法

| 需求                     | 正确通路                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| 状态变更（白板图元、课件登记……） | REST/命令总线：`PUT /api/lessons/:id/whiteboard/:elementId` → `whiteboard.update` 命令 → 服务端 `eventBus` → `server/event-routing.ts` 投递 |
| 即时通知                 | 直接用 socket（插件可用 `ctx.services.socketService`）                                           |
| AI 侧感知课堂事件         | 走服务端事件：课件提交 → `courseware.attempt_updated`；学生进度 → `student.progress_updated` 等   |

### `lms-bridge.ts` 的双写入

`src/services/lms-bridge.ts` 的 `emitCoursewareEvent` 同时调用 `frontendEventBus.publish` **和** `whiteboardEventSlot.ingest`（后者是 `import()` 动态加载后异步 ingest）。这是有意为之，但**理由与旧文档不同**：

- `frontendEventBus`：服务同一进程内既有的 `frontendEventBus` 订阅者（保持既有代码路径不受影响）
- `whiteboardEventSlot`：提供本地可订阅、可重放（`replay`）、可过滤的实时队列
- 两个写入互不影响（各自由订阅者过滤），任一故障都被 try/catch 隔离

---

## 8. 调试 UI

```tsx
import { WhiteboardEventPanel } from '@/features/whiteboard/events';

// 白板右下角浮窗（开发/调试用）
<WhiteboardEventPanel lessonId={lessonId} defaultCollapsed />;
```

功能：

- 实时显示最近 100 条事件
- 按 `type` / `source` 过滤
- 暂停 / 清空
- 点击行展开原始 JSON
- `data-testid`：`whiteboard-event-panel`、`whiteboard-event-panel-toggle` / `whiteboard-event-row-{id}` 等

---

## 9. 版本与稳定性

- **新增**于 v0.3.21（OpenLearn Next）
- 单例 API 表面稳定；`WhiteboardEventSource` / `EventFilter` 在新接入场景下会扩展，但破坏性变更需经评审
- 新代码应优先使用 `whiteboardEventSlot.ingest(...)`。直接调 `frontendEventBus.publish('courseware.*')` 仍然有效，但它**只在本进程内可订阅**（§7），拿不到可重放队列、过滤器和 `query/stats` 能力
- ⚠️ **不要**依赖「白板事件会跨端传播」这一假设。历史上 `setSocketBridge` 的注释让不少人（包括 AI 助手）误判此事，该注入点已删除且有回归测试守卫

---

## 10. 已知 gap（待后续接入）

- ✅ **`widget.quiz` 已接入**（v0.3.21）：`useClassroomSocket` 监听 `whiteboard-quiz-answered` socket 事件后 ingest；广播点见 §3.2（`server/routes/lessons.ts` 的 `quiz-submit` 路由 + `server/routes/classroom.ts` 的 `simulate-quiz-responses`）
- ⚠️ **`courseware-attempt-updated` 的 type 映射与服务端广播值有缺口**：前端 `useClassroomSocket` 的映射表覆盖 `log` / `submit` / `promote`，但服务端 `publishAttemptUpdated` 只发 `log` / `submit` / `adopt`。结果是 `courseware.finished` 分支永不触发，`adopt` 被兜底标成 `courseware.event_logged`。建议补 `adopt` 分支并移除失效的 `promote` 分支
- `widget.canvas` / `widget.custom` 仍待接入（白板目前未发现原生 canvas widget，custom widget 需插件端主动调用 `whiteboardEventSlot.ingest`）
- `whiteboard.*` 事件仍在原 `frontendEventBus` 直发（34 处），未迁移到槽
- IndexedDB 持久化默认关闭（`persist: false`），生产可按需开启
- ❌ **无跨端转发**：白板槽事件到不了服务端，AI Agent / 服务端插件订阅不到（§7）。需要跨端感知只能走服务端事件或 socket

---

## 11. 配套 UI 组件

- `WhiteboardEventPanel` (`src/features/whiteboard/events/WhiteboardEventPanel.tsx`) — 右下角调试浮窗
- `RecentSubmissionsCard` (`src/features/whiteboard/events/RecentSubmissionsCard.tsx`) — 顶部"最近提交"小卡，按 `lessonId` 过滤；按事件类型分色（`quiz.answered` 答对/答错；`courseware.submitted` 课件提交），教师面板内嵌用

---

## 12. 相关源文件

| 路径                                                   | 内容                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `src/features/whiteboard/events/types.ts`              | `WhiteboardEvent` / `EventFilter` / `toPlatformEvent` / `DEFAULT_QUEUE_CAPACITY` |
| `src/features/whiteboard/events/WhiteboardEventSlot.ts` | 单例实现：ingest / subscribe / query / stats / clear      |
| `src/features/whiteboard/events/useWhiteboardEvents.ts` | `useWhiteboardEvents` / `useWhiteboardEventListener` / `useEmitWhiteboardEvent` |
| `src/features/whiteboard/events/index.ts`              | barrel 导出                                                |
| `src/services/event-bus.ts`                            | `frontendEventBus`（**仅本进程内**，§7）                   |
| `src/services/lms-bridge.ts`                           | `emitCoursewareEvent`（双写入，见 §7）                     |
| `src/hooks/useClassroomSocket.ts`                      | socket → 槽的映射（`quiz.answered` / `courseware.*`）      |
| `server/routes/lessons.ts`                              | `POST /api/lessons/:id/quiz-submit` 广播 `whiteboard.quiz_answered` |
| `server/routes/classroom.ts`                            | `simulate-quiz-responses` 演示广播                          |
| `server/classroom-events.ts` / `server/event-routing.ts` | 课堂事件发布与 Socket 投递路由表                           |
| `src/services/__tests__/event-bus.test.ts`             | 断言 `setSocketBridge` 不得复活的回归测试                   |
| `src/hooks/__tests__/whiteboard-quiz-ingest.test.tsx`  | `whiteboard-quiz-answered` → 槽 ingest 的回归测试          |
