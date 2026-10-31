# 子系统：实时通道与事件

> 覆盖 `server/presence.ts`、`server/event-routing.ts`、`server/classroom-events.ts`、
> `server/realtime-bridge.ts`、`packages/core/presence-engine/`、`packages/core/collaboration-engine/`。

---

## 1. 房间命名：五类，全部由 `server/presence.ts` 定义

| 房间      | 构造函数                                                            | 行  | 用途                               |
| --------- | ------------------------------------------------------------------- | --- | ---------------------------------- |
| 班级      | `classRoom(classId)` → `class-<id>`                                 | L56 | 班级级广播（锁状态、积分、动态流） |
| 员工/管理 | `PRESENCE_STAFF_ROOM` = `presence-staff`                            | L66 | 在线状态面板，仅教师/管理员        |
| 白板广播  | `WHITEBOARD_BROADCAST_ROOM` = `whiteboard-broadcast`                | L76 | 跨课节白板同步                     |
| 用户      | `userRoom(userId)` → `user-<id>`（前缀常量 `USER_ROOM_PREFIX` L84） | L85 | 个人通知（成绩、进度）             |
| 课节      | 房间名 = `lessonId` 字面量                                          | —   | 课堂内广播                         |

**铁律**：房间名只能通过这 4 个构造函数 + 课节 id 字面量产生。
`event-routing.ts` 的注释明确要求「房间名不能出现两份来源」（L28-31）——
手写 `'class-' + id` 会在改前缀时漏改。

辅助函数：

| 函数                                    | 行   | 用途                                         |
| --------------------------------------- | ---- | -------------------------------------------- |
| `isRealLessonRoom(roomId)`              | L100 | 区分真实课节房间与伪房间                     |
| `pseudoRoomStudentId(roomId)`           | L108 | 从伪房间反解学生 id                          |
| `classroomEventRooms(lessonId, target)` | L140 | 一次算出「课节 + 班级 + 指定角色」的房间集合 |
| `emitClassroomEvent(...)`               | L171 | 统一发射器，自动补 `_meta`                   |

---

## 2. 事件路由表：`SOCKET_ROUTES`

`server/event-routing.ts` L263 起的声明式数组，**19 条**。每条结构：

```ts
interface SocketRoute {
  eventType: string; // 内核事件名
  socketEvent: string; // 前端监听名（可与内核名不同）
  rooms: (event) => string[] | null; // 目标房间
  map?: (event, deps) => unknown; // 载荷整形（可查库补标题）
  effect?: (event, deps) => void; // 副作用（落库、写通知）
  description: string; // 人类可读用途
  mirrorToStaffRoom?: boolean; // 额外把全量 payload 镜像到 presence-staff
}
```

完整映射表见 [../architecture/request-lifecycle.md](../architecture/request-lifecycle.md) §4。

### 2.1 为什么需要 `map`

`assignment.graded` 的内核 payload 只有 `assignmentId`，前端要显示作业标题。
`map` 里查 `SELECT title FROM assignments WHERE id = ?`（`TITLE_SQL`，L88）补上。
**代价**：每条命中路由会多一次同步查询。高频事件不要用 `map` 查库。

### 2.2 为什么 socket 事件名与内核事件名不同

`whiteboard-sync` 是历史遗留名，前端仍在监听，所以路由表**显式声明两次名字**
（注释 L288-291）。新增事件时应让两者同名，除非有兼容包袱。

### 2.3 `_meta` 统一附加

投递时统一补 `_meta`（事件 id / type / source / timestamp / correlationId）。
前端用它做去重、排序、以及「迟到学生补齐上下文」。
`buildMeta` 在 L523。**不要自己拼 `_meta`**，走 `emitClassroomEvent`。

---

## 3. 课堂动态流（Feed）

| 组件                   | 位置                                  | 作用                                                                |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `ClassroomFeedService` | `packages/core/classroom-runtime/` 侧 | 订阅内核事件 → 落 `classroom_feed` 表 → 广播 `classroom:feed`       |
| 挂载                   | `server.ts` L459-461                  | `attachClassroomFeedService(feedService, kernelContainer.eventBus)` |

