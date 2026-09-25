# Courseware Attempts API Contract

<!-- doc-version: sdk=3.7.0 -->

> 本文档汇总 **互动课件 (courseware) / 学生作答 (attempt) / 成绩提交流水** 的全部 HTTP 端点契约快照。
>
> 目的：把服务端实现 `server/routes/courseware.ts` 与 LMS Bridge SDK（前端 iframe 内）实际期望的请求/响应形态做一次**唯一可信**记录，方便前后端协作、契约测试回归、以及新人 onboarding。
>
> ⚠️ 这份快照是 **从 `server/routes/courseware.ts`、`packages/plugins/builtin.ts` 的 `courseware.submit_attempt` handler、以及 e2e 测试 `server/__tests__/courseware-e2e-flow.test.ts` 逐字提取**。代码与本表不一致时以代码为准；但**请同时把代码改回文档**——契约漂移是隐患。

---

## 0. 通用约定

- **Content-Type**: 所有 `POST`/`PUT`/`PATCH` 请求统一使用 `application/json; charset=utf-8`
- **鉴权**:
  - 教师端点（`/promote`、`GET /api/courseware/attempts`）需要 session.role ∈ `{teacher, administrator}`
  - 学生端点（`/log`、`/submit`）需要 session.role === `student`，且 `session.userId === attempt.student_id`，否则返回 403
- **状态码**: 400（参数缺失/格式错误）、401（未登录）、403（越权）、404（资源不存在）、500（内部错误）
- **Socket.IO 事件**: 课件相关操作均会 emit `courseware-attempt-updated`、作业晋升后 emit `student-progress-updated`

---

## 1. 表格：端点速览

| 方法   | 路径                                              | 角色   | 用途                       |
| ------ | ------------------------------------------------- | ------ | -------------------------- |
| POST   | `/api/courseware/attempts/:attemptId/log`         | 学生/教师 | 学生答题过程事件流             |
| POST   | `/api/courseware/attempts/:attemptId/submit`      | 学生/教师 | 学生最终提交分数                  |
| GET    | `/api/courseware/attempts`                        | 教师   | 列出全部 attempts（可选过滤）     |
| GET    | `/api/courseware/attempts/:attemptId/raw`         | 教师   | 拉取 attempt 的原始事件流      |
| GET    | `/api/courseware/attempts/:attemptId/progress`    | 教师   | 拉取 attempt 当前成绩快照    |
| POST   | `/api/courseware/attempts/:attemptId/promote`     | 教师   | 把成绩写入作业/进度         |
| GET    | `/api/courseware/attempts/:attemptId/progress`    | 学生   | 学生端轮询自己的成绩         |
| POST   | `/api/courseware/confirm`                         | 教师   | 上传课件后入库                  |
| GET    | `/api/courseware/list`                            | 教师   | 课件列表                          |
| POST   | `/api/courseware/:id`                             | 教师   | 删除课件                          |
| GET    | `/api/courseware/:id`                             | 教师   | 单课件详情（VFS 节点）            |

> 仅本表中的端点在本契约范围；其他 `/api/courseware/*`（上传 / VFS）见 （上传 / VFS 契约文档尚未建立，待补）。

---

## 2. `POST /api/courseware/attempts/:attemptId/log` — 答题事件流

### 用途
学生答题过程中的实时事件上报：每答一道题、上传一段进度，都打一次 log。`extractScoreCommentCompletion()` 会自动从 payload 里抠出 `score` / `comment` / `completion`，并 UPSERT 到 `submission_result`。

### 请求

```js
// Headers
Content-Type: application/json

// Body — 注意是 { eventType, payload } 形态，不是 { type, score }
{
  "eventType": "progress",     // 必填 — 任意字符串，会原样存到 submission_raw.event_type
  "payload": {                 // 必填 — 任意 JSON 对象，会被搜索 score/comment/completion 字段
    "score": 50,               // 可选 — 0-100 整数或 0-1 浮点（仅作为单次事件快照，不归一化）
    "completion": 0.5,         // 可选 — 0-1
    "comment": "q1 done",      // 可选
    "data": { "q1": "B" }      // 任意扩展字段
  }
}
```

