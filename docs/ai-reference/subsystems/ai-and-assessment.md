# 子系统：AI 与测评

> 覆盖 `packages/core/ai/`、`packages/core/ai-capability/`、`server/ai-agent.ts`、
> `packages/core/assessment/`、`packages/core/assignment/`、`packages/plugins/ai-planner.ts`。

---

## 1. AI 分三层，别混

| 层 | 位置 | 职责 | 谁能改 |
| --- | --- | --- | --- |
| **能力层** | `packages/core/ai-capability/`（12 文件 / 902 行） | 把「AI 能做什么」切分成 7 个 capability 文件，各自有独立 prompt 与工具集 | 平台 |
| **运行时层** | `packages/core/ai/`（14 文件 / 1,014 行） | provider 网关、流式、会话、记忆、工具注册、prompt 注册 | 平台 |
| **接入层** | `server/ai-agent.ts`（514 行）+ `server/routes/os.ts` L270-430 | HTTP 端点、限流、工具调用编排 | 平台 |

插件**不直接调模型**，而是通过 `ctx.services.ai`（`IAIService`，主进程）或
`CTX.services.ai`（前端，若宿主注入）。

### 1.1 `ai-capability/capabilities/` 七个能力模块

```text
analytics-capability.ts    chat-capability.ts      completion-capability.ts
lesson-capability.ts       plugin-capability.ts    tool-capability.ts
whiteboard-capability.ts
```

`plugin-capability.ts` 是插件能触及 AI 的**唯一通道** —— 它把插件的 `ActionDescriptor`
包装成模型可用的工具。这条关系解释了两件事：

1. 命令没有 ActionDescriptor ⇒ AI 看不到它（即使 handler 存在）。
2. `exposeToAgent: false` ⇒ 该工具不出现在工具箱，但命令本身仍可被程序调用。

### 1.2 运行时子目录

| 目录 | 作用 |
| --- | --- |
| `provider/` | `provider-gateway.ts`，唯一对外部模型 API 发请求的地方 |
| `streaming/` | SSE 流式输出 |
| `conversation/` | 会话与多轮上下文 |
| `memory/` | 长期记忆 |
| `context/` | 上下文装配（课程/课节/学生） |
| `prompt/` | `prompt-registry.ts`，命名 prompt 模板 |
| `tool/` | `tool-registry.ts`，工具注册与 schema 归一 |
| `utils/` | `strip-reasoning.ts` 等 |

---

## 2. AI 的 HTTP 面

| 端点 | 行 | 鉴权 | 限流 |
| --- | --- | --- | --- |
| `GET /api/agent/personas` | `os.ts` L270 | `requireScopedAuth('authenticated')` | 无 |
| `POST /api/agent/chat` | L278 | `requireScopedAuth('self')` | **`aiLimiter`** |
| `GET /api/agent/conversations` | L390 | `self` | 无 |
| `DELETE /api/agent/conversations` | L412 | `self` | 无 |

`self` 作用域的含义：只能操作自己的资源。学生无法通过改 `studentId` 读别人的会话。

`aiLimiter` 是独立于 `writeLimiter` 的第二道限流 —— AI 调用成本高，
即使写请求总配额充足，AI 端点也会单独计数。

配置来源：`ai_providers` 表 + 管理后台「AI Provider 管理」。任何 OpenAI 兼容端点都可接入
（DeepSeek / Qwen / Ollama / OpenAI）。`server/ai-agent.ts` 里对此有
`buildOpenAIChatUrl` / `runOpenAIAgentChat` / `runGeminiAgentChat` 三条分支。

---

## 3. 插件怎么安全地用 AI

### 3.1 主进程（inline）

```ts
const ai = ctx.services.ai;                      // IAIronService | null，必须判空
if (!ai) return;                                 // optional 依赖不可用
const text = await ai.generateText('把这段讲义变成 5 道选择题', { systemInstruction });
```

`generateText` 需 `ai:invoke` 能力（`CAP_AI_INVOKE`）。

### 3.2 5 个可选方法必须判存在性

```ts
registerAIPersona?(persona): void;
listAIPersonas?(): AIPersonaDefinition[];
unregisterAIPersona?(id): void;
registerAIContextProvider?(id, fn): void;
unregisterAIContextProvider?(id): void;
```

