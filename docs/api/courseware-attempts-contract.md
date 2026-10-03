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
  - 声明式角色门禁由 `requireAuth(...)` 中间件完成，形态为 `requireAuth()`（任意登录角色）或 `requireAuth('teacher', 'administrator')`（仅教师/管理员）
  - `/log`、`/submit` 走内联的会话 + 所属权校验：非教师/管理员会话必须满足 `session.userId === courseware_attempt.student_id`，否则 403
  - `GET /api/courseware/attempts` 是**成绩榜**端点，`requireAuth()` 即可访问（见 §4 的角色字段脱敏），并非教师专属
  - `GET /api/courseware/:id` 是课件 HTML 直出端点，**不能**用 `requireAuth()`：沙箱 iframe 不携带会话 cookie，改用父页面铸造的短时 HMAC token（`?ct=`，见 §11.6）
- **状态码**: 400（参数缺失/格式错误）、401（未登录/令牌无效）、403（越权）、404（资源不存在）、413（inline HTML 超限）、422（业务前置条件不满足，promote / mark-absent）、500（内部错误）
- **Socket.IO 事件**: 课件相关操作发布内核事件 `courseware.attempt_updated`，由 `server/event-routing.ts` 路由表投递为 socket 事件 `courseware-attempt-updated`；作业晋升后同理发布 `student.progress_updated` → socket `student-progress-updated`

---

## 1. 表格：端点速览

`server/routes/courseware.ts` 中 `registerCoursewareRoutes` 注册的全部端点（按注册顺序）：

| 方法   | 路径                                              | 角色              | 用途                                    |
| ------ | ------------------------------------------------- | ----------------- | --------------------------------------- |
| POST   | `/api/courseware/upload`                          | 教师/管理员       | 上传课件（base64）→ 落 VFS              |
| POST   | `/api/courseware/confirm`                         | 教师/管理员       | 上传后登记 `courseware` 行              |
| GET    | `/api/courseware`                                 | 任意登录          | 课件列表（**无 `/list` 后缀**）          |
| DELETE | `/api/courseware/:id`                             | 教师/管理员       | 删除课件（**不是 POST**）               |
| POST   | `/api/courseware/attempts/:attemptId/log`         | 学生/教师         | 学生答题过程事件流                      |
| POST   | `/api/courseware/attempts/:attemptId/submit`      | 学生/教师         | 学生最终提交分数                        |
| POST   | `/api/courseware/attempts/:attemptId/adopt`       | 任意登录          | 把无主 attempt 认领到当前学生名下      |
| GET    | `/api/courseware/attempts`                        | 任意登录          | 成绩榜（分页信封 + 角色脱敏，见 §4）    |
| POST   | `/api/courseware/debug`                           | 任意登录          | 课件 iframe 客户端调试日志落盘          |
| GET    | `/api/courseware/attempts/:attemptId/raw`         | 本人/教师         | 拉取 attempt 的原始事件流               |
| GET    | `/api/courseware/attempts/:attemptId/progress`    | 本人/教师         | 拉取 attempt 当前成绩快照               |
| POST   | `/api/courseware/attempts/mark-absent`            | 教师/管理员       | 教师标记缺考                            |
| POST   | `/api/courseware/attempts/:attemptId/promote`     | 教师/管理员       | 把成绩写入作业/进度                     |
| POST   | `/api/courseware/attempts/auto-record`            | 教师/管理员       | 按规则批量补录成绩                      |
| GET    | `/api/courseware/:id/access-token`                | 任意登录          | 铸造课件 HTML 短时访问令牌              |
| POST   | `/api/courseware/inline`                          | 任意登录          | 手写 HTML 课件落库（按内容 sha256 幂等） |
| GET    | `/api/courseware/:id`                             | 持 `?ct=` 令牌    | 单课件详情（VFS 节点 → HTML）           |

> **路由顺序陷阱**：`/api/courseware/attempts/:attemptId/promote` 等 `:attemptId` 形态的路由与 `/api/courseware/attempts/mark-absent`、`/api/courseware/attempts/auto-record` 这类**字面量**路径共存时，Express 按注册顺序匹配。新增 `/api/courseware/attempts/<字面量>` 端点时必须注册在 `attempts/:attemptId/*` 之前，否则会被当作 attemptId 吞掉。
>
> `GET /api/courseware/:id` 与 `GET /api/courseware/:id/access-token` 靠注册顺序区分（`access-token` 在前），同理不可调换。

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

