# 统一扩展点与 UI 贡献点注册表 (Extension & Contribution Registry)

<!-- doc-version: sdk=3.7.5 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.4`

OpenLearn V2 提供了双层扩展点架构：

1. **`ContributionRegistry` (静态声明式)**：在插件未激活时解析 `manifest.json` 中的 `contributes` 配置，用于管理后台和主界面静态呈现图标与菜单。
2. **`UnifiedExtensionRegistry` (内核统一索引)**：对所有类型的扩展点（UI 插件组件、Activity 活动提供者、AI Actions、命令与 Capability）进行统一分类聚合索引。

---

## 0. 先分清三类扩展面（插件能注册的东西不止 UI 槽位）

| 类别                 | 形态                                              | 典型 API                                                                                                                                                    | 谁能用                                        |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| UI 槽位 / 声明式贡献 | manifest 声明，或运行期注册**数据型** `slotProps` | `manifest.contributes`、`ctx.ui.registerExtensionPoint(slot, { slotProps })`                                                                                | 服务端插件 + 前端插件（远程沙箱**仅数据型**） |
| 前端注册表           | 插件提供 React 组件或数据，宿主渲染/调用          | `ctx.ui.registerAssessmentQuestionType` / `registerAssignmentQuestionRenderer` / `registerCoursewareSource` / `registerPaletteItem` / `registerSegmentType` | **仅前端 inline 插件**（受信任内建）          |
| 服务端注册表         | 插件往内核注册表里塞定义对象（DI token）          | `ctx.resolve(IToken).register*(...)`                                                                                                                        | 服务端插件（inline / worker / process 均可）  |

> ⚠️ **远程（ZIP）插件的 `ctx.ui` 只有两个方法**：`registerExtensionPoint(slot, config)` 与 `showToast(message)`
> —— 沙箱桥接层一共只放行 10 个 op（见[前端沙箱能力边界](frontend-sandbox-capability-boundary.md) §3.2.1）。
> 表里其余 `ctx.ui.register*` 属于**前端 inline** 的 `FrontendPluginContext`：它们的值里带函数/JSX，
> 远程插件调用会直接 `TypeError: ctx.ui.registerAssignmentQuestionRenderer is not a function`。

### 0.1 注册表总索引（9 个）

| 扩展点            | 获取方式                                                  | 注册 / 注销                                                                                     | 回收路径                                                     | 可用范围                            | 详细文档                                           |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------- |
| 题库题型          | `ctx.resolve(IAssessmentGraderRegistryToken)`             | `registerQuestionType(def, { pluginId })` / `unregisterQuestionType(type, pluginId)`            | 服务端停用链 `revokePluginQuestionTypes`（Issue #320）       | 服务端；前端编辑器仅 inline         | [测评模型](../architecture/assessment-model.md) §4 |
| 教学环节进入条件  | `ctx.resolve(IStageGuardServiceToken)`                    | `registerGuard(guard, owner)`（返回注销函数）/ `unregisterGuard(id, owner)`                     | 停用链 `revokePluginStageGuards` → `unregisterByOwner`       | 服务端                              | §0.3.2                                             |
| 积分维度          | `ctx.services.pointsDimension`（非 inline 模式为 `null`） | `registerDimension(spec)` / `unregisterDimension(id)`                                           | `ResourceTracker`（`ctx.services` 包装层）                   | 服务端（**只有 inline 拿得到**）    | §0.3.3                                             |
| AI 人格           | `ctx.services.ai`                                         | `registerAIPersona(persona)` / `unregisterAIPersona(id)`                                        | `ResourceTracker`                                            | 服务端                              | §0.3.4                                             |
| 作业题型渲染器    | `ctx.ui`                                                  | `registerAssignmentQuestionRenderer(config)` / `unregisterAssignmentQuestionRenderer(quizType)` | 前端停用 `assignmentQuestionRendererRegistry.clearOwned`     | **仅前端 inline**                   | §0.3.5                                             |
| 课件内容源 loader | `ctx.ui`                                                  | `registerCoursewareSource(loader)` / `unregisterCoursewareSource(id)`                           | 前端停用 `coursewareSourceRegistry.unregisterPlugin`         | **仅前端 inline**                   | §0.3.6                                             |
| 课堂阶段门禁      | `ctx.resolve(IClassroomLifecycleServiceToken)`            | `registerStageGuard(owner, guard)` / `unregisterStageGuard(owner)`                              | `ctx.resolve` 层 per-plugin 代理 → `ResourceTracker`（#327） | 服务端（**仅 inline**，守卫是函数） | §0.3.7                                             |
| 课堂互动提供者    | `ctx.resolve(IInteractionRuntimeServiceToken)`            | `registerActivityProvider(owner, descriptor)` / `unregisterActivityProvider(owner, id)`         | `ctx.resolve` 层 per-plugin 代理 → `ResourceTracker`（#327） | 服务端                              | §0.3.8                                             |
| AI 上下文提供者   | `ctx.services.ai`                                         | `registerAIContextProvider(id, fn)` / `unregisterAIContextProvider(id)`                         | `ResourceTracker`                                            | 服务端（**仅 inline**，fn 是函数）  | §0.3.9                                             |

> 🔑 **一条判据**：经 `ctx.services.*` 拿到的注册表是宿主包装过的，注册项自动进 `ResourceTracker`；
> 经 `ctx.resolve(token)` 拿到的是**裸注册表**，需要额外兜底。三条兜底路径都已落地：
> 题型走停用链 `revokePluginQuestionTypes`（#320）、环节 Gate 走 `revokePluginStageGuards`、
> 「课堂阶段门禁」与「课堂互动提供者」走 **`ctx.resolve` 层 per-plugin 代理**（#327，登记进 `ResourceTracker`）。
> 即使宿主已兜底，也**仍建议自己保存注销函数**并在 `deactivate()` 调用 ——
> 宿主兜底是为了防止泄漏，不是为了替你表达「提前撤销」的意图。

### 0.2 维护约定：新增注册表必须登记

上表是「插件可注册什么」的唯一入口。**新增任何插件可注册的注册表时，请在同一 PR 里补一行** ——
否则第三方作者只能靠翻源码发现它（本节 6 行扩展点里，有 5 个此前在插件文档中完全缺席）。

三个字段是硬要求：**获取方式**（token 还是 `ctx.services.*`）、**回收路径**（谁在什么时机注销）、
**可用范围**（服务端 / 前端 inline / 前端远程沙箱）。缺了第三列，读者会把 inline 专属 API
当成人人可用 —— 这类误用不会在构建期暴露，只在运行时变成 `TypeError`。

### 0.3 逐个上手：最小示例 + 卸载语义 + 常见错用

#### 0.3.1 题库题型（测评题型）

```ts
// 服务端 activate
const registry = await ctx.resolve(IAssessmentGraderRegistryToken);
registry.registerQuestionType(
  {
    type: 'ext-code:python', // 必须是 <pluginId>:<name>，格式不符直接抛错
    label: { zh: 'Python 代码题', en: 'Python code' },
    category: 'subjective',
    supports: ['quiz', 'exam'],
    autoGradable: false,
    createDefaultConfig: () => ({ tests: [] }),
    validateConfig: () => null,
    grade: () => ({ score: null, needsManualReview: true }), // 判不了就返回 null，不要兜底 0
  },
  { pluginId: 'ext-code' },
);
```

- **回收**：停用/卸载时宿主按「安装行 UUID」与 `manifest.id` 两个 owner 各清一次（`revokePluginQuestionTypes`）。
- **错用 1**：`type` 不带 `<pluginId>:` 前缀 → `must be namespaced as "<pluginId>:<name>"` 抛错。
- **错用 2**：只注册服务端、不注册前端编辑器 → 出题页该题没有自定义编辑器（配置只能是默认 `{}`），
  学生端作答退化为 JSON 文本框（`ui?.Answer ?? FallbackAnswer`）；能用，但没人想用。
- **错用 3**：`autoGradable: true` 却在判不了时返回 `0` —— 违反「无法判分必须返回 `score: null`」，
  会把「不确定」变成「判错」，且人工批改队列收不到它。

#### 0.3.2 教学环节进入条件（Stage Guard）

```ts
const stageGuards = await ctx.resolve(IStageGuardServiceToken);
stageGuards.registerGuard(
  {
    id: 'ext-vote:must-answer-poll',
    name: '必须先答投票',
    priority: 50, // 数值越小越先执行，默认 100
    async canEnterStage({ lessonId, targetStageId }) {
      return { allowed: true };
    },
  },
  'ext-vote', // owner：停用时按它回收
);
```

- **回收**：停用链的 `revokePluginStageGuards` 按 owner 清（owner 传 `manifest.id` 或安装 UUID 都能被兜到）。
- **错用 1**：`canEnterStage` 里抛异常或耗时超过 pipeline 预算 —— 会被按失败策略处理，
  学生端只看到笼统的「无法进入」。业务失败请 `return { allowed: false, reason: '…' }`。
- **错用 2**：把守卫当副作用钩子用（在里面写库、发通知）。它会被反复调用、且可能超时被丢弃。

#### 0.3.3 积分维度

```ts
const dimensions = ctx.services.pointsDimension; // 非 inline 模式恒为 null
if (dimensions) {
  dimensions.registerDimension({
    id: 'ext-vote:participation',
    name: '投票参与',
    category: 'plugin', // 只能是 'plugin'；内置维度不可注销
    defaultWeight: 0.05,
  });
}
```

- **回收**：经 `ctx.services.pointsDimension` 注册的会进 `ResourceTracker`，停用时自动 `unregisterDimension`。
- **错用 1**：不判空 —— worker / process 模式下 `pointsDimension` 是 `null`，直接调会 `TypeError`。
- **错用 2**：`category: 'builtin'` —— 会与内置维度冲突，且停用后注销不掉（保护逻辑按 `category` 拦）。

#### 0.3.4 AI 人格（Persona）

```ts
ctx.services.ai.registerAIPersona?.({
  id: 'ext-vote:coach',
  nameZh: '投票教练',
  nameEn: 'Vote Coach',
  instructionZh: '你负责引导学生完成一次课堂投票并解释结果。',
  instructionEn: 'Guide the class through one poll and explain the result.',
});
```

- **回收**：注册时宿主自动记 `registeredBy: pluginId` 并 `tracker.track`，停用时按该插件注销。
- **错用**：与内置人格 id 撞名 —— 宿主内置角色不可注销，插件侧只会有一次静默覆盖。

#### 0.3.5 作业题型渲染器（仅前端 inline）

```ts
// 只有 inline 前端插件能调用：render 返回 React 节点，跨 postMessage 不可克隆
ctx.ui.registerAssignmentQuestionRenderer({
  quizType: 'ext-code-run', // 与作业 content 里的 quizType 匹配
  label: '代码运行题',
  description: '在下方编辑器里完成代码后提交',
  render: ({ assignment, answers, setAnswers, lang }) => (
    <YourEditor assignment={assignment} answers={answers} setAnswers={setAnswers} lang={lang} />
  ),
  validate: ({ answers }) => (answers.code ? null : '请先写代码'),
  buildSubmission: ({ answers }) => JSON.stringify({ code: answers.code }),
});
```

- **回收**：停用时 `assignmentQuestionRendererRegistry.clearOwned(pluginId)`。
- **错用**：远程 ZIP 插件照抄 —— `ctx.ui.registerAssignmentQuestionRenderer` 在沙箱桥接层不存在，
  调用即 `TypeError`。远程插件只能走 `manifest.contributes` 声明式贡献。

#### 0.3.6 课件内容源 loader（仅前端 inline）

```ts
// loader 只负责把课件数据解析成 iframe src URL；返回 null 表示“我不处理这个”
ctx.ui.registerCoursewareSource({
  id: 'ext-moodle:courseware', // 全局唯一，带插件命名空间
  resolve: (data, { lessonId }) => {
    if (!data?.resourceId) return null;
    return `https://moodle.example.com/courseware/${data.resourceId}?lesson=${lessonId}`;
  },
});
```

- **回收**：停用时 `coursewareSourceRegistry.unregisterPlugin(pluginId)`。
- **错用**：同上 —— 远程插件无法注册（函数不可跨沙箱传递），只能让宿主按扩展名兜底渲染。

#### 0.3.7 课堂阶段门禁（四阶段流转）

课堂生命周期是四阶段：`PRE_CLASS_READY` → `IN_CLASS_TEACHING` → `WRAP_UP_EXIT_TICKET` → `ARCHIVED_REPORT`。
`registerStageGuard` 让你在这条流转上追加一条**准入判定**。

```ts
const lifecycle = await ctx.resolve(IClassroomLifecycleServiceToken);
lifecycle.registerStageGuard('ext-quiz', async (fromStage, toStage, { lessonId, classId, actorId }) => {
  if (toStage !== 'IN_CLASS_TEACHING') return true; // 只关心进入授课阶段
  const answered = await ctx.services.storage.get(`poll-answered:${lessonId}`);
  return answered ? true : { allowed: false, reason: '请先完成课前投票' };
});
```

- **形状**：`ClassroomStageGuard = (fromStage, toStage, context) => boolean | StageGuardResult | Promise<…>`；
  返回 `false` 或 `{ allowed: false, reason }` 都会阻断流转。
- **可用范围**：⚠️ **仅 inline**。守卫是**函数**，无法跨 Worker / process 边界传递，
  在非 inline 模式注册会拿不到可调用的实现。
- **回收**：停用时**自动**回收。`ctx.resolve` 返回的是 per-plugin 代理，它记下你实际传入的 `owner`
  并登记进 `ResourceTracker`（#327）；需要提前撤销时再手动 `unregisterStageGuard('ext-quiz')`。
- **错用 1**：每个 `owner` **只能有一个**守卫（`Map.set(owner, guard)` 是覆盖式），
  同一插件注册两个会静默顶掉前一个。
- **错用 2**：把它当成「教学环节（timeline segment）进入条件」用 ——
  环节条件由 `SegmentGateService` 单独判定，不走这条链。

#### 0.3.8 课堂互动提供者

注册一个自定义课堂互动（极速投票、抢答、结课通票那一类），让宿主把互动入口渲染出来。

```ts
const runtime = await ctx.resolve(IInteractionRuntimeServiceToken);
runtime.registerActivityProvider('ext-quiz', {
  id: 'matrix_voting', // 同一 owner 下可注册多个 id
  name: '矩阵投票',
  category: 'vote',
  icon: 'Vote',
  description: '支持多选矩阵的即时投票',
  supportedRoles: ['teacher', 'student'],
});
```

- **形状**：`QuickActivityDescriptor = { id, name, category, icon?, description?, supportedRoles? }`，
  是纯数据 —— 因此**可跨进程**（worker / process 模式都能用）。
- **回收**：停用时**自动**回收。代理记下你实际传入的 `(owner, id)` 并登记进 `ResourceTracker`（#327）。
  需要提前撤销时再手动 `unregisterActivityProvider('ext-quiz', 'matrix_voting')`。
- **错用 1**：`id` 不带插件命名空间 → 不同插件的 id 会撞在同一个键空间里
  （实际键是 `${owner}:${id}`，所以只要 owner 不同就安全；但同一 owner 下 id 必须唯一）。
- **错用 2**：以为注册完宿主会自动渲染出完整 UI —— 这里只提供**元数据**，
  实际互动界面仍需走 manifest 声明式贡献或宿主自带的那几类互动。

#### 0.3.9 AI 上下文切片提供者

让 AI Agent 在每次对话前拿到一段由你生成的上下文（按 `lessonId` 注入）。

```ts
ctx.services.ai.registerAIContextProvider?.('ext-quiz:progress', (lessonId) => {
  // 返回要注入的文本；返回 null 表示本次不注入
  return lessonId ? `本课进度：${readProgress(lessonId)}` : null;
});
```

- **可用范围**：⚠️ **仅 inline**。`fn` 是**函数**，Worker 序列化边界无法传递。
- **回收**：`ResourceTracker` 自动 `unregisterAIContextProvider(id)`。
- **错用**：把大段内容塞进返回值 —— 它会进每一次 AI 请求的上下文，token 成本按对话次数放大。

---

## 1. `ContributionRegistry` 声明式贡献点

实现位置：`packages/core/plugin-host/contribution-registry.ts`

### 槽位分类 (Slots)

| 槽位 Identifier            | UI 挂载位置                                | 配置字段说明                                           |
| :------------------------- | :----------------------------------------- | :----------------------------------------------------- |
| `classroom.tool`           | 课堂交互工具箱                             | `id`, `name`, `icon`, `commandType`, `payload`         |
| `teacher.tab`              | 教师端主导航 Tab 标签                      | `id`, `label`, `icon`, `position`                      |
| `teacher.dashboard.widget` | 教师端工作区仪表盘小组件                   | `id`, `label`, `icon`, `position`                      |
| `student.view`             | 学生端主导航视图路线                       | `id`, `label`, `icon`, `route`                         |
| `student.lesson.tool`      | 学生端课中互动小工具                       | `id`, `label`, `icon`                                  |
| `anchor:*`                 | 宿主原生按钮/元素前后（锚点槽位，v0.2.6+） | `id`, `label`, `icon`, `placement`（`before`/`after`） |

> **注意**：上表仅列举最早一批核心槽位，**并非全集**。截至当前版本，`ContributionConfig` 联合类型已定义 **109 种**贡献配置（对应 manifest `contributes` 的 108 个键），而前端 `ExtensionSlot` 联合类型有 **120 个**成员 —— 两套数量口径不同，不可混用。完整清单与配置字段以 [UI 扩展槽位全目录](../reference/plugin-ui-extension-slots.md) 为权威。

> 锚点槽位是开放命名空间，具体锚点 id 由宿主定义并公布，见 [`anchor-slots.md`](./anchor-slots.md)。

### API 使用示例

```typescript
const contributions = pluginHost.getContributionRegistry();

