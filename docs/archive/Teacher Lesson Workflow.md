# OpenLearn Teacher Lesson Workflow Specification (教师授课工作流编排规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P3-02 中，成功构建了 **Teacher Lesson Workflow**（位于 `src/features/lesson-workflow/`）。

授课工作流编排器 (`LessonWorkflowOrchestrator`) 负责集中编排已有的 6 大能力 (`Lesson Runtime`, `Workspace`, `Whiteboard`, `AI Assistant`, `Plugin Host`, `Analytics Engine`)，覆盖 Prepare → Start → Teach → Interact → Assess → Summarize → Complete 标准授课阶段，**绝对零新增业务逻辑**。

---

## 2. Workflow Stage Pipeline (授课阶段图谱)

```
Prepare (预习与大纲载入)
  ↓
Start (上课开讲)
  ↓
Teach (讲授与板书)
  ↓
Interact (随堂互动与问答)
  ↓
Assess (随堂测验与批改)
  ↓
Summarize (学情总结与 AI 洞察)
  ↓
Complete (下课与归档)
```
