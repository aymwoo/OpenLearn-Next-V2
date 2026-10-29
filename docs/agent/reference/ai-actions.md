# AI Action 与 Agent 工具

> 插件把自己的命令暴露给 AI Agent 的唯一入口是 `ctx.services.actionRegistry.register(descriptor)`。
> 本页给出 `ActionDescriptor` 的逐字段契约、`inputSchema` 的**大写类型**要求、
> 以及运行时工具清单是怎么拼出来的。

---

## 1. `ActionDescriptor`

```typescript
// packages/core/registry/index.ts
export interface ActionDescriptor {
  readonly id: string;
  readonly commandType: string;
  readonly description: string;
  readonly inputSchema: any; // JSON Schema，直接对接 GenAI tool parameters
  readonly capabilityRequired: string;
  readonly isHighRisk?: boolean;
  readonly exposeToAgent?: boolean; // 默认 true
}
```

| 字段                 | 必填 | 作用                                              | 注意                                                                                          |
| :------------------- | :--- | :------------------------------------------------ | :-------------------------------------------------------------------------------------------- |
| `id`                 | ✅   | 注册表主键                                        | 重复注册抛 `Action <id> is already registered.`；包装层会自动补一个 `<id>__raw_alias` 别名    |
| `commandType`        | ✅   | 关联到 CommandBus 的命令                          | **写短名**（如 `poll.create`），包装层自动加 `manifest.id.` 前缀，见 §4                       |
| `description`        | ✅   | 给模型看的工具说明                                | 这是模型决定是否调用该工具的**唯一依据**，必须写清前置条件与副作用                            |
| `inputSchema`        | ✅   | 既用于**运行时 payload 校验**，也用于模型参数声明 | 类型必须**大写**，见 §3                                                                       |
| `capabilityRequired` | ✅   | 拦截器鉴权用的能力串                              | 不写 = 该 action 跳过能力检查（`if (action.capabilityRequired && !isAdmin)`）。插件应始终填写 |
| `isHighRisk`         | ❌   | 是否需人工审批                                    | 只决定审批，**不影响是否出现在 AI 工具箱**                                                    |
| `exposeToAgent`      | ❌   | 是否出现在 AI 工具箱                              | 只决定可见性，**不影响鉴权与审批**。`isHighRisk` 挡不住 AI，见 §5                             |

`ActionRegistry` 的方法（`register` / `unregister` / `getAllActions` / `getAgentTools` /
`getActionByToolName` / `getActionByCommandType`）在 `IActionRegistryService` 里全部被放宽为
`T | Promise<T>`，所以**不要 `await` 结果再取属性**之外的假设。

---

## 2. 与命令的配对关系（default-deny 的另一半）

```
commandBus.registerHandler('poll.create', handler)     ← 让命令「能执行」
actionRegistry.register({ commandType: 'poll.create', capabilityRequired, inputSchema })
                                                        ← 让命令「被允许派发」
```

内核拦截器对**没有 descriptor 的命令一律拒绝**（`403` / `COMMAND_NOT_REGISTERED`）。
详见 {doc}`command-and-event` §4。

```{important} 补 descriptor 等价于把命令交给 AI —— 除非你显式关掉
`getAgentTools()` 此前**不过滤**全部 action，因此「补 action descriptor」=
「把该命令加进 AI 工具箱」。这正是引入 `exposeToAgent` 的原因（D-5）。
纯内部命令请显式 `exposeToAgent: false`。
```

---

## 3. `inputSchema` 的类型必须大写

`inputSchema` 被两处消费，**两处的类型口径不一样**：

### 3.1 运行时校验：`validateJsonSchema`（`packages/core/kernel/index.ts`）

```typescript
const type = schema.type;
if (type === 'OBJECT') { ... }
else if (type === 'ARRAY') { ... }
else if (type === 'STRING') { ... }
else if (type === 'NUMBER') { ... }
else if (type === 'BOOLEAN') { ... }
```

