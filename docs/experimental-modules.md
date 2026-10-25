# 未接线模块登记（Experimental / 已删除）

本文登记 `src/features/` 下**有实现但从未接入生产链路**的模块，以及它们的处置结论。
目的是防止下一个人（或下一个 AI Agent）把死代码当成"现有能力"继续开发。

## 怎么发现的

从真实入口（`src/App.tsx` / `src/main.tsx` / `server.ts` / `cli-data.mjs`）做可达性分析
（解析相对路径、`@/` 别名、`.js`→`.ts`、动态 `import()`）：

```
可达 859 / 983 个文件 → 不可达 124 个，其中 17 个是整模块
```

> ⚠️ **踩过的坑**：只统计"有没有外部 import"会把死模块误判成活的。
> `workspace` / `resource-runtime` / `ai-teacher-workspace` 的引用方只有彼此和
> `student-workspace` —— 一个自洽循环，从入口出发根本到不了。
> 判断"活的"必须从入口做可达性，不能只看入边数量。

## 处置一览

| 模块                   | 原体量 | 结论                 | 理由                                                                                                                                                                                                                                           |
| ---------------------- | ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lesson-workflow`      | 61 行  | **已删除**           | `advanceStage(target)` 是裸 setter：不校验、不落库、不发事件。接线等于给服务端门禁（`CLASS_LOCKED`→409 / `Illegal transition`→400）开后门                                                                                                      |
| `ai-teaching-workflow` | 55 行  | **已删除**           | 同上，getter/setter 壳                                                                                                                                                                                                                         |
| `classroom-runtime`    | 399 行 | **已删除**           | 自带 9 阶段 `Create/Prepare/Ready/Teaching/Paused/Resumed/Finished/Archived/Disposed`，与在用的 `classroom_sessions.stage`（含 `ARCHIVED_REPORT`）词表不兼容；且有独立的 `classroom.created/paused/…` 事件命名空间，接上会与 socket 事件流双写 |
| `interaction-runtime`  | 191 行 | **已删除**           | 第二个 Keyboard/Mouse/Touch 派发器；白板已自接管 DOM 事件（111 文件、E2E 覆盖最重）。接它=双处理，或拆掉白板的 handler                                                                                                                         |
| `ai-action-api`        | 154 行 | 标注 `@experimental` | `server/ai-agent.ts` 不查它；插件贡献动作已走活的 `command_palette.item` 槽位 + `/api/plugins/execute-command`。功能冗余，但设计形状可作为将来参考                                                                                             |
| `ai-skill-registry`    | 148 行 | 标注 `@experimental` | 同上；AI 技能目前由插件 actor 派发，不经过本注册表                                                                                                                                                                                             |
| `ai-prompt-registry`   | 154 行 | 标注 `@experimental` | `server/ai-agent.ts` 用自己的 `buildAgentSystemInstruction` 拼 prompt，不读本注册表                                                                                                                                                            |
| `ai-classroom-context` | 240 行 | 标注 `@experimental` | `server/ai-context-registry.ts` 是并行的另一套实现**且已在用**；本模块 provider 注册表无消费方                                                                                                                                                 |
| `student-workspace`    | 496 行 | 待产品决策           | 见下文「学生端迁移」                                                                                                                                                                                                                           |
| `workspace`            | 430 行 | 待产品决策           | `student-workspace` 的依赖，C 组 all-or-nothing                                                                                                                                                                                                |
| `resource-runtime`     | 160 行 | 待产品决策           | 同上                                                                                                                                                                                                                                           |
| `ai-teacher-workspace` | 317 行 | 待产品决策           | 同上                                                                                                                                                                                                                                           |

## 为什么 B 组是"标注"而不是"删除"

它和 A 组的区别只有一点：A 组接线会**破坏**现有正确性（双权威、给门禁开后门），
B 组接线只会**白费力气**（重写一条正在工作的 AI 链路）。

B 组没有生产消费方，但**有一套完整的注册表形状**（action / skill / prompt / context
provider），与现有 `server/ai-context-registry.ts` 的单点实现不同。保留它作为
"若将来要做插件化 AI 扩展，注册表该长什么样"的设计参考；标注 `@experimental`
保证它不会被误当能力使用。

**接线前置条件（写在每个 `index.ts` 头部）**：

1. 先把 `server/ai-agent.ts` 的能力判定（`action.capabilityRequired`）与 provider
   解析抽成可复用层 —— **绝不能让新注册表绕过现有授权**；
2. 配好至少一个 AI provider，补集成测试（当前只有纯单元测试，从未在真实链路上跑过；
   CI 不配 provider，所以这段代码进可达图后**无人验证**）；
3. 逐个迁移现有入口（`/api/lessons/:id/ai-tutor`、白板 AI 工具栏、`ai_sidebar.tab`），
   确认行为等价后再删旧路径。

## 学生端迁移（C 组）—— 这是产品决策，不是接线动作

C 组的 4 个模块构成一条自洽依赖链：

```
student-workspace ← workspace
                 ← resource-runtime
                 ← ai-teacher-workspace
```

「接通它」的真正含义 = **用第二套学生端壳替换现在能跑的那一套**
（`src/features/student`，63 文件、6 个引用方）。

必须满足的前置条件：

1. **功能对齐**：逐项核对 `src/features/student` 现有能力（课堂跟随、答题、通知、进度…）
   在新壳里是否等价，尤其那些未写进文档、只在交互里体现的行为；
2. **全量学生端 E2E 重验**：25 条 E2E 里 **22 条涉及学生端**，换壳后需逐条确认；
   其中一部分会**合理地**失败（壳变了，选择器与流程都变）；
3. **插件兼容**：`student-workspace` 走 `WorkspaceSlotRegistry`，需确认现有插件在
   `teacher.tab` / `ai_sidebar.tab` 等槽位的贡献在新壳里仍能渲染；
4. **回滚方案**：壳切换必须可一键回退，不能"切了就回不去"。

在满足这四条之前，建议维持现状（`src/features/student`）。

## 相关记录

- `CHANGELOG.md` → `## [Unreleased]` 下的对应条目
- 覆盖率影响：A 组删除后需复核 `coverage-baseline.json`（这些模块覆盖率高于全仓均值，
  删除会**拉低**聚合数字；棘轮允许下调，但需在 PR 中说明理由）
