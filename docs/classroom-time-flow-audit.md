# 上课时间流审计（教师端 → 学生端）

> 范围：一节课从开始到结束的实时链路 —— 倒计时、课堂阶段、随堂投票、抢答器、
> 节奏信号、结课通票、白板协同、点名、积分。
> 方法：机械化交叉核对「服务端发出的事件名」×「客户端监听的事件名」，再逐条走读
> 房间归属与传输时序。触发背景：随机点名不同步（见
> [`whiteboard-realtime-sync-audit.md`](./whiteboard-realtime-sync-audit.md)）。
>
> 结论基于 2026-09-30 的代码走查。

## 状态

| #   | 问题                                                      | 状态                                                                                                                                           |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `io.to('lesson-${lessonId}')` 指向无人加入的房间（13 处） | ✅ 已修                                                                                                                                        |
| B   | `classroom:exit_ticket_submitted` 完全失效                | ✅ 已修                                                                                                                                        |
| C   | `ClassroomSyncChannel` 构造时抓 socket → 跨机监听永久缺失 | ✅ 已修（改为订阅 socket 就绪）                                                                                                                |
| D   | 学生端倒计时不监听 `classroom:countdown_updated`          | ✅ 已修（直接订阅权威事件）                                                                                                                    |
| E   | `rollcall:evaluated` / `student:coins_awarded` 无人监听   | ✅ 已接消费端                                                                                                                                  |
| F   | `hasFinishedAlerted` 永不复位                             | ✅ 已修（按 `endsAt` 复位）                                                                                                                    |
| G   | 悬空路由                                                  | ✅ 全部处理完：`spotlight:*` 删除；`points_awarded` / `icebreaker_updated` 接消费端；`groups_changed` 数据源统一后接线；`exambank:*` 保留+注释 |

---

## 0. 已实施：房间口径统一为「课节房间 + 常驻课堂广播房间」

`server/presence.ts` 成为房间口径的唯一真源（与白板侧对称）：

- `CLASSROOM_BROADCAST_ROOM = 'classroom-broadcast'` —— 与 `WHITEBOARD_BROADCAST_ROOM` 同构，
  客户端连接即加入（`useClassroomSocket.syncPresenceAndRooms`），因此**停在仪表盘的学生也能收到**；
- `isRealLessonRoom()` —— 伪课节（`assignment-*-student-*`）不进任何广播房间；
- `classroomEventRooms()` / `emitClassroomEvent()` —— 统一投递入口。

13 处幽灵房间投递全部改为 `emitClassroomEvent(io, lessonId, EVENT, PAYLOAD)`：

```
classroom:countdown_updated   classroom:quick_poll_started   classroom:quick_poll_updated
classroom:quick_poll_closed   classroom:buzzer_ready         classroom:buzzer_winner
classroom:buzzer_reset        classroom:pacing_updated      classroom:exit_ticket_submitted
classroom:pulse_check_requested  whiteboard-quiz-answered   classroom:feed_appended
classroom:stage_changed
```

### ⚠️ 关键陷阱（已避开）

11 处原本是「幽灵房间 + 紧跟一行全局 `io.emit`」。**只把房间名改对而不处理
`io.emit`，会让同一个事件推送两次**（一次房间、一次全局）。因此这里做的是
**替换而非新增**：删掉那 11 行 `io.emit`，由 `emitClassroomEvent` 一次性投两房间。

`server/__tests__/classroom-event-rooms.test.ts` 的 `emitClassroomEvent` 用例
把这个「只发一次」钉死。

### 顺带收敛

- `classroom:stage_event` 全平台零监听（含插件目录），已删除该重复投递，只保留
  `classroom:stage_changed`。
- `classroom:icebreaker_updated` 从全局广播改为投班级房间（它是班级维度事件，
  原先把 A 班的破冰统计推给全平台）。
- `classroom-runtime-service.test.ts` 原先把错误房间名 `lesson-les_101:classroom:stage_changed`
  **当作正确行为钉住了** —— 已改为断言正确房间（`les_101` + 广播房间 + `class-cls_1`）。
  「测试锁死了 bug」正是问题能存活这么久的直接原因。