```{danger} 小写类型 = 静默不校验
`type: 'object'`（小写）**不匹配任何分支**，`validateJsonSchema` 直接返回空数组。
写小写不会报错，只会让 payload 校验彻底失效。

`INTEGER` 同样**不被校验** —— 它不在上面 5 个分支里，会当"未知类型"放过。
要校验整数请写 `NUMBER`，或在 handler 里自己判 `Number.isInteger`。
```

校验错误会阻断派发并抛：

```
[PayloadValidationError] Invalid command payload for <type>: Missing required property "question"; property "options": Expected array, got string
```

行为细节：

- `required` 数组逐项检查 `req in data && data[req] !== undefined`。
- `properties` 只对**存在且非 undefined** 的键递归（缺省不报错 —— 与 `required` 配合使用）。
- `items` 对每个下标递归，错误前缀 `item at index <i>: `。
- `OBJECT` 分支对 `null` 和数组都报 `Expected object, got ...`。
- `schema` 为 falsy → 返回 `[]`（不校验）。

### 3.2 发给模型前：`normalizeToolSchema`（`server/ai-agent.ts`）

```typescript
const typeMap = {
  OBJECT: 'object',
  STRING: 'string',
  ARRAY: 'array',
  INTEGER: 'integer',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
};
normalized.type = typeMap[value.toUpperCase()] || value.toLowerCase();
```

递归处理 `properties`（逐键）与 `items`；数组整体 map；非对象原样透传；**未知键保留**。

```{note} 所以小写只是「不报错」
`normalizeToolSchema` 会把大写归一为模型要的小写，同时也能容忍小写
（`typeMap['OBJECT'] || 'object'.toLowerCase()`）。
但 `validateJsonSchema` **只认大写**。写小写的净效果：模型能看懂参数，平台不校验 payload。
```

### 3.3 推荐写法

```typescript
inputSchema: {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING', description: '投票题干，不超过 60 字' },
    options: {
      type: 'ARRAY',
      description: '候选项字符串数组，2–6 项',
      items: { type: 'STRING' },
    },
    anonymous: { type: 'BOOLEAN', description: '是否匿名，默认 false' },
    durationSec: { type: 'NUMBER', description: '作答时长（秒），默认 60' },
  },
  required: ['question', 'options'],
}
```

---

## 4. `wrapActionRegistry`：前缀与别名

```typescript
// packages/core/plugin-host/context-builder.ts
const prefix = manifestId || pluginId;
const isKernel = prefix.startsWith('@openlearn/');

register(descriptor) {
  const commandType = descriptor.commandType;
  const prefixed = isKernel || !commandType || commandType.startsWith(`${prefix}.`)
    ? commandType
    : `${prefix}.${commandType}`;
  // ...以 prefixed 注册
}
```

- 内核插件（`@openlearn/*`）**不加前缀**。
- 已自带 `manifest.id.` 前缀的不重复加。
- 加了前缀时，额外注册一个**裸名兼容别名**：

```typescript
actionRegistry.register({ ...descriptor, id: `${descriptor.id}__raw_alias`, exposeToAgent: false });
```

```{important} 别名必须 exposeToAgent: false
别名与原描述符的 `commandType` 不同（一个裸名、一个前缀名），不加这个标志就会把
**同一个能力**在 AI 工具列表里出成两条 —— 而裸名在 commandBus 里**没有 handler**
（handler 只按前缀名注册），模型选中它只会拿到「命令未注册」。

```

别名只服务「按原始 commandType 查描述符」的调用方
（如 `getActionByCommandType('grade.list_configs')`）。
`dispose` 时两个 id 一起注销。

工具名 sanitization 在**注册表与两个 builder 里是三份同源实现**：

```typescript
action.commandType.replace(/[^a-zA-Z0-9_\-]/g, '_');
```

所以 `@myteam/poll.poll.create` → `@myteam_poll_poll_create`（`@`、`.`、`/` 全变 `_`）。
`getActionByToolName(toolName)` 用同一规则反查。

