// AI-agent chat logic (extracted verbatim from server.ts, lines 74-430).
//
// These functions previously lived at the top of server.ts as module-level
// `const`s. They reference the kernel singleton exactly as before — the import
// path is preserved so behavior is unchanged. See
// server/__tests__/ai-agent.test.ts for the characterization tests.

import crypto from 'crypto';
import { kernelContainer } from '../packages/core/kernel/index.js';
import { fetchWithRetry } from '../packages/core/ai/utils/fetch-with-retry.js';
import { resolvePluginCommandType } from '../packages/core/plugin-host/plugin-namespace.js';
import { lessonActiveSegments } from './shared-state.js';
import { collectAIContextSlices } from './ai-context-registry.js';
import {
  DEFAULT_PERSONA_TURNS,
  MAX_PERSONA_TURNS,
  getAIPersona,
  type AIPersona,
  type AIPersonaToolPolicy,
} from './ai-persona-registry.js';
import type { AgentChatAttachment, AgentChatRequest, AgentToolExecution, StoredAIProvider } from './context.js';

export interface AgentPersonaPromptInput {
  nameZh: string;
  instructionZh: string;
  nameEn: string;
  instructionEn: string;
  mode?: 'overlay' | 'replace';
  basePolicy?: 'inherit' | 'drop';
}

export const buildAgentSystemInstruction = (
  lang: 'zh' | 'en',
  currentLessonId?: string | null,
  pluginSlices?: string[],
  persona?: AgentPersonaPromptInput,
  callerRole?: string,
) => {
  const mode = persona?.mode ?? 'overlay';
  const basePolicy = persona?.basePolicy ?? (mode === 'replace' ? 'drop' : 'inherit');

  let baseInstruction = '';
  if (basePolicy === 'inherit') {
    if (callerRole === 'student') {
      baseInstruction =
        lang === 'zh'
          ? '你是一个面向学生的智能学习助教。你需要耐心解答学生的学科问题，提供启发式的思考建议与学习支持。请注意：你没有管理班级、修改成绩或操作系统底层的权限。请始终以积极、鼓励的态度引导学生自主探究。'
          : 'You are an intelligent learning assistant for students. Answer students questions, provide thought-provoking guidance and learning support. You do not have permissions to manage classes, edit scores, or alter system configurations. Always guide students encouragingly.';
    } else {
      baseInstruction =
        lang === 'zh'
          ? '你是一个教育系统底层的 OS Agent。你需要理解老师的指令，并调用可用的工具（命令）去执行这些操作。如果老师让你创建一节课，请务必利用工具生成详细的初始课程内容。如果老师要求管理进程/任务，请使用 process.spawn, process.kill, process.list。如果需存储文件、素材或创建目录，请使用 vfs.* 并在需要时管理班级和学生。你支持通过 class_create 创建班级, student_create 创建学生, class_add_student 将学生加入班级。当老师要求从提供的数据（如CSV、JSON、Markdown或对话中）创建班级或学生时，请依次发出这些指令。如果上一阶段返回了创建成功的班级ID或学生ID，你需要在后续的 functionCall 中引用这些ID（例如：把刚创建的学生ID加入到刚创建的班级ID中）。通过往复的工具调用，你可以自动完成完整的流程。'
          : 'You are an educational OS kernel agent. You interpret teacher instructions and use your available tools (commands) to execute them. If the teacher asks to create a lesson, always generate some detailed initial content for it. If the teacher asks to spawn or kill processes, use process tools. Use vfs tools to store assets, and manage classes/students as necessary. You support class_create, student_create, class_add_student. Always use tool chaining if you need to create a class and enroll students: first call class_create/student_create, receive their returned IDs, and then call class_add_student in the next turn. Always answer with a helpful summary.';
    }
  }

  let systemInstruction = baseInstruction;

  const appendSection = (section: string) => {
    if (!section) return;
    systemInstruction = systemInstruction ? `${systemInstruction}\n\n${section}` : section;
  };

  const personaName = persona ? (lang === 'zh' ? persona.nameZh : persona.nameEn) : '';
  const personaInstruction = persona
    ? ((lang === 'zh' ? persona.instructionZh : persona.instructionEn) ?? '').trim()
    : '';
  const personaBlock = persona && personaInstruction ? `[Persona · ${personaName}]\n${personaInstruction}` : '';

  if (mode === 'replace') {
    if (basePolicy === 'drop') {
      systemInstruction = personaBlock;
    } else {
      appendSection(personaBlock);
    }
  }

  if (currentLessonId) {
    const contextBlock = `[Context] The current selected lesson ID is "${currentLessonId}". Use this ID if the teacher's instruction is about modifying or adding to the current lesson.\n\nAvailable tools (functions) can be used multiple times in sequence if needed.`;
    systemInstruction = systemInstruction ? `${systemInstruction}\n${contextBlock}` : contextBlock;
  }

  // P2: ai.context.provider —— 插件注册的上下文切片；学生角色默认不继承插件切片（SEC 隔离）
  if (callerRole !== 'student' && pluginSlices?.length) {
    appendSection(pluginSlices.join('\n\n'));
  }

  // overlay 模式：在基础指令与上下文之后叠加角色段落（无 instruction 时跳过）
  if (mode === 'overlay') {
    appendSection(personaBlock);
  }

  return systemInstruction;
};

