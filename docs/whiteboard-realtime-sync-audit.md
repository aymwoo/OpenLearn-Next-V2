# 白板实时同步通路审计（备课组件 → 学生端）

> 范围：`whiteboard_elements` 的写入路径，及其对学生端可见性的影响。
> 结论基于 2026-09-30 的代码走查，每条结论均标注可复核的代码位置。
> 触发背景：随机点名（`rollcall`）教师端已抽中学生、学生端组件仍显示旧状态。
> **当前状态（2026-10-03 复核）**：§4 的 P0 / P0.5 / P1 / P2 / P3 均已实施，本文档结论仍然成立
> （死通道确已删除、`LAYOUT_ONLY_ELEMENT_TYPES` 确在 `server/event-routing.ts`、
> `CodeSandboxWrapper` / `MathGraphWrapper` 的回填 effect 确在）。§4 P2 的重复草稿段已合并为单一「已实施」小节。

---

## 0. 结论摘要

1. **点名不同步是双因叠加**：服务端从未广播（`whiteboard.element_updated` 是 effect-only 路由）**且**组件从不回读 `data`（`useState` 只在挂载时读一次）。两者已修复。

2. **「前端事件总线 → 服务端」的桥从未接线。** `frontendEventBus.setSocketBridge()` 在整个仓库中**没有任何调用点**。这意味着 `InteractiveWhiteboard` 里 30+ 处 `frontendEventBus.publish({ type: 'whiteboard.element_updated' })` 全部是**空操作** —— 既不通知本地订阅者（前端无人订阅该事件），也不上行到服务端。

3. **服务端已有一个功能完整、但零生产调用方的广播通道。** `server/presence.ts:130` 的 `whiteboard-event` socket 处理器完整实现了「写入 EventBus 审计 + 广播 `refresh` 到课节房间」，payload 类型里甚至带 `elementId` / `elementType` —— 但**只有测试代码触发过它**。

4. **唯一活着的同步通路是 REST + 命令总线。** 教师端任何图元写入都必须走
   `onElementUpdate` → `PUT /api/lessons/:id/whiteboard/:elementId` → `whiteboard.update` 命令 → DB → 服务端 `eventBus.publish` → `setupRealtimeBridge`。
   **所有绕过这条通路的广播都是死的。**

5. **学生端靠 2 秒轮询兜底**（`useAppPolling.ts:146`，`fetchElements` 每 2000ms）。所以"最终一致"成立，"实时"不成立；而任何把 `data` 缓存进 `useState` 且不回填的组件，连兜底都失效 —— 这正是点名组件的表现。

6. **`element_deleted` / `cleared` / `batch_drawn` 原先只投课节房间**，而 `element_drawn` 两个都投 —— 不在课节视图的学生（停在仪表盘）收不到删除/清空通知。**已对齐**（见 §4 P1），并顺带堵掉伪课节房间被误投广播的隐患。

---

## 1. 实际数据流（as-built）

### 1.1 四条候选通路

| #   | 通路                          | 前端生产者                                                              | 服务端处理                                                        | 是否广播 refresh                    |
| --- | ----------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| A   | `whiteboard-update` socket    | `InteractiveWhiteboard`（**仅** temp-draw / temp-end / segment-change） | `presence.ts:124` `socket.to(room).emit('whiteboard-sync', data)` | 原样透传，非 refresh                |
| B   | `whiteboard-event` socket     | **无**（仅 `presence.test.ts:128`）                                     | `presence.ts:130` → EventBus + `refresh` 广播                     | ✅ 完整实现，零调用方               |
| C   | `frontendEventBus` → socket   | `InteractiveWhiteboard` ×30+，payload **无 `elementId`**                | `event-routing.ts` (`rooms: () => []`)                            | ❌ 死通道（桥未接线）               |
| D   | REST `whiteboard.update` 命令 | `onElementUpdate` → PUT                                                 | `builtin.ts:526` → DB + EventBus                                  | ❌ 原为 effect-only；点名已单独补发 |

### 1.2 为什么通路 C 是死的

```ts
// src/services/event-bus.ts
publish(event: PlatformEvent): Promise<void> {
  const handlers = this.handlers.get(event.type);   // ① 本地订阅者：无
  ...
  if (this.socketBridge && SOCKET_FORWARD_PREFIXES.some(...)) {  // ② 恒为 false
    this.socketBridge(event);
  }
}
```