- `student:coins_awarded` 补上 `lessonId` / `classId` / `studentName`，否则消费端无从按课节过滤。

---

## 1. 已实施：点名评价 / 金币接上消费端

`POST /api/rollcalls/evaluate` 一直在发 `rollcall:evaluated` 与 `student:coins_awarded`，
但前端**零监听** —— 教师给学生评价并发金币，学生端一条提示都收不到。

`useClassroomSocket` 新增 `rollcall:evaluated` 处理器：

- **被评价的学生** → `success` toast：徽章 + 评价 + `+N 金币`，并刷新自己的学情数据；
- **全班其他学生** → 轻量 `info` 播报（维持课堂公开感），不当成自己的奖励；
- 两者都追加一条 `liveClassFeed` 动态；
- 按 `payload.lessonId` 过滤（事件会经广播房间覆盖全平台客户端）。

评价的徽章/文案**直接复用** `fair-picker-engine` 的 `EVALUATION_CONFIGS`。

**刻意只订阅 `rollcall:evaluated`** —— `student:coins_awarded` 与它在服务端
**同一个 `if (io)` 块**里为**同一次动作**发出，同时订阅会让同一次奖励弹两次提示。

`useClassroomSocket.test.tsx` 新增 5 个用例：本人收到、他人收到、跨课节过滤、
未知 rating 不渲染 NaN、教师角色不消费。

---

## 2. 已修：`ClassroomSyncChannel` 构造时序

### 根因

`src/services/classroom-sync-channel.ts` 原先在**构造函数**里抓 socket：

```ts
const socket = getOptionalSocket();
if (socket) { socket.on('classroom:sync_message', handleRemoteSync); ... }
```

而 socket 是在 `src/hooks/useClassroomSocket.ts` 的 **effect** 里才注入的
（`setSocketInstance(socket)`）。React 的 passive effect **按「子先于父」执行**，
因此在子组件 effect 里构造 channel 时 socket 必然还不存在 ——
监听**永久缺失且不报错**。`StudentCountdownBanner:53`、`LiveClassroomView:710`、
`LessonEditorView:171` 全部命中。

因为 `postMessage` 每次都重新取 socket，症状是**「发正常、收静默失效」**这种
不对称故障；同机多标签页因 BroadcastChannel 是独立通路而完全看不出来。

### 实施过程中的一个自我修正

最初实现为「`onMessage` / `postMessage` 前惰性补挂」。**这不完整** ——
纯接收方（学生端只收不发）永远不调 `postMessage`，监听就永远不会补上。
补挂必须由「socket 出现」这个事件驱动，而非「下次收发」。

### 最终实现

1. `socket-service.ts` 新增 `onSocketInstance(listener)` —— 订阅「socket 就绪」，
   已就绪则**立即同步调用一次**。这把「消费者比 socket 更早诞生」从**每个调用方各自踩坑**
   收敛成一个共享原语。
2. `ClassroomSyncChannel` 在构造末尾 `onSocketInstance(() => this.ensureSocketBound())`，
   并保留 `onMessage` / `postMessage` 里的 `ensureSocketBound()` 以覆盖
   「socket 实例被替换（重连换实例）」的换绑。幂等，`destroy()` 解绑两者。

`classroom-sync-channel-order.test.tsx` 6 个用例（每例 `vi.resetModules()` 拿全新模块实例，
避免 `_socket` 模块级变量跨例泄漏）：子 effect 先跑仍可达、构造后才注入也能补挂、
重复调用幂等、实例替换换绑、destroy 解绑、跨课节过滤。

其中一条用例**证伪了「把 socket effect 声明在前面就能修好」这个直觉** ——
React 的 effect 执行顺序是子先于父，与声明顺序无关。写测试的价值就在于此。

---

## 3. 已修：学生端倒计时直连权威事件