实现在 `server/utils/score-extract.ts`（原为路由闭包内函数，已抽取为共享模块供路由与 e2e 测试复用）。

- 顶层键（大小写不敏感）: `score` / `grade` / `result` / `point` / `points` / `mark` / `marks` / `score_val` / `scoreval`
- 顶层键: `comment` / `feedback` / `msg` / `message` / `text` / `note` / `memo`
- 顶层键: `completion` / `progress` / `done` / `finished` / `completed` / `percentage`
- 也搜索 `payload.data` / `payload.body` 的**一层**子键，以及 `payload.url`（或 `payload.action`）`?query=` 里的同名键
- 搜索时每个键类取**第一个**命中值（`=== undefined` 判定），故遍历顺序即优先级

### 响应

```json
// 200 OK
{ "success": true }
```

### 错误

- `401 { error: "Authentication required" }` — 未登录
- `403 { error: "Forbidden: Cannot modify logs for another student" }` — 学生操作他人 attempt
- `500` — 内部错误（如 CapabilityGuard 拦截 — 提交路径要求 `student:write` capability，见 `courseware.submit_attempt`；`/log` 本身不走命令总线）

### 副作用

1. 写入 `submission_raw` 表（新行，`id` 前缀 `raw_`）
2. `extractScoreCommentCompletion(payload)` 提取 `score` / `comment` / `completion`
3. **原生成绩归集**：调 `aggregateAttemptScore(db, attemptId)`（`packages/plugins/courseware-score.ts`）按该课件的成绩策略从 `submission_raw` 样本历史算出官方分；策略由 `resolveScoreConfig` 决定，取值为 `LATEST`（默认）/ `MAX` / `AVERAGE` / `FIRST`（见 `normalizeScorePolicy` 与 `aggregateScores`）。无显式配置时保留最后一次分数的历史行为
4. 若聚合分 / comment / completion 任一存在，UPSERT `submission_result`（`id` 前缀 `res_`）；`extra_json` 合并本次 `payload` 并附 `score_aggregation` 快照（`describeAggregation` 的输出：policy / sample_count / samples / raw_aggregate / normalized / weight_percentage / configured / aggregated_at）
5. `publishAttemptUpdated(attemptId, 'log')` → 内核事件 `courseware.attempt_updated` → socket `courseware-attempt-updated`
6. `kernelContainer.eventBus.publish({ type: 'courseware.event_logged', source: 'builtin.courseware', payload: { attemptId, eventType, payload } })`

---

## 3. `POST /api/courseware/attempts/:attemptId/submit` — 最终提交

### 用途

学生完成作答后，由 LMS Bridge 自动调用（或教师手动指定）触发。最终成绩入库，`courseware_attempt.status` 切到终态。

### 请求

```json
{
  "score": 88, // 可选 — 0-100 整数或 0-1 浮点（推荐 0-100，避免与 promote 归一化歧义）
  "completion": 1, // 可选 — 0-1；不传则从 extractScoreCommentCompletion 推断
  "status": "completed", // 关键字段！传 "completed" 才把 attempt.status 切到终态
  // 可选值: "active" / "in_progress" / "completed" / "abandoned"
  // 推荐统一用 "completed"
  "comment": "all questions done", // 可选
  "extra": {
    // 可选 — 任意扩展，写入 submission_raw.payload_json 与 submission_result.extra_json
    "q1": "B",
    "q2": "C"
  },
  "lessonId": "lesson-abc" // 可选 — 关联 lesson，写入 submission_raw.payload_json（仅供审计）
}
```

> ⚠️ **历史陷阱**: 数据库 `courseware_attempt.status` 实际写入的值是 `"completed"`（不是 `"finished"`）。前端展示时常规范化显示为「已完成」。如果按 GET 接口的查询结果判断状态，二者等价。

### 响应

