# 测评子系统 · 数据模型与 API（P0a）

> Issue #100 / 子 issue #120。本文件描述 **P0a 已落地**的部分（数据模型 + 判分引擎 + REST API）。
> 教师端 UI（#121）、学生端 UI（#122）、考试模式与成绩回写（#123）、存量收敛（#124）分别在后续阶段。

## 1. 三种类型只差配置

`assessments.kind ∈ {quiz, exam, survey}`，行为差异**全部**集中在 `settings_json`
（`packages/core/assessment/settings.ts`）：

| 配置 | quiz | exam | survey |
| --- | --- | --- | --- |
| `maxAttempts` | 可配（默认 1） | **强制 1** | **强制 1** |
| `countsTowardGrade` | 可选 | **强制 true** | **强制 false** |
| `resultVisibility` | 可配 | `immediate` 会被强制改为 `after_release` | **强制 `score_only`** |
| `showItemAnalysis` | 可配 | 可配 | **强制 false** |
| `anonymous` | 强制 false | 强制 false | 可配 |

非法取值一律回落到该类型默认值（拼错不能静默放宽约束）。

## 2. 表结构（`migrations/031_assessment_core.sql`）

```text
assessments ──┬─< assessment_items          （组卷即快照）
              └─< assessment_assignments    （发布到班级/课节/课表节次）
                        └─< assessment_attempts ──< assessment_answers
question_bank_items                          （题库，独立于试卷）
```

关键点：

- **组卷即快照**：题目加入试卷时复制进 `assessment_items`，草稿自包含；发布只改
  `assessments.status`。删题库条目不改变已组卷内容（`bank_item_id` 仅溯源）。
- **`answer_key_json` 明文落库，但永不出接口**：所有学生端响应走
  `packages/core/assessment/serialize.ts` 的白名单视图；`server/__tests__/assessment-api.test.ts`
  用哨兵字符串对每个学生端响应做全量断言。
- **匿名问卷**：`assessment_attempts.student_id = NULL`、
  `anon_key = HMAC-SHA256(ENCRYPTION_KEY, `${assignmentId}:${studentId}`)`；
  唯一索引 `(assignment_id, coalesce(student_id,''), coalesce(anon_key,''), attempt_no)`
  同时承担「同一学生不能重复提交」。
- **不落冗余聚合列**：多次作答的 `first/last/highest/average` 实时计算
  （`grading.ts#aggregateScores`）。
- **超时惰性结算**：任何读取到 `now > deadline_at` 的 `in_progress` attempt 都结算为
  已交卷并按 deadline 时间判分；不引入后台定时器。

## 3. 判分口径

| 题型 | 规则 |
| --- | --- |
| 单选 | 索引相等 → 满分，否则 0 |
| 多选 | 全对满分；**错选（选了错误项）得 0**；少选按 `命中数/正确总数 × 满分`（`partialCredit` 可关） |
| 判断 | 严格布尔（容忍 `对/错`、`1/0`） |
| 填空 | 每空等分；答案接受列表任一命中；归一化 = `trim` + 全角→半角 + 大小写折叠（可配）；`numeric` 按数值比较（容差需显式配置）；**无模糊匹配** |
| 简答 | 永不自动判分 → `score: null` + `needsManualReview: true` |

三条不变量：

1. **无法判分返回 `null`，绝不兜底成 0 或满分**；
2. **判分幂等**：纯函数，同输入同输出；
3. **`manual_override = 1` 的行不被自动判分覆盖**（regrade 时 SQL 层过滤）。

## 4. 插件接口

服务端题型注册走新的 DI token（不走 capability provider，理由见
`packages/core/di/interfaces.ts` 的注释）：

```ts
// 插件服务端 activate
const registry = await ctx.resolve(IAssessmentGraderRegistryToken);
registry.registerQuestionType(
  {
    type: 'ext-code:python',            // 必须 <pluginId>:<name>
    label: { zh: 'Python 代码题', en: 'Python code' },
    category: 'objective',
    supports: ['quiz', 'exam'],
    autoGradable: true,
    createDefaultConfig: () => ({ tests: [] }),
    validateConfig: () => null,
    grade: async () => ({ score: null, needsManualReview: true }),
  },
  { pluginId: 'ext-code' },
);
// 卸载时宿主调用 registry.clearOwnedQuestionTypes('ext-code')
```

内置 5 种题型走**同一个注册路径**（`createQuestionTypeRegistry()` 只是预先 register 它们），
所以插件题型不是二等公民。`GET /api/assessment-question-types` 可查当前注册表。

前端 `QuestionTypeRegistry` 契约与内置题型定义同源（`packages/core/assessment/question-types/`），
P0b 的出题编辑器直接消费这份定义；React 组件在 PR B 里补充。

## 5. REST API

教师（`requireAuth('teacher','administrator')`，一律按 `assessments.owner_id` 判归属）：

| 方法 | 路径 |
| --- | --- |
| GET/POST | `/api/assessments` |
| GET/PUT/DELETE | `/api/assessments/:id` |
| PUT | `/api/assessments/:id/items`（整卷覆盖） |
| GET/POST | `/api/question-bank`，GET/DELETE `/api/question-bank/:id` |
| POST | `/api/assessments/:id/publish` |
| POST | `/api/assessment-assignments/:id/close` · `/release` |
| GET | `/api/assessment-assignments/:id/attempts` · `/stats` · `/export?format=csv` |
| PUT | `/api/assessment-attempts/:id/answers/:itemId/grade`（人工批改） |
| POST | `/api/assessment-attempts/:id/regrade` |

学生（`requireAuth('student')`）：

| 方法 | 路径 |
| --- | --- |
| GET | `/api/me/assessments` |
| POST | `/api/assessment-assignments/:id/attempts`（开始/续答） |
| PUT | `/api/assessment-attempts/:id/answers/:itemId`（自动保存） |
| POST | `/api/assessment-attempts/:id/submit` |
| GET | `/api/assessment-attempts/:id/result` |

管理员专用：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/assessment-attempts/:id/reveal-identity` | 匿名反查，**必写审计** `assessment.anonymous_identity_revealed` |

## 6. 本期未做（后续阶段）

- 教师/学生 UI（#121 / #122）
- 乱序、全屏锁定、切屏计数、`exams` 成绩回写、课内发起（#123）
- 白板 `quiz` / `lesson_preset_polls` / AI 出题的桥接与迁移（#124）
- 题库共享、按规则抽题、AI 辅助批改、难度/区分度（#124）
- 管理员跨教师查看试卷（本期 `listAssessments` 只返回自己名下的）