---

## 5. 运行时工具清单：`buildOpenAITools(callerRole?)`

```{warning} 这才是生效的那一份
`ActionRegistry.getAgentTools()` 返回 **Gemini functionDeclarations** 格式：
`[{ functionDeclarations: [{ name, description, parameters }] }]`，全部隐藏时返回 `[]`。
但**运行时真正生效的 OpenAI 工具清单是 `buildOpenAITools()`**（`runOpenAIAgentChat` 直接用它）。

历史缺陷：此前只有 `getAgentTools()` 做了 `exposeToAgent === false` 过滤，
导致 `courseware.save_score_config` 这类作者显式声明「不应由 agent 自主决策」的命令
仍出现在大模型工具箱里；插件 action 经 method-policy 降级为 false 后也仍然漏进来。现已在此收口。
```

`buildOpenAITools` 的过滤链：

```
1. getAllActions()
2. .filter(a => a.exposeToAgent !== false)
3. if (callerRole === 'student') 额外剔除（SEC-01）：
     capabilityRequired 含 ':write' | ':delete'
     capabilityRequired 以 'management:' | 'process:' | 'plugin:' 开头
     commandType 以 'class_' | 'student_' | 'courseware.' | 'vfs.' | 'process.' 开头
4. map → { type: 'function', function: { name, description, parameters: normalizeToolSchema(inputSchema) } }
```

```{danger} isHighRisk 挡不住 AI
回归测试专门锁了这条：`isHighRisk` 不影响工具箱暴露（两者正交，防止误以为 `isHighRisk` 能挡 AI）。
要挡 AI，只有 `exposeToAgent: false`。

```

### 5.1 actor 与权限（SEC-01）

`executeAgentToolCall` 决定用谁的身份派发：

```typescript
const isAdmin = callerRole === 'administrator' || callerRole === 'admin';
const actorId = isAdmin ? 'user-frontend' : realActorId || (callerRole ? `user:agent:${callerRole}` : 'agent-system-0');
const metadata = isAdmin ? { approved: true } : undefined;
```

**不再无条件把普通调用者提升为具有全局写权限的 `agent-system-0`** ——
严格使用调用方真实 actorId（如 `user:studentId:student`），由 `CapabilityGuard` 校验。

工具找不到时返回 `{ error: 'Command / Tool not found: <toolName>' }`，
并记 `allExecutedTools.push({ callName, success: false, error: 'Command not registered' })`。

### 5.2 白板元素的 segment 回填

`whiteboard.*` 类工具若返回 `elementId` 且存在 `currentLessonId`，宿主会把
`lessonActiveSegments` 里的活跃环节注入 `data.segmentId`，并发布
`whiteboard.element_updated`（`source: 'agent-tool-sync'`）通知前端重取 ——
否则元素会被前端过滤掉、画布上看不到。这是**平台行为，插件不需要也不应该自己实现**。

---

## 6. `ai.skill.provider`：manifest 声明式技能

消费链路（v0.6.0 审计遗留 —— 该槽位此前只有 schema 与前端 store 登记、**无任何消费方**）：

```
manifest contributes['ai.skill.provider']
  → collectPluginSkills() → buildPluginSkillTools() → 注入 agent 工具列表
  → 模型调用 → executePluginSkillToolCall() 以「贡献插件自身 actor」（plugin:{manifest.id}）
  → 经 commandBus 派发 → 内核拦截器照常做 inputSchema 校验与能力检查
  → fail-closed：技能命令必须在 actionRegistry 有 descriptor，否则拒绝派发
```

```json
// manifest.json
{
  "contributes": {
    "ai.skill.provider": [
      {
        "id": "srs-review",
        "name": "间隔复习排期",
        "description": "为指定学生生成未来 7 天的复习卡片排期建议",
        "commandType": "srs.schedule",
        "parametersSchema": {
          "type": "OBJECT",
          "properties": { "studentId": { "type": "STRING" } },
          "required": ["studentId"]
        }
      }
    ]
  }
}
```

