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
import { getAIPersona } from './ai-persona-registry.js';
import type { AgentChatAttachment, AgentChatRequest, AgentToolExecution, StoredAIProvider } from './context.js';

export const buildAgentSystemInstruction = (
  lang: 'zh' | 'en',
  currentLessonId?: string | null,
  pluginSlices?: string[],
  persona?: { nameZh: string; instructionZh: string; nameEn: string; instructionEn: string },
) => {
  let systemInstruction =
    lang === 'zh'
      ? '你是一个教育系统底层的 OS Agent。你需要理解老师的指令，并调用可用的工具（命令）去执行这些操作。如果老师让你创建一节课，请务必利用工具生成详细的初始课程内容。如果老师要求管理进程/任务，请使用 process.spawn, process.kill, process.list。如果需存储文件、素材或创建目录，请使用 vfs.* 并在需要时管理班级和学生。你支持通过 class_create 创建班级, student_create 创建学生, class_add_student 将学生加入班级。当老师要求从提供的数据（如CSV、JSON、Markdown或对话中）创建班级或学生时，请依次发出这些指令。如果上一阶段返回了创建成功的班级ID或学生ID，你需要在后续�? functionCall 中引用这些ID（例如：把刚创建的学生ID加入到刚创建的班级ID中）。通过往复的工具调用，你可以自动完成完整的流程�?'
      : 'You are an educational OS kernel agent. You interpret teacher instructions and use your available tools (commands) to execute them. If the teacher asks to create a lesson, always generate some detailed initial content for it. If the teacher asks to spawn or kill processes, use process tools. Use vfs tools to store assets, and manage classes/students as necessary. You support class_create, student_create, class_add_student. Always use tool chaining if you need to create a class and enroll students: first call class_create/student_create, receive their returned IDs, and then call class_add_student in the next turn. Always answer with a helpful summary.';

  if (currentLessonId) {
    systemInstruction += `\n[Context] The current selected lesson ID is "${currentLessonId}". Use this ID if the teacher's instruction is about modifying or adding to the current lesson.\n\nAvailable tools (functions) can be used multiple times in sequence if needed.`;
  }

  // P2: ai.context.provider —— 插件注册的上下文切片（每个独立 try/catch，见 registry）
  if (pluginSlices?.length) {
    systemInstruction += '\n\n' + pluginSlices.join('\n\n');
  }

  // P2: ai.agent.persona —— 角色指令叠加（不替换工具链与基础行为）
  if (persona) {
    const name = lang === 'zh' ? persona.nameZh : persona.nameEn;
    const instruction = lang === 'zh' ? persona.instructionZh : persona.instructionEn;
    if (instruction.trim() && !instruction.startsWith('保持基础')) {
      systemInstruction += `\n\n[Persona · ${name}]\n${instruction.trim()}`;
    }
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

export const buildOpenAITools = () => {
  const actions = kernelContainer.actionRegistry.getAllActions();
  return actions.map((action) => ({
    type: 'function',
    function: {
      name: action.commandType.replace(/[^a-zA-Z0-9_\-]/g, '_'),
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
  SKILL_TOOL_PREFIX + commandType.replace(/[^a-zA-Z0-9_\-]/g, '_');

/**
 * 从 manifest 来源集合收集插件技能。
 *
 * 命令名解析：优先按 manifest 声明的原名（内核直注册的内置插件命令，
 * 如 smart_edu.* —— 注册时即用完整命令名）；原名无 descriptor 时回退
 * 插件命名空间规则（worker 插件的 handler 注册在 `pluginId.` 前缀下）。
 *
 * @param manifestSources  manifest JSON 字符串或已解析对象
 * @param isRegistered     命令名是否已有 actionRegistry descriptor（默认查内核注册表）
 */
export const collectPluginSkills = (
  manifestSources: Array<string | object | null | undefined>,
  isRegistered: (commandType: string) => boolean = (ct) =>
    !!kernelContainer.actionRegistry.getActionByCommandType(ct),
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
      const { id, name, description, commandType, parametersSchema } = raw as Record<string, any>;
      if (!commandType || typeof commandType !== 'string') continue;
      const registered = isRegistered(commandType);
      const effectiveType = registered ? commandType : resolvePluginCommandType(commandType, pluginId);
      skills.push({
        toolName: skillToolName(effectiveType),
        skillName: String(name ?? id ?? effectiveType),
        description: String(description ?? ''),
        commandType: effectiveType,
        parametersSchema: parametersSchema && typeof parametersSchema === 'object' ? parametersSchema : undefined,
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
  } catch (err: any) {
    console.error('[Agent] Failed to collect plugin skills:', err?.message);
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
        skill.parametersSchema ?? kernelContainer.actionRegistry.getActionByCommandType(skill.commandType)?.inputSchema ?? {
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
) => {
  const actionDesc = kernelContainer.actionRegistry.getActionByToolName(toolName);
  let actionResult: any;

  // When the caller is an administrator, elevate the agent to superadmin
  // and auto-approve high-risk operations (no manual approval queue).
  const isAdmin = callerRole === 'administrator';
  const actorId = isAdmin ? 'user-frontend' : 'agent-system-0';
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

                // 方案 A1：注入完成后发布二次事件，通知前端重新获取元素数据�?
                // 确保携带 segmentId 的元素能被正确渲染�?
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
  const { message, lang = 'zh', currentLessonId, attachments, callerRole, history } = request;
  const systemInstruction = buildAgentSystemInstruction(
    lang,
    currentLessonId,
    collectAIContextSlices(currentLessonId ?? null),
    getAIPersona(request.personaId),
  );
  const finalMessage = buildAgentFinalMessage(message, attachments);

  // ai.skill.provider —— 插件贡献技能注入工具列表；与 actionRegistry 暴露的
  // 同命令工具去重（技能路径以插件 actor 派发，capability 走插件自身授权）。
  const pluginSkills = loadActivePluginSkills();
  const skillCommandTypes = new Set(pluginSkills.map((s) => s.commandType));
  const baseTools = buildOpenAITools().filter((t) => {
    const action = kernelContainer.actionRegistry.getActionByToolName(t.function.name);
    return !(action && skillCommandTypes.has(action.commandType));
  });
  const tools = [...baseTools, ...buildPluginSkillTools(pluginSkills)];

  const chatUrl = buildOpenAIChatUrl(provider.api_url);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (provider.api_key && provider.api_key.trim()) {
    headers.Authorization = `Bearer ${provider.api_key.trim()}`;
  }

  const historyMessages: any[] = (history || []).map((h) => ({ role: h.role, content: h.content }));
  const systemInstructionWithSkills = pluginSkills.length
    ? systemInstruction +
      '\n\n[Plugin Skills · 插件贡献技能]\n' +
      pluginSkills.map((s) => `- ${s.skillName} (${s.toolName}): ${s.description || s.commandType}`).join('\n')
    : systemInstruction;
  const messages: any[] = [
    { role: 'system', content: systemInstructionWithSkills },
    ...historyMessages,
    { role: 'user', content: finalMessage },
  ];

  const allExecutedTools: AgentToolExecution[] = [];
  let finalResponseText = '';
  const MAX_LOOPS = 5;
  let loopCount = 0;

  while (loopCount < MAX_LOOPS) {
    // Phase B5: 超时 + 指数退避重试（30s 超时，429/5xx/网络错误最多 3 次）
    const response = await fetchWithRetry(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model_name,
        messages,
        tools,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
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

      let parsedArgs: any = {};
      if (typeof call?.function?.arguments === 'string' && call.function.arguments.trim()) {
        try {
          parsedArgs = JSON.parse(call.function.arguments);
        } catch (err) {
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
      const skill = findSkillByToolName(pluginSkills, toolName);
      const actionResult = skill
        ? await executePluginSkillToolCall(skill, parsedArgs, allExecutedTools)
        : await executeAgentToolCall(toolName, parsedArgs, allExecutedTools, callerRole, currentLessonId);
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
