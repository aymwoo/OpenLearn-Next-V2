# 测评域扩展插槽设计稿（Draft for Review）

- **状态**：已实现（P0 / P1 / P2；题型 UI 声明式化按 Q7 单独立项，未在本轮落地）
- **提出日期**：2026-11-24
- **基线**：平台 `0.7.17` / SDK `3.8.0` / 槽位契约 `docs/agent/contracts/slots.json`（141 个固定槽位 + 8 个锚点）
- **配套契约**：[assessment-extension-slots.contract.json](./assessment-extension-slots.contract.json)
- **范围**：测评中心（测试 / 考试 / 问卷）的题库、组卷、发布、作答、批改、统计六段界面，以及题型扩展通道

---

## 0. 结论先行

| 项               | 现状                                                                                                         | 本稿主张                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 测评域固定槽位   | **3 个**（`assessment.list.card` / `assessment.attempt.toolbar` / `assessment.stats.card`），占全部槽位约 2% | P0 先修 3 个既有槽位的缺陷，再按 P1/P2 增补 **13 个**新槽位        |
| 题库扩展面       | **0 个**（无槽位、无注册表、无宿主只读服务）                                                                 | P1 补齐题库工具栏 / 条目操作 / 导入源 / 筛选维度                   |
| 题型扩展         | 服务端 `IAssessmentGraderRegistry` + 前端 `ctx.ui.registerAssessmentQuestionType`（**仅 inline**）           | 增加 manifest 声明式题型 UI（`view` 驱动），让远程 ZIP 插件可用    |
| 插件读数据       | 无合法路径（测评相关表不在插件前缀内，SQL guard 拒绝）                                                       | 新增只读服务 `IAssessmentReadService`（宿主派生身份 + 白名单投影） |
| 领域事件         | 无                                                                                                           | 新增 5 个 `assessment.*` 事件                                      |
| 已暴露但 UI 未接 | 抽题规则、项分析、试卷导入导出、题库 tags/difficulty                                                         | 作为 P1/P2 槽位的天然切入点                                        |

> 关键判断：**「有没有槽位」不是主要矛盾，「槽位能不能被第三方插件用起来」才是。**
> 现有 3 个槽位声明了 `commandType`，但通用渲染分支只认 `component / render / view`，
> 纯数据声明会静默不显示。本稿把「远程插件可用」作为每条槽位的验收条件之一。

---

## 1. 现状与缺陷（源码证据）

### 1.1 现有 3 个槽位

