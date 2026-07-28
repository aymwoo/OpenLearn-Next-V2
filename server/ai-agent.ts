// AI-agent chat logic (extracted verbatim from server.ts, lines 74-430).
//
// These functions previously lived at the top of server.ts as module-level
// `const`s. They reference the kernel singleton exactly as before — the import
// path is preserved so behavior is unchanged. See
// server/__tests__/ai-agent.test.ts for the characterization tests.

import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { kernelContainer } from '../packages/core/kernel/index.js';
import { lessonActiveSegments } from './shared-state.js';
import type {
  AgentChatAttachment,
  AgentChatRequest,
  AgentToolExecution,
  StoredAIProvider,
} from './context.js';

export const buildAgentSystemInstruction = (lang: 'zh' | 'en', currentLessonId?: string | null) => {
  let systemInstruction = lang === 'zh'
    ? '你是一个教育系统底层的 OS Agent。你需要理解老师的指令，并调用可用的工具（命令）去执行这些操作。如果老师让你创建一节课，请务必利用工具生成详细的初始课程内容。如果老师要求管理进程/任务，请使用 process.spawn, process.kill, process.list。如果需存储文件、素材或创建目录，请使用 vfs.* 并在需要时管理班级和学生。你支持通过 class_create 创建班级, student_create 创建学生, class_add_student 将学生加入班级。当老师要求从提供的数据（如CSV、JSON、Markdown或对话中）创建班级或学生时，请依次发出这些指令。如果上一阶段返回了创建成功的班级ID或学生ID，你需要在后续�? functionCall 中引用这些ID（例如：把刚创建的学生ID加入到刚创建的班级ID中）。通过往复的工具调用，你可以自动完成完整的流程�?'
    : 'You are an educational OS kernel agent. You interpret teacher instructions and use your available tools (commands) to execute them. If the teacher asks to create a lesson, always generate some detailed initial content for it. If the teacher asks to spawn or kill processes, use process tools. Use vfs tools to store assets, and manage classes/students as necessary. You support class_create, student_create, class_add_student. Always use tool chaining if you need to create a class and enroll students: first call class_create/student_create, receive their returned IDs, and then call class_add_student in the next turn. Always answer with a helpful summary.';

  if (currentLessonId) {
    systemInstruction += `\n[Context] The current selected lesson ID is "${currentLessonId}". Use this ID if the teacher's instruction is about modifying or adding to the current lesson.\n\nAvailable tools (functions) can be used multiple times in sequence if needed.`;
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
        BOOLEAN: 'boolean'
      };
      normalized.type = typeMap[value.toUpperCase()] || value.toLowerCase();
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      normalized.properties = Object.fromEntries(
        Object.entries(value).map(([propKey, propSchema]) => [propKey, normalizeToolSchema(propSchema)])
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
  return actions.map(action => ({
    type: 'function',
    function: {
      name: action.commandType.replace(/[^a-zA-Z0-9_\-]/g, '_'),
      description: action.description,
      parameters: normalizeToolSchema(action.inputSchema)
    }
  }));
};

export const executeAgentToolCall = async (
  toolName: string,
  args: any,
  allExecutedTools: AgentToolExecution[],
  callerRole?: string,
  currentLessonId?: string | null
) => {
  const actionDesc = kernelContainer.actionRegistry.getActionByToolName(toolName);
  let actionResult: any;

  // When the caller is an administrator, elevate the agent to superadmin
  // and auto-approve high-risk operations (no manual approval queue).
  const isAdmin = callerRole === 'administrator';
  const actorId = isAdmin ? 'user-frontend' : 'agent-system-0';
  const metadata = isAdmin ? { approved: true } : undefined;

  if (actionDesc) {
    const cmd = kernelContainer.commandBus.createCommand(
      actionDesc.commandType,
      args,
      actorId,
      metadata
    );
    try {
      const cmdResult = await kernelContainer.commandBus.execute(cmd) as any;
      actionResult = cmdResult;
      allExecutedTools.push({ callName: toolName, success: true, result: cmdResult });

      // If a whiteboard element was successfully drawn, let's make sure it is associated 
      // with the current active segment so it isn't filtered out by the frontend!
      if (cmdResult && cmdResult.elementId && currentLessonId) {
        const activeSeg = lessonActiveSegments.get(currentLessonId);
        if (activeSeg) {
          const row = kernelContainer.db.prepare('SELECT data FROM whiteboard_elements WHERE id = ?').get(cmdResult.elementId) as { data: string } | undefined;
          if (row) {
            try {
              const dataObj = JSON.parse(row.data);
              if (!dataObj.segmentId) {
                dataObj.segmentId = activeSeg;
                kernelContainer.db.prepare('UPDATE whiteboard_elements SET data = ? WHERE id = ?')
                  .run(JSON.stringify(dataObj), cmdResult.elementId);
                console.log(`[Agent Tool Sync] Injected active segment "${activeSeg}" into element "${cmdResult.elementId}"`);

                // 方案 A1：注入完成后发布二次事件，通知前端重新获取元素数据�?
                // 确保携带 segmentId 的元素能被正确渲染�?
                kernelContainer.eventBus.publish({
                  id: crypto.randomUUID(),
                  type: 'whiteboard.element_updated',
                  source: 'agent-tool-sync',
                  payload: { elementId: cmdResult.elementId, lessonId: currentLessonId },
                  timestamp: Date.now(),
                  correlationId: cmd.id
                }).catch(e => console.error('[Agent Tool Sync] Failed to publish element_updated event:', e));
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
  const { message, lang = 'zh', currentLessonId, attachments, callerRole, history } = request;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.trim() === 'MY_GEMINI_API_KEY') {
    throw new Error(
      lang === 'zh'
        ? '未配置可用的 AI 服务。请在管理后台的「AI 提供商管理」中添加一个 AI 提供商（或设置 GEMINI_API_KEY 作为兼容回退）。'
        : 'No AI service is configured. Please add an AI Provider in the admin dashboard\'s "AI Provider Management" (or set `GEMINI_API_KEY` as a compatible fallback).'
    );
  }
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const tools = kernelContainer.actionRegistry.getAgentTools();
  const systemInstruction = buildAgentSystemInstruction(lang, currentLessonId);
  const finalMessage = buildAgentFinalMessage(message, attachments);

  const historyContents: any[] = (history || []).map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.content }]
  }));
  const contents: any[] = [...historyContents, { role: 'user', parts: [{ text: finalMessage }] }];
  let loopCount = 0;
  const MAX_LOOPS = 5;
  let finalResponseText = '';
  const allExecutedTools: AgentToolExecution[] = [];

  while (loopCount < MAX_LOOPS) {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: contents,
      config: {
        systemInstruction,
        tools: tools,
        temperature: 0.1
      }
    });

    const candidate = response.candidates?.[0];
    const contentParts = candidate?.content?.parts || [];
    const functionCalls = contentParts.filter(p => 'functionCall' in p);

    if (functionCalls.length === 0) {
      finalResponseText = response.text || '';
      break;
    }

    contents.push({
      role: 'model',
      parts: contentParts
    });

    const toolParts: any[] = [];
    for (const part of contentParts) {
      if ('functionCall' in part && part.functionCall) {
        const call = part.functionCall;
        if (call.args && typeof call.args === 'object' && attachments) {
          for (const key of Object.keys(call.args)) {
            const val = call.args[key];
            if (typeof val === 'string' && val.startsWith('ATTACHMENT_BASE64:')) {
              const idx = parseInt(val.split(':')[1]);
              if (attachments[idx]) {
                call.args[key] = attachments[idx].content;
              }
            }
          }
        }
        const actionResult = await executeAgentToolCall(call.name, call.args, allExecutedTools, callerRole, currentLessonId);

        toolParts.push({
          functionResponse: {
            name: call.name,
            response: typeof actionResult === 'object' && actionResult !== null ? actionResult : { value: actionResult }
          }
        });
      }
    }

    contents.push({
      role: 'tool',
      parts: toolParts
    });

    loopCount++;
  }

  if (loopCount >= MAX_LOOPS && !finalResponseText) {
    finalResponseText = 'I have executed several internal commands to create or link resources, but reached the iteration limit. Please double-check the interface to confirm.';
  }

  return {
    agentText: finalResponseText,
    toolResults: allExecutedTools
  };
};