export const buildAgentFinalMessage = (message: string, attachments?: AgentChatAttachment[]) => {
  let finalMessage = message;
  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    finalMessage += '\n\n[Attached Reference Files]';
    attachments.forEach((file, index) => {
      if (file.name.endsWith('.zip') || file.content.startsWith('data:application/zip') || file.content.length > 5000) {
        finalMessage += `\n\nFilename: "${file.name}"\nContent: "ATTACHMENT_BASE64:${index}"`;
      } else {
        finalMessage += `\n\nFilename: "${file.name}"\nContent:\n"""\n${file.content}\n"""`;
      }
    });
  }
  return finalMessage;
};

export const normalizeToolSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normalizeToolSchema);

  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') {
      const typeMap: Record<string, string> = {
        OBJECT: 'object',
        STRING: 'string',
        ARRAY: 'array',
        INTEGER: 'integer',
        NUMBER: 'number',
        BOOLEAN: 'boolean',
      };
      normalized.type = typeMap[value.toUpperCase()] || value.toLowerCase();
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      normalized.properties = Object.fromEntries(
        Object.entries(value).map(([propKey, propSchema]) => [propKey, normalizeToolSchema(propSchema)]),
      );
      continue;
    }

    if (key === 'items') {
      normalized.items = normalizeToolSchema(value);
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
};

export function isActionAllowedForRole(
  action: { commandType: string; capabilityRequired?: string; exposeToAgent?: boolean },
  callerRole?: string,
): boolean {
  if (action.exposeToAgent === false) return false;
  if (callerRole === 'student') {
    // SEC-01: 学生角色下，严格剔除一切具有管理、修改、删除或系统副作用的工具
    const cap = action.capabilityRequired || '';
    if (
      cap.includes(':write') ||
      cap.includes(':delete') ||
      cap.startsWith('management:') ||
      cap.startsWith('process:') ||
      cap.startsWith('plugin:') ||
      action.commandType.startsWith('class_') ||
      action.commandType.startsWith('student_') ||
      action.commandType.startsWith('courseware.') ||
      action.commandType.startsWith('vfs.') ||
      action.commandType.startsWith('process.')
    ) {
      return false;
    }
  }
  return true;
}

export function matchesToolPattern(pattern: string, toolName: string, commandType?: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (trimmed === '*') return true;

  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  if (regex.test(toolName)) return true;
  if (commandType && regex.test(commandType)) return true;
  return false;
}

export function isToolAllowedByPolicy(
  candidate: { toolName: string; commandType?: string },
  policy?: AIPersonaToolPolicy,
): boolean {
  if (!policy) return true;
  if (Array.isArray(policy.allow)) {
    const allowed = policy.allow.some((pattern) =>
      matchesToolPattern(pattern, candidate.toolName, candidate.commandType),
    );
    if (!allowed) return false;
  }
  if (Array.isArray(policy.deny) && policy.deny.length > 0) {
    const denied = policy.deny.some((pattern) =>
      matchesToolPattern(pattern, candidate.toolName, candidate.commandType),
    );
    if (denied) return false;
  }
  return true;
}