```json
// 200 OK
{
  "success": true, // 来自 courseware.submit_attempt command handler
  "autoRecord": { "recorded": true } // 实时自动录入结果，见下方说明
  // autoRecord 也可能是 { "recorded": false, "reason": "..." }
}
```

> 注：响应**不返回** `assignmentId` / `score`（与 `/promote` 不同）。`score` 若被自动录入，教师需从 `assignment_submissions` 或重新查询成绩榜获取。

### 自动录入（`autoRecord`）

`/submit` 成功后会尝试**实时**把成绩写入学期成绩（教师在课件成绩配置里开启 `autoRecordEnabled` 后生效）：

1. `findActiveLessonForStudent(db, studentId)` 找该生当前进行中的课节；查不到则 `autoRecord = { recorded: false, reason: 'no-active-lesson' }`，交由「学生提交数据」页的 `/attempts/auto-record` 补录兜底
2. 找到则 `autoRecordAttempt(db, attemptId, activeLesson)`，返回 `{ recorded: true }` 或 `{ recorded: false, reason }`
3. 整段包在 try/catch 中，异常一律吞掉（`reason: 'auto-record-error'`）——**成绩录入是附加能力，绝不能让学生提交失败**

### 副作用

1. 写 `submission_raw`（`event_type='submit_lms'`，`payload_json={score, comment, completion, status, ...extra}`）
2. 若 `status === 'completed'`：`UPDATE courseware_attempt SET finished_at=now, status='completed' WHERE id=:attemptId`
3. 按成绩策略归集官方分（`aggregateAttemptScore`），UPSERT `submission_result`（score/comment/completion/extra_json，extra 附 `score_aggregation` 快照）
4. `eventBus.publish({ type: 'courseware.attempt_submitted', source: 'builtin.courseware' })`
5. `publishAttemptUpdated(attemptId, 'submit')` → 内核事件 `courseware.attempt_updated` → socket `courseware-attempt-updated`
6. 实时自动录入（见上）

### 错误

- `401 { error: "Authentication required to submit attempt scores" }` — 未登录
- `403 { error: "Forbidden: Cannot submit scores for another student" }` — 学生操作他人 attempt
- `500` — 内部错误（如 CapabilityGuard 拦截 — 需 `student:write` capability；或 `PayloadValidationError` — 路由已剔空 `score`/`completion` 的显式 `null` 再组 payload，因为 `validateJsonSchema` 把 `null` 当作已提供值）

---

## 4. `GET /api/courseware/attempts` — 成绩榜（分页信封）

### 用途

白板课件元素的「查看成绩」浮层的数据源。**全班可见**（`requireAuth()`，不限教师），但服务端按角色裁剪字段。

### Query 参数

| 名称             | 类型   | 必填 | 描述                                                                                                        |
| ---------------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------- |
| `coursewareUuid` | string | 否   | 过滤该课件的 attempts；缺省返回全部。**白板 HtmlAppletFrame 实时面板必须传此参数**避免拉整张表            |
| `page`           | number | 否   | 页码，默认 1（< 1 或非数字按 1 处理）                                                                       |
| `pageSize`       | number \| `all` | 否 | 每页条数，默认 50，clamp 到 1..500；特殊值 `all` 返回全量（`LIMIT -1`），此时响应 `pageSize = total`   |

分页参数由 `server/utils/pagination.ts` 的 `parsePagination` 统一解析（A7 约定，全站列表端点一致）。

### 响应（200 OK）

```json
{
  "data": [
    {
      "attemptId": "att_1a2b3c4d5e6f7788",
      "started_at": 1735689600000,
      "finished_at": 1735689700000,
      "status": "completed", // 注意：DB 实际存 "completed"，见 §3 注释
      "coursewareId": "cw-node-001", // vfs_nodes.id
      "coursewareName": "课件 A",
      "coursewareUuid": "cw-uuid-001",
      "studentName": "小明", // 见下方 COALESCE 回退
      "studentId": "stu-001",
      "score": 88, // submission_result.score（可能为 null）
      "comment": "finished", // submission_result.comment（可能为 null）—— 非 staff 会被剥除
      "completion": 1, // submission_result.completion（可能为 null）
      "extra_json": "{\"q1\":\"B\"}", // 原始 JSON 字符串 —— 非 staff 会被剥除
      "isPromoted": 0 // 已晋升作业的次数（同一学生在该课件下产生的 assignment_submissions 行数）
    }
  ],
  "total": 42, // 满足过滤条件的总行数（独立 COUNT 查询）
  "page": 1,
  "pageSize": 50 // isAll 时等于 total
}
```