条目字段：`{ id, name, description, commandType, parametersSchema? }`。
`commandType` 缺失或非字符串 → 该条目被跳过。

### 6.1 命令名解析与绑定面收严（v0.6.1 审计 C-3/R-3）

```typescript
const isFirstParty = pluginId.startsWith('@openlearn/');
const effectiveType = isFirstParty
  ? isRegistered(commandType)
    ? commandType
    : resolvePluginCommandType(commandType, pluginId)
  : resolvePluginCommandType(commandType, pluginId); // 第三方：强制前缀化
```

| 插件                                                   | 规则                                             |
| :----------------------------------------------------- | :----------------------------------------------- |
| **第一方**（`@openlearn/*`，随宿主发布、代码在仓库内） | 允许按**原名**绑定内核直注册命令                 |
| **第三方**                                             | **只允许绑定自己命名空间内的命令**（强制前缀化） |

```{danger} 为什么第三方不能按原名
此前「原名优先」可把 `user.delete` 等宿主高危命令**绑成技能并顶替宿主工具**。
未注册的命名空间命令在派发时因缺 descriptor 被 fail-closed。
```

### 6.2 技能工具的名字

```typescript
export const SKILL_TOOL_PREFIX = 'pskill_';
const toolName = 'pskill_' + effectiveType.replace(/[^a-zA-Z0-9_\-]/g, '_');
```

`pskill_` 前缀用于**避免与 `actionRegistry` 工具名冲突**。
所以同一个命令可能以两个工具名出现在清单里（`<sanitized action id>` 与 `pskill_<sanitized type>`），
模型看到的 description 不同。

参数 schema 回落顺序：

```
skill.parametersSchema
  ?? actionRegistry.getActionByCommandType(skill.commandType)?.inputSchema
  ?? { type: 'OBJECT', properties: {} }
```

### 6.3 加载时机

`loadActivePluginSkills()` **每次会话请求时**调用（源码注释：读取消耗可忽略）：

```sql
SELECT manifest FROM plugins WHERE status = 'active' AND manifest IS NOT NULL AND manifest != ''
```

读取失败 → `console.error('[Agent] Failed to collect plugin skills: ...')` 并返回 `[]`（不抛）。
manifest JSON 解析失败的行**静默跳过**。

---

## 7. AI 上下文切片与角色模板（`ctx.services.ai`）

```typescript
interface IAIService {
  generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string>;

  registerAIContextProvider?(id: string, fn: (lessonId: string | null) => string | null): void;
  unregisterAIContextProvider?(id: string): void;

  registerAIPersona?(persona: AIPersonaDefinition): void;
  listAIPersonas?(): AIPersonaDefinition[];
  unregisterAIPersona?(id: string): void;
}

interface AIPersonaDefinition {
  id: string;
  nameZh: string;
  nameEn: string;
  instructionZh: string;
  instructionEn: string;
  icon?: string;
}
```

全部为**可选方法** —— mock 或旧部署可缺省，包装层用 `(aiService as any).xxx?.()` 调用。
所以调用前请判 `typeof ai.registerAIPersona === 'function'`。

| 能力                        | 可达性                         | 说明                                                                                 |
| :-------------------------- | :----------------------------- | :----------------------------------------------------------------------------------- |
| `generateText`              | inline / worker / process 均可 | 委托数据库里配置的 OpenAI 兼容提供商，返回 `trim()` 后的文本                         |
| `registerAIContextProvider` | ⚠ **仅 Inline**                | `fn` 是**服务端闭包**，Worker 序列化边界无法传递函数。Agent 对话时按 `lessonId` 调用 |
| `registerAIPersona`         | inline / worker 均可           | `persona` 是可序列化静态模板；教师聊天面板可选；宿主内置角色**可被同名覆盖**         |
| `listAIPersonas`            | —                              | 返回 builtin + plugin 全部                                                           |
| `unregisterAIPersona`       | —                              | builtin 不可注销；仅注册者可注销自身模板（包装层自动带 `pluginId`）                  |

