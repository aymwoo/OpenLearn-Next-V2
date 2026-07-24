# AI Teacher Workspace AI 助教协同

AI Teacher 协同模块由内置插件（`AiPlannerPlugin`, `AiSubmitInjectorPlugin`, `AssignmentEvalPlugin`）与前端 Teacher Workspace 协同实现。

---

## 核心应用场景

1. **AI 智能备课 (AiPlannerPlugin)**:
   - 输入教学主题，AI 自动生成对应的 `Flow`, `Stage` 以及随堂练习 `Activity` 对象。

2. **课堂实时巡视助手 (Teacher Patrol Assistant)**:
   - 实时监控全班学生的答题进度与专注度指标。
   - 针对出现困难的学生自动提出教学干预建议。

3. **作业与提交自动注入 (AiSubmitInjectorPlugin & AssignmentEvalPlugin)**:
   - 在学生提交白板答题或代码练习时，利用大模型自动识别并打分，将得分实时回传至成绩系统。