// 检索指定插件的所有贡献点
const pluginContribs = contributions.summary(pluginId);

// 检索指定槽位下的所有已注册贡献点（跨插件；ContributionRegistry 没有 getTeacherTabs() 这类按槽位命名的便捷方法）
const allTeacherTabs = contributions.getBySlot('teacher.tab');
```

---

## 2. `UnifiedExtensionRegistry` 统一扩展索引

实现位置：`packages/core/plugin-host/unified-extension-registry.ts`

### 核心 API 契约

```typescript
export interface IUnifiedExtensionRegistry {
  registerExtension(category: string, id: string, impl: unknown, meta?: Partial<ExtensionItemMetadata>): void;
  hasExtension(category: string, id: string): boolean;
  getExtension<T = unknown>(category: string, id: string): T | undefined;
  listExtensions(category?: string): ReadonlyArray<ExtensionItemMetadata>;
  listCategories(): ReadonlyArray<string>;
  health(): IntegrationHealthStatus;
  metadata(): IntegrationDescriptor;
}
```

### 与 `ContributionRegistry` 的双向同步

当插件初始化或平台启动时，`UnifiedExtensionRegistry` 自动调用 `syncContributionRegistry()`，将所有声明式的 UI 贡献自动提升并归纳为统一分类，使得前端和 AI 智能体能以同一视角检索系统中的全量扩展组件。

---

## 3. 前端 UI 扩展槽与渲染流程

前端 React 层（位于 `src/plugin-host/extension-point-renderer.tsx` 的 `ExtensionPointRenderer`，以及 `src/components/PluginTabPanel.tsx`、`src/features/whiteboard/widgets/PluginCardRenderer.tsx`）：

1. 用户点击插件提供的 `teacher.tab` 菜单。
2. 前端根据 `manifest.id` 与 `staticRoute` 渲染安全 `<iframe>` 沙箱或动态组件。
3. `<iframe>` 内通过 Bridge SDK 发起 `vfs.read_file` 或跨插件 Command 命令。
4. 主应用路由与 CommandBus 处理请求并返回状态。

**锚点槽位渲染**（v0.2.6+）：宿主在目标按钮前后各渲染一次 `ExtensionPointRenderer`，通过 `placement` prop 按侧过滤——`placement="before"` 只渲染声明 `placement: 'before'` 的扩展，`placement="after"` 只渲染声明 `'after'` 或未声明（默认）的扩展。见 [`anchor-slots.md`](./anchor-slots.md)。
