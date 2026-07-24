# OpenLearn AI Teaching Workflow Specification (AI 深度协同授课工作流规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P5-04 中，成功构建了 **AI Teaching Workflow**（位于 `src/features/ai-teaching-workflow/`）。

AI 授课协同编排器 (`AITeachingWorkflowOrchestrator`) 负责编排 AI 在教学全周期（PreLesson → InLesson → PostLesson）中作为 `Tutor`（导师）、`CoTeacher`（助教）、`Evaluator`（评估员）或 `Observer`（观察员）的协同调度，跨 6 大核心子系统（`Lesson Runtime`, `Workspace`, `Whiteboard`, `Analytics`, `Activity`, `Resource`）进行协同，**零硬编码 Prompt，零重复逻辑，纯工作流调度**。

---

## 2. AI Participant Roles & Phases (AI 角色与阶段图谱)

```
PreLesson (课前备课与试讲)
  ├── Tutor / CoTeacher: 生成教案提示与预习材料
  └── Subsystems: Lesson, Resource, Workspace
  ↓
InLesson (课中实时助教与答疑)
  ├── CoTeacher / Tutor: 实时板书解释、随堂互动测验生成
  └── Subsystems: Whiteboard, Activity, Workspace
  ↓
PostLesson (课后复盘与学情评估)
  ├── Evaluator / Observer: 聚合学情日志与评估反馈
  └── Subsystems: Analytics, Lesson, Resource
```