- `socketBridge` 仅由 `setSocketBridge()` 注入 —— 全仓库 **0 个调用点**。
- `SOCKET_FORWARD_PREFIXES = ['whiteboard.', 'courseware.', 'quiz.', 'rollcall.']` 这段前缀白名单因此从未生效，`rollcall.picked` / `rollcall.evaluated` 同样没有上行。

**影响面（已核实，不含第三方插件）**：

所有 `type: 'whiteboard.*'` / `courseware.*` / `quiz.*` / `rollcall.*` 的**一方前端代码**发布都只对本地订阅者可见。但**第三方插件不受影响** —— `FrontendPluginContext.services`（`src/plugin-host/types.ts:232`）只有 `frontendApi` / `socketService` / `uiService` / `storageService` 四项，**根本没有 `eventBus`**，插件写了也会被 TypeScript 拦下。SDK 里那两处 `services.eventBus`（`openlearn.d.ts:408` `PluginContext`、`:529` `ActivityContext`）都属于服务端/Worker 上下文，其 EventBus 经 `setupRealtimeBridge` 是接线的。

即：这条死通道的影响**仅限一方代码**，且症状与点名 bug 完全同源 —— 代码看起来在广播，实际什么都没发生。

### 1.3 服务端路由表现状

| 事件                         | socket 名                  | 目标房间                       | 学生端效果                    |
| ---------------------------- | -------------------------- | ------------------------------ | ----------------------------- |
| `whiteboard.element_drawn`   | `whiteboard-sync`          | 课节 + `whiteboard-broadcast`  | ✅ 全员刷新                   |
| `whiteboard.element_updated` | `whiteboard-sync`          | `[]`，由 effect 按元素类型决定 | ✅ 语义型广播 / 布局型静默    |
| `whiteboard.batch_drawn`     | `whiteboard-sync`          | 课节 + `whiteboard-broadcast`  | ✅ 已对齐                     |
| `whiteboard.element_deleted` | `whiteboard-sync`          | 课节 + `whiteboard-broadcast`  | ✅ 已对齐                     |
| `whiteboard.cleared`         | `whiteboard-sync`          | 课节 + `whiteboard-broadcast`  | ✅ 已对齐                     |
| `whiteboard.quiz_answered`   | `whiteboard-quiz-answered` | 全局                           | ✅ 仅学生作答回传，非内容同步 |

> 四条白板刷新通路（新增/批量/删除/清空）房间口径现已一致。伪课节房间
> （`assignment-*-student-*`）不进广播房间，见 §4 P1。

---

## 2. 元素类型清单

学生端白板对所有组件都是 `readOnly`（`StudentLessonInteractionPanel.tsx:145` `readOnly={isStudentLocked}`），只读模式隐藏编辑/删除入口但**照常渲染内容**。因此判定标准是：**教师修改后，学生是否必须看到。**

### 2.1 语义型（教师改 = 课堂内容改，必须同步）

「组件是否消费 `data`」一列是**逐文件走查**结果：把 `data` 的语义字段复制进 `useState` 却不回填的，就是点名同款 bug。

| 类型                     | 关键内容字段                                | 组件是否消费 `data`                                     | 广播策略（P0 后）   | 综合判定                            |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------- | ------------------- | ----------------------------------- |
| `rollcall`               | `selectedStudent` / `status` / `evaluation` | ✅ 已加回填 effect                                      | ✅ 抽中新学生时补发 | ✅ 已修                             |
| `math-graph`             | `equation`                                  | ✅ 已加回填 effect                                      | ✅ 默认广播         | ✅ 已修                             |
| `code-sandbox`           | `code`                                      | ✅ 已加回填 effect                                      | ✅ 默认广播         | ✅ 已修                             |
| `presentation`           | `markdown` / `slideX`                       | ✅ 原本就有（`RevealPresentationWrapper.tsx:72-83`）    | ✅ 默认广播         | ✅ 已通（原先靠 2s 轮询）           |
| `quiz`                   | `question` / `options` / `correctIndex`     | 未走独立 Widget 组件，内联渲染（`data` 变化直接重渲染） | ✅ 默认广播         | ✅ 已通                             |
| `assignment`             | `title` / `description` / `assignmentId`    | 同上，内联渲染                                          | ✅ 默认广播         | ✅ 已通                             |
| `plugin` / `hello-world` | 插件自有数据                                | 与白板 `data` **无关**（见 §2.4）                       | ✅ 默认广播         | ➖ 主机侧已通；插件内同步由插件自负 |