`StudentCountdownBanner` 原本只有三个弱数据源（同机 BroadcastChannel / 同文档 window 事件 /
挂载那一瞬的 GET），而 `classroom:countdown_updated` 只有教师端大屏在监听 ——
于是**教师中途启动的倒计时，远程学生永远看不到**。

现由横幅**直接订阅** `classroom:countdown_updated`（经 `onSocketInstance` 处理 socket 晚到），
并按 `payload.lessonId` 过滤（该事件投递到常驻课堂广播房间，覆盖全平台客户端）。

> 与 §2 的修法对比：这里**绕开**了 channel 的构造时序问题，直接吃服务端权威事件。
> 对「服务端已有权威广播」的场景，订阅它比修传输层更短更稳。

`StudentCountdownBanner.test.tsx` 3 个用例：socket 晚于组件出现仍可达、
跨课节过滤、第二轮倒计时复位。

---

## 4. 悬空路由：三项分别处理

| 路由                                                  | 处置                  | 理由                                 |
| ----------------------------------------------------- | --------------------- | ------------------------------------ |
| `spotlight:state_updated` / `spotlight.state_updated` | ✅ **已删**           | 全仓无 producer、无 consumer         |
| `classroom:points_awarded`（`points.awarded`）        | ⏸ **建议接消费端**    | 有真实 producer 与真实消费面         |
| `exambank-survey-state` / `exambank-stats-update`     | ⏸ **建议保留 + 注释** | 是给**不在本仓的插件**预留的平台契约 |

### `spotlight:*` —— 已删

原先两条冒号/点号双拼写路由，注释说是「历史遗留，先双轨保持兼容」。走查结论：
**既无 producer 也无 consumer** —— 全仓（含插件目录）没有任何一处 publish 这两个事件，
也没有任何一处 `socket.on` 它们的 socket 名。「双轨兼容」保护的是一个不存在的两端，
代价是让后来者以为聚焦功能已打通。已删除，并在路由表原位留下说明注释。

将来真要做聚焦，应连同内核事件与前端消费端一起加，而不是留空路由占位。

### `classroom:points_awarded` —— ✅ 已接消费端

这是三项里**唯一有真实产品面**的。查证后的具体缺陷比预想更明确：

- **producer 唯一**：`grading.ts:598`（`POST /api/students/:id/points`，限教师/管理员），
  落 `points_ledger` 后 publish `points.awarded`，payload 是完整的 `PointLogItem`
  （含 `studentId` / `deltaPoints` / `reason`）；
- **断链症状**：教师在**已打开的**「学生成长档案 / 积分榜」弹窗里加分后，
  弹窗自己 toast「成长积分已发放」，但界面**数字不刷新** —— 提示说成功、数字却还是旧的。
  被加分的学生端也收不到任何提示。

**实现**：

1. 新增 `store/pointsLedgerStore.ts`（zustand vanilla，与 `whiteboardViewStore` 同构）：
   记录最近一次变更 + 自增 `version` + 提供 `subscribe`。
   之所以独立成 store：消费端分处 `useClassroomSocket`（socket 生命周期所在）
   与深层弹窗组件之间，后者拿不到前者的返回值。
2. `useClassroomSocket` 消费 `classroom:points_awarded`：
   - 事件是**全局广播**（积分是账户级事实、不隶属课节），所以**只有被加分的那个学生**
     会收到 toast —— 否则全平台都会弹，纯噪音；扣分走 `warning` 且文案为负；
   - **所有人**都写入 store，供已打开的积分类 UI 自行 refetch；
   - 被加分的学生顺带 `fetchStudentDashboard` 刷新学情。
3. `StudentGrowthProfileModal` 把 `pointsVersion` 纳入取数 effect 的依赖，
   积分一变就重拉 —— 直接修掉「加分后数字不更新」。

> **与 `student:coins_awarded` 当前不重叠**（此前我提示过要去重，查证后确认无需）：
> 点名评价只写 `student_rollcalls.reward_coins`，**不写 `points_ledger`**，
> 两者是互不相交的两套子系统。已在 store 注释里写明：若将来把点名金币迁到积分台账，
> 需在此加去重，否则同一次奖励会提示两次。