### `extractScoreCommentCompletion()` 搜索规则
- 顶层键: `score` / `grade` / `result` / `point` / `points` / `mark` / `marks` / `score_val` / `scoreval`
- 顶层键: `comment` / `feedback` / `msg` / `message` / `text` / `note` / `memo`
- 顶层键: `completion` / `progress` / `done` / `finished` / `completed` / `percentage`
- 也递归搜索 `payload.data` / `payload.body` / `payload.url?query=` 里的同名键
- 搜索时取**第一个**命中值；同名字段后者覆盖前者仅发生在同一对象层级

### 响应

```json
// 200 OK
{ "success": true }
```

### 错误
- `401 { error: "Authentication required" }` — 未登录
- `403 { error: "Forbidden: Cannot modify logs for another student" }` — 学生操作他人 attempt

### 副作用
1. 写入 `submission_raw` 表（新行）
2. 若 extracted score/comment/completion 任一存在：UPSERT `submission_result`（已存在则 UPDATE score/comment/completion/extra_json）
3. `io.emit('courseware-attempt-updated', { attemptId, type: 'log' })`
4. `kernelContainer.eventBus.publish('courseware.event_logged')`

---

## 3. `POST /api/courseware/attempts/:attemptId/submit` — 最终提交

### 用途
学生完成作答后，由 LMS Bridge 自动调用（或教师手动指定）触发。最终成绩入库，`courseware_attempt.status` 切到终态。

### 请求

```json
{
  "score": 88,                       // 可选 — 0-100 整数或 0-1 浮点（推荐 0-100，避免与 promote 归一化歧义）
  "completion": 1,                   // 可选 — 0-1；不传则从 extractScoreCommentCompletion 推断
  "status": "completed",             // 关键字段！传 "completed" 才把 attempt.status 切到终态
                                       // 可选值: "active" / "in_progress" / "completed" / "abandoned"
                                       // 推荐统一用 "completed"
  "comment": "all questions done",   // 可选
  "extra": {                         // 可选 — 任意扩展，写入 submission_raw.payload_json 与 submission_result.extra_json
    "q1": "B",
    "q2": "C"
  },
  "lessonId": "lesson-abc"           // 可选 — 关联 lesson，写入 submission_raw.payload_json（仅供审计）
}
```

> ⚠️ **历史陷阱**: 数据库 `courseware_attempt.status` 实际写入的值是 `"completed"`（不是 `"finished"`）。前端展示时常规范化显示为「已完成」。如果按 GET 接口的查询结果判断状态，二者等价。

### 响应

```json
// 200 OK
{
  "success": true
  // 注：响应字段为 success，不返回 assignmentId / score（与 /promote 不同）
}
```

### 副作用
1. 写 `submission_raw`（event_type=`submit_lms`，payload_json={score, comment, completion, status, ...extra}）
2. 若 `status === 'completed'`：`UPDATE courseware_attempt SET finished_at=now, status='completed' WHERE id=:attemptId`
3. UPSERT `submission_result`（score/comment/completion/extra_json）
4. `io.emit('courseware-attempt-updated', { attemptId, type: 'submit' })`

### 错误
- `401` 未登录 / `403` 越权 / `500` 内部错误（如 CapabilityGuard 拦截 — 需用户具备 `student:write` capability）

---

## 4. `GET /api/courseware/attempts` — 列表（教师端）

### Query 参数

| 名称              | 类型   | 必填 | 描述                                                                 |
| ----------------- | ------ | ---- | -------------------------------------------------------------------- |
| `coursewareUuid`  | string | 否   | 过滤该课件的 attempts；缺省返回全部。**白板 HtmlAppletFrame 实时面板必须传此参数**避免拉整张表 |

### 响应（200 OK）

```json
[
  {
    "attemptId": "att-xyz",
    "started_at": 1735689600000,
    "finished_at": 1735689700000,
    "status": "completed",          // 注意：DB 实际存 "completed"，见 §3 注释
    "coursewareName": "课件 A",
    "coursewareUuid": "cw-uuid-001",
    "studentName": "小明",          // 关联 students.name 失败时回退到 raw student_id
    "studentId": "stu-001",
    "score": 88,                    // submission_result.score（可能为 null）
    "comment": "finished",          // submission_result.comment（可能为 null）
    "completion": 1,                // submission_result.completion（可能为 null）
    "extra_json": "{\"q1\":\"B\"}", // 原始 JSON 字符串
    "isPromoted": 0                 // 已晋升作业的次数（同一学生在该课件下产生的 assignment_submissions 行数）
  }
]
```