> **「默认广播」= 未列入 `LAYOUT_ONLY_ELEMENT_TYPES` 的一律广播。** 这是 fail-safe 方向：新增元素类型默认走广播（多刷一次，代价可接受），而不会静默不同步。

> **`RevealPresentationWrapper` 是正面样本**：它既有 `useState(data.markdown)`，也有对应的双向回填 effect。本次对 `RollCallWrapper` 的修法与它同构 —— 组件层面的正确范式已经在仓库里存在，点名只是漏了。
>
> 另注：`slideIndex` 的初值读的是 `data.slideX`（`:33`），字段名可疑但读写两侧一致（`:73` 的回填 effect 同样用 `slideX`），故判定为**命名不当而非 bug**；建议改名 `slideIndex` 但不要在本次同步修复里顺手改，会混入无关变更。

### 2.2 布局型（拖拽/缩放，刻意不广播 —— 设计正确）

`text` / `rect` / `rectangle` / `circle` / `shape` / `pen` / `highlighter` / `page_meta`

字段：`x` / `y` / `width` / `height` / `rotation` / `opacity` / `zIndex` / `isMinimized` / `isMaximized`

这些走 `handleElementDragEnd` / `handleResizeEnd`，每次松手一次 PUT。`rooms: () => []` 正是为它们设计的 —— 若改成广播，每次拖拽都会触发全班全量重拉。**这部分不应改。**

> 代价：教师把一个组件从左边拖到右边，学生不会看到移动，只能靠 2 秒轮询感知。这是可接受的取舍，但应写进文档而非靠默认行为。

### 2.4 架构上不在范围内（已查实，原「待确认」两项）

这两类**不适用**本文的「哪些 `element_updated` 要广播」，因为它们的状态根本不存在 `whiteboard_elements.data` 里。

**`html-applet`（互动课件）—— 已是正面样本**

- `InteractiveWhiteboard:3240` 渲染 `HtmlAppletFrame` 时**根本没传 `onElementUpdate`**，其状态不落白板元素。`data` 里只有 `data.coursewareUuid` 这个**引用**。
- 真实状态走独立通路：成绩浮层自行 `GET /api/courseware/attempts`，并**主动订阅 `courseware-attempt-updated`**（`HtmlAppletFrame.tsx:121-135`）自动重拉。
- 该事件的权威生产者在服务端（`classroom-events.ts:32` → `event-routing.ts:311`，`rooms: () => null` 全局广播），不依赖前端 → 服务端那条 `frontendEventBus` 桥。

这正是 §3 准则想要的目标形态：**专用事件 + 专用重拉**，与白板刷新解耦。

**`plugin` / `hello-world`（第三方组件）—— 状态自有**

- `PluginCardRenderer` 的 props 只有 `pluginId / slot / widgetId / elementId / lessonId`，**不接收 `data`**；`useEffect` 依赖也不含 `data`。
- 插件以 `elementId` 为键持有自己的状态（经 `frontendApi` 或 `socketService`）。跨端同步由插件自己负责，宿主不介入。
- 白板刷新对它的唯一作用是：教师增删/改绑组件后，让 `PluginCardRenderer` 拿到新的 `widgetId`。这一诉求已被 §4 P0 覆盖。

**结论**：待确认清单清空。需要重新审视的只剩 §2.1 前五行。

---

## 3. 判定准则（建议固化为契约）

一个图元更新是否需要广播，不看"是否持久化"，看**"学生是否必须看到"**：

```
需要广播 ⟺ 满足任一条
  ① 更新改变了「学生要读的内容」      （题面、代码、幻灯片、点名结果）
  ② 更新改变了「课堂进行中的状态」    （抽中、公布答案、绑定作业）
  ③ 更新会改变「学生下一步能做什么」  （组件出现/消失、可点击性）

不广播 ⟺ 仅几何/视图属性
  x y width height rotation opacity zIndex isMinimized isMaximized
```

