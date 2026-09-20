# Whiteboard Event Slot Contract

> 白板内**前端事件采集 / 队列 / 分发**层的契约文档。
>
> 对应实现位于 `src/features/whiteboard/events/`：
> - `types.ts` — 类型定义
> - `WhiteboardEventSlot.ts` — 核心单例类（采集 / 队列 / 分发）
> - `useWhiteboardEvents.ts` — React Hook（订阅 + state）
> - `WhiteboardEventPanel.tsx` — 调试面板
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
采集层 (HtmlAppletFrame / widget / manual)
   ↓ ingest({...})
WhiteboardEventSlot (单例)
   ├─→ 本地订阅者 (TeacherPanel / AI / 调试面板 / 任何 useWhiteboardEvents 消费者)
   ├─→ frontendEventBus.publish → Socket 转发 → server EventBus
   └─→ 可选 IndexedDB 持久化 (默认关闭)
```

---

## 1. 事件类型 (`WhiteboardEvent`)

```ts
interface WhiteboardEvent {
  id: string;                                  // uuid v7
  timestamp: number;                           // Date.now()
  source: WhiteboardEventSource;               // 见 §2
  type: string;                                // 见 §3
  payload: Record<string, unknown>;            // 标准化后的字段
  raw?: unknown;                               // 原始数据
  lessonId?: string;
  elementId?: string;                          // 白板 shapeId
  coursewareUuid?: string;                     // courseware.uuid
  attemptId?: string;                          // courseware_attempt.id
  studentId?: string;
  studentName?: string;
}
```

`payload` 中的字段约定：

| 字段             | 类型     | 含义                                                         |
| ---------------- | -------- | ------------------------------------------------------------ |
| `score`          | `number` | 学生得分（已归一化为 number，不接受字符串）                   |
| `total`          | `number` | 满分                                                          |
| `completion`     | `number` | 完成度（0-100，已百分制）                                     |
| `comment`        | `string` | 评语 / 反馈                                                    |
| `detail`         | `unknown`| 课件 SDK 上报的明细（结构由课件决定）                          |
| `originalType`   | `string` | 仅 `courseware.unknown` 事件使用，记录未识别的 LMS_* 协议类型 |

---

## 2. 事件来源 (`WhiteboardEventSource`)

| 值                    | 含义                                                         | 典型采集层                                       |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `iframe.postMessage`  | iframe 直接 postMessage（未规范化）                          | `HtmlAppletFrame.messageHandler`                 |
| `iframe.bridge`       | 父窗口 LMS Bridge 处理后的协议事件                            | `lms-bridge.ts` 全局监听 (`useLmsBridge`)        |
| `applet.score`        | 来自 HtmlAppletFrame 解析后的成绩事件                        | `HtmlAppletFrame.messageHandler` (courseware:score 分支) |
| `widget.quiz`         | 原生 quiz widget                                              | （待接入）                                       |
| `widget.canvas`       | 原生画布 widget                                                | （待接入）                                       |
| `widget.custom`       | 通用自定义 widget                                              | （待接入）                                       |
| `manual`              | 手动 emit（UI / 调试代码 / 业务事件）                          | 任意代码直接调用 `whiteboardEventSlot.ingest`    |

---

## 3. 事件类型 (`type`)

事件类型用 `<域>.<动作>` 命名空间，匹配 `frontendEventBus` 的 `SOCKET_FORWARD_PREFIXES`（`'whiteboard.', 'courseware.', 'quiz.', 'rollcall.'`）。

### 3.1 `courseware.*` （白板内 HTML 课件 / courseware-hub 插件）

| `type`                       | 触发时机                                                   | `payload` 字段                                             |
| ---------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `courseware.submitted`       | iframe 内 `LMS.submit` / `OpenLearn.submit` 被调用；或 server `courseware-attempt-updated` type=`submit` 广播 | `score`, `total`, `completion`, `comment`, `source`       |
| `courseware.progress_saved`  | iframe 内 `LMS.saveProgress` 被调用                        | `score`, `completion`                                     |
| `courseware.finished`        | iframe 内 `LMS.finish` 被调用；或 server promote 动作      | —                                                         |
| `courseware.config_reported` | iframe 内 `LMS_CONFIG` 上报                                | （取决于课件；通常包含互动能力清单）                       |
| `courseware.event_logged`    | lms-bridge 处理未知协议或杂项时写入；或 server log 动作     | （取决于 iframe 消息内容）                                 |
| `courseware.unknown`         | 未识别的 `LMS_*` 协议事件                                   | `originalType`                                             |

**双路径汇合**：plugin `submitScore` (courseware-hub) 和 LMS Bridge 都会触发 server 的 `courseware-attempt-updated` 广播。`useClassroomSocket` 统一将该事件映射到 WhiteboardEventSlot (`source='iframe.bridge'`, `type` 按 server 的 `data.type` 取 `submit`/`log`/`promote`)，保证两种提交路径都在 TeacherPanel "最近提交" 小卡可见。

### 3.2 `quiz.*` （原生 quiz widget）

| `type`           | 触发时机                                                          | `payload` 字段                                         |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| `quiz.answered`  | 学生提交 quiz 答案后，服务端 `/api/lessons/:id/quiz-submit` 成功   | `answer`, `score`, `isCorrect`, `correctAnswer`, `question`, `time` |

**数据流**：学生点击 quiz 答案 → POST `/api/lessons/:id/quiz-submit`（`server/routes/lessons.ts:549`）→ 写入 `whiteboard_elements.data.submissions[studentId]` → `io.emit('whiteboard-quiz-answered', {...})` → 前端 `useClassroomSocket` 监听 → `whiteboardEventSlot.ingest({ source:'widget.quiz', type:'quiz.answered', ...})`。

### 3.3 `whiteboard.*` （白板自身 UI 事件，已有）

参考 `InteractiveWhiteboard.tsx` 中已有的 28 个 `frontendEventBus.publish` 点（`whiteboard.element_updated` / `whiteboard.element_added` / ...）。这些事件**不经过 `WhiteboardEventSlot`**，直接走全局 `frontendEventBus`。

> **未迁移原因**：迁移涉及 28 处代码，影响面大；优先解决"成绩静默丢失"的高优问题。

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
import { useWhiteboardEvents, useWhiteboardEventListener } from '@/features/whiteboard/events';

// 维护 React state（事件列表）
const events = useWhiteboardEvents(
  { types: ['courseware.submitted'], lessonId },
  { replay: 10, maxItems: 50 },
);

// 仅副作用监听
useWhiteboardEventListener(
  { coursewareUuid },
  (e) => console.log('分数:', e.payload.score),
);
```

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
  types?: string[];                   // 任一命中即可
  sources?: WhiteboardEventSource[];
  lessonId?: string;                  // 精确匹配
  elementId?: string;
  coursewareUuid?: string;
  studentId?: string;
  predicate?: (e: WhiteboardEvent) => boolean;
}
```

所有字段**同时**生效（AND 关系）。`types` / `sources` 数组内是 OR 关系。

---

## 6. 队列语义

- **环形 buffer**，默认容量 200 条（`DEFAULT_QUEUE_CAPACITY`）
- 超出容量**从头部丢弃**（最老的先丢）
- 默认**不**持久化；启用 `persist: true` 时写入 IndexedDB（`whiteboard-event-slot` 数据库，`events` object store）
- 查询按时间倒序，返回数组**最新 → 最旧**

---

## 7. 与 frontendEventBus / Socket 转发的关系

`WhiteboardEventSlot.ingest()` 会**同步**调用 `frontendEventBus.publish()`（包成 `PlatformEvent`）：

```ts
function toPlatformEvent(event: WhiteboardEvent): PlatformEvent {
  return {
    id: event.id,
    type: event.type,                              // 'courseware.submitted' 等
    source: `whiteboard.slot.${event.source}`,     // 'whiteboard.slot.iframe.postMessage' 等
    payload: {
      lessonId, elementId, coursewareUuid, attemptId, studentId, studentName,
      ...event.payload,
      __raw: event.raw,                            // 原始数据放 payload 末尾
    },
    timestamp: event.timestamp,
    correlationId: event.lessonId,
  };
}
```

而 `frontendEventBus` 的 `SOCKET_FORWARD_PREFIXES = ['whiteboard.', 'courseware.', 'quiz.', 'rollcall.']`，因此 **`courseware.*` 事件会自动通过 socket 转发到服务端 EventBus**，供 AI Agent / 服务端插件订阅。

> ⚠️ **同步双重写入**：`lms-bridge.ts` 的 `emitCoursewareEvent` 同时调用 `frontendEventBus.publish` **和** `whiteboardEventSlot.ingest`。这是有意为之：
> - frontendEventBus 走 socket 转发链（保证与原行为一致）
> - whiteboardEventSlot 提供本地可订阅的实时队列
> - 两个写入互不影响（各自由订阅者过滤）

---

## 8. 调试 UI

```tsx
import { WhiteboardEventPanel } from '@/features/whiteboard/events';

