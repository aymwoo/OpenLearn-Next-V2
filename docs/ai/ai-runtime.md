# AI Runtime 内核

`AIRuntimeKernel` 与 `AIProviderGateway` 在 `packages/core/ai/` 中实现，提供统一的 OpenAI 兼容大语言模型接入架构。

## 核心特性

- **动态多 Provider 网关**：支持通过管理后台动态添加与管理多个第三方 AI 提供商（如 DeepSeek、Qwen、Ollama、OpenAI 等）。
- **凭据安全加密**：所有 Provider 的 API Key 均采用 AES-256-GCM 算法加密存储于 SQLite 数据库中。
- **内核级 DI 契约**：通过 `IAIService` / `IAIServiceToken` 提供 `generateText`，以及可选的 `listProviders()`（只返回元数据，不含 API Key；需 `ai:invoke`）。
- **AI 遥测总线**：内置 `AIEventBus`，统一分发 `ModelStarted`、`ModelFinished` 等生命周期事件。
- **未配置拦截保护**：当系统未配置任何激活的 AI Provider 时，内核统一拦截并抛出标准化提示，前端提供醒目配置引导。

## Skill 运行时

Skill 不是新的执行通道，而是 `ai.skill.provider` 之上的「目录 + 场景过滤 + 产物」层：

- **注册表**：`server/skill-registry.ts` 将内置技能与 active 插件 manifest 归一为 `SkillDescriptor`，按 `surface` / `roles` 过滤，并合并 `skill_settings` 的启停与场景覆盖；未声明 `roles` 的技能默认排除学生。
- **渐进披露**：`/api/agent/chat` 传入 `skillId` 时，只注入该技能声明的工具，不再全量注入所有插件技能；未传 `skillId` 时保持旧行为。
- **人工确认**：技能工具声明 `requiresConfirm: true` 时，Agent 只返回 `pendingConfirmations`，不自主执行写操作。
- **产物与场景**：
  - `lesson_segments`（备课）：确认后走既有 `PUT /api/lessons/:id/timeline`；
  - `config_patch`（设置）：确认后由 `POST /api/skills/:id/apply-config` 调用 `setRuntimePolicies`，旧值存入 `skill_config_rollbacks` 支持回滚；
  - `classroom_card`（课堂）：确认后由 `POST /api/skills/:id/apply-card` 走 `whiteboardService.drawElement` 投屏。
- **运行审计**：每次运行写入 `skill_runs`；管理端可查询并回滚配置变更。
- **脚本技能**：manifest 声明 `script` 时走 `server/skill-script-sandbox.ts`（`node:vm` + 禁用代码生成 + 硬超时），不经过大模型；需获批 `skill:script`。
- **细粒度绑定**：`skill_bindings` 按 lesson > class > global 覆盖可用性；绑定可带 `roles` 收窄技能声明（只减不增，交集为空即不可用）；运行时目录与 `/api/agent/chat` 都会带 `lessonId` / `classId` 解析。
- **接口**：`GET /api/skills?surface=`、`POST /api/skills/:id/run`；管理端 `GET/PATCH /api/admin/skills`、`GET /api/admin/skill-runs`、`POST /api/admin/skill-runs/:runId/rollback`、`GET/PUT/DELETE /api/admin/skills/:id/bindings`。
