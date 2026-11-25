# Skills 运行时

> 状态：P0（备课场景已接入；设置与课堂场景待 P1/P2）。
> 代码位置：`server/skill-registry.ts`、`server/routes/skills.ts`、`src/features/skills/`。

## 定位

Skill 不是新的执行通道，也不新建第二套 AI 链路。它是 `ai.skill.provider` 之上的
**编排层**：宿主把插件声明（或内置种子）归一为技能目录，按场景/角色过滤后，
只把选定技能声明的工具注入 Agent，并把模型输出解析为可预览、可确认的产物。

概念边界：

| 概念         | 回答的问题             | 载体                                       |
| ------------ | ---------------------- | ------------------------------------------ |
| Plugin       | 谁交付、怎么装、有何权限 | `manifest` + `capabilitiesProposed`        |
| Persona      | 以什么身份/风格说       | `server/ai-persona-registry.ts`            |
| **Skill**    | 做什么、怎么做、产出什么 | `ai.skill.provider` + `server/skill-registry.ts` |
| Action       | 原子操作               | `actionRegistry` / `commandBus`            |
| Surface      | 在哪用、自主度多高       | `lesson_prep` / `admin_settings` / `classroom_live` |
| Artifact     | 产物与落地             | P0：`lesson_segments`                      |

## 注册表

`server/skill-registry.ts` 提供：

- `parseManifestSkills()`：把 manifest 条目归一为 `SkillDescriptor`。旧条目（只有
  `id/name/description/commandType`）保持合法，等价于「单工具技能」。
- `listSkillCatalog({ surface, role })`：内置种子 + active 插件技能的目录，按
  `surfaces` 与 `roles` 过滤；未声明 `roles` 的技能默认排除 `student`（SEC-01）。
- `resolvePluginSkillTools({ surface, callerRole, skillId })`：选定技能时只返回该技能
  声明的工具；未选定时保持旧的「全量插件技能」行为。
- `parseSkillArtifact()`：从模型文本解析产物，解析失败时回退为单个环节，保证备课端
  始终有可预览、可插入的结果。

## 运行时

`POST /api/skills/:id/run` 的链路：

```
技能目录 → 选定 skillId
  → 校验 surface / role 可见性（fail-closed）
  → 校验课节归属（lesson_prep）
  → 读取课节标题 / 已有环节 / 内容摘要作为上下文
  → runOpenAIAgentChat（skillId 收窄工具 + 注入技能指令 + 技能 maxTurns）
  → parseSkillArtifact → 返回预览
  → 教师确认 → 前端调用既有 PUT /api/lessons/:id/timeline
  → lesson.update_timeline 命令（调用者 actor）落库
```

关键约束：

- `requiresConfirm: true` 的工具不会被 Agent 自主执行，而是进入 `pendingConfirmations`。
- 选定技能时，宿主仅挂载技能声明的命令；技能未声明工具时不挂载任何宿主工具。
- 产物写库仍走既有 REST + commandBus 路径，技能运行时本身不直接写业务表。

## P0 范围

- 场景：`lesson_prep`（备课编辑器头部的「技能」按钮）。
- 内置技能：`lesson.plan.generate`（课时教案生成 → `lesson_segments`）。
- 接口：`GET /api/skills?surface=`、`POST /api/skills/:id/run`。
- 未实现（P1/P2）：技能管理与绑定、`config_patch` 产物、课堂快捷技能、运行记录持久化。

## 相关文档

- [插件清单规范](../plugin/plugin-manifest-spec.md)
- [AI Runtime 内核](../ai/ai-runtime.md)
- [插件 UI 扩展槽位](../reference/plugin-ui-extension-slots.md)