老宿主不实现它们。**用 `typeof fn === 'function'` 判定，直接调会 TypeError**。

### 3.3 反面模式

| 反模式 | 后果 |
| --- | --- |
| 在插件里直接 `fetch` 模型 API | 受信插件能跑但违反最小权限；非受信插件拿不到网络 |
| 把整段学生名单塞进 prompt | 泄露面过大，且会撞上 provider 的 token 上限 |
| 用 AI 结果直接写业务表 | 无审计、无回滚；应落 `agent_conversations` 或走命令 |

---

## 4. 测评子系统

`packages/core/assessment/`（14 文件 / 1,835 行）。

| 文件 | 作用 |
| --- | --- |
| `types.ts` | 测评领域类型 |
| `registry-service.ts` | 题型注册表（内置 5 种 + 插件题型共用同一实例） |
| `question-types/builtin.ts` | 内置题型的评分实现 |
| `question-types/registry.ts` | 注册/查找 |
| `grading.ts` | 评分入口 |
| `item-analysis.ts` | 题目质量分析（难度/区分度） |
| `normalize.ts` / `serialize.ts` | 答案归一化与序列化 |
| `snapshot.ts` | 试卷快照（防改题后历史成绩错乱） |
| `timing.ts` | 作答计时 |
| `settings.ts` | 测评设置 |
| `anonymous.ts` | 匿名阅卷 |

**题型注册表的注册点是内核**（`packages/core/kernel/index.ts` L300，
`IAssessmentGraderRegistryToken`），不在 `server.ts` —— 因为 canary 测试要求它早于服务启动可解析。

### 4.1 相关表

```text
assessments  assessment_items  assessment_assignments  assessment_attempts
assessment_answers  question_bank_items  exams  exam_scores
lesson_quiz_submissions  courseware_attempt  courseware_score_config
```

### 4.2 相关路由

`server/routes/assessments.ts`（502 行）：

| 前缀 | 端点数量 |
| --- | --- |
| `/api/assessments` | 10 |
| `/api/assessment-assignments` | 10 |
| `/api/assessment-attempts` | 9 |
| `/api/question-bank` | 4 |
| `/api/assessment-question-types` | 1 |

**插件要加题型**：实现评分器 → 注册进 `IAssessmentGraderRegistryToken` → 题型出现在
`GET /api/assessment-question-types`。不要改 `builtin.ts`。

---

## 5. 作业与评分

`packages/core/assignment/`（1 文件 / 264 行）+ `packages/core/db/assignment-grade-writer.ts`。

| 关注点 | 位置 |
| --- | --- |
| 提交与重交 | `packages/core/db/assignment-resubmit.ts` |
| 评分写入 + 历史 | `packages/core/db/assignment-grade-writer.ts`（对应表 `assignment_grade_history`） |
| AI 评分命令 | `packages/plugins/assignment-eval.ts`（1,263 行，命令 `assignment.grade`） |
| 路由 | `server/routes/assignments.ts`（132）、`assignment-hub.ts`（394）、`grading.ts`（333） |
| 同伴互评 | `server/routes/classroom-peer-review.ts`（631） |

**成绩写入必须经 `assignment-grade-writer`**：它同时写 `assignment_submissions` 与
`assignment_grade_history`。直接 `UPDATE assignment_submissions SET score=?` 会丢审计链。

---

## 6. 活动生态（AI 与插件之外的第三类扩展）

`packages/activity-ecosystem/`（7 文件 / 768 行）提供 `IActivityRegistry`，
让「研究活动」类扩展注册自己的描述符，供 `/api/activities` 与工作台消费。

| 事实 | 说明 |
| --- | --- |
| Token 名 | `@openlearn/activity-ecosystem:IActivityRegistry` |
| 解析方式 | **只能按名字** resolve（对象不在白名单） |
| 路由 | `GET /api/activities?role=`（`os.ts` L146） |
| 相关表 | `lianyun_research_activities` / `_groups` / `_submissions` / `_reviews`（均在 40 张黑名单内） |

插件若想读取活动的分组信息，正确路径是 `ctx.resolve(IActivityRegistryToken as any)`
再降级到只读 SQL（示例见 [../examples/lab-seat-walkthrough.md](../examples/lab-seat-walkthrough.md) §6.3）。