它订阅的是**内核事件总线**而非路由表，所以 Feed 与实时推送是两条并行消费路径：
改了 `SOCKET_ROUTES` 不影响 Feed 落库，反之亦然。

---

## 4. Presence 引擎

`packages/core/presence-engine/`（13 文件 / 1,029 行）+ `server/presence.ts`（socket 处理器）。

| 关注点       | 实现                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| 在线判定     | socket 连接 + 心跳；断线后按 `OPENLEARN_CLASSROOM_GUARD_TIMEOUT_MS` 宽限         |
| 身份绑定     | `socketAuthMiddleware`（`server.ts` L421）握手期确定，之后不可改                 |
| 学生端可见性 | 学生只能进自己的 `user-<id>` 与所在课节房间                                      |
| 员工面板     | `PRESENCE_STAFF_ROOM`，`mirrorToStaffRoom: true` 的路由会把全量 payload 镜像过来 |

**安全要点**：`mustChangePassword` 会话在握手阶段就被拒（`server/middleware/auth.ts`），
所以在线列表里不会出现「待改密」的种子账号。

---

## 5. 课堂实时交互

`server/classroom-events.ts`（94 行）+ `packages/core/classroom-runtime/`（14 文件 / 1,391 行）。

支撑的表（`migrations/`）：

```text
classroom_sessions        classroom_feed         classroom_buzzers
classroom_danmaku         classroom_exit_tickets classroom_pacing_signals
classroom_quick_polls     classroom_poll_votes   classroom_peer_*
icebreaker_checkins       lesson_checkins        lesson_preset_polls
segment_gate_overrides    segment_visits
```

| 能力         | 说明                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| 随机点名     | `student_rollcalls` 表 + `rollcall` 类型白板元素；`persistRollcallPick`（`event-routing.ts` L189）落库 |
| 抢答器       | `classroom_buzzers`                                                                                    |
| 弹幕         | `classroom_danmaku`                                                                                    |
| 快速投票     | `classroom_quick_polls` + `classroom_poll_votes`                                                       |
| 出门条       | `classroom_exit_tickets`                                                                               |
| 课堂节奏信号 | `classroom_pacing_signals`                                                                             |
| 同伴互评     | `classroom_peer_review_tasks` / `reviews` / `rubric_dimensions` / `nominations` / `badges`             |

**改动提示**：这些表都在 40 张黑名单之外，但**不等于插件可以写**。
正确路径是调对应命令或 HTTP 路由，由服务层处理事务与广播。

---

## 6. 协作引擎

`packages/core/collaboration-engine/`（15 文件 / 1,150 行）负责多人协同的冲突处理，
与 `whiteboard`（2 文件）配合。白板元素的操作语义（`element_drawn` / `element_updated` /
`batch_drawn` / `element_deleted` / `cleared`）由 `SOCKET_ROUTES` 统一收敛到 `whiteboard-sync`，
前端只监听一个事件名。

`LAYOUT_ONLY_ELEMENT_TYPES`（`event-routing.ts` L157）列出「只影响布局、不触发重绘」的元素类型，
`broadcastWhiteboardRefresh`（L172）据此决定是否广播 —— 改白板元素类型时**必须同步这张集合**，
否则会出现「拖一下整块白板闪一下」。

---

## 7. 排障速查

| 现象                           | 首查                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| 前端收不到事件                 | 该事件是否在 `SOCKET_ROUTES` 里；`rooms` 是否返回了空数组                    |
| 全班都收到了本该只给个人的消息 | `rooms` 用错了 `classRoom` 而非 `userRoom`（`assignment.graded` 是反例参照） |
| 消息收到但没有 `_meta`         | 走了手写 `io.to(...).emit(...)` 而非 `emitClassroomEvent`                    |
| 白板拖动卡顿/闪烁              | `LAYOUT_ONLY_ELEMENT_TYPES` 缺新类型，导致每次布局变化都全量刷新             |
| 在线列表缺人                   | 握手期被 `socketAuthMiddleware` 拒绝（`mustChangePassword` / 无 session）    |
| 断线重连后状态不对             | 该状态是否只走 socket 未落库；正确做法是同时落表并由前端 `get_active_*` 补齐 |