> ⚠️ **Breaking Change**：历史版本此处返回**裸数组**。现已统一改为分页信封，消费方必须取 `data` 字段。`server/utils/pagination.ts` 顶部注释对此有明确说明。

### 角色字段脱敏（安全行为）

判定 `isStaff` = `session.role ∈ {teacher, administrator}` **或** `session.subRole === 'administrator'`。

- **非 staff（学生）**：逐行 `delete sanitized.extra_json` 与 `delete sanitized.comment` 后返回
- **staff**：返回完整行

理由（见路由注释）：`extra_json` 是原始作答明细（同学可直接抄答案），`comment` 是教师评语，二者都不应出现在面向学生的成绩榜里。

> 脱敏发生在 `data` 数组内，`total` / `page` / `pageSize` 不受影响。

### 排序

按 `a.started_at DESC`，最近作答在前。

### 实现 SQL（节选）

```sql
SELECT a.id as attemptId, a.started_at, a.finished_at, a.status,
       cw.id as coursewareId, cw.name as coursewareName, cw.uuid as coursewareUuid,
       COALESCE(s.name,
                CASE WHEN a.student_id = 'teacher' THEN 'Teacher (Test)'
                     WHEN a.student_id = 'guest'   THEN 'Guest Student'
                     ELSE a.student_id END) as studentName,
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
ORDER BY a.started_at DESC
LIMIT ? OFFSET ?;   -- pageSize='all' 时 LIMIT 传 -1
```

---

## 5. `POST /api/courseware/attempts/:attemptId/promote` — 写入作业成绩

### 用途

教师在 LiveClassroom 看到成绩后，点击「保存为作业成绩」时调用。把这次 attempt 的最终成绩**自动建作业**、**UPSERT 作业提交**、**UPSERT 学生课程进度**三件事一次性做完。

### 请求

```json
{
  "lessonId": "lesson-abc", // 必填 — 关联到 lesson_id（写进 assignments.lesson_id 与 student_lesson_progress）
  "classId": "cls-001" // 必填 — 关联到班级（写进 assignments.class_id）
}
```

### 响应

```json
// 200 OK
{
  "success": true,
  "assignmentId": "ast-cw-<hex>", // 新建或已存在的 assignment.id
  "score": 88 // 归一化后的最终分数（注意：是 "score"，不是 "finalScore"）
}
```

### 分数归一化

`submission_result.score` 经 `normalizePercentScore`（`server/utils/auto-record-score.ts`）归一化：

| 原始值                    | 处理                    | 备注                                                |
| ------------------------- | ----------------------- | --------------------------------------------------- |
| `null` / `undefined` / `''` | 返回 `null` → **拒绝录入** | 铁律 1：「没有分数就不录」，绝不兜底成 0 或 100     |
| 非有限数（`NaN` / `Infinity`） | 返回 `null` → 拒绝   |                                                     |
| `0 < x ≤ 1.0`             | `Math.round(x * 100)`   | 0.85 → 85；这是**唯一**会被乘 100 的分支            |
| 其它                      | `Math.round(x)` 后 clamp 到 `0..100` | 88 → 88；-5 → 0；120 → 100                  |

> ✅ **历史陷阱已修**：旧实现是 `let finalScore = 100`，`score` 为 `NULL` 时直接给满分、`x === 0` 也落进满分兜底。现已改为「无分数拒绝录入 + 0 保持 0 + 结果 clamp」。
>
> 真实生产中 `LMS.submit(88, 100, ...)` 是 0-100 范围，所以归一化不会触发；但**自研课件若用了 0-1 比例务必传对**，否则录入结果会意外。

### 副作用

