# 平台侧扩展能力建设：学案槽位 + 远程题型 + 审查缺陷修复

## Context

前两轮讨论得出两个结论：

1. 学案编辑器只有 3 个活动类扩展槽，首页块、进度区、工具栏、卡片操作/角标、编辑弹窗底部、学生活动附加区都没有注入点；且既有 `xuean.activity.editor/student` 分支把调用点传入的 `lessonId/onSaved` 丢掉，远程 `view` 也拿不到活动上下文。
2. 连线题这类自定义题型，服务端判分 + 前端题型 UI 的通道已经存在，但前端 React 组件只对内联（inline）插件开放；第三方 ZIP 插件只能渲染 manifest `view`，无法交付可拖拽的作答组件。设计稿 §4.5 的 `assessment.question_type` 声明 + `question.*` 桥接尚未落地。

本轮只做平台侧：补齐 7 个学案槽位、打通远程题型 UI 通道、修复最近一次代码审查的 8 条缺陷。**不写任何插件业务代码。**

## 决策与边界

- 不修改 `packages/bridge-sdk/src/bridge.js`：它是课件 LMS Bridge，与插件 view 通道无关。插件 view 的桥接脚本在 `server/utils/plugin-view-bridge.ts`（手写模板字符串）。
- 远程题型仍需插件服务端 `registerQuestionType` 才能存题/判分；manifest 只解决 UI。文档必须写明“两段式注册”。
- 题型 `type` 必须满足服务端 `isValidPluginQuestionType`（`^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9_-]*$`），不能强制等于 scoped manifest id；只校验“含 `:`”并提示保持一致。
- 新增槽位五处同源：`src/plugin-host/types.ts`、`packages/core/esm-loader/manifest-schema.ts`、调用点、`docs/reference/plugin-ui-extension-slots.md`、`docs/agent/contracts/slots.json`（由脚本生成）。
- `answerKey` 永不进入学生 answer view；`review` 是否可见由 `showAnalysis` 决定。
- 复用现有模式：`sanitizeSandboxContext`、`renderTabPanelContent`、行内 `commandType` 兜底、`AssessmentGradingAnswerAddonProps` 判别联合。

---

## 批次 1：渲染器上下文与 manifest 顶层字段（C1、C2）

### C1 学案分发补上下文

文件：`src/plugin-host/extension-point-renderer.tsx`

- `renderTabPanelContent(activeExt, extraProps, fallbackText, baseProps?)` 增加第 4 参：
  - `mergedProps = { ...activeExt.slotProps, ...extraProps, ...baseProps, dispatcher }`
  - iframe 分支补 `sandboxContext={mergedProps}`、`studentId`、`studentName`
  - `fallbackText` 同时作为 ErrorBoundary fallback
- 学案分支改为按白名单传：`{ activityType, activity, lessonId, onSaved, lang }`，不再只传 `{ activity }`。
- 新增 `SANDBOX_CONTEXT_BUDGET`（按槽位给字节预算，学案槽位 64KB，其余沿用 16KB），传给 `PluginSandboxIframeView` 的新 prop `maxContextBytes`。
- `src/components/PluginSandboxIframeView.tsx`：`sanitizeSandboxContext(raw, maxBytes = 16 * 1024)`，`postInit`/`context-update` 使用该预算。

### C2 manifest 顶层字段提升

文件：`src/plugin-host/plugin-host.ts`

- `registerManifestContributions` 注册时把 `requiresSensitive`、`placement` 提升到 `ExtensionPointConfig` 顶层（`slotProps` 仍保留完整条目，兼容旧消费端）。
- 仅提升渲染器实际读取的字段，不扩大白名单。

### 测试

- `src/plugin-host/__tests__/contributes-generic-bridge.test.ts`：manifest 声明 `requiresSensitive` / `placement` 后顶层可见。
- `src/plugin-host/__tests__/xuean-activity-extension-point.test.tsx`：编辑器组件收到 `onSaved/lessonId`；远程 view 收到 `activity/activityType/lessonId`。
- `src/components/__tests__/PluginSandboxIframeView.test.tsx`：超过默认预算但在 64KB 内的上下文仍能下发。