export function resolvePersonaMaxTurns(maxTurns?: number): number {
  if (typeof maxTurns !== 'number' || !Number.isFinite(maxTurns)) {
    return DEFAULT_PERSONA_TURNS;
  }
  return Math.min(MAX_PERSONA_TURNS, Math.max(1, Math.trunc(maxTurns)));
}

export function resolveToolsForPersona(
  callerRole?: string,
  persona?: Pick<AIPersona, 'toolPolicy'>,
  explicitPluginSkills?: PluginSkillTool[],
) {
  // SEC-01: 若为学生身份，插件贡献的高危技能不注入工具列表
  const rawSkills = callerRole === 'student' ? [] : (explicitPluginSkills ?? loadActivePluginSkills());
  const filteredSkills = rawSkills.filter((skill) =>
    isToolAllowedByPolicy({ toolName: skill.toolName, commandType: skill.commandType }, persona?.toolPolicy),
  );
  const skillCommandTypes = new Set(filteredSkills.map((s) => s.commandType));

  // 先构建角色可用基线工具，再按 persona.toolPolicy 收窄，最后再做 SEC-01 学生裁剪交集校验
  const actions = kernelContainer.actionRegistry.getAllActions();
  const actionByToolName = new Map(actions.map((a) => [a.commandType.replace(/[^a-zA-Z0-9_-]/g, '_'), a] as const));

  const baseTools = buildOpenAITools(callerRole).filter((t) => {
    const action =
      actionByToolName.get(t.function.name) ?? kernelContainer.actionRegistry.getActionByToolName(t.function.name);
    if (action && skillCommandTypes.has(action.commandType)) return false;
    if (!isToolAllowedByPolicy({ toolName: t.function.name, commandType: action?.commandType }, persona?.toolPolicy)) {
      return false;
    }
    if (action && !isActionAllowedForRole(action, callerRole)) {
      return false;
    }
    return true;
  });

  const tools = [...baseTools, ...buildPluginSkillTools(filteredSkills)];
  const allowedToolNames = new Set(tools.map((t) => t.function.name));

  return { tools, filteredSkills, allowedToolNames };
}

export const buildOpenAITools = (callerRole?: string) => {
  const actions = kernelContainer.actionRegistry
    .getAllActions()
    .filter((action) => isActionAllowedForRole(action, callerRole));
  return actions.map((action) => ({
    type: 'function',
    function: {
      name: action.commandType.replace(/[^a-zA-Z0-9_-]/g, '_'),
      description: action.description,
      parameters: normalizeToolSchema(action.inputSchema),
    },
  }));
};

// ── ai.skill.provider —— 插件贡献的 AI 技能（真实工具注入 + 插件 actor 派发）──
//
// v0.6.0 审计遗留：该槽位此前只有 schema 与前端 store 登记，无任何消费方。
// 现在的消费链路：插件 manifest `contributes['ai.skill.provider']` → agent
// 工具列表注入（OpenAI function calling）→ 模型调用 → 以**贡献插件的自身
// actor**（`plugin:{manifest.id}`，激活时已获 capabilitiesProposed 授权）经
// commandBus 派发 → 内核拦截器照常做 inputSchema 校验与能力检查。
// fail-closed：技能命令必须在 actionRegistry 有 descriptor，否则拒绝派发。

export interface PluginSkillTool {
  /** OpenAI function name（pskill_ 前缀，避免与 actionRegistry 工具名冲突） */
  toolName: string;
  skillName: string;
  description: string;
  /** 已解析为总线上真实注册名的命令类型 */
  commandType: string;
  parametersSchema?: Record<string, unknown>;
  /** 贡献插件的内核 actor —— 拥有该插件 capabilitiesProposed 授予的能力 */
  pluginActorId: string;
  pluginId: string;
}

export const SKILL_TOOL_PREFIX = 'pskill_';

export const skillToolName = (commandType: string): string =>
  SKILL_TOOL_PREFIX + commandType.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * 从 manifest 来源集合收集插件技能。
 *
 * 命令名解析：优先按 manifest 声明的原名（内核直注册的内置插件命令，
 * 如内核插件的领域命令 —— 注册时即用完整命令名）；原名无 descriptor 时回退
 * 插件命名空间规则（worker 插件的 handler 注册在 `pluginId.` 前缀下）。
 *
 * @param manifestSources  manifest JSON 字符串或已解析对象
 * @param isRegistered     命令名是否已有 actionRegistry descriptor（默认查内核注册表）
 */