`registerAIPersona` 会把 `registeredBy: pluginId` 注入 persona，用于归属判定。

```{note} 审计 D-1：这两类注册此前没有 disposer
- persona → `server/ai-persona-registry` 全局单例 → `routes/os.ts` 返回前端
  → **停用插件的 AI 角色模板仍出现在 Agent 面板的角色下拉里**；
- context provider → **每次 AI 请求都会被注入已停用插件的上下文**。
且 `uninstallPlugin` 也不调注销。现在两者都登记 disposer 到 `ResourceTracker`。
```

### 7.1 Agent 系统指令随角色变

`buildAgentSystemInstruction(lang, currentLessonId?, pluginSlices?, persona?, callerRole?)`：

- `callerRole === 'student'` → 学生助教人格，明确声明"你没有管理班级、修改成绩或操作系统底层的权限"。
- 其他 → OS Agent 人格，提示使用 `process.spawn/kill/list`、`vfs.*`、
  `class_create` / `student_create` / `class_add_student` 工具链式调用
  （先创建拿到 ID，下一轮 `functionCall` 引用这些 ID）。
- `pluginSlices` 来自各插件注册的 context provider 返回值。

---

## 8. 完整示例

```typescript
import type { Manifest } from '@openlearn/plugin-sdk';

export const manifest: Manifest = {
  id: '@myteam/lesson-prep-ai',
  version: '1.0.0',
  capabilitiesProposed: ['lesson:write'],
  contributes: {
    'ai.skill.provider': [
      {
        id: 'gen-outline',
        name: '生成课程大纲',
        description: '按主题生成分层教学大纲并写入课时',
        commandType: 'prep.gen_outline',
        parametersSchema: {
          type: 'OBJECT',
          properties: { title: { type: 'STRING' }, minutes: { type: 'NUMBER' } },
          required: ['title'],
        },
      },
    ],
  },
};

export async function activate(ctx) {
  const { actionRegistry, commandBus, ai } = ctx.services;
  if (!actionRegistry || !commandBus) return;

  // 1) 高危内部命令：有 descriptor 但不给 AI
  await actionRegistry.register({
    id: 'prep.wipe_draft',
    commandType: 'prep.wipe_draft',
    description: '清空当前草稿（仅供 HTTP 路由调用）',
    capabilityRequired: 'lesson:write',
    isHighRisk: true,
    exposeToAgent: false, // ← 关 AI 只能靠这个
    inputSchema: { type: 'OBJECT', properties: {}, required: [] },
  });
  await commandBus.registerHandler('prep.wipe_draft', {
    async execute() {
      /* ... */
    },
  });

  // 2) 面向 AI 的工具
  await actionRegistry.register({
    id: 'prep.gen_outline',
    commandType: 'prep.gen_outline', // 与 manifest 里的技能同名 → 复用同一 descriptor
    description: '按主题生成分层教学大纲并写入课时草稿。需要 title；minutes 可选，默认 45。',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT', // ← 大写
      properties: {
        title: { type: 'STRING', description: '课程主题' },
        minutes: { type: 'NUMBER', description: '课时时长（分钟）' },
      },
      required: ['title'],
    },
  });
  await commandBus.registerHandler('prep.gen_outline', {
    async execute(cmd) {
      const { title, minutes } = cmd.payload as { title: string; minutes?: number };
      const draft = ai ? await ai.generateText(`为主题「${title}」写 45 分钟分层大纲`, { temperature: 0.4 }) : '';
      return { ok: true, draft };
    },
  });

  // 3) 角色模板（可序列化，worker 也能注册）
  if (typeof ai?.registerAIPersona === 'function') {
    ai.registerAIPersona({
      id: '@myteam/lesson-prep-ai/prep-coach',
      nameZh: '备课教练',
      nameEn: 'Prep Coach',
      instructionZh: '你帮助教师把模糊想法拆成可执行的课时结构。',
      instructionEn: 'You help teachers turn rough ideas into runnable lesson structure.',
      icon: 'book-open',
    });
  }

  // 4) 上下文切片 —— 仅 inline 可用
  if (typeof ai?.registerAIContextProvider === 'function') {
    ai.registerAIContextProvider('@myteam/lesson-prep-ai/preferences', (lessonId) =>
      lessonId ? `该教师偏好 45 分钟课时、小组合作占比 30%。` : null,
    );
  }
}
```