---

## 批次 2：测评缺陷（C3–C8）+ 题型注册表订阅

### C3 preflight 可清除

文件：`src/features/assessment/AssessmentEditor.tsx`、`src/plugin-host/types.ts`

- `AssessmentPublishPreflightSlotProps` 增加 `onClear?: (code?: string) => void`。
- `onClear()` 清空全部；`onClear(code)` 删除单项。
- `useEffect` 在 `detail.id` / `classId` / 题量 / 总分变化时清空；发布成功后清空。
- 发布按钮仍只被当前 error 阻断。

### C4 结果槽类型收口

文件：`src/plugin-host/types.ts`

- `AssessmentResultItemAddonProps` 改为判别联合，与 `AssessmentGradingAnswerAddonProps` 同构：
  - `sensitiveAccess: false` 分支；
  - `sensitiveAccess: true` 时 `sensitive?: { answerKey?: unknown; studentAnswer?: unknown }`；
  - `item` 内移除 `answerKey`。
- 运行时不变（本来就走 `sensitive`），这是类型修正；CHANGELOG 标注插件作者可见变更。

### C5 统计分布脱敏

文件：`packages/core/di/assessment-read-service.ts`

- `getAssignmentStats` 只对 `single_choice` / `multiple_choice` / `true_false` 构造 `distribution`；`fill_blank`、`short_answer` 及未知插件题型一律 `{}`。
- 保留 `answered/graded/correct/correctRate/avgScore`。

### C6 题库筛选真支持

文件：`server/services/assessment-service.ts`、`server/routes/assessments.ts`、`src/features/assessment/api.ts`、`src/features/assessment/QuestionBankPanel.tsx`

- 题库列表支持 `type`、`tags`、`difficultyMin`、`difficultyMax`；tags 用 `json_each(tags_json)`。
- 路由解析重复参数/逗号分隔 tags 与难度区间。
- `listBank` 参数改为对象（保留旧字符串重载）。
- 面板维护筛选状态，`onChange` 处理四类字段并重新 `load()`；`activeFilters` 回传完整状态。

### C7 题库槽位 refresh

文件：`QuestionBankPanel.tsx`、`src/plugin-host/types.ts`

- `assessment.bank.import.source` 与 `assessment.bank.toolbar.action` 的 `slotProps` 增加 `refresh: load`。
- 对应 Props 接口补 `refresh?: () => void | Promise<void>`。

### C8 学生端策略贯穿

文件：`src/features/assessment/student/StudentAssessmentsView.tsx`

- `AssessmentRunner` 与 `ResultView` 接收 `hiddenPluginIds/hiddenExtensionIds`。
- `assessment.attempt.toolbar`、`assessment.attempt.question.addon`、`assessment.result.item.addon` 传 `excludePluginIds/excludeExtensionIds`。
- 不隐藏题型 `Answer` / `Review`（属于作答内容本身）。

### 题型注册表订阅（B 的前置）

文件：`src/features/assessment/question-type-ui-registry.tsx` + 三个消费点

- 注册表内部缓存 `snapshot`，`getSnapshot()` 返回稳定引用。
- 新增 `useAssessmentQuestionTypes()`（`useSyncExternalStore`）。
- 替换 `AssessmentEditor` 里的 `subscribe(() => undefined)` 空订阅，以及 `QuestionBankPanel`、`StudentAssessmentsView` 的直接 `list()/get()`。

### 测试

- `AssessmentEditor.test.tsx`：error 后 `onClear` 恢复发布；切换班级自动清空。
- `sensitive-props.test.ts`：结果槽 `item` 不含 `answerKey`，`sensitive.answerKey` 受 `showAnalysis` 控制。
- `server/__tests__/assessment-api.test.ts`：主流题 `distribution` 不含原文；tags/难度过滤。
- `StudentAssessmentsView.test.tsx`：策略隐藏后作答/结果槽位不渲染。
- `question-type-ui-registry.test.ts`：快照稳定、hook 能感知后注册。

---

## 批次 3：7 个学案扩展槽

### 槽位契约

