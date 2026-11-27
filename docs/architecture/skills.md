# Skills 运行时

> 状态：P0（备课场景已接入；设置与课堂场景待 P1/P2）。
> 代码位置：`server/skill-registry.ts`、`server/routes/skills.ts`、`src/features/skills/`。

## 定位

Skill 不是新的执行通道，也不新建第二套 AI 链路。它是 `ai.skill.provider` 之上的
**编排层**：宿主把插件声明（或内置种子）归一为技能目录，按场景/角色过滤后，
只把选定技能声明的工具注入 Agent，并把模型输出解析为可预览、可确认的产物。

概念边界：

| 概念      | 回答的问题               | 载体                                                |
| --------- | ------------------------ | --------------------------------------------------- |
| Plugin    | 谁交付、怎么装、有何权限 | `manifest` + `capabilitiesProposed`                 |
| Persona   | 以什么身份/风格说        | `server/ai-persona-registry.ts`                     |
| **Skill** | 做什么、怎么做、产出什么 | `ai.skill.provider` + `server/skill-registry.ts`    |
| Action    | 原子操作                 | `actionRegistry` / `commandBus`                     |
| Surface   | 在哪用、自主度多高       | `lesson_prep` / `admin_settings` / `classroom_live` |
| Artifact  | 产物与落地               | P0：`lesson_segments`                               |

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

## 场景接入

| 场景             | 入口                           | 上下文                         | 产物              | 落地方式                                     |
| ---------------- | ------------------------------ | ------------------------------ | ----------------- | -------------------------------------------- |
| `lesson_prep`    | 备课编辑器头部「技能」按钮     | 课节标题 / 已有环节 / 内容摘要 | `lesson_segments` | 教师确认后走 `PUT /api/lessons/:id/timeline` |
| `admin_settings` | 管理后台「AI 配置 → 技能管理」 | 运行时策略快照                 | `config_patch`    | 管理员确认后 `setRuntimePolicies` + 旧值快照 |
| `classroom_live` | 课堂顶栏「技能」按钮           | 课节 / 班级 / 阶段 / 当前环节  | `classroom_card`  | 教师确认后 `whiteboardService.drawElement`   |

## 运行时接口

- `GET /api/skills?surface=`：当前角色可见的技能目录（已过滤停用技能）。
- `POST /api/skills/:id/run`：运行技能，返回 `runId`、文本与结构化产物；
  按 `surface` 做鉴权：备课校验课节归属、设置仅管理员、课堂校验班级 staff 权限。
- `POST /api/skills/:id/apply-card`：课堂卡片投屏（白板文本元素）。
- `POST /api/skills/:id/apply-config`：应用 `config_patch`；只接受白名单字段，
  写入前保存旧值快照。
- `GET/PATCH /api/admin/skills`：技能目录与启停 / 场景覆盖。
- `GET /api/admin/skill-runs`、`POST /api/admin/skill-runs/:runId/rollback`：
  运行审计与配置回滚。

## 数据表

| 表                       | 用途                                           |
| ------------------------ | ---------------------------------------------- |
| `skill_settings`         | 管理员启停与场景覆盖（未设置 = 沿用 manifest） |
| `skill_runs`             | 每次运行的状态、产物类型、操作者与作用域       |
| `skill_config_rollbacks` | `config_patch` 的旧值快照与应用/回滚记录       |

## 关键约束

- `requiresConfirm: true` 的工具不会被 Agent 自主执行，而是进入 `pendingConfirmations`。
- 选定技能时，宿主仅挂载技能声明的命令；技能未声明工具时不挂载任何宿主工具。
- `config_patch` 只能写受控字段（`hookTelemetryEnabled` / `httpAccessLog*` /
  `httpSlowMs` / `allowUnsignedByDefault` / `modePacks*`），模型给出的其他字段会被丢弃。
- 所有产物写库都复用既有 REST + commandBus / service 路径，技能运行时本身不直写业务表。

## 脚本类技能沙箱

插件可在 `ai.skill.provider` 条目中声明内联脚本：

```json
{
  "id": "@scope/demo:focus-card",
  "outputKind": "classroom_card",
  "surfaces": ["classroom_live"],
  "script": { "source": "return { title: '专注提醒', body: '请回到任务' }", "timeoutMs": 200 }
}
```

- **能力门禁**：插件必须在 `capabilitiesProposed` 声明并获得 `skill:script`；未获批时脚本被剥离，技能退化为普通技能。
- **隔离**：`node:vm` 新上下文 + 禁用 `eval`/`Function`/WebAssembly；不暴露 `require`、`process`、文件系统与网络。
- **预算**：源码 ≤32KB、同步执行硬超时 50–3000ms（默认 800ms）、输出 ≤64KB、日志 ≤20 条 / 4KB。
- **执行**：脚本返回对象按 `outputKind` 归一化（`lesson_segments` / `config_patch` / `classroom_card`），非法输出直接失败。
- **定位**：当前实现面向「可信插件 + 管理员批准」场景；需要进程级隔离的脚本应等待后续 worker 沙箱。

## 细粒度绑定

`skill_bindings` 按 `(skill, surface, scope_type, scope_id)` 覆盖技能可用性：

| 维度       | 取值                                                         |
| ---------- | ------------------------------------------------------------ |
| scope_type | `global`（scope_id 为空）/ `class` / `lesson`                |
| 解析优先级 | lesson > class > global > `skill_settings`                   |
| 作用       | 最具体的绑定会覆盖全局启停（可用于「全局关闭、单节课开启」） |
| roles_json | `NULL` = 跟随技能声明；数组 = 该绑定内只允许这些角色         |

角色合并规则：**绑定只能收窄技能声明的 `roles`，不能扩大**，最终角色 =
声明 ∩ 绑定。未声明 `roles` 的技能默认角色为 `teacher + administrator`，因此
绑定写 `student` 时交集为空（该范围内无人可用，fail-closed）。学生侧 SEC-01
仍是硬底线。

管理端接口：

- `GET /api/admin/skills/:id/bindings`
- `PUT /api/admin/skills/:id/bindings`（`{ surface, scopeType, scopeId, enabled, roles? }`）
- `DELETE /api/admin/skills/:id/bindings?surface=&scopeType=&scopeId=`

运行时目录与运行接口都会带上 `lessonId` / `classId` 解析绑定；`/api/agent/chat` 同样接受 `classId`。

## 状态

- **P0 / P1 / P2 已完成**：备课环节生成、管理端启停与配置体检、课堂卡片投屏。
- **脚本沙箱、细粒度绑定与角色收窄已完成**：`skill:script` 能力门禁 + `node:vm` 隔离执行；`skill_bindings` 支持全局 / 班级 / 课节三级覆盖与角色交集。
- 待办：技能市场导入、进程级（worker）脚本隔离、管理员 super-role 语义。

## 相关文档

- [插件清单规范](../plugin/plugin-manifest-spec.md)
- [AI Runtime 内核](../ai/ai-runtime.md)
- [插件 UI 扩展槽位](../reference/plugin-ui-extension-slots.md)