测试：`pointsLedgerStore.test.ts` 5 例（含「内容相同的连续变更也要自增」——
避免 refetch 被内容比较挡住）；`useClassroomSocket.test.tsx` 新增 4 例
（本人加分/扣分、**别人被加分时不提示但仍记录**、畸形 payload 忽略）。

### `exambank-*` —— 保留，已补注释说明

考试银行插件**不在本仓**（`v2_plugins/` 下只有 `courseware-hub` / `ext-homework-hub` /
`openlearn-workhub` / `scratch-editor-deploy`）。这两条路由是**平台为外部插件预留的契约**，
与 `spotlight` 性质不同：spotlight 是「曾经有过、现在两端都空了」，
exambank 是「插件还没进这个仓」。

所以**不删** —— 删了插件装上时会静默失效，正是本次审计反复撞上的模式。
已在路由表原位补注释写明：这是前置契约、consumer 在插件侧、后续还会继续扩展、请勿删除。

### `classroom:icebreaker_updated` —— ✅ 已接消费端

**先修了一个我自己上一轮引入的回归。** 查证时发现：

- 破冰心情统计的展示面 `PreClassDiagnosticHub` 位于 `PreClassReadyView` 内，
  而 `PreClassReadyView` 只由 `LiveClassroomView` 挂载，`LiveClassroomView` 只由
  `TeacherView` 挂载 —— **这是纯教师端 UI**，学生只负责打卡、不看统计。
- 但**班级房间只有学生加入**（服务端 `presence.ts` 的 `register-student` 分支
  才 `socket.join(classRoom(...))`），教师只 join 了 `whiteboard-broadcast` 与
  `classroom-broadcast`。
- 也就是说：我上一轮把 `icebreaker_updated` 从全局 `io.emit` 改成投班级房间，
  等于**把这个事件对唯一的消费方屏蔽掉了**。收窄投递范围是对的，但漏了投递对象。

**修复**：教师端也 join 当前所教班级的房间。用的是既有的通用 `join-room`
（服务端无需为教师新增分支），班级 id 从 app store 的 `liveClassSelectedClassId`
读取 —— 它是「当前视图」而非会话属性，不值得为此加 prop。

> 已知取舍：服务端没有通用的 `leave-room`，教师切换班级会累积旧班级房间。
> 由于消费端一律按 `classId` 过滤，功能上无影响，故未新增服务端接口。
> 这一点已写进代码注释与 `useClassroomSocket` 的测试。

**接线**：`PreClassDiagnosticHub` 组件内直接订阅（经 `onSocketInstance` 等待 socket
就绪）。事件 payload **自带 stats**，故直接采用而不必重拉诊断接口。组件自己订阅而
不绕全局 store —— 展示逻辑就在这里。

测试：`PreClassDiagnosticHubIcebreaker.test.tsx` 4 例（socket 晚到仍可达、
按 classId 过滤、畸形 payload 忽略、卸载解绑）；`useClassroomSocket.test.tsx`
新增 4 例（教师 join 班级房间 / 学生不走这条路径 / 未选班级不 join /
常驻广播房间始终在）—— **这组是上面那个回归的护栏**。

### `classroom:groups_changed` —— ✅ 已接线（数据源已统一）

查证时发现的关键事实，决定了修法：

> **`students.group_name` 全仓从未被写入** —— 服务端没有任何 UPDATE，前端也没有任何赋值。
> 也就是说小组联赛一直按 `students[].groupName` 分组，而这个字段恒为 `undefined`，
> 分组页实际上**始终只渲染出一个「未分组」桶**。

所以这不是「实时层没接好」，而是**数据源分叉叠加「其中一条数据链是空的」**。
改成读 `GET /api/classes/:id/groups`（`class_groups`）后：