| 槽位                           | 挂载点                                       | 容器       | props（白名单）                                                                                      | 远程                 |
| ------------------------------ | -------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| `xuean.editor.toolbar`         | 活动编排器标题行右侧                         | ActionItem | `{ lessonId, activities: XueanActivitySummary[], refresh, lang }`                                    | commandType / inline |
| `xuean.activity.card.action`   | 活动卡片操作区                               | ActionItem | `{ activity: XueanActivitySummary, index, lang, commandPayload }`                                    | commandType / inline |
| `xuean.activity.card.badge`    | 活动卡片状态角标行                           | 微徽章     | `{ activity: XueanActivitySummary, index, lang }`                                                    | inline / commandType |
| `xuean.activity.editor.footer` | 活动编辑弹窗底部操作栏                       | ActionItem | `{ activityType, activity: XueanActivitySummary \| null, lessonId, lang, onSaved?, commandPayload }` | commandType / inline |
| `xuean.activity.student.addon` | 学生活动卡片底部（内置与插件活动分支都渲染） | Panel      | `{ activity, activityType, lessonId, progress, lang }`                                               | view / inline        |
| `xuean.progress.summary`       | 学生学案头部进度条旁                         | Panel      | `{ lessonId, completedCount, total, percent, lang }`                                                 | view / inline        |
| `xuean.home.block`             | 学生学案首页块区域（整块之后渲染一次）       | Panel      | `{ lessonId, blocks, lang }`                                                                         | view / inline        |

`XueanActivitySummary`：`{ id, type, title, required, visible, peer_review, order_index, release_at, due_at, surface_id }`，**不含 `config_json` / `rubric_json`**。

### 改动点

1. `src/plugin-host/types.ts`：`ExtensionSlot` 追加 7 项 + 对应 SlotProps。
2. `packages/core/esm-loader/manifest-schema.ts`：
   - 宽松组：`xuean.editor.toolbar`、`xuean.activity.card.action`、`xuean.activity.card.badge`、`xuean.progress.summary`、`xuean.home.block`；
   - 按类型分发：`xuean.activity.editor.footer`、`xuean.activity.student.addon` 复用 `xueanActivityRendererSchema`（`activityType` + `view`）。
3. `src/plugin-host/extension-point-renderer.tsx`：学案分发分支扩展到 `xuean.activity.editor.footer`、`xuean.activity.student.addon`，仍按 `activityType ?? activity.type` 精确匹配。
4. `src/features/teacher/xuean/XueanActivitiesPanel.tsx`：
   - 头部：toolbar 槽位（摘要投影 + `refresh`）；
   - `ActivityCard`：badge 行与 action 区；槽位外层 `draggable={false}` 并阻止 `dragstart` 冒泡；
   - `ActivityEditor`：底部 sticky 栏插 footer 槽位；文档要求插件按钮显式 `type="button"`。
5. `src/features/student/xuean/StudentXueanView.tsx`：
   - 头部进度区：`xuean.progress.summary`；
   - 首页 section：blocks 渲染后插 `xuean.home.block`；
   - `ActivityItem` 进度条后 + 插件活动早返回分支各插一次 `xuean.activity.student.addon`。
6. 文档与生成物：`docs/reference/plugin-ui-extension-slots.md`（槽位清单、props 表、§12.9/§12.10、末尾数量）、`python3 audit-tools/agent_facts.py` 重新生成 `docs/agent/contracts/slots.json`。

### 测试

- `XueanActivitiesPanel.test.tsx`：4 个教师端槽位渲染、`commandPayload.activityId` 正确。
- `StudentXueanView.test.tsx`：进度摘要数值、首页块、内置/插件活动都有 addon。
- `xuean-activity-extension-point.test.tsx`：footer/addon 的 `activityType` 分发与 iframe 上下文。

---

## 批次 4：题型注册表 + manifest 声明 + 桥接

### 注册表语义

文件：`src/features/assessment/question-type-ui-registry.tsx`

- 新增 `QuestionReviewProps` 与 `AssessmentQuestionTypeUi.Review?`：
  `{ config, answer, answerKey?, score?, isCorrect?, feedback?, lang, readOnly? }`。