| 槽位                         | 真实挂载点                                                                                                                | 实际 props                               | 容器语义 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- |
| `assessment.list.card`       | [AssessmentCenter.tsx:302](../../src/features/assessment/AssessmentCenter.tsx#L302)（**仅教师端**）                       | `{ assessment, viewer:'teacher', lang }` | 卡片内嵌 |
| `assessment.stats.card`      | [StatsPanel.tsx:112](../../src/features/assessment/StatsPanel.tsx#L112)                                                   | `{ assignmentId, stats, lang }`          | 卡片     |
| `assessment.attempt.toolbar` | [StudentAssessmentsView.tsx:625](../../src/features/assessment/student/StudentAssessmentsView.tsx#L625)（**顶部**头部条） | `{ assignmentId, attemptId, lang }`      | 行内     |

类型定义：[types.ts:218-221](../../src/plugin-host/types.ts#L218-L221)；
安全投影：[extension-slot-props.ts](../../src/features/assessment/extension-slot-props.ts)。

### 1.2 题型通道

- 服务端：[assessment-model.md §4](./assessment-model.md)，`registerQuestionType(def, { pluginId })`，停用链 `revokePluginQuestionTypes` 回收。
- 前端：[question-type-ui-registry.tsx](../../src/features/assessment/question-type-ui-registry.tsx)，与服务端共用同一个 `type` 字符串。
- 限制：远程沙箱 `ctx.ui` 只有 `registerExtensionPoint` / `showToast`（[extension-registry.md §0](../plugin/extension-registry.md)），**ZIP 插件无法注册 React 编辑器/作答组件**，只能退化为 JSON 文本框。

### 1.3 已知缺陷（本稿要求一并处理或在评审中明确取舍）

| #   | 缺陷                                                  | 证据                                                                                                                                                                                                                                                                                                                                                                                          | 影响                               |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| D1  | `assessment.list.card` 的 `viewer:'student'` 是死代码 | 学生端从未渲染该槽位（[plugin-ui-extension-slots.md §12.1](../reference/plugin-ui-extension-slots.md)）                                                                                                                                                                                                                                                                                       | 按学生分支写的插件逻辑永远不生效   |
| D2  | 三个测评槽位声明了 `commandType` 但不会渲染           | [contribution-registry.ts:676-699](../../packages/core/plugin-host/contribution-registry.ts#L676-L699) 声明；manifest 条目 `component = NullExtensionComponent`（[plugin-host.ts:232-248](../../src/plugin-host/plugin-host.ts#L232-L248)）；通用分支要求 `component/render/view`（[extension-point-renderer.tsx:1188-1196](../../src/plugin-host/extension-point-renderer.tsx#L1188-L1196)） | 纯数据插件「声明成功、界面空白」   |
| D3  | 文档写 `attempt.toolbar` 在底栏，实际在顶栏           | 同 D1 文档 vs 上文 1.1                                                                                                                                                                                                                                                                                                                                                                        | 插件布局与预期不符                 |
| D4  | 题库 0 扩展面                                         | `QuestionBankPanel.tsx` 无 `ExtensionPointRenderer`                                                                                                                                                                                                                                                                                                                                           | 题库无法被生态增强                 |
| D5  | 插件无测评只读路径                                    | 可解析 token 仅 `IAssessmentGraderRegistryToken`；`question_bank_items` / `assessments` 不属插件前缀，SQL guard 拒绝                                                                                                                                                                                                                                                                          | 插件只能被动出题，不能做分析/联动  |
| D6  | 无测评领域事件                                        | `assessment-service.ts` 无 `eventBus.publish`                                                                                                                                                                                                                                                                                                                                                 | 错题本、家校通知、积分联动无从触发 |
| D7  | 后端能力已具备、UI 未接                               | 抽题 `settings.draw`、`/item-analysis*`、`/paper/export                                                                                                                                                                                                                                                                                                                                       | import`、题库 `tags/difficulty`    | 扩展点缺少入口，教师也用不到 |

---

## 2. 设计原则（所有新槽位必须满足）

1. **白名单投影**：props 由宿主显式构造，新增字段默认不可见；`answerKey` / `raw answer_key_json` / 逐生作答默认**永不进入** props。
2. **远程优先**：每个槽位从立项起就支持 manifest 声明式 `view: 'storage/*.html'`；`commandType` 按钮在 P0 修复后必须可用。React 组件路径只作为 inline 内建插件的增强，不作为验收前提。
3. **容器语义对齐 `layoutVariant`**：`Panel` / `WhiteboardWidget` / `FloatingOverlay` / `ActionItem` 四类，浮层严禁 `w-full/h-full`（[plugin-ui-extension-slots.md §1.1.1](../reference/plugin-ui-extension-slots.md)）。
4. **身份由宿主派生**：任何涉及「谁在看/谁在批改」的服务调用，actor 由宿主会话推导，插件不得自报 `userId/role`。
5. **空态与失败隔离**：无贡献不占位；单扩展崩溃走独立 ErrorBoundary + 熔断，不影响测评主流程。
6. **同源契约**：槽位名、props 类型、manifest 键、`slots.json`、文档五处同 PR 更新，`drift_count` 保持 0。

---

## 3. 阶段划分

| 阶段   | 内容                                       | 目标                                        | 破坏性                     |
| ------ | ------------------------------------------ | ------------------------------------------- | -------------------------- |
| **P0** | 修 D1/D2/D3 + 只读服务 + 领域事件          | 让既有 3 个槽位真正可用，并给出合法读写通道 | 无数据模型变更；事件为新增 |
| **P1** | 题库域 5 槽位 + 组卷/发布 3 槽位           | 覆盖「录题 → 组卷 → 发布」                  | 纯新增                     |
| **P2** | 批改/统计/学生端 5 槽位 + 题型 UI 声明式化 | 覆盖「作答 → 批改 → 复盘」                  | 题型 UI 为新增能力         |

---

## 4. 槽位详设

### 4.1 P0：修既有（不新增槽位）

| 项             | 方案                                                                                                                                                                     | 验收                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| D1 学生端列表  | 复用 `assessment.list.card`，在 `EntryCard` 渲染，`viewer: 'student'`；props 仅 `assessment` 摘要（与教师同构，**不含成绩明细**）                                        | 学生列表出现插件卡片；`viewer` 断言为 `student`          |
| D2 commandType | 在通用渲染分支增加「无 component/render/view 但声明 commandType → 渲染行内按钮」的兜底，复用 `frontendApi.post('/api/plugins/execute-command')` 与白板上下文菜单同款实现 | 三个测评槽位均可只声明 `{id,label,commandType}` 显示按钮 |
| D3 文档        | 修正 `attempt.toolbar` 位置描述为「顶部头部条」                                                                                                                          | 文档与调用点一致                                         |
| D2 附带        | `commandType` 必须全限定或由 manifest 桥接前缀化（[plugin-host.ts:237-243](../../src/plugin-host/plugin-host.ts#L237-L243)）                                             | 命令可派发，无 `COMMAND_NOT_REGISTERED`                  |

### 4.2 P1：题库域（当前为空）

| 槽位                             | layoutVariant | 挂载点                             | props（白名单）                                          | 典型用途                              |
| -------------------------------- | ------------- | ---------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| `assessment.bank.toolbar.action` | ActionItem    | 题库面板标题行右侧                 | `{ filters, lang, dispatcher }`                          | 批量导入、AI 批量生成、批量打标、去重 |
| `assessment.bank.item.action`    | ActionItem    | 题库每条目行操作区（删除按钮左侧） | `{ item: BankItemSummary, lang, dispatcher }`            | 加入试卷、复制、查看来源、编辑扩展    |
| `assessment.bank.import.source`  | ActionItem    | 「新增题库题目」卡片底部           | `{ lang, dispatcher }` + 声明字段 `extensions/mimeTypes` | 国家平台 / 校本题库 / Moodle 题库同步 |
| `assessment.bank.filter`         | ActionItem    | 题库筛选栏                         | `{ activeFilters, lang }`                                | 知识点、标签体系、难度维度扩展        |
| `assessment.bank.item.preview`   | Panel         | 题库条目预览抽屉                   | `{ item: BankItemSummary, lang }`                        | 插件题型的自定义预览                  |

`BankItemSummary`（只读投影）：

```ts
{
  id: string; type: string; stem: string;
  tags: string[]; difficulty: number | null;
  visibility: 'private' | 'school';
  ownerIsSelf: boolean;
  createdAt: number; updatedAt: number;
}
```

**禁止**：`config`（可能含答案线索）、`answerKey`、`answer_key_json`、`ownerId`、任何学生字段。

### 4.3 P1：组卷与发布

| 槽位                               | layoutVariant     | 挂载点                 | props                                                              | 典型用途                            |
| ---------------------------------- | ----------------- | ---------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `assessment.editor.item.addon`     | Panel（卡片内嵌） | 组卷逐题卡片底部       | `{ assessmentId, item: EditorItemSummary, lang, dispatcher }`      | 知识点标注、难度标注、AI 改编、配图 |
| `assessment.editor.settings.addon` | Panel（表单区）   | 「测评设置」区块底部   | `{ assessmentId, kind, settings, readOnly, onPatch, lang }`        | 抽题规则、防作弊参数、计分策略      |
| `assessment.publish.preflight`     | ActionItem / 清单 | 发布对话框确认按钮上方 | `{ assessmentId, classId, itemCount, totalScore, lang, onResult }` | 题库余量、题型未安装、满分异常校验  |

`EditorItemSummary`：`{ id, type, stem, maxScore, section, sortOrder }`（不含 `answerKey`）。

`onPatch` 契约：插件只能提交**补丁**，宿主负责白名单合并 + Zod/`settings.ts` 归一化；非法值回落默认，不因插件写入放宽约束。

`onResult` 契约：`{ level: 'error' | 'warn', code: string, message: string }`；`error` 阻止发布，`warn` 仅提示。插件不实现则不产生任何检查。

### 4.4 P2：批改、统计、学生端

| 槽位                                | layoutVariant      | 挂载点                     | props                                                        | 典型用途                            |
| ----------------------------------- | ------------------ | -------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| `assessment.grading.toolbar.action` | ActionItem         | 批改面板顶部「刷新」左侧   | `{ assignmentId, attempts, refresh, lang }`                  | AI 批量初评、批改报告导出           |
| `assessment.grading.answer.addon`   | Panel（卡片内嵌）  | 逐题批改卡片、评分表单下方 | `{ attemptId, item: GradingItemView, onScoreChange, lang }`  | 代码运行结果、查重报告、音视频回放  |
| `assessment.stats.item.addon`       | Panel（行内附加）  | 逐题统计表每行下方展开区   | `{ assignmentId, item: StatsItemView, lang }`                | 难度/区分度、知识点掌握度、错因分析 |
| `assessment.attempt.question.addon` | ActionItem / Panel | 学生每题作答区旁           | `{ assignmentId, attemptId, itemId, itemType, index, lang }` | 草稿纸、计算器、公式输入            |
| `assessment.result.item.addon`      | Panel（卡片内嵌）  | 学生结果页逐题解析下方     | `{ assignmentId, attemptId, item: ResultItemView, lang }`    | 解析、知识点推荐、加入错题本        |

**教师可见 vs 学生可见的边界**：

- `GradingItemView` **允许**含 `answerKey`（教师批改场景，与 `TeacherItemDetail` 同源），但必须是**教师角色**且由宿主注入。
- `ResultItemView` 的 `answerKey` 仅在 `resultVisibility` 允许且 `showAnalysis` 为真时出现；否则字段缺省（不是空字符串）。
- `attempt.question.addon` **不含** `config` 中的答案字段与 `answerKey`，只给定位信息。
- 统计扩展采用**行内附加**而不是「任意追加列」，避免多插件列数/表头协调（见评审问题 Q5）。

### 4.5 题型扩展增强（P2，已实现 2026-11-25）

目标：让远程 ZIP 插件也能交付一个「有编辑器、有作答组件」的题型。

> 落地说明：manifest 键为 `assessment.question_type`（严格 A 组，不属于渲染槽位），
> 沙箱页面通过 `window.OpenLearnPluginBridge.question` 的
> `getState / onUpdate / setConfig / setAnswerKey / setValue` 与宿主交换状态。
> 新增可选 `reviewView` 承载结果页逐题复盘；内联插件仍可用题型注册表的
> `Review` 组件位。`answerView` 永不接收 `answerKey`，`reviewView` 只读。
> 判分仍要求插件服务端 `registerQuestionType`（两段式注册）。

```json
// manifest.contributes
"assessment.question_type": [
  {
    "id": "ext-code:python",
    "label": "Python 代码题",
    "labelEn": "Python code",
    "category": "subjective",
    "supports": ["quiz", "exam"],
    "autoGradable": false,
    "editorView": "storage/question-editor.html",
    "answerView": "storage/question-answer.html",
    "reviewView": "storage/question-review.html"
  }
]
```

- `id` 必须满足服务端题型命名规则（`<prefix>:<name>`），且与服务端已注册的题型 `type` 完全一致，否则声明无效并告警。
- 两个/三个 `view` 走现有桥接；桥接 op：`question.setConfig` / `question.setAnswerKey` / `question.setValue`，仅在该题型上下文内可调用。
- 不改变既有 `ctx.ui.registerAssessmentQuestionType` 的 inline 行为；两者同 `type` 时**inline 优先**（内建插件可覆盖，停用后回退 manifest 版本）。

---

## 5. 服务与事件契约（P0）

### 5.1 `IAssessmentReadService`（只读）

```ts
interface IAssessmentReadService {
  listAssessments(actor: HostActor, filter?: { kind?: string; status?: string }): Promise<AssessmentBrief[]>;
  getAssessmentBrief(actor: HostActor, assessmentId: string): Promise<AssessmentBrief>;
  listAssignments(actor: HostActor, assessmentId: string): Promise<AssignmentBrief[]>;
  getAssignmentStats(actor: HostActor, assignmentId: string): Promise<StatsProjection>;
  listBankItems(actor: HostActor, filter?: BankFilter): Promise<BankItemSummary[]>;
  getAttemptSummary(actor: HostActor, attemptId: string): Promise<AttemptSummary>;
}
```

约束：

- `actor` 由宿主注入（会话派生），插件拿不到伪造入口。
- 教师视角按 `owner_id` 校验归属；学生视角只能读自己的 `attempt`。
- 返回值全部走白名单投影，`answerKey` 永不出现。
- 需要新能力串 `assessment:read`（见 §6）；未授予时服务为 `null`（与 `roster` 同款降级）。

### 5.2 领域事件

| 事件                              | 载荷（不含答案/逐生作答）                                                    | 触发点                              |
| --------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| `assessment.assignment.published` | `{ assessmentId, assignmentId, classId, lessonId, kind, opensAt, closesAt }` | `publish()`                         |
| `assessment.assignment.released`  | `{ assignmentId, classId, releasedAt }`                                      | `release()`                         |
| `assessment.assignment.closed`    | `{ assignmentId, classId, closedAt }`                                        | `close()`                           |
| `assessment.attempt.submitted`    | `{ assignmentId, attemptId, submittedAt, needsManualReview }`                | `submit()`                          |
| `assessment.attempt.graded`       | `{ assignmentId, attemptId, score, maxScore, needsManualReview }`            | 自动判分 / `regrade` / 人工批改落分 |

`studentId` **默认不进入**载荷（见评审问题 Q4）；需要学生维度的插件通过 `assessment:read` + `student-data:read` 二次取数。

---

## 6. Manifest 与能力变更

| 变更            | 内容                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| manifest 新增键 | `contributes['assessment.bank.toolbar.action']` 等 13 个新键；`contributes['assessment.question_type']`                       |
| 现有键          | 保留 `assessment.list.card` / `assessment.attempt.toolbar` / `assessment.stats.card`，schema 继续 `passthrough` 以支持 `view` |
| 新增能力串      | `assessment:read`（只读服务 + 统计）；写入类暂不开放（见 Q3）                                                                 |
| 最低宿主版本    | P0 完成后为新版；新槽位文档需标注 `engines.openlearn` 最小值                                                                  |

能力串变更必须同步：`packages/core/capability/catalog.ts`（31 → 32）、`docs/agent/contracts/capabilities.json`、`docs/reference/plugin-capability-matrix.md`、`assertValidManifestCapabilities` 相关测试。

---

## 7. 兼容性与迁移

- 新增槽位不影响既有插件：未声明即不渲染。
- `assessment.list.card` 学生端启用后，教师端行为不变。
- `commandType` 兜底改造会改变「声明了但空白」的现状——这是**修复**而非破坏；需在 CHANGELOG 标注。
- 事件为新增，订阅方可以忽略。
- 不新增数据表；不修改 `assessments` / `question_bank_items` 结构。

---

## 8. 安全边界（评审红线）

1. 插槽 props 一律白名单构造，**不得**把 DB 行对象直接 `...spread` 给插件。
2. 学生端槽位不得携带其他学生的身份、成绩、作答。
3. 教师端 `answerKey` 只在批改/组卷场景显式提供，且必须 `viewer === 'teacher'`。
4. 学生端 `view` 的 CSP 维持 `connect-src 'none'`，只能通过宿主代发请求。
5. 新增桥接 op 必须限定作用域（题型上下文 / 当前 attempt），拒绝任意 id 探测。
6. 事件 payload 禁止携带标准答案与作答正文。

---

## 9. 测试与审计计划

| 层   | 用例                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 单元 | 每个投影函数用哨兵字段断言不含 `answerKey` / `studentId` / `answer_key_json`                                                    |
| 渲染 | 每个新槽位至少一条「教师 / 学生」可见性断言 + 空态断言                                                                          |
| 契约 | `manifestSchema.parse` 保留每个槽位的 `view` 字段（遍历全部新键，不只测一个）                                                   |
| 服务 | 归属校验（跨教师 / 跨学生 / 未授权班级）+ 能力未授予时为 `null`                                                                 |
| 事件 | 发布/交卷/判分各触发一次，payload 形状断言，无答案字段                                                                          |
| 审计 | `python3 audit-tools/agent_facts.py --check` / `bash scripts/build-docs.sh` / `pnpm lint` / `pnpm test` 全绿，`drift_count = 0` |

---

## 10. 每个槽位的落地清单（实现时逐项打勾）

1. `src/plugin-host/types.ts`：`ExtensionSlot` 联合 + `*SlotProps`
2. 真实调用点：`ExtensionPointRenderer`（确认容器语义与 `locked` / `excludePluginIds` 传参）
3. `packages/core/esm-loader/manifest-schema.ts`：`frontendSlotsShape` 新键
4. `packages/core/plugin-host/contribution-registry.ts`：`*Config` + 联合类型
5. `docs/reference/plugin-ui-extension-slots.md`：挂载点 / props / 坑
6. `docs/agent/contracts/slots.json` + `assets/test-harness/slot-registry.json`
7. 回归测试：投影哨兵 + 可见性 + `view` 保留
8. `CHANGELOG.md`：`### Features`

---

## 11. 评审问题（需要拍板）

| #   | 问题                                                                            | 选项                                                        | 推荐                                                     |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Q1  | 学生端列表复用 `assessment.list.card` 还是新增 `assessment.student.list.card`？ | A 复用（修死代码）/ B 新增（语义清晰、多一个槽位）          | **A**：复用槽位 + 判别联合 props；详见 §13               |
| Q2  | 组卷/批改槽位是否允许 `answerKey` 进入 props？                                  | A 永不 / B 分级 + 显式申请                                  | **B**：L0 硬禁止 / L1 默认不含 / L2 声明后授予；详见 §14 |
| Q3  | 新增 `assessment:read` 能力串，还是复用现有能力？                               | A 新增（语义清晰）/ B 复用 `lesson:read` / C 不复用也不校验 | **A**：与 `roster` 的服务级降级模型一致                  |
| Q4  | 事件载荷是否带 `studentId`？                                                    | A 不带（按能力二次取）/ B 带（方便错题本）                  | **A**：默认最小暴露                                      |
| Q5  | 统计表扩展用「行内附加」还是「整列追加」？                                      | A 行内附加 / B 列扩展（需表头协调）                         | **A**：避免多插件列冲突                                  |
| Q6  | P0 是否包含 `commandType` 渲染器改造？                                          | A 包含 / B 推迟到 P1                                        | **A**：不做则新老槽位都对数据插件无效                    |
| Q7  | 题型 UI 声明式化（bridge op 扩展）是否单独立项？                                | A 单独提案 / B 并入本稿 P2                                  | **A**：涉及沙箱 op 白名单，风险面独立                    |

---

## 12. 附：与现行文档的差异（顺带修正）

- `plugin-ui-extension-slots.md §1.1.1` 写「140 个槽位」，契约文件实际为 **141 个固定槽位 + 8 个锚点**。
- 同文档 `assessment.attempt.toolbar` 位置描述与调用点不一致（见 D3）。
- 同文档 §12.1 已正确标注 `viewer` 学生分支为死代码；本稿 P0 修复后需同步删除该警告。

---

## 13. Q1 详设：学生端列表复用 `assessment.list.card`

### 13.1 决策

**复用 `assessment.list.card`，props 改为按 `viewer` 判别的联合类型。** 不新增 `assessment.student.list.card`。

原因不是「槽位已经够多」，而是：

1. 学生与教师看到的都是「一张测评卡片」，语义同构；差异只在**数据形状**，不在交互模型。
2. 新增槽位会让 manifest 键、props 类型、文档、测试、`slots.json` 全部翻倍，但换来的只是少一个 `viewer` 分支。
3. 学生分支此前是死代码（D1），**没有任何存量插件依赖**，因此把 `viewer` 从「装饰字段」升级为「判别字段」的破坏面为零。

### 13.2 必须先解决的数据形状差异

| 字段     | 教师 `AssessmentSummary`                                                                       | 学生 `StudentAssignmentEntry`                                                                             |
| -------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 主键     | `id`（assessmentId）                                                                           | `assignmentId` + `assessmentId`                                                                           |
| 共有     | `kind` / `title`                                                                               | `kind` / `title`                                                                                          |
| 教师独有 | `description` / `status` / `itemCount` / `totalScore` / `settings` / `createdAt` / `updatedAt` | —                                                                                                         |
| 学生独有 | —                                                                                              | `classId` / `lessonId` / `opensAt` / `closesAt` / `durationSec` / `windowState` / `completed` / `attempt` |

`/api/me/assessments` 当前**不返回** `description` / `itemCount` / `totalScore` / `settings`（[assessment-service.ts:991](../../server/services/assessment-service.ts#L991)）。
不要在扩展槽位里临时补聚合查询：`itemCount` / `totalScore` 在教师侧也是逐卷 `items.length` 算出来的，给学生列表再加一次是纯浪费。

### 13.3 Props 设计（判别联合）

```ts
export interface AssessmentCardCommon {
  lang?: 'zh' | 'en';
  dispatcher?: IHostActionDispatcher;
}

export interface TeacherAssessmentCardProps extends AssessmentCardCommon {
  viewer: 'teacher';
  assessment: {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    status: string;
    itemCount: number;
    totalScore: number;
    settings: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
  };
}

export interface StudentAssessmentCardProps extends AssessmentCardCommon {
  viewer: 'student';
  assessment: {
    /** 学生侧的主键是 assignmentId；assessmentId 单独给出用于回溯试卷 */
    id: string;
    assessmentId: string;
    kind: string;
    title: string;
    classId: string;
    lessonId: string | null;
    windowState: 'before_open' | 'open' | 'after_close' | 'untimed';
    completed: boolean;
    opensAt: number | null;
    closesAt: number | null;
    durationSec: number | null;
  };
  attempt: {
    attemptNo: number;
    status: string;
    submittedAt: number | null;
    /** 服务端已按可见性置 null，扩展不要自行推断 */
    score: number | null;
    maxScore: number | null;
    needsManualReview: boolean;
  } | null;
}

export type AssessmentListCardSlotProps = TeacherAssessmentCardProps | StudentAssessmentCardProps;
```

关键点：

- `viewer` 是**判别字段**，插件必须写 `if (props.viewer === 'student')` 才能访问学生字段，TS 穷尽检查生效。
- 学生侧 `id` 明确等于 `assignmentId`，与教师侧 `id`（assessmentId）语义不同——这是最容易踩的坑，必须在文档里写死。
- `attempt.score` 已由 `toStudentAttemptView` 按 `canStudentSeeScore()` 置空（[serialize.ts](../../packages/core/assessment/serialize.ts#L158)），槽位**不得**再暴露 `attempts` 或 `studentId`。
- **不提供** `settings`：其中含 `draw`（抽题规则）、`strictProctor` 等运营配置，对学生和扩展都不必要。

### 13.4 投影函数

在 [extension-slot-props.ts](../../src/features/assessment/extension-slot-props.ts) 新增：

```ts
export function toStudentAssessmentCardProps(entry: StudentAssignmentEntry): StudentAssessmentCardProps {
  return {
    viewer: 'student',
    assessment: {
      id: entry.assignmentId,
      assessmentId: entry.assessmentId,
      kind: entry.kind,
      title: entry.title,
      classId: entry.classId,
      lessonId: entry.lessonId,
      windowState: entry.windowState,
      completed: entry.completed,
      opensAt: entry.opensAt,
      closesAt: entry.closesAt,
      durationSec: entry.durationSec,
    },
    attempt: entry.attempt
      ? {
          attemptNo: entry.attempt.attemptNo,
          status: entry.attempt.status,
          submittedAt: entry.attempt.submittedAt,
          score: entry.attempt.score,
          maxScore: entry.attempt.maxScore,
          needsManualReview: entry.attempt.needsManualReview,
        }
      : null,
  };
}
```

教师侧保留现有 `toAssessmentListCardProps`，只需把返回类型显式标注为 `TeacherAssessmentCardProps`。

### 13.5 渲染点改造（EntryCard）

`EntryCard` 目前是「横向 flex + 右侧按钮」的单行结构（[StudentAssessmentsView.tsx:260](../../src/features/assessment/student/StudentAssessmentsView.tsx#L260)）。挂载扩展必须加一层纵向容器，否则扩展会挤在按钮旁边：

```tsx
return (
  <div
    data-testid={`student-assessment-${entry.assignmentId}`}
    className="bg-surface border border-theme rounded-xl px-4 py-3 flex flex-col gap-2"
  >
    {/* 原横向主行保持不变 */}
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">{/* 原有横向主行内容保持不变 */}</div>

    {/* 扩展行：有贡献才占位，由 Renderer 自行返回 null */}
    <ExtensionPointRenderer
      slot="assessment.list.card"
      slotProps={{
        ...toStudentAssessmentCardProps(entry),
        lang,
        classId: entry.classId,
        lessonId: entry.lessonId,
      }}
      excludePluginIds={hiddenPluginIds}
      excludeExtensionIds={hiddenExtensionIds}
      lang={lang}
    />
  </div>
);
```

### 13.6 必须一起修的四个隐藏坑

| #   | 坑                                   | 现状                                                                                                                                                                           | 修法                                                                                                            |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 1   | `view` 分支不读 `slotProps.lessonId` | 通用分支硬编码 `lessonId={selectedLesson}`（[extension-point-renderer.tsx:1263](../../src/plugin-host/extension-point-renderer.tsx#L1263)），`classId` 却可用 `slotProps` 覆盖 | 改为 `lessonId: slotProps?.lessonId ?? selectedLesson`，与 `classId` 对齐                                       |
| 2   | 学生可见性策略没传进来               | `StudentAssessmentsView` 无 `studentUiPolicy` 参数（[StudentView.tsx:112](../../src/features/student/StudentView.tsx#L112) 只传 `lang/onExit`）                                | 增加可选 prop，从 `StudentView` 透传 `hiddenPlugins/hiddenExtensions`                                           |
| 3   | 每条一个 iframe                      | 列表可能有几十条，`view` 型扩展会挂几十个沙箱                                                                                                                                  | 契约里明确「必须折叠态」：默认只渲染小按钮，展开才 `ui.resize`；或宿主在 `entries.length > 50` 时只渲染前 50 条 |
| 4   | 课堂内复用                           | `StudentAssessmentsView` 也被 `StudentInteractiveOverlay` 使用                                                                                                                 | 该场景无 `studentUiPolicy`，按「空策略 = 全部可见」处理，并在文档说明                                           |

### 13.7 文件级改动清单（Q1）

| 文件                                                         | 改动                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/features/assessment/extension-slot-props.ts`            | 新增学生投影；教师投影标注返回类型                              |
| `src/plugin-host/types.ts`                                   | `AssessmentListCardSlotProps` 改判别联合；拆出两个接口          |
| `src/features/assessment/student/StudentAssessmentsView.tsx` | `EntryCard` 加纵向容器 + 槽位；新增 `studentUiPolicy` 可选 prop |
| `src/features/student/StudentView.tsx`                       | 传入 `studentUiPolicy`                                          |
| `src/plugin-host/extension-point-renderer.tsx`               | `view` 分支 lessonId 支持 `slotProps` 覆盖                      |
| `docs/reference/plugin-ui-extension-slots.md`                | 删除「学生端从未渲染」警告；补 props 判别说明                   |
| `docs/agent/contracts/slots.json`                            | 无需新增槽位（沿用旧 id），但 props 文档需更新                  |

### 13.8 边界与失败模式

- **匿名问卷**：`score/maxScore` 为 null；扩展不得以「null = 0 分」渲染。
- **未开始 / 已截止**：以 `windowState` 为准，扩展不得用 `Date.now()` 自行判断。
- **单扩展崩溃**：独立 `ErrorBoundary`，不阻断 `onOpen` 进入作答。
- **空态**：无贡献时 Renderer 返回 null，`gap-2` 不额外留白。
- **排序**：`position` 升序；同一卡片建议最多 2 个扩展（文档建议，不硬限制）。

### 13.9 测试

1. 投影哨兵：`answerKey` / `answer_key_json` / `studentId` / `settings` 不出现在学生 props。
2. `score` 在 `resultVisibility=after_release` 且未发布时为 `null`。
3. 教师列表 `viewer === 'teacher'`；学生列表 `viewer === 'student'`，两者互不串。
4. `hiddenPlugins` 命中的插件在学生列表不渲染。
5. `view` 型扩展收到 `entry.lessonId`（验证 renderer 修复）。
6. 教师端现有 `AssessmentCenter` 测试不改断言仍绿。

### 13.10 如果仍选 B（新增槽位）

代价：多 1 个 `ExtensionSlot` 成员、1 个 `*SlotProps`、1 个 manifest 键、1 行 `slots.json`、1 套文档、2 条以上测试；收益是插件少写一个 `viewer` 分支。
在「学生分支本来就是死代码」的前提下，这个交换不划算，因此推荐 A。

---

## 14. Q2 详设：敏感字段（`answerKey` / `config` / 学生作答）

### 14.1 决策：分级 + 显式申请

不采用「教师槽位一律放行」，也不采用「永不放行」。三档：

| 档位                | 含义                                | 适用槽位                                                                                                                                                                                          |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L0 硬禁止**       | 无论声明什么，都不构造敏感字段      | 全部学生可见槽位（`assessment.list.card` 学生分支、`assessment.attempt.toolbar`、`assessment.attempt.question.addon`、`assessment.result.item.addon`、`assessment.bank.*` 不含学生的槽位仍按 L1） |
| **L1 默认不含**     | props 不含敏感字段；声明也不生效    | `assessment.stats.item.addon`、`assessment.grading.toolbar.action`、`assessment.publish.preflight`、`assessment.editor.settings.addon`                                                            |
| **L2 声明后可授予** | 扩展显式声明 + 宿主校验通过后才注入 | `assessment.grading.answer.addon`、`assessment.editor.item.addon`                                                                                                                                 |

> 与初稿的差异：初稿只把 `assessment.grading.answer.addon` 放进 L2。细化后建议把 `assessment.editor.item.addon` 也纳入 L2 —— 它和批改一样是**教师编辑面**，宿主 UI 本来就在同一张卡片里展示/编辑 `answerKey`，禁掉只会让「AI 改编答案」这类正当用例无法实现。但两者都必须显式声明。

### 14.2 为什么「角色是教师」不够

1. **插件是第三方代码**，以教师权限运行；教师的可见性不等于插件的必要性。
2. `rolesAllowed` 是渲染期过滤，配置错误时不会报错，只会静默多暴露。
3. 出站通道存在：管理员批准域名后，进程插件可由宿主代发请求；服务端插件也可写自己的表。一旦 props 默认含答案，任何「只想显示徽章」的扩展都拿到了全卷答案。
4. 结论：**默认不构造** 是唯一可靠的默认值；授予必须是显式、可审计的动作。

### 14.3 敏感字段分类

| 字段              | 敏感原因                                       | 典型需要者              |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `answerKey`       | 标准答案；泄露即作弊                           | 批改辅助、AI 改编       |
| `config`          | 插件题型的 config 可能含测试用例/评分细则/答案 | 代码题判分展示、AI 改编 |
| `studentAnswer`   | 学生个人作答（个人数据）                       | 查重、代码运行、AI 评语 |
| `studentIdentity` | `studentId` / 姓名（个人身份）                 | 家校通知、错题本        |

`config` 对内置题型通常只有 `options`（题干已可见），但**按最敏感类型处理**：无法在运行时可靠区分「这个 config 里有没有答案」，所以统一归入 L2。

### 14.4 槽位 × 字段矩阵

| 槽位                                        | `answerKey`                               | `config` | `studentAnswer`                | `studentIdentity`           |
| ------------------------------------------- | ----------------------------------------- | -------- | ------------------------------ | --------------------------- |
| `assessment.grading.answer.addon`           | L2                                        | L2       | L2                             | L2                          |
| `assessment.editor.item.addon`              | L2                                        | L2       | —                              | —                           |
| `assessment.grading.toolbar.action`         | L0/L1                                     | L1       | L1（默认只给 `attempts` 摘要） | L1（`anonymousLabel` 优先） |
| `assessment.editor.settings.addon`          | L0                                        | L0       | —                              | —                           |
| `assessment.publish.preflight`              | L0                                        | L0       | L0                             | L0                          |
| `assessment.stats.item.addon`               | L0                                        | L0       | L0                             | L0（聚合统计）              |
| `assessment.result.item.addon`（学生）      | **条件性**：仅 `showAnalysis=true` 且声明 | L0       | 仅本人作答                     | 仅本人                      |
| `assessment.attempt.question.addon`（学生） | L0                                        | L0       | 仅本人（若声明）               | 仅本人                      |
| `assessment.bank.*`                         | L0                                        | L0       | —                              | —                           |

「L0/L1」表示：字段本身不在该槽位的语义内，即使声明也拒绝。

### 14.5 声明形状

**Manifest 声明式**：

```json
{
  "id": "ext-code/review",
  "label": "代码评审",
  "requiresSensitive": ["answerKey", "config", "studentAnswer"]
}
```

**运行期注册**（inline 插件）：

```ts
ctx.ui.registerExtensionPoint('assessment.grading.answer.addon', {
  id: 'ext-code/review',
  label: '代码评审',
  requiresSensitive: ['answerKey', 'config', 'studentAnswer'],
  component: () => import('./Review'),
});
```

落地要点：

1. `ExtensionPointConfig` 增加 `requiresSensitive?: SensitiveField[]`（[types.ts:293](../../src/plugin-host/types.ts#L293)）。
2. `frontendSlotEntrySchema` 已是 `passthrough`，`view` 与 `requiresSensitive` 都不会被 strip；但**安装期要按槽位做 allowlist 校验**，不能只靠 passthrough。
3. `contribution-registry` 的 `AssessmentGradingAnswerConfig` / `AssessmentEditorItemConfig` 增加同名字段，其他 `*Config` **不增加**（类型层面就拒绝）。
4. 非法组合（学生槽位声明 `answerKey`）→ 安装失败并给出明确错误码 `SENSITIVE_FIELD_NOT_ALLOWED_FOR_SLOT`；运行期注册 → 忽略 + `console.error`。

### 14.6 类型设计（编译期防线）

```ts
export type SensitiveField = 'answerKey' | 'config' | 'studentAnswer' | 'studentIdentity';

/** 基础视图：永远不含敏感字段 */
export interface GradingAnswerItemBase {
  itemId: string;
  type: string;
  stem: string;
  maxScore: number;
  score: number | null;
  isCorrect: boolean | null;
  needsManualReview: boolean;
  feedback: string | null;
  manualOverride: boolean;
}

/** 声明 + 授予后才有 sensitive 分支 */
export type AssessmentGradingAnswerAddonProps =
  | {
      sensitiveAccess: false;
      attemptId: string;
      item: GradingAnswerItemBase;
      onScoreChange?: (score: number) => void;
      lang?: 'zh' | 'en';
    }
  | {
      sensitiveAccess: true;
      attemptId: string;
      item: GradingAnswerItemBase & {
        answerKey: unknown;
        config: Record<string, unknown>;
        answer: unknown;
      };
      onScoreChange?: (score: number) => void;
      lang?: 'zh' | 'en';
    };
```

这样写的好处：

- 插件必须判 `sensitiveAccess` 才能访问 `answerKey`，TS 会拦住「忘记判空」。
- 宿主侧 `projectSensitive()` 返回的联合类型与 props 类型同源，不会出现「声明了但字段没赋值」。
- 学生槽位的 props 类型直接把敏感字段声明为 `never`（或不声明），编译期即拒绝。

### 14.7 运行时统一投影入口

新增 `src/features/assessment/sensitive-props.ts`，**所有** assessment 投影函数必须经过它：

```ts
export function projectAssessmentSensitive(input: {
  slot: AssessmentExtensionSlot;
  viewer: 'teacher' | 'student';
  role: 'teacher' | 'administrator' | 'student';
  extends: ExtensionPointConfig;
  granted: ReadonlySet<SensitiveField>; // 来自安装授予；未启用授予时为空集
  source: {
    answerKey?: unknown;
    config?: Record<string, unknown>;
    studentAnswer?: unknown;
    studentId?: string | null;
    studentName?: string | null;
  };
}): { sensitiveAccess: boolean; fields: Partial<Record<SensitiveField, unknown>> };
```

规则按顺序执行：

1. `viewer === 'student'` 且槽位属于 L0 → 直接返回空。
2. 槽位不在 L2 allowlist → 返回空（即使声明了）。
3. `role` 不是 `teacher/administrator` → 返回空。
4. `requiresSensitive` 未声明 → 返回空。
5. 声明字段 ∉ 槽位允许集合 → 该字段丢弃 + dev 警告。
6. 声明字段 ∉ `granted` → 该字段丢弃（未授予）。
7. 其余字段从 `source` 取；`source` 缺失时该字段不构造（不要给 `undefined` 占位）。

返回 `sensitiveAccess = 任意字段被注入`，供 props 判别使用。

### 14.8 授予与审计：两档方案

| 方案             | 做法                                                                                                                                                                | 成本                   | 建议                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| **MVP**          | 仅靠 manifest `requiresSensitive` 声明 + 宿主 allowlist                                                                                                             | 无迁移                 | 可接受，但管理员无法在安装时看到风险                |
| **加固**（推荐） | 安装向导展示「该插件申请读取标准答案/学生作答」并要求勾选；授予结果落 `plugins.sensitive_grants_json`（新列，可空）；授予/撤销写审计 `assessment.sensitive_granted` | 1 个可空迁移 + 安装 UI | 推荐，理由同 capabilitiesProposed 的「申请 ≠ 授予」 |

无论哪档，都**不要**新增 `assessment:answer_key` 这类能力串：能力串是服务端 ActionDescriptor 的闸门，与此处的前端 props 投影不是同一套机制，混用会造成两套授权状态。

### 14.9 失败模式与降级

| 场景                                 | 行为                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| 声明了但未授予                       | `sensitiveAccess: false`，扩展仍渲染，只是拿不到敏感字段 |
| 槽位不允许                           | 安装失败（manifest）或忽略（runtime）+ 明确错误码        |
| 字段缺失（如匿名问卷无 `studentId`） | 不构造该字段，不传 `null` 占位                           |
| 扩展崩溃                             | 独立 ErrorBoundary，不影响批改主流程                     |
| 扩展改分                             | 只能经 `onScoreChange`；宿主表单持有真实评分状态         |

### 14.10 测试矩阵

| 维度 | 用例                                                                                  |
| ---- | ------------------------------------------------------------------------------------- |
| 类型 | `@ts-expect-error`：在 `sensitiveAccess:false` 分支访问 `item.answerKey` 必须编译失败 |
| 投影 | 每个 L0 槽位注入 sentinel `answerKey`，断言 JSON 不含                                 |
| 投影 | L1 槽位即使声明也不含                                                                 |
| 投影 | L2 未声明 → 不含；声明未授予 → 不含；声明 + 授予 → 含                                 |
| 安装 | 学生槽位声明 `answerKey` → manifest 校验失败，错误码正确                              |
| 渲染 | `sensitiveAccess` 两个分支各一条渲染断言                                              |
| 回归 | `GradingPanel` 现有 AI 建议/保存评分行为不变                                          |
| 审计 | 授予/撤销各写一条 `assessment.sensitive_granted`                                      |

### 14.11 兼容性

- 现有 3 个槽位：`assessment.stats.card` 维持 L1；`assessment.list.card` / `assessment.attempt.toolbar` 为 L0（学生分支启用后也仍是 L0）。
- 不声明 `requiresSensitive` 的插件行为与今天一致（今天也没有这些槽位）。
- 若采用加固方案，`plugins.sensitive_grants_json` 为可空新列，历史插件默认无授予 → 不会突然拿到答案。
- `pnpm lint:strict` 会因为 `AssessmentListCardSlotProps` 变成联合类型而暴露存量插件分支——这是预期收益，不是回归。

### 14.12 最终建议

1. **Q2 = B（分级 + 显式申请）**。
2. L2 首批只开两个槽位：`assessment.grading.answer.addon`、`assessment.editor.item.addon`。
3. 首版可以采用 MVP（仅声明），但必须在文档里写明「管理员安装前应审查 `requiresSensitive`」；如果本季度能做安装向导，直接上加固方案。
4. 学生侧永远 L0；`assessment.result.item.addon` 的 `answerKey` 只跟随 `showAnalysis`，不接受插件声明覆盖。

---

## 15. 实施结果（2026-11-24）

| 项        | 落地情况                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 槽位数量  | `assessment.*` 由 3 个扩展到 **16 个**；槽位契约 `docs/agent/contracts/slots.json` 自动再生，`drift_count = 0`                                                                                      |
| Q1        | 按推荐 A 实现：`assessment.list.card` 改为判别联合；学生端 `EntryCard` 渲染；`studentUiPolicy` 透传；`view` 分支支持 `slotProps.lessonId` 覆盖（含显式 `null`）                                     |
| Q2        | 按推荐 B 实现：`requiresSensitive` + `projectAssessmentSensitive`；L2 为 `grading.answer.addon` / `editor.item.addon` / `result.item.addon`；**授予模型采用 MVP（声明即生效，未接入安装向导勾选）** |
| 敏感字段  | 学生槽位 L0；`result.item.addon` 只给本人字段且 `answerKey` 受 `showAnalysis` 约束                                                                                                                  |
| 只读服务  | `IAssessmentReadService` + `assessment:read`（方法级）；身份由 `currentLessonViewer()` 派生，接口**不接收 actor 参数**（与初稿不同，按平台既有安全模式收敛）                                        |
| 领域事件  | 5 个 `assessment.*` 事件已接入；`attempt.submitted` 仅在首次交卷时发布                                                                                                                              |
| 远程 view | 新增 `PluginSandboxIframeView.sandboxContext`（`init.context` / `context-update`，JSON 安全子集 ≤ 16KB）；否则 ZIP 插件只能拿到 lesson/class                                                        |
| 未落地    | 题型 UI 的 manifest 声明式化（Q7 推荐单独立项）；安装向导的敏感字段授予与审计（Q2 加固方案）                                                                                                        |
| 门禁      | `tsc --noEmit`、`tsc -p tsconfig.strict.json`、全量 vitest、`build-docs.sh -W`、`audit-tools/run.sh`（`drift_count=0`）、lint 预算均通过                                                            |