export const collectPluginSkills = (
  manifestSources: Array<string | object | null | undefined>,
  isRegistered: (commandType: string) => boolean = (ct) => !!kernelContainer.actionRegistry.getActionByCommandType(ct),
): PluginSkillTool[] => {
  const skills: PluginSkillTool[] = [];
  for (const source of manifestSources) {
    if (!source) continue;
    let manifest: any;
    try {
      manifest = typeof source === 'string' ? JSON.parse(source) : source;
    } catch {
      continue;
    }
    const pluginId = String(manifest?.id ?? '');
    const entries = manifest?.contributes?.['ai.skill.provider'];
    if (!pluginId || !Array.isArray(entries)) continue;

    for (const raw of entries) {
      if (!raw || typeof raw !== 'object') continue;
      const { id, name, description, commandType, parametersSchema } = raw as Record<string, unknown>;
      if (!commandType || typeof commandType !== 'string') continue;
      // 绑定面收严（v0.6.1 审计 C-3/R-3）：
      // - 第一方（@openlearn/*，随宿主发布、代码在仓库内）：允许按原名绑定
      //   内核直注册命令（@openlearn/* 内置插件）；
      // - 第三方：**只允许绑定自己命名空间内的命令**（强制前缀化）——此前
      //   「原名优先」可把 user.delete 等宿主高危命令绑成技能并顶替宿主
      //   工具。未注册的命名空间命令在派发时因缺 descriptor 被 fail-closed。
      const isFirstParty = pluginId.startsWith('@openlearn/');
      const effectiveType = isFirstParty
        ? isRegistered(commandType)
          ? commandType
          : resolvePluginCommandType(commandType, pluginId)
        : resolvePluginCommandType(commandType, pluginId);
      skills.push({
        toolName: skillToolName(effectiveType),
        skillName: String(name ?? id ?? effectiveType),
        description: String(description ?? ''),
        commandType: effectiveType,
        parametersSchema:
          parametersSchema && typeof parametersSchema === 'object'
            ? (parametersSchema as Record<string, unknown>)
            : undefined,
        pluginActorId: `plugin:${pluginId}`,
        pluginId,
      });
    }
  }
  return skills;
};

/** 从 DB 读取全部 active 插件的 manifest 并收集技能（每次会话请求时调用，读取消耗可忽略）。 */
export const loadActivePluginSkills = (): PluginSkillTool[] => {
  try {
    const rows = kernelContainer.db
      .prepare("SELECT manifest FROM plugins WHERE status = 'active' AND manifest IS NOT NULL AND manifest != ''")
      .all() as Array<{ manifest: string }>;
    return collectPluginSkills(rows.map((r) => r.manifest));
  } catch (err: unknown) {
    console.error('[Agent] Failed to collect plugin skills:', err instanceof Error ? err.message : String(err));
    return [];
  }
};

export const buildPluginSkillTools = (skills: PluginSkillTool[]) =>
  skills.map((skill) => ({
    type: 'function',
    function: {
      name: skill.toolName,
      description: skill.description || skill.skillName,
      parameters: normalizeToolSchema(
        skill.parametersSchema ??
          kernelContainer.actionRegistry.getActionByCommandType(skill.commandType)?.inputSchema ?? {
            type: 'OBJECT',
            properties: {},
          },
      ),
    },
  }));

export const findSkillByToolName = (skills: PluginSkillTool[], toolName: string): PluginSkillTool | undefined =>
  skills.find((s) => s.toolName === toolName);

/** 以贡献插件 actor 派发技能命令（descriptor 缺失时 fail-closed）。 */
export const executePluginSkillToolCall = async (
  skill: PluginSkillTool,
  args: any,
  allExecutedTools: AgentToolExecution[],
): Promise<any> => {
  const actionDesc = kernelContainer.actionRegistry.getActionByCommandType(skill.commandType);
  if (!actionDesc) {
    allExecutedTools.push({ callName: skill.toolName, success: false, error: 'Command not registered' });
    return { error: `Plugin skill command not registered: ${skill.commandType}` };
  }
  const cmd = kernelContainer.commandBus.createCommand(skill.commandType, args, skill.pluginActorId);
  try {
    const cmdResult = (await kernelContainer.commandBus.execute(cmd)) as any;
    allExecutedTools.push({ callName: skill.toolName, success: true, result: cmdResult });
    return cmdResult;
  } catch (err: any) {
    allExecutedTools.push({ callName: skill.toolName, success: false, error: err?.message });
    return { error: err?.message };
  }
};