---

## 9. 自检清单

- [ ] 每个 `registerHandler` 都有配对 `actionRegistry.register`，且**描述符先注册**
- [ ] `inputSchema.type` 全大写（`OBJECT` / `STRING` / `NUMBER` / `BOOLEAN` / `ARRAY`），不用 `INTEGER` 指望校验
- [ ] `ARRAY` 一定带 `items`，`OBJECT` 一定带 `properties` + `required`
- [ ] `capabilityRequired` 填了，且值在 {doc}`capabilities` 的真实清单里
- [ ] 不希望 AI 自主决策的命令显式 `exposeToAgent: false`（`isHighRisk` 不算）
- [ ] `commandType` 在 `registerHandler` / `actionRegistry` / manifest 里都写**短名**
- [ ] `ai.skill.provider[].commandType` 与自注册的 descriptor 能对上（第三方会被强制前缀化）
- [ ] 调 `ai.registerAIContextProvider` 前判 `typeof === 'function'`，并在文档里注明仅 inline 可用
- [ ] `id` 全局唯一（建议 `"<插件短名>.<动作>"`），避免与内置 action 撞 `id`

---

## 取证

| 论断                                                                                                                                             | 来源                                                                      |
| :----------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------ |
| `ActionDescriptor` 全字段与 `exposeToAgent` 契约注释                                                                                             | `packages/core/registry/index.ts`                                         |
| `register` 重复 id 抛错、`getAgentTools()` 的 Gemini 格式与过滤、tool name sanitization                                                          | 同上                                                                      |
| `wrapActionRegistry` 前缀规则、`__raw_alias` 与 `exposeToAgent: false`                                                                           | `packages/core/plugin-host/context-builder.ts`                            |
| default-deny 与 `COMMAND_NOT_REGISTERED`                                                                                                         | `packages/core/kernel/index.ts`（`setInterceptor`）                       |
| `validateJsonSchema` 仅认 5 个大写类型                                                                                                           | `packages/core/kernel/index.ts`（`validateJsonSchema`）                   |
| `normalizeToolSchema` 大写→小写映射、递归 `properties`/`items`、保留未知键                                                                       | `server/ai-agent.ts`                                                      |
| `buildOpenAITools` 双过滤（`exposeToAgent` + 学生角色剔除清单）与「运行时生效的是本函数」注释                                                    | `server/ai-agent.ts`                                                      |
| `executeAgentToolCall` 的 actor 选择（SEC-01）、白板 segment 回填                                                                                | `server/ai-agent.ts`                                                      |
| `PluginSkillTool` / `SKILL_TOOL_PREFIX` / `collectPluginSkills` 绑定面收严 / `executePluginSkillToolCall` fail-closed / `loadActivePluginSkills` | `server/ai-agent.ts`                                                      |
| `buildAgentSystemInstruction` 角色分支                                                                                                           | `server/ai-agent.ts`                                                      |
| `IAIService` / `AIPersonaDefinition` 与「仅 Inline」注释                                                                                         | `packages/core/di/interfaces.ts`                                          |
| `wrapAI` 的 disposer 登记（审计 D-1）                                                                                                            | `packages/core/plugin-host/context-builder.ts`                            |
| `exposeToAgent` / `isHighRisk` 正交的回归断言                                                                                                    | `packages/core/registry/__tests__/action-registry-agent-exposure.test.ts` |
