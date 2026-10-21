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

### 3.5 项分析：难度与区分度（#184）

| 指标 | 口径 | 退化规则 |
| --- | --- | --- |
| 难度 (p) | 该题已判分作答的平均得分 / 该题满分 | 无已判分作答 → `null` |
| 区分度 (r) | 题目得分与该考生**剩余卷面分**（总分 − 本题得分）的 Pearson 相关 | 样本量 < 5、题目得分方差为 0（全对/全错）、剩余分方差为 0 → `null` |

- 用剩余分而不是总分，避免题目自身贡献总分导致相关系数虚高；二分题下等价于点二列相关。
- **待人工批改的作答不参与**（`score = null` 不计入样本），不会把未批改的题当成 0 分。
- 分级：`|r| ≥ 0.4` 高、`≥ 0.2` 中、其余低；原始数值与等级同时返回。
- 纯函数实现：`packages/core/assessment/item-analysis.ts`（不依赖数据库）。

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
    // 可选：插件题型自带的 AI 批改提示词（见 §9.1）；不实现则回退内置通用模板
    getAiGradingPrompt: (config, answerKey, answer) => `测试用例：${JSON.stringify(config.tests)}\n学生代码：${answer}`,
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
| GET | `/api/assessment-assignments/:id/item-analysis`（难度/区分度） |
| GET | `/api/assessment-assignments/:id/item-analysis/export?format=csv\|json\|xlsx` |
| GET | `/api/assessments/:id/paper/export?format=json\|csv\|xlsx`（试卷本体导出，插件题型互通） |
| POST | `/api/assessments/paper/import`（建新草稿卷，见 §9） |
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

## 7. 题库共享与按规则随机抽题（Issue #186）

### 7.1 题库可见范围

- `question_bank_items.visibility`：`private`（默认，仅 owner）| `school`（同实例教师可见）。平台按 ADR-001「一校一实例」部署，因此 school 即本校。
- 共享**不复制**条目：`GET /api/question-bank` 返回「自己的全部 + visibility=school 的他人条目」；读取他人共享条目允许，写/删仍限 owner（`getBankItem` 的写路径不变）。
- 学生永远不可见题库。

### 7.2 抽题规则（每人一卷）

在 `assessments.settings_json` 里配置：

```json
{ "draw": { "count": 5, "type": "short_answer", "tags": ["unit-1"], "difficultyMin": 1, "difficultyMax": 3 } }
```

- 生效时机：`startAttempt` 创建作答时，用种子 `assignmentId:studentKey:attemptNo` 对题目池做确定性洗牌后取前 `count` 道；结果与种子写入 `assessment_attempts.paper_json`（`{ seed, itemIds }`）。
- **稳定性**：同一学生重入复用同一条 attempt（未交卷）或已交卷的多次作答各自独立成卷；刷新/断网重连题目集合与顺序不变。
- **不同学生不同卷**：种子含学生身份，卷面不同；同卷内不重复（洗牌后切片）。
- **题库不足**：可用题数 < count 时 `startAttempt` 抛 409，**不静默少题**。
- **过滤口径**：`type` / `tags`（命中任一）/ `difficultyMin..Max` 依据题库条目（`question_bank_items`）；未关联题库的自建题在启用过滤时被排除。
- **判分不受题库后续修改影响**：试卷题目在组卷时已快照进 `assessment_items`（含标准答案），抽题只选 id。

### 7.3 数据与回滚

- 迁移 `039_question_bank_sharing_and_papers.sql` 只加两列（幂等；DOWN 可回滚）。
- 关闭抽题：把 settings.draw 去掉后，新作答恢复整卷；已有 `paper_json` 的旧作答仍按各自的卷面判分与展示。
## 8. 存量数据导入：白板 quiz 与预置投票（Issue #185）

### 8.1 范围

| 旧来源 | 新模型 | 说明 |
| --- | --- | --- |
| `whiteboard_elements.type='quiz'` | `assessments(kind=quiz)` + 1 道单选 | 题干/选项/正确答案来自元素 `data`；历史 `lesson_quiz_submissions` 导入为 attempts/answers |
| `lesson_preset_polls`（有 `correct_option`） | `assessments(kind=quiz)` + 1 道单选 | `A/B/C/D` 映射为选项索引；**纯投票（无正确答案）不导入**，报告为 `no_correct_option` |

### 8.2 执行方式

```bash
pnpm exec tsx scripts/migrate-legacy-assessments.ts --dry-run   # 只统计
pnpm exec tsx scripts/migrate-legacy-assessments.ts             # 正式导入
```

- **幂等**：以 `assessments.settings_json.legacy.sourceId` 为标记；二次执行全部记 `already_imported`，不产生新行。
- **只读旧表**：不修改/删除任何 legacy 数据；旧接口（白板 quiz、预置投票）行为不变，可继续读写。
- **班级归属**：有 `schedules`（lesson → class）时创建已发布 assignment 并导入历史作答；无排课时只创建草稿试卷。
- **可追溯**：`settings_json.legacy = { source, sourceId, lessonId }`。

### 8.3 已知差异与回滚

- 历史作答的 `score` 按旧记录原样保留；旧数据未记录的建议/解析不会凭空生成。
- 预置投票的作答只存在于课堂会话运行时，没有可按学生回放的持久表 → **不导入作答**（试卷与题目仍导入）。
- 回滚：删除带对应 `legacy.sourceId` 标记的 assessments（级联删除 items/assignments/attempts/answers）；旧数据始终未被改动。