### 排序
按 `a.started_at DESC`，最近作答在前。

### 实现 SQL（节选）

```sql
SELECT a.id as attemptId, a.started_at, a.finished_at, a.status,
       cw.name as coursewareName, cw.uuid as coursewareUuid,
       COALESCE(s.name, ...) as studentName,
       a.student_id as studentId,
       r.score, r.comment, r.completion, r.extra_json,
       (SELECT COUNT(*) FROM assignment_submissions sub
          JOIN assignments ast ON sub.assignment_id = ast.id
         WHERE sub.student_id = a.student_id
           AND ast.title = '互动课件: ' || cw.name) as isPromoted
FROM courseware_attempt a
JOIN courseware cw ON a.courseware_id = cw.id
LEFT JOIN students s ON a.student_id = s.id
LEFT JOIN submission_result r ON a.id = r.attempt_id
[WHERE cw.uuid = ?]
ORDER BY a.started_at DESC;
```

---

## 5. `POST /api/courseware/attempts/:attemptId/promote` — 写入作业成绩

### 用途
教师在 LiveClassroom 看到成绩后，点击「保存为作业成绩」时调用。把这次 attempt 的最终成绩**自动建作业**、**UPSERT 作业提交**、**UPSERT 学生课程进度**三件事一次性做完。

### 请求

```json
{
  "lessonId": "lesson-abc",         // 必填 — 关联到 lesson_id（写进 assignments.lesson_id 与 student_lesson_progress）
  "classId": "cls-001"              // 必填 — 关联到班级（写进 assignments.class_id）
}
```

### 响应

```json
// 200 OK
{
  "success": true,
  "assignmentId": "ast-cw-<hex>",   // 新建或已存在的 assignment.id
  "score": 88                       // 归一化后的最终分数（注意：是 "score"，不是 "finalScore"）
}
```

### 分数归一化

`submission_result.score` 归一化规则：

| 原始值范围       | 处理                   | 备注                                 |
| ---------------- | ---------------------- | ------------------------------------ |
| `null` / `undefined` | 视为 100（兜底）         | promote 不区分「未提交」与「满分」    |
| `0 < x ≤ 1.0`     | `Math.round(x * 100)`   | 0.85 → 85；这是**唯一**会被乘 100 的分支 |
| 其它（> 1 或 < 0）| `Math.round(x)`         | 88 → 88；-5 → -5（不截断）            |
| 整数 0            | 视为 100                | ⚠️ 历史陷阱：0 被当作「未填」归为满分 |

> 真实生产中 `LMS.submit(88, 100, ...)` 是 0-100 范围，所以归一化不会触发；但**自研课件若用了 0-1 比例务必传对**，否则 promote 会得到意外结果。

### 副作用

1. **UPSERT assignments**：title = `"互动课件: <courseware.name>"`，description = `"来自互动课件 [...] 的随堂学习提交数据记录"`，content = `{type: 'interactive_courseware', attemptId, coursewareUuid}`
2. **UPSERT assignment_submissions**：
   - `score = finalScore`
   - `feedback = "由教师在课堂中保存录入。课件完成度: <X>%。课件原始反馈: <comment>"`
   - `status = 'graded'`，`submitted_at = graded_at = now`
3. **UPSERT student_lesson_progress**：completed=1, progress_percent=100
4. `io.emit('student-progress-updated', { studentId, lessonId, progressPercent: 100, completed: true, completedSegments: [] })`

### 错误
- `400 { error: "Missing lessonId or classId" }`
- `404 { error: "Attempt not found" }`
- `500` 内部错误

### 幂等性
- 同 attempt 重复 promote：assignment 不会重建（按 class_id + lesson_id + title 查询已存在则复用），但 assignment_submissions 行通过 `ON CONFLICT DO UPDATE` 保持单行
- 已 promote 的 attempt 在 `GET /api/courseware/attempts` 中 `isPromoted >= 1`，前端可据此显示「✓ 已保存为作业」徽标