// 白板右下角浮窗（开发/调试用）
<WhiteboardEventPanel lessonId={lessonId} defaultCollapsed />
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
- 不向后兼容旧版 `frontendEventBus.publish('courseware.*')` —— 旧调用仍然有效，但新代码应优先使用 `whiteboardEventSlot.ingest(...)`

---

## 10. 已知 gap（待后续接入）

- ✅ **`widget.quiz` 已接入**（v0.3.21）：`useClassroomSocket` 监听 `whiteboard-quiz-answered` socket 事件后 ingest；`server/routes/lessons.ts:590` 在 quiz-submit 成功后全局广播。详见 §3.2。
- `widget.canvas` / `widget.custom` 仍待接入（白板目前未发现原生 canvas widget，custom widget 需插件端主动调用 `whiteboardEventSlot.ingest`）
- `whiteboard.*` 事件仍在原 frontendEventBus 直发，未迁移
- IndexedDB 持久化默认关闭（`persist: false`），生产可按需开启

## 11. 配套 UI 组件

- `WhiteboardEventPanel` (`src/features/whiteboard/events/WhiteboardEventPanel.tsx`) — 右下角调试浮窗
- `RecentSubmissionsCard` (`src/features/whiteboard/events/RecentSubmissionsCard.tsx`) — 顶部"最近提交"小卡，按 `lessonId` 过滤；按事件类型分色（`quiz.answered` 答对/答错；`courseware.submitted` 课件提交），教师面板内嵌用