实现上应把这条准则表达为**声明式的**，而不是继续在路由 `effect` 里逐类型开洞 —— 否则每加一个语义型组件都要改一次服务端路由表（点名这次就是这么加的）。

---

## 4. 建议（按优先级）

### P0 — 按元素类型声明广播策略（✅ 已实施，落点与初稿不同）

初稿提议在两个前端宿主（`LiveClassroomView` / `LessonEditorView`）的 `onElementUpdate` 里判断。**实施时改为放在服务端 `event-routing.ts`**，理由是走查发现两条持久化路径形态不同：

| 宿主                            | 路径                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `LiveClassroomView`（直播课堂） | `onElementUpdate` → 直接 `fetch(PUT)`                                                                            |
| `LessonEditorView`（备课编辑）  | `onElementUpdate` → `queueUpdate`（800ms 防抖 autosave）→ `flush()` → `handleSaveElementToServer` → `fetch(PUT)` |

两者最终都汇聚到 `whiteboard.update` 命令。因此判定放在服务端有三个好处：

1. 元素 `type` 本来就在 `whiteboard_elements` 行里，无需前端传；
2. **一次覆盖两条路径**，防抖路径不需要特殊处理；
3. 判定逻辑只有一份，不会随宿主增加而漂移。

实现形态是 `LAYOUT_ONLY_ELEMENT_TYPES` 声明式集合 + `handleElementUpdatedEffect` 统一入口：

- 落在集合里的类型（`text` / `rectangle` / `rect` / `circle` / `shape` / `pen` / `highlighter` / `page_meta`）→ 静默；
- 其余（含**未登记的新类型**）→ 广播。

**默认方向是 fail-safe**：未登记类型最多多刷一次；若默认不广播，新加的语义型组件会静默不同步 —— 那正是本次要根治的病。

点名不走默认策略：`persistRollcallPick` 返回「本次是否新抽中」，只有真正抽中新学生才补广播，拖拽/缩放不触发。

### P0.5 — 顺带修掉的两处同类组件 bug（✅ 已实施）

服务端广播只解决「数据到不到」，**解决不了组件读不读**。`code-sandbox` 与 `math-graph` 同样把 `data` 语义字段缓存进 `useState` 且无回填，数据到了也不显示。两者已按 `RevealPresentationWrapper` 的既有范式补上回填 effect。

> 这一条初稿没识别出依赖关系：只做 P0 会让这两个组件**看起来**修好了（服务端在广播）却依然不同步。

### P1 — 统一房间口径（✅ 已实施）

`element_deleted` / `cleared` / `batch_drawn` 与 `whiteboard-event` 均已对齐为
`lessonId + whiteboard-broadcast`。至此四条白板刷新通路（新增/更新/批量/删除/清空）房间口径一致。

**顺带堵掉一个被放大的隐患**：作业工作区给白板挂的是**伪课节** id
`assignment-<id>-student-<studentId>`（`StudentAssignmentWorkPanel`）。若把它也投进全局广播房间：

- 全平台客户端（含其它课节的学生）都会收到并无意义地重拉白板；
- 更糟的是客户端处理器在「当前没有选中课节」时会执行
  `setSelectedLesson(roomId)` + `setStudentViewStatus('lesson')`，
  把学生拉进一个**并不存在的课节视图**。

该隐患原本已存在于 `element_drawn`，本次扩大房间范围会放大它，因此补了
`isRealLessonRoom()` 守卫：伪课节只投自己的房间。

### P2 — 让组件消费 `data`，而不是缓存它（✅ 已实施）

修 `RollCallWrapper` 时走查发现另有两处同类 bug，均已修复：

- `src/features/whiteboard/widgets/MathGraphWrapper.tsx` —— `equation`
- `src/features/whiteboard/widgets/CodeSandboxWrapper.tsx` —— `code`

修法照抄 `RevealPresentationWrapper.tsx:72-83` 的既有范式（它是仓库里唯一原本就做对了的样本）。审计方法：

```bash
# ① 找出所有把 data 语义字段复制进 useState 的位置
grep -n "useState(.*data\." src/features/whiteboard/widgets/*.tsx
# ② 对每一处，确认是否存在对应的回填 effect（缺一即 bug）
grep -n "useEffect" src/features/whiteboard/widgets/<File>.tsx
```