## 9. 插件题型的 AI 批改与试卷导入导出协议（Issue #196）

测评中心的题型扩展点（#100 / #120 / #183 / #187）让第三方插件能注册自己的题型。§9 补的是
"插件题型如何与 AI 批改、试卷导入导出深度协作"——否则插件题型在生态里只能出题、不能迁移。

### 9.1 AI 批改提示词：`getAiGradingPrompt`

```ts
interface QuestionTypeDefinition<TConfig, TAnswer> {
  // …既有字段
  getAiGradingPrompt?(config: TConfig, answerKey: unknown, answer: TAnswer): string | null;
}
```

内置通用提示词只看得见 **题干 / 满分 / 标准答案 / 学生作答**。对代码题它看不到测试用例，
对语音评测题它不知道评分细则 —— 建议质量只能泛泛。题型自己知道 `config` 里有什么，所以
把提示词的**组装权交给题型**。

返回值的三种语义（区分它们是这套协议的关键）：

| 返回 | 含义 | 服务端行为 |
| --- | --- | --- |
| `string`（非空） | 用我这条提示词 | 直接交给 AI Provider，**不再拼接内置模板** |
| `null` | 本题型不提供 AI 建议 | 保守拒绝：`400 该题型不提供 AI 批改建议`，不调用 AI |
| 未实现（`undefined`） | 走通用逻辑 | 回退内置通用模板（**全部内置题型走这条，行为不变**） |

约束：

- 纯函数（不得读库、不得依赖时间/随机数），与 `grade` 同一约束；
- 返回值仍是"提示词"，**不参与判分**：`suggestAiGrade` 只写 `assessment_answers.ai_suggestion_json`，
  教师确认才落分并置 `manual_override = 1`（见 §3、#187）；
- 仍受题型 `category === 'subjective'` 的前置限制与 AI 建议限流约束。

### 9.2 试卷导出 / 导入（`openlearn.assessment.paper/v1`）

与 `/api/assessment-assignments/:id/export`（成绩矩阵 CSV，导的是**作答结果**）不同，
`/api/assessments/:id/paper/export` 导的是**试卷本体**，目标是"在另一个环境重新变成一份试卷"。

JSON 协议：

```jsonc
{
  "schema": "openlearn.assessment.paper/v1",
  "exportedAt": 1730000000000,
  "assessment": { "title": "期中卷", "kind": "exam", "description": null, "settings": { /* AssessmentSettings */ } },
  "items": [
    {
      "order": 1,
      "section": null,
      "type": "ext-code:python",           // 题型标记：内置为 single_choice 等，插件为 <pluginId>:<name>
      "stem": "请实现累加函数",
      "config": { "testCases": [], "rubric": "…" },  // 插件自定义结构，原样保留
      "answerKey": "def add(n): …",                  // 教师可见，导入时由题型校验
      "maxScore": 10
    }
  ]
}
```

CSV / XLSX 是**同一个数据模型的扁平视图**（列：`order,section,type,stem,config,answerKey,maxScore`）：

- `config` / `answerKey` 以 **JSON 字符串**存放。不展平成列 —— 每类题型的 config 形状都不同，
  展平等于把插件题型塞回内置题型的形状，必然丢字段；拆多文件则再导入时对齐成本高。
- XLSX 导出带一张人读的「试卷」汇总页 + 一张「题目」明细页；**导入只接受 json/csv**
  （表格编辑后容易改坏 JSON 单元格，返回 400 明确拒绝，不是解析崩溃）。

导入语义：

1. **建一份新草稿卷**（`status = 'draft'`），不覆盖任何既有试卷；`assessment.kind` 缺失时默认 `quiz`；
2. **逐题核对题型是否已安装**（`QuestionTypeRegistry.has(type)`）。缺失时返回
   `400 QUESTION_TYPE_NOT_INSTALLED` 并附 `missingTypes` 清单，提示"请先在插件中心安装对应插件"。
   不能静默丢题或让题目落库 —— 那样学生会看到一道渲染不出来、也判不了分的题；
3. **用题型自己的校验器验内容**：`validateConfig` / `validateAnswerKey`，任一处不合法返回
   `400 PAPER_IMPORT_INVALID_ITEM`（附前 5 条明细）。导入是外部数据入口，不因"看起来对"就信任；
4. CSV 不携带标题，需在请求体额外传 `title`（缺失 → `400 PAPER_IMPORT_MISSING_TITLE`）。

机器可读错误码（4xx 会经 `sendSafeError` 透传 `code`，前端据此分支）：

| code | 场景 |
| --- | --- |
| `PAPER_IMPORT_INVALID_JSON` | 内容不是合法 JSON |
| `PAPER_IMPORT_INVALID_SHAPE` | 缺 `items` 数组或不是对象 |
| `PAPER_IMPORT_INVALID_CSV` | CSV 缺必需列 / 内容为空 |
| `PAPER_IMPORT_EMPTY` | 一道题都没有 |
| `QUESTION_TYPE_NOT_INSTALLED` | 题型未安装（附 `missingTypes`） |
| `PAPER_IMPORT_INVALID_ITEM` | 题干/满分/配置/标准答案非法（附 `invalidItems`） |
| `PAPER_IMPORT_MISSING_TITLE` | 缺试卷标题 |

协议向后兼容策略：`schema` 不匹配只**告警不报错**（导入结果里带 `warnings`），字段顺序与语义保持不变。