- 真实分组数据（`name` / `name_en` / `color` / `leader_id` / `memberIds` / `sort_order`）接入；
- 成员按 `memberIds` 与课堂花名册**按学生 id 求交集** —— 分组方案可能引用已转学学生，
  静默忽略而非崩溃；
- `classroom:groups_changed` 顺带可接（此前接了也没用：那个 UI 读不到 `class_groups`），
  组件内订阅、按 `classId` 过滤、变更即重拉；
- **零回归风险**：旧数据源本来就是空的，没有可丢失的数据。

个人英雄榜的小组标签也从 `students.groupName` 改为同一真源，
避免组件内部再出现两套组名。

**保留「不编造」原则**：无分组数据时展示明确空态（「本班尚未配置分组方案」），
**不回退**到 `students.groupName`、也不编造队名 —— 回退正是这次歧义的来源。
接口失败同样落到空态 + `console.warn`，不静默切回旧数据源。

测试：`ClassroomLeaderboardModalGroups.test.tsx` 8 例（真实分组与成员、请求打在
正确接口、空态不编造、接口失败不抛错、已转学成员被忽略、`groups_changed` 触发重拉、
跨班级事件被忽略、个人榜标签同源）—— 这是该组件的**首份测试覆盖**。

---

## 5. 已修：`hasFinishedAlerted` 永不复位

原实现只有 `setHasFinishedAlerted(true)`，**无复位路径** → 第二次倒计时结束不响提示音，
且横幅永久停在「时间已截止」。

现按 **`endsAt` 变化**判定新一轮并复位（`lastAlertedEndsAtRef`）。
用 `endsAt` 而非时间戳倒推：暂停/恢复不改 `endsAt`，而教师 `start` / `add_time`
一定会给出新的 `endsAt`。

---

## 6. 双轨不一致：socket 事件 vs 2.5s 轮询（保持现状）

`StudentInteractiveOverlay` 不订阅 `classroom:quick_poll_*` / `classroom:buzzer_*`，
而是每 2.5s 轮询 `GET /api/classroom/sessions/:lessonId`。

- **优点**：天然抗丢包、抗重连、无需处理乱序 —— 代码里的水位线注释说明踩过坑；
- **代价**：投票/抢答的反馈延迟最坏 2.5s。

这不是 bug，是**两套机制并存**。想优化学生端实时性时，正确方向是补 socket 通路，
而不是调小轮询间隔。

---

## 7. 做对了、不要动的部分

- 倒计时全程用 `endsAt` 墙钟推导（服务端与客户端都不累积漂移）；
- `StudentInteractiveOverlay` 的轮询用 `pollSeqRef` / `buzzPollSeqRef` / `buzzOutcomeRef`
  三重水位线处理竞态，并用 ref 而非 state 避免自激轮询 —— 质量很高；
- `useStageDisplayFeed` 有 `connect → refresh()` 的重连自愈与健康态，且按
  `payload.lessonId` 过滤跨课节串台；
- `useClassroomSocket` 的 `connect` / `reconnect` 都会重跑 `syncPresenceAndRooms()`，
  房间与在线态能正确重建；
- `server/presence.ts` 的 disconnect 竞态保护（旧 socket 断开不抹除新连接的在线态）。

---

## 8. 复核命令

```bash
# 幽灵房间已清零（应无输出）
grep -rn 'io\.to(`lesson-' --include="*.ts" server/ packages/

# 房间口径真源
grep -n -A 20 "classroomEventRooms" server/presence.ts

# 客户端加入广播房间
grep -n "classroom-broadcast" src/hooks/useClassroomSocket.ts

# 仍有 producer 但无人监听的事件
for e in classroom:points_awarded classroom:groups_changed classroom:icebreaker_updated exambank-survey-state; do
  echo "$e -> $(grep -rlF "'$e'" --include='*.ts' --include='*.tsx' src/ | grep -vc __tests__) 个前端引用"
done

# channel 不再在构造时抓 socket
grep -n "onSocketInstance\|ensureSocketBound" src/services/classroom-sync-channel.ts
```