export const runOpenAIAgentChat = async (provider: StoredAIProvider, request: AgentChatRequest) => {
  const { message, lang = 'zh', currentLessonId, attachments, callerRole, history } = request;
  const systemInstruction = buildAgentSystemInstruction(lang, currentLessonId);
  const finalMessage = buildAgentFinalMessage(message, attachments);
  const tools = buildOpenAITools();
  const chatUrl = buildOpenAIChatUrl(provider.api_url);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (provider.api_key && provider.api_key.trim()) {
    headers.Authorization = `Bearer ${provider.api_key.trim()}`;
  }

  const historyMessages: any[] = (history || []).map(h => ({ role: h.role, content: h.content }));
  const messages: any[] = [
    { role: 'system', content: systemInstruction },
    ...historyMessages,
    { role: 'user', content: finalMessage }
  ];

  const allExecutedTools: AgentToolExecution[] = [];
  let finalResponseText = '';
  const MAX_LOOPS = 5;
  let loopCount = 0;

  while (loopCount < MAX_LOOPS) {
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model_name,
        messages,
        tools,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI provider request failed (${response.status}): ${errorText || response.statusText}`);
    }

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
      tool_calls: toolCalls
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
      const actionResult = await executeAgentToolCall(toolName, parsedArgs, allExecutedTools, callerRole, currentLessonId);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(actionResult)
      });
    }

    loopCount++;
  }

  if (loopCount >= MAX_LOOPS && !finalResponseText) {
    finalResponseText = 'I have executed several internal commands, but reached the iteration limit. Please review the assistant panel for the latest state.';
  }

  return {
    agentText: finalResponseText,
    toolResults: allExecutedTools
  };
};