1. **UPSERT assignments**（`findOrCreateCoursewareAssignment`）：按 class_id + lesson_id + title 查已存在则复用；新建时 `title = "互动课件: <courseware.name>"`、`description = "来自互动课件 [<name>] 的随堂学习提交数据记录"`、`content = {type: 'interactive_courseware', attemptId, coursewareUuid}`（缺考标记路径传 `'{}'`）
2. **UPSERT assignment_submissions**（`ON CONFLICT(assignment_id, student_id) DO UPDATE`）：
   - `score = finalScore`
   - `content = attempt.extra_json`（原样搬运原始作答明细）
   - `feedback = "由<sourceLabel>。课件完成度: <X>%。课件原始反馈: <comment 或 —>"`
   - `status = 'graded'`，`source = 'manual'`，`submitted_at = graded_at = now`
3. **UPSERT student_lesson_progress**：completed=1, progress_percent=100, completed_segments='[]'
4. 发布 `student.progress_updated` → socket `student-progress-updated`，payload `{ studentId, lessonId, progressPercent: 100, completed: true, completedSegments: [] }`

以上三步在 `db.transaction(run)()` 内执行，要么全落要么全不落。

### 错误

- `400 { error: "Missing lessonId or classId" }`
- `404 { success: false, error: <describePromoteReason('attempt-not-found')>, reason: 'attempt-not-found' }`
- `422` — 其余业务前置条件不满足，`reason` 取值见下表（`error` 文本由 `describePromoteReason` 生成）

| `reason`            | 触发条件                                                          |
| ------------------- | ----------------------------------------------------------------- |
| `not-finished`      | attempt.status 不在 `FINISHED_ATTEMPT_STATUSES` 内（手动路径已用 `ignoreNotFinished` 放宽） |
| `placeholder-student` | `student_id ∈ {guest, teacher, teacher_preview, ''}`             |
| `missing-score`     | `normalizePercentScore` 返回 `null`（**没有分数就不录**）         |
| `below-min-completion` | 完成度低于门槛（手动路径已用 `ignoreMinCompletion` 放宽）       |

> 手动录入以 `ignoreMinCompletion: true` + `ignoreNotFinished: true` + `source: 'manual'` 调用，与「自动录入规则」共用同一落库实现（`promoteAttemptToGrade`），保证两条路径口径一致。
>
> `already-recorded` / `manual-protected` / `absent-protected` / `not-higher` / `rule-disabled` 这几个 `reason` **只出现在自动路径**（`/attempts/auto-record`），手动路径恒不返回。

### 幂等性

- 同 attempt 重复 promote：`assignments` 按 class_id + lesson_id + title 查已存在则复用，不重建；`assignment_submissions` 通过 `ON CONFLICT DO UPDATE` 保持单行
- 已 promote 的 attempt 在 `GET /api/courseware/attempts` 中 `isPromoted >= 1`，前端可据此显示「✓ 已保存为作业」徽标

---

## 6. `GET /api/courseware/attempts/:attemptId/progress` — 单条成绩快照

### 用途

学生端轮询自己的当前成绩（教师端实时面板也可用）。**需登录**（`requireAuth()`）：教师/管理员可读取任意 attempt；其他角色（含学生）仅能读取 `student_id` 等于自身的 attempt，越权返回 403。attempt 无成绩时返回 `{ progress: null }`。

> 403 的错误体是 `{ success: false, error: 'Forbidden: Cannot read another student attempt' }`。attempt 不存在与非本人返回**同样的 403**，避免用状态码枚举 attempt 是否存在。

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

教师复盘：拉取 attempt 的全部原始 LMS Bridge 事件流（`submission_raw` 表）。`requireAuth()` + 与 `/progress` 相同的所属权校验（非教师/管理员只能读自己的）。

> 该端点此前**没有鉴权**且 `actorId` 硬编码为 `'teacher-demo'`（其种子能力恰好含 `lesson:read`，满足命令要求），任何人凭 attemptId 即可越权读取作答明细。现已收紧。

### 响应

由 `courseware.get_attempt_raw_data` command handler（`packages/plugins/builtin.ts`，`capabilityRequired: 'lesson:read'`）返回。Schema 不稳定，不在本契约范围。

---

## 8. 实时事件