export const executeAgentToolCall = async (
  toolName: string,
  args: any,
  allExecutedTools: AgentToolExecution[],
  callerRole?: string,
  currentLessonId?: string | null,
  realActorId?: string,
) => {
  const actionDesc = kernelContainer.actionRegistry.getActionByToolName(toolName);
  let actionResult: any;

  // When the caller is an administrator, elevate the agent to superadmin
  // and auto-approve high-risk operations (no manual approval queue).
  const isAdmin = callerRole === 'administrator' || callerRole === 'admin';
  // SEC-01: 不再无条件将普通调用者提升为具有全局写权限的特权 agent-system-0
  // 严格使用调用方的真实 actorId（如 user:studentId:student），由 CapabilityGuard 进行能力校验
  const actorId = isAdmin
    ? 'user-frontend'
    : realActorId || (callerRole ? `user:agent:${callerRole}` : 'agent-system-0');
  const metadata = isAdmin ? { approved: true } : undefined;

  if (actionDesc) {
    const cmd = kernelContainer.commandBus.createCommand(actionDesc.commandType, args, actorId, metadata);
    try {
      const cmdResult = (await kernelContainer.commandBus.execute(cmd)) as any;
      actionResult = cmdResult;
      allExecutedTools.push({ callName: toolName, success: true, result: cmdResult });

      // If a whiteboard element was successfully drawn, let's make sure it is associated
      // with the current active segment so it isn't filtered out by the frontend!
      if (cmdResult && cmdResult.elementId && currentLessonId) {
        const activeSeg = lessonActiveSegments.get(currentLessonId);
        if (activeSeg) {
          const row = kernelContainer.db
            .prepare('SELECT data FROM whiteboard_elements WHERE id = ?')
            .get(cmdResult.elementId) as { data: string } | undefined;
          if (row) {
            try {
              const dataObj = JSON.parse(row.data);
              if (!dataObj.segmentId) {
                dataObj.segmentId = activeSeg;
                kernelContainer.db
                  .prepare('UPDATE whiteboard_elements SET data = ? WHERE id = ?')
                  .run(JSON.stringify(dataObj), cmdResult.elementId);
                console.log(
                  `[Agent Tool Sync] Injected active segment "${activeSeg}" into element "${cmdResult.elementId}"`,
                );

                // 方案 A1：注入完成后发布二次事件，通知前端重新获取元素数据，
                // 确保携带 segmentId 的元素能被正确渲染。
                kernelContainer.eventBus
                  .publish({
                    id: crypto.randomUUID(),
                    type: 'whiteboard.element_updated',
                    source: 'agent-tool-sync',
                    payload: { elementId: cmdResult.elementId, lessonId: currentLessonId },
                    timestamp: Date.now(),
                    correlationId: cmd.id,
                  })
                  .catch((e) => console.error('[Agent Tool Sync] Failed to publish element_updated event:', e));
              }
            } catch (e) {
              console.error('[Agent Tool Sync] Failed to parse/update element data:', e);
            }
          }
        }
      }
    } catch (err: any) {
      actionResult = { error: err.message };
      allExecutedTools.push({ callName: toolName, success: false, error: err.message });
    }
  } else {
    actionResult = { error: `Command / Tool not found: ${toolName}` };
    allExecutedTools.push({ callName: toolName, success: false, error: 'Command not registered' });
  }

  return actionResult;
};

export const buildOpenAIChatUrl = (apiUrl: string) => {
  let cleanUrl = apiUrl.trim();
  if (!cleanUrl.endsWith('/chat/completions')) {
    cleanUrl = cleanUrl.endsWith('/') ? cleanUrl + 'chat/completions' : cleanUrl + '/chat/completions';
  }
  return cleanUrl;
};

export const runGeminiAgentChat = async (request: AgentChatRequest) => {
  const { lang = 'zh' } = request;
  throw new Error(
    lang === 'zh'
      ? '未检测到可用的 AI 提供商。请前往「系统管理 -> AI 提供商管理」添加并配置大模型服务。'
      : 'No active AI Provider configured. Please add and configure an AI Provider in "System Management -> AI Provider Management".',
  );
};