---

## 6. `GET /api/courseware/attempts/:attemptId/progress` — 单条成绩快照

### 用途
学生端轮询自己的当前成绩（教师端实时面板也可用）。**需登录**（`requireAuth`）：教师/管理员可读取任意 attempt；学生仅能读取 `student_id` 等于自身的 attempt，越权返回 403。attempt 无成绩时返回 `{ progress: null }`。

### 响应

```json
// 200 OK — 有成绩
{
  "progress": {
    "score": 88,
    "comment": "...",
    "completion": 1,
    "extra": { "q1": "B" }   // parsed extra_json；JSON 解析失败时为 {}
  }
}

// 200 OK — 无成绩
{ "progress": null }
```

---

## 7. `GET /api/courseware/attempts/:attemptId/raw` — 原始事件流

### 用途
教师复盘：拉取 attempt 的全部原始 LMS Bridge 事件流（submission_raw 表）。

### 响应
由 `courseware.get_attempt_raw_data` command handler 返回，详见 `packages/plugins/builtin.ts`。Schema 不稳定，不在本契约范围。

---

## 8. 实时事件

| 事件名                          | 触发条件                            | Payload                                                              |
| ------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `courseware-attempt-updated`    | `/log`、`/submit`、`/promote` 调用后 | `{ attemptId, type: 'log' \| 'submit' \| 'promote' }`                |
| `student-progress-updated`      | `/promote` 调用后（且涉及 student_lesson_progress 变更） | `{ studentId, lessonId, progressPercent, completed, completedSegments }` |

前端订阅示例（白板 `HtmlAppletFrame`）：

```ts
socket.on('courseware-attempt-updated', async (payload) => {
  if (payload.attemptId in currentAttemptIds) {
    const rows = await fetch(`/api/courseware/attempts?coursewareUuid=${uuid}`).then((r) => r.json());
    setAttempts(rows);
  }
});
```

---

## 9. 已知契约陷阱（迁移期 backlog）

下列条目是**当前实现现状**与**直觉契约**不一致的地方。建议在后续 PR 中修正：

1. **响应字段命名**：`/promote` 返回的是 `score`，但代码中变量名 `finalScore`。建议响应改为 `{ success, assignmentId, finalScore }` 与变量名一致
2. **status 词汇不统一**：`/submit` 入参约定 `status: 'completed'`，但部分前端/文档用 `'finished'`。建议统一为 `completed`（与 DB 一致），前端展示层做「已完成」翻译
3. **score=0 归一化**：当前 `0 < x <= 1` 走 `x * 100` 分支，但 `x === 0` 会落入 `finalScore = 100` 兜底——会把「学生答了 0 分」误算满分。建议加 `if (rawScore === 0) finalScore = 0` 短路
4. **assignment.title 取名依赖课件 name**：若同一 lesson 有多个同名课件会合并到同一作业。建议在 title 中追加 `attemptId` 后缀以唯一化
5. **缺失 doc on 跨 lesson 重 promote**：若同一 student 在不同 lesson 都用过同一课件，会创建多份独立 assignment——这是正确行为，但前端 UI 提示需要解释

---

## 10. 相关源文件

| 路径                                            | 内容                                                       |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `server/routes/courseware.ts`                   | 全部 HTTP 端点实现                                         |
| `packages/plugins/builtin.ts`                   | `courseware.submit_attempt` / `courseware.get_attempt_raw_data` command handler |
| `packages/core/capability-system/index.ts`     | 学生需具备 `student:write` capability 才能 submit_attempt   |
| `server/utils/bridge-sdk.ts`                    | LMS Bridge SDK 服务端代理                                 |
| `src/features/whiteboard/utils/bridgeUtils.ts`  | LMS Bridge SDK 前端注入（`wrapSrcDocWithBridge`）          |
| `src/features/whiteboard/components/HtmlAppletFrame.tsx` | 白板课件 iframe + 实时成绩浮层                    |
| `server/__tests__/courseware-e2e-flow.test.ts`  | 本契约的回归测试                                            |
| `server/__tests__/courseware-attempts-filter.test.ts` | `/api/courseware/attempts?coursewareUuid=` 过滤测试  |