课件侧事件先经 `server/classroom-events.ts` 的 `publishClassroomEvent` 进入内核 EventBus（落 `events` 审计表、带 `correlationId`），再由 `server/event-routing.ts` 的声明式路由表投递到 Socket.IO。

| 内核事件类型                | Socket 事件名                | 触发条件                     | Payload                                                                  |
| --------------------------- | ---------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `courseware.attempt_updated` | `courseware-attempt-updated` | `/log`、`/submit`、`/adopt` | `{ attemptId, type: 'log' \| 'submit' \| 'adopt' }`                     |
| `student.progress_updated`  | `student-progress-updated`   | `/promote` 成功后           | `{ studentId, lessonId, progressPercent, completed, completedSegments }` |

> `/promote` **不**发 `courseware-attempt-updated`（它改的是学期成绩而非 attempt 流水），只发 `student-progress-updated`。

前端订阅示例（白板 `HtmlAppletFrame`）——注意分页信封必须取 `data`：

```ts
socket.on('courseware-attempt-updated', async (payload) => {
  if (currentAttemptIds.has(payload.attemptId)) {
    const envelope = await fetch(`/api/courseware/attempts?coursewareUuid=${uuid}`).then((r) => r.json());
    setAttempts(envelope.data); // 分页信封：取 data，不是 envelope 本身
  }
});
```

---

## 9. 已知契约陷阱（迁移期 backlog）

下列条目是**当前实现现状**与**直觉契约**不一致的地方。建议在后续 PR 中修正：

1. **响应字段命名**：`/promote` 返回的是 `score`，但内部变量名 `finalScore`。建议响应改为 `{ success, assignmentId, finalScore }` 与变量名一致
2. **status 词汇不统一**：`/submit` 入参约定 `status: 'completed'`，但部分前端/文档用 `'finished'`。数据库实际写入的终态是 `completed`；`FINISHED_ATTEMPT_STATUSES = ['completed', 'submitted', 'finished']` 兼容三种读法。展示层应统一翻译为「已完成」
3. **assignment.title 取名依赖课件 name**：若同一 lesson 有多个同名课件会合并到同一作业（按 class_id + lesson_id + title 查复用）。建议在 title 中追加课件 uuid 后缀以唯一化
4. **跨 lesson 重 promote**：若同一 student 在不同 lesson 都用过同一课件，会创建多份独立 assignment——这是正确行为（title 复用查询含 lesson_id），但前端 UI 提示需要解释
5. **`completion` 单位不统一**：`submission_result.completion` 存 0-1（promote 的 feedback 会 `× 100`），而 `WhiteboardEvent` 的 `payload.completion` 约定是 0-100。跨层传递时必须显式换算

> ✅ **已修复**（不再列为陷阱）：`score = 0` 被当作满分、`score = NULL` 兜底 100、分页信封未生效、`GET /list` 与 `POST /:id` 路径错误、7 个端点漏记、`/raw` 与成绩榜的越权读取。

---

## 10. 相关源文件

| 路径                                                     | 内容                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `server/routes/courseware.ts`                            | 全部 HTTP 端点实现                                                              |
| `server/utils/score-extract.ts`                          | `extractScoreCommentCompletion` 分数/评语/完成度探测                               |
| `server/utils/pagination.ts`                             | `parsePagination` 全站分页信封约定                                                |
| `server/utils/auto-record-score.ts`                      | `promoteAttemptToGrade` / `markStudentAbsent` / `autoRecordForLesson` / `normalizePercentScore` |
| `server/utils/courseware-access.ts`                      | `mintCoursewareToken` / `verifyCoursewareToken`（课件 HTML 短时 HMAC 令牌）       |
| `server/classroom-events.ts`                             | `publishClassroomEvent` / `CLASSROOM_EVENTS` 课堂事件统一发布入口                 |
| `server/event-routing.ts`                                | 内核事件 → Socket.IO 投递的声明式路由表                                          |
| `packages/plugins/courseware-score.ts`                   | `aggregateAttemptScore` / `describeAggregation` 成绩归集策略                      |
| `packages/plugins/builtin.ts`                            | `courseware.submit_attempt` / `courseware.get_attempt_raw_data` / `courseware.list` / `courseware.delete` command handler |
| `packages/core/capability-system/index.ts`               | 学生需具备 `student:write` capability 才能 submit_attempt                       |
| `server/utils/bridge-sdk.ts`                             | LMS Bridge SDK 服务端代理                                                       |
| `src/features/whiteboard/utils/bridgeUtils.ts`           | LMS Bridge SDK 前端注入（`wrapSrcDocWithBridge`）                               |
| `src/features/whiteboard/components/HtmlAppletFrame.tsx` | 白板课件 iframe + 实时成绩浮层                                                  |

