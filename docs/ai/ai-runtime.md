# AI Runtime 内核

`AIRuntimeKernel` 与 `AIProviderGateway` 在 `packages/core/ai/` 中实现，提供统一的 OpenAI 兼容大语言模型接入架构。

## 核心特性

- **动态多 Provider 网关**：支持通过管理后台动态添加与管理多个第三方 AI 提供商（如 DeepSeek、Qwen、Ollama、OpenAI 等）。
- **凭据安全加密**：所有 Provider 的 API Key 均采用 AES-256-GCM 算法加密存储于 SQLite 数据库中。
- **内核级 DI 契约**：通过 `IAIService` / `IAIServiceToken` 提供 `generateText`，以及可选的 `listProviders()`（只返回元数据，不含 API Key；需 `ai:invoke`）。
- **AI 遥测总线**：内置 `AIEventBus`，统一分发 `ModelStarted`、`ModelFinished` 等生命周期事件。
- **未配置拦截保护**：当系统未配置任何激活的 AI Provider 时，内核统一拦截并抛出标准化提示，前端提供醒目配置引导。

## Skill 运行时（P0）

Skill 不是新的执行通道，而是 `ai.skill.provider` 之上的「目录 + 场景过滤 + 产物」层：

- **注册表**：`server/skill-registry.ts` 将内置技能与 active 插件 manifest 归一为 `SkillDescriptor`，按 `surface` / `roles` 过滤；未声明 `roles` 的技能默认排除学生。
- **渐进披露**：`/api/agent/chat` 传入 `skillId` 时，只注入该技能声明的工具，不再全量注入所有插件技能；未传 `skillId` 时保持旧行为。
- **人工确认**：技能工具声明 `requiresConfirm: true` 时，Agent 只返回 `pendingConfirmations`，不自主执行写操作。
- **产物**：P0 支持 `lesson_segments`，由 `POST /api/skills/:id/run` 返回预览；教师确认后仍走既有 `PUT /api/lessons/:id/timeline`（`lesson.update_timeline` 命令）落库。
- **接口**：`GET /api/skills?surface=` 返回当前角色可见的技能目录；`POST /api/skills/:id/run` 以选定技能调用现有 Agent 链路。