注意 ① 的结果里 `RevealPresentationWrapper` 是**误报** —— 它有回填 effect。这正是不能只靠 grep 下结论的原因。

### P3 — 删除永不生效的 socket 桥（✅ 已实施）

`SOCKET_FORWARD_PREFIXES` 与 `setSocketBridge` / `hasSocketBridge` 已删除，`event-bus.ts` 顶部注释写明「本总线仅限当前浏览器进程内」，并指向两条真正接线的跨端通路（REST/命令总线、socket）。

理由：保留一个永不生效的前缀白名单，只会让后来者误判跨端能力 —— 这次审计本身就是被它误导的先例。

新增 `src/services/__tests__/event-bus.test.ts` 断言 `setSocketBridge` / `hasSocketBridge` / `socketBridge` **不存在**，防止它被重新伪装成跨端通道。

---

## 5. 风险与回归

| 风险                           | 说明                                                    | 缓解                                                                      |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| 全量刷新风暴                   | 若所有 PUT 都广播，拖拽场景会退化                       | 已按元素类型分流：布局型静默、语义型广播；未登记类型默认广播（fail-safe） |
| 未登记类型默认广播             | 未来新增纯布局类型会多刷一次                            | 代价是一次幂等的 `fetchElements`；方向上宁可多刷也别静默不同步            |
| 重复刷新                       | 教师端本地已 `fetchElements`，又收到广播再拉一次        | 幂等（`fetchElements` 无副作用）；如需优化用 `_meta.correlationId` 去重   |
| `presence.ts:151` 房间名不一致 | 注释自认"emit 到原始 lessonId（非 roomName）"的遗留问题 | 沿用原始 `lessonId`；`enter-lesson` 亦 join 原始 id，目前自洽             |

---

## 6. 复核命令

> 以下命令均**已排除注释行与测试文件**（注释里保留了 `setSocketBridge` 的历史说明，
> `__tests__/event-bus.test.ts` 则**故意**断言该 API 不存在 —— 两者都不是「死通道复活」）。
> 裸 grep 会把它们一并匹配进来，产生误报。

```bash
# ① 死通道已删除（应无输出）
#    过滤器依次剔除：依赖目录 → 测试文件 → // 与 /* */ 注释行
grep -rn "setSocketBridge\|SOCKET_FORWARD_PREFIXES" --include=*.ts --include=*.tsx . \
  | grep -v node_modules \
  | grep -vE "__tests__|\.test\.|\.spec\." \
  | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)"

# ② 回归测试确实在守护「API 不存在」（应命中 event-bus.test.ts 的断言）
grep -rn "setSocketBridge" src/services/__tests__/event-bus.test.ts

# ③ whiteboard-event 仍无生产调用方（应无输出；仅 presence.test.ts 用 socket.trigger 触发）
grep -rn "emit('whiteboard-event'" --include=*.ts --include=*.tsx . \
  | grep -v node_modules \
  | grep -vE "__tests__|\.test\.|\.spec\."

# ④ 布局型/语义型清单（唯一的广播策略真源）——锚定定义处，避免连带匹配 :220 的使用点
grep -n -A 12 "^const LAYOUT_ONLY_ELEMENT_TYPES" server/event-routing.ts

# ⑤ 组件缓存 data 的候选（须逐个确认有无回填 effect，见 §4 P2）
#    注：RevealPresentationWrapper 是**已知误报**——它有回填 effect
grep -n "useState(.*data\." src/features/whiteboard/widgets/*.tsx
```

## 7. 状态总览

**已实施**：

- P0 广播策略（服务端 `LAYOUT_ONLY_ELEMENT_TYPES` + `handleElementUpdatedEffect`）
- P0.5 `code-sandbox` / `math-graph` 回填 effect
- P1（部分）`whiteboard-event` 房间口径 + 缺失的 `roomId`
- P2 `code-sandbox` / `math-graph` 回填 effect
- P3 删除死代码桥
- §2.4 确认 `html-applet` / `plugin` 不在范围内

**仍待处理**：

- 无。P0 / P0.5 / P1 / P2 / P3 均已实施。