### 回归测试

| 路径                                                    | 覆盖点                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `server/__tests__/courseware-e2e-flow.test.ts`          | log → submit → promote 主链路                          |
| `server/__tests__/courseware-attempts-filter.test.ts`   | `?coursewareUuid=` 过滤与成绩榜字段                     |
| `server/__tests__/courseware-access-token.test.ts`      | `?ct=` 短时令牌鉴权                                     |
| `server/__tests__/courseware-submit-actor.test.ts`      | `/submit` 的 actorId `:role` 后缀归一化（曾致 500）      |
| `server/__tests__/courseware-score-capture-e2e.test.ts` | 分数/评语捕获与成绩归集                                 |

---

## 11. 其余端点速记

### 11.1 `POST /api/courseware/upload` — 上传课件

**角色**：教师/管理员。**Body**：`{ name, filename, base64Data }`（base64 字符串）。转发 `courseware.upload` 命令，HTML 分支响应 `{ success: true, id, uuid, name, entry }`（以 `packages/plugins/builtin.ts` 的 `courseware.upload` handler 为准；ZIP 分支会解包并递归登记多个文件）。

### 11.2 `POST /api/courseware/confirm` — 登记课件

**角色**：教师/管理员。**Body**：`{ uuid, name, entry }`。转发 `courseware.confirm` 命令，写入 `courseware` 表行。

### 11.3 `GET /api/courseware` — 课件列表

**角色**：任意登录（`requireAuth()`，命令侧要求 `lesson:read`）。**无 query 参数**。响应是 `courseware` 表按 `created_at DESC` 的**裸数组**（未接分页信封，与 §4 不同）。

### 11.4 `DELETE /api/courseware/:id` — 删除课件

**角色**：教师/管理员（命令侧要求 `lesson:write`）。副作用（`courseware.delete` handler）：删 `courseware` 行 → 递归删除 `storage/courseware/<uuid>/` 目录 → 发布内核事件 `courseware.deleted`。响应 `{ success: true }`。课件不存在也返回 `success: true`（幂等）。

### 11.5 `POST /api/courseware/attempts/:attemptId/adopt` — 归属认领

**角色**：任意登录。

背景：课件 iframe 以 `credentialless` + `sandbox`（无 `allow-same-origin`）加载，访问 `/runtime/:uuid/` 时**不携带会话 cookie**，`injectLmsSdk` 只能识别为匿名，建出一条 `student_id='guest'` 的共享 attempt。结果所有学生共用一个 attempt，真实学生 `POST /submit` 时因 `attempt.student_id('guest') !== session.userId` 被 403 丢弃。父窗口在转发上报前先调本端点把 attempt 认领回来。

| 情形                                | 行为                                             | 响应                                                    |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| 教师/管理员会话                     | 预览用，不参与归属约束                           | `{ attemptId, adopted: false, reused: true, role }`     |
| 已是本人 attempt                    | 幂等，原样返回                                   | `{ attemptId, adopted: false, reused: true }`           |
| 无主（`guest`/`teacher`/`teacher_preview`/`''`） | 直接改 `student_id`，保留已产生的原始流水 | `{ attemptId, adopted: true, reused: true }`            |
| 已被其他真实学生占用                | 为当前学生复用/新建自己的 `active` attempt        | `{ attemptId, adopted: false, reused: true, reason: 'attempt-owned-by-another-student' }`（`attemptId` 是**新的** id） |

**错误**：`401 Authentication required to adopt an attempt`、`404 Attempt not found`、`400 Session has no student identity`。认领成功会发 `courseware-attempt-updated`（`type: 'adopt'`）。

### 11.6 `GET /api/courseware/:id/access-token` + `GET /api/courseware/:id`

