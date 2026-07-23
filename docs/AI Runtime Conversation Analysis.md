# OpenLearn AI Runtime Conversation Analysis (AI 运行时对话分析报告)

## 1. Executive Summary (概述)

本报告审查 AI Runtime 的对话生命周期、Session 管理、历史记录打包与内存/持久化清理。

---

## 2. Conversation State & Lifecycle (对话状态与生命周期)

- **Session Context**: 对话以 `currentLessonId` 与 `actorId` 作为关键关联维度。
- **History Memory**: 自动按 Chronological 顺序维护 User 与 Agent 工具调用的完整 `functionCall` / `functionResponse` 往复上下文。
- **Persistence**: 对话历史存储在内存集中列表与底层数据库之中，支持单次交互与多轮 Task Chaining 调度。