- 条目记录 `origin: 'inline' | 'manifest'` 与 `manifestFallback?`：
  - 无同 type：写入；
  - 同 owner：manifest → inline 时覆盖并保留 fallback；inline → inline 仍抛 duplicate；
  - 跨 owner：manifest 冲突跳过 + warn（first wins），inline 冲突仍抛错。
- `unregister`：有 fallback 则恢复 manifest 版本。
- `clearOwned(pluginId, { preserveManifest })`：`preserveManifest` 为真时保留 manifest 条目、恢复被覆盖的 manifest 版本。
- `src/plugin-host/plugin-host.ts` 的 `unregisterPluginResources` 传入 `preserveManifest: !!preserveManifestContributions`。
- `buildContext` 的 `registerAssessmentQuestionType` 标记 `origin: 'inline'`。

### manifest schema

文件：`packages/core/esm-loader/manifest-schema.ts`

- 在严格 A 组（与 `classroom.*` 同级）新增 `assessment.question_type` 数组：
  `{ id, label, labelEn?, category, supports?, autoGradable?, editorView, answerView?, reviewView?, defaultConfig?, defaultAnswerKey? }`。
- `editorView/answerView/reviewView` 复用 learningSurface 的 view 路径 refine；`.passthrough()`。
- 不放进 `frontendSlotsShape`（它不是渲染槽位）。

### manifest 桥接

文件：`src/plugin-host/plugin-host.ts` + 新增 `src/features/assessment/manifest-question-views.tsx`

- `registerManifestContributions` 单独处理 `assessment.question_type`：
  - 只接受含 `:` 的 id、必须有 `editorView`；
  - 用 `ManifestQuestionEditor/Answer/Review` 包装组件注册，`origin: 'manifest'`；
  - 单条失败只 warn，不阻断激活；
  - 通用 contributes 循环 `continue` 跳过该键，避免注册伪扩展槽。
- 包装组件在批次 5 实现。

### 测试

- `question-type-ui-registry.test.ts`：manifest→inline 覆盖、inline 重复抛错、跨 owner manifest 跳过、`clearOwned` 保留/回退。
- 新增 `src/plugin-host/__tests__/manifest-question-types.test.ts`：非法 view 跳过、伪扩展槽不出现、激活失败保留题型 UI。

---

## 批次 5：iframe 双向通道 + Review 接入

### 宿主侧

文件：`src/components/PluginSandboxIframeView.tsx`

- 新增 `question?: { type, role: 'editor'|'answer'|'review', config, answerKey?, value?, score?, isCorrect?, feedback?, readOnly? }`。
- 新增 `onHostCall?: (call: { op, args }) => Promise<{ handled: boolean; value?; error? }> | { handled: boolean; value?; error? }`；**只路由 `question.*`**，其余仍走内置白名单。
- `init.payload.question`；question 变化时发 `type: 'question.update'`，序列化后 >64KB 丢弃并 warn。
- `answer` 角色永不构造 `answerKey`。

### 插件侧桥接脚本

文件：`server/utils/plugin-view-bridge.ts`

- 维护 `currentQuestion` 与 `question.update` 回调。
- `bridge.question`：`getState()`、`onUpdate(cb)`、`setConfig()`、`setAnswerKey()`、`setValue()`。

### 包装组件

新增 `src/features/assessment/manifest-question-views.tsx`

- `ManifestQuestionEditor`：接受 `question.setConfig` / `question.setAnswerKey`，调用 `onChange`。
- `ManifestQuestionAnswer`：只接受 `question.setValue`，`onChange(value)`。
- `ManifestQuestionReview`：只读，拒绝所有 setter。
- 校验 op 与角色匹配、payload 可序列化且 ≤64KB。
- 给 iframe 容器固定/最小高度（editor 320px、answer 200px），避免 `h-full` 塌陷。

### 结果页与数据

- `server/services/assessment-service.ts`：学生结果 `items` 的 `base` 增加 `config`（学生的作答 payload 本来就有 config，非新增泄露）。
- `packages/core/assessment/serialize.ts` 的 `ItemResultView`、`src/features/assessment/api.ts` 的 `StudentResultPayload.items` 增加 `config`。
- `StudentAssessmentsView.tsx` 的 `ResultView`：
  - 有 `Review` 时渲染 `config/answer/answerKey(showAnalysis)/score/isCorrect/feedback`；
  - 无 `Review` 时保留 `answerToText`；
  - 宿主对错徽标、得分、反馈仍保留。