export const runOpenAIAgentChat = async (provider: StoredAIProvider, request: AgentChatRequest) => {
  const { message, lang = 'zh', currentLessonId, attachments, callerRole, actorId, history } = request;
  const persona = getAIPersona(request.personaId);
  const pluginContextSlices = callerRole === 'student' ? [] : collectAIContextSlices(currentLessonId ?? null);
  const systemInstruction = buildAgentSystemInstruction(
    lang,
    currentLessonId,
    pluginContextSlices,
    persona,
    callerRole,
  );
  const finalMessage = buildAgentFinalMessage(message, attachments);

  // ai.skill.provider + persona.toolPolicy + SEC-01 学生裁剪
  const { tools, filteredSkills: pluginSkills, allowedToolNames } = resolveToolsForPersona(callerRole, persona);

  const chatUrl = buildOpenAIChatUrl(provider.api_url);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (provider.api_key && provider.api_key.trim()) {
    headers.Authorization = `Bearer ${provider.api_key.trim()}`;
  }

  type ChatMessage = {
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  };
  const historyMessages: ChatMessage[] = (history || []).map((h) => ({ role: h.role, content: h.content }));
  const systemInstructionWithSkills = pluginSkills.length
    ? systemInstruction +
      '\n\n[Plugin Skills · 插件贡献技能]\n' +
      pluginSkills.map((s) => `- ${s.skillName} (${s.toolName}): ${s.description || s.commandType}`).join('\n')
    : systemInstruction;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemInstructionWithSkills },
    ...historyMessages,
    { role: 'user', content: finalMessage },
  ];

  const allExecutedTools: AgentToolExecution[] = [];
  let finalResponseText = '';
  const MAX_LOOPS = resolvePersonaMaxTurns(persona?.maxTurns);
  let loopCount = 0;

  while (loopCount < MAX_LOOPS) {
    // Phase B5: 超时 + 指数退避重试（30s 超时，429/5xx/网络错误最多 3 次）
    const response = await fetchWithRetry(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model_name,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0.1,
      }),
    });

    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message;
    if (!assistantMessage) {
      throw new Error('AI provider returned no assistant message');
    }

    finalResponseText = typeof assistantMessage.content === 'string' ? assistantMessage.content.trim() : '';
    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

    messages.push({
      role: 'assistant',
      content: assistantMessage.content ?? '',
      tool_calls: toolCalls,
    });

    if (toolCalls.length === 0) {
      break;
    }

    for (const call of toolCalls) {
      const toolName = call?.function?.name;
      if (!toolName) continue;

      let parsedArgs: Record<string, unknown> = {};
      if (typeof call?.function?.arguments === 'string' && call.function.arguments.trim()) {
        try {
          parsedArgs = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }
      }

      if (parsedArgs && typeof parsedArgs === 'object' && attachments) {
        for (const key of Object.keys(parsedArgs)) {
          const val = parsedArgs[key];
          if (typeof val === 'string' && val.startsWith('ATTACHMENT_BASE64:')) {
            const idx = parseInt(val.split(':')[1]);
            if (attachments[idx]) {
              parsedArgs[key] = attachments[idx].content;
            }
          }
        }
      }
      if (!allowedToolNames.has(toolName)) {
        const deniedError = `Tool "${toolName}" is not permitted by the active persona policy.`;
        allExecutedTools.push({
          callName: toolName,
          success: false,
          error: deniedError,
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ error: deniedError }),
        });
        continue;
      }

      const skill = findSkillByToolName(pluginSkills, toolName);
      const actionResult = skill
        ? await executePluginSkillToolCall(skill, parsedArgs, allExecutedTools)
        : await executeAgentToolCall(toolName, parsedArgs, allExecutedTools, callerRole, currentLessonId, actorId);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(actionResult),
      });
    }

    loopCount++;
  }

  if (loopCount >= MAX_LOOPS && !finalResponseText) {
    finalResponseText =
      'I have executed several internal commands, but reached the iteration limit. Please review the assistant panel for the latest state.';
  }

  return {
    agentText: finalResponseText,
    toolResults: allExecutedTools,
  };
};