两段式鉴权。沙箱 iframe 不带会话 cookie，无法 `requireAuth()`：

1. 已认证的**父页面**调 `/api/courseware/:id/access-token` → `{ token }`（`mintCoursewareToken`，与 `:id` 绑定 + 有效期）
2. 父页面把 token 拼进 iframe src：`/api/courseware/<id>?ct=<token>`
3. `GET /api/courseware/:id` 用 `verifyCoursewareToken` 校验；未带/无效一律 `401 Courseware access token missing or invalid`

副作用（`GET /:id`）：读 `vfs_nodes`（须 `type='file'`）→ 若 `courseware` 表无对应行则**自动登记**一行 → 注入 LMS SDK（`injectLmsSdk`）→ 以 `text/html` 直出，并用 `setCoursewareDocumentCsp` 覆盖 helmet 全局 CSP（第三方课件内容需要宽松 CSP）。这同时挡住「未认证读取课件 HTML」与「未认证触发 courseware 行自动登记」两个面。

### 11.7 `POST /api/courseware/attempts/mark-absent` — 标记缺考

**角色**：教师/管理员。**Body**：`{ lessonId, classId, studentId, coursewareId }`（四者缺一即 400）。委托 `markStudentAbsent`：写一行 `status='absent'`、`score=NULL`、`source='manual'` 的 `assignment_submissions`。

`source='manual'` 使缺考行**受自动规则保护**——学生之后补交课件也不会冲掉；教师改判走 `/promote` 手动路径显式覆盖。

**错误**：`422` + `reason` 取 `courseware-not-found`（课件不存在）或 `student-not-in-class`（不在所选班级，含占位身份 `guest`/`teacher`/`teacher_preview`/`''`）。

### 11.8 `POST /api/courseware/attempts/auto-record` — 批量补录

**角色**：教师/管理员。**Body**：`{ lessonId, classId, limit? }`。委托 `autoRecordForLesson`，把该课节 + 班级下**已提交但尚未录入**的 attempt 按课件成绩配置补录。响应 `{ success: true, ...report }`。

`AutoRecordReport` 形如 `{ recorded, skipped, details[] }`；`limit` clamp 到 1..5000（默认 1000）。筛选条件：`a.status IN ('completed','submitted','finished')`、排除占位身份、必须属于该班级（经 `class_students` 关联），按 `finished_at DESC, started_at DESC` 排序后**同一 (学生, 课件) 只保留最新一条** attempt。

> 自动路径相对手动路径多出的 `reason`：`rule-disabled`（未开启 `autoRecordEnabled`）、`already-recorded`、`manual-protected`（教师手改分受保护，自动规则绝不覆盖）、`absent-protected`（教师缺考标记受保护）、`not-higher`（`strategy='highest'` 且新分不高于已录分）、`below-min-completion`（自动路径**不**放宽完成度门槛）。

### 11.9 `POST /api/courseware/debug` — 客户端调试日志

**角色**：任意登录。**Body**：`{ msg, url, student, courseware }`。写 `client_debug.log`（进程 cwd 下）并打到控制台。`msg` 截断 2000 字符、`url` 截断 1000 字符、其余字段 `JSON.stringify` 后截断 1000 字符，防止日志灌盘 / 注入。响应 `{ success: true }`。

### 11.10 `POST /api/courseware/inline` — 手写 HTML 课件落库

**角色**：任意登录（学生端也要渲染同一元素，不能限教师）。

背景：`HtmlAppletFrame` 原先用 `<iframe srcdoc>` 承载手写 HTML，而 srcdoc 文档**继承父页面 CSP**；全局 CSP 收紧（`scriptSrc` 去掉 `'unsafe-inline'`）后课件内联脚本会被拦。改造后前端把 code 经本端点落库，改走 `/runtime/inline-<hash>/` 加载——该路由有自有宽松 CSP。

**Body**：`{ code }`（≤ 512KB，按内容 sha256 前 16 位生成 `inline-<hash>` 幂等去重，存 `system_resources`）。**响应**：`{ uuid }`。**错误**：`400 Missing code`、`413 Inline courseware too large (512KB max)`。