### 测试

- `server/utils/__tests__/plugin-view-bridge.test.ts`：question API 发送正确 op；`question.update` 触发回调。
- `src/components/__tests__/PluginSandboxIframeView.test.tsx`：answer 角色 init 不含 answerKey；`question.update` 上限；`api.get` 不被 `onHostCall` 劫持。
- `StudentAssessmentsView.test.tsx`：有/无 Review 两条路径；`showAnalysis=false` 时 Review 收不到 answerKey。
- `server/__tests__/assessment-api.test.ts`：结果 payload 含 `config`。

---

## 批次 6：文档、生成物与质量门禁

- `docs/reference/plugin-ui-extension-slots.md`：7 个新槽位、`assessment.question_type`、`question.*` 桥接、preflight `onClear`、结果槽判别联合。
- `docs/architecture/assessment-extension-slots-proposal.md`：§4.5 状态改为“已实现”，补 reviewView 与安全边界。
- `docs/architecture/assessment-extension-slots.contract.json`：同步题型声明与桥接 op。
- `CHANGELOG.md` 的 `## [Unreleased]`：Features / Fixes / Breaking Changes（C4 类型变更）。
- `python3 audit-tools/agent_facts.py` 重新生成契约；随后 `--check` 必须为 0 漂移。
- 如文档示例使用 `question` 成员，同步 `audit-tools/plugin_docs_check.py` 的 `BRIDGE_MEMBERS`。

---

## 验证

```bash
pnpm format:check
pnpm lint
pnpm lint:strict
node scripts/check-lint-budget.mjs
pnpm test

pnpm vitest run src/plugin-host/__tests__/xuean-activity-extension-point.test.tsx \
  src/plugin-host/__tests__/contributes-generic-bridge.test.ts \
  src/components/__tests__/PluginSandboxIframeView.test.tsx \
  src/features/assessment/__tests__/question-type-ui-registry.test.ts \
  src/features/assessment/__tests__/AssessmentEditor.test.tsx \
  src/features/assessment/student/__tests__/StudentAssessmentsView.test.tsx \
  src/features/teacher/xuean/__tests__/XueanActivitiesPanel.test.tsx \
  src/features/student/xuean/__tests__/StudentXueanView.test.tsx \
  server/utils/__tests__/plugin-view-bridge.test.ts

python3 audit-tools/agent_facts.py
python3 audit-tools/agent_facts.py --check
```

手工验证（`pnpm dev`，端口 9000）：

1. 教师端新增一个 manifest 声明的题型（可临时用测试 manifest），确认题库/组卷下拉出现、编辑器 iframe 可改 config、答案键不回传学生。
2. 学生作答页确认 answer iframe 收到 `value` 但无 `answerKey`；提交后结果页走 Review。
3. 学案教师端 4 个槽位、学生端 3 个槽位可见；远程 view 能拿到 `activityType/lessonId`。
4. 发布前检查：error 后调用 `onClear` 可恢复发布按钮；切换班级自动清空。

## 风险

- `agent_facts.py` 会重写多个契约文件：先跑 `--check` 记录基线，生成物单独提交，避免混入历史漂移。
- `clearOwned` 语义变化需覆盖“激活失败保留 manifest 题型 UI”，否则远程插件激活失败会连带丢题型。
- 远程题型若只声明 UI、服务端没注册 grader，存题/判分会失败；文档必须写清两段式注册，建议后续加发布前“题型未安装”预检（本轮不做）。
- `question.update` 通道要把 `answerKey` 锁定在 editor/review 角色；任何包装组件的字段扩展都必须走白名单。
- 学案卡片槽位位于 `draggable` 容器内，必须阻止拖拽冒泡，否则点击插件按钮会触发卡片重排。
- 活动编辑弹窗槽位位于 `<form>` 内，插件按钮若不是 `type="button"` 会误提交。
