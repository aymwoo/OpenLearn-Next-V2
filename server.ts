import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

declare var __dirname: string | undefined;
// Auto-fallback NODE_ENV to production if executing the bundled output
if (!process.env.NODE_ENV) {
  const isCjs = typeof __filename !== 'undefined' && __filename.endsWith('.cjs');
  const isDist = process.cwd().endsWith('/dist') || (typeof __dirname !== 'undefined' && __dirname.includes('/dist')) || (typeof __filename !== 'undefined' && __filename.includes('/dist'));
  if (isCjs || isDist) {
    process.env.NODE_ENV = 'production';
  }
}
import { exec } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { kernelContainer } from './packages/core/kernel/index.js';
import { ISemesterGradeServiceToken } from './packages/core/di/interfaces.js';
import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { filterXSS } from 'xss';
import { hasDataSubmission, hasScoreDisplay, injectScoreSubmissionUsingAI } from './packages/plugins/ai-submit-injector.js';
import { verifyPassword, hashPassword as bcryptHashPassword } from './packages/core/db/index.js';
import { encryptApiKey, decryptApiKey, maskApiKey, detectPromptInjection } from './server/utils/crypto.js';
import { getCookieToken, getValidSession, checkIsTeacherOrAdmin, getActorId } from './server/middleware/auth.js';
import { BRIDGE_SDK_CODE } from './server/utils/bridge-sdk.js';
import { ServerBootstrapAdapter } from './packages/core/bootstrap/index.js';

// ── Activity Ecosystem (Sprint P7-01) ─────────────────────────────────────
import {
  ActivityRegistry,
  registerOfficialActivities,
  createActivityContext,
  IActivityRegistryToken,
} from './packages/activity-ecosystem/index.js';
import type { ServerContext, AgentChatAttachment, AgentChatRequest, AgentToolExecution, StoredAIProvider } from './server/context.js';
import { registerOsRoutes } from './server/routes/os.js';
import { registerResourcesRoutes } from './server/routes/resources.js';
import { registerCoursewareRoutes } from './server/routes/courseware.js';
import { registerBridgeRoutes } from './server/routes/bridge.js';
import { registerLessonsRoutes } from './server/routes/lessons.js';
import { registerWorkspaceRoutes } from './server/routes/workspace.js';
import { registerProcessesRoutes } from './server/routes/processes.js';
import { registerAdminRoutes } from './server/routes/admin.js';
import { registerRosterRoutes } from './server/routes/roster.js';
import { registerAssignmentsRoutes } from './server/routes/assignments.js';
import { registerSchedulesRoutes } from './server/routes/schedules.js';
import { registerGradingRoutes } from './server/routes/grading.js';
import { registerPluginsRoutes } from './server/routes/plugins.js';




// ── MFE Remote Entry Cache ──────────────────────────────────────────────────
/** In-memory cache for MFE remote entry URLs (D-24: cache-first strategy) */
const MF_REMOTE_CACHE = new Map<string, { entry: string; meta: Record<string, any> }>();

// ── Lesson Active Segments ──────────────────────────────────────────────────
/** Active timeline segments for lessons, shared with agents to bind new items */
const lessonActiveSegments = new Map<string, string>(); // lessonId -> activeSegmentId

// Initialize core OS tools


const buildAgentSystemInstruction = (lang: 'zh' | 'en', currentLessonId?: string | null) => {
  let systemInstruction = lang === 'zh'
    ? '你是一个教育系统底层的 OS Agent。你需要理解老师的指令，并调用可用的工具（命令）去执行这些操作。如果老师让你创建一节课，请务必利用工具生成详细的初始课程内容。如果老师要求管理进程/任务，请使用 process.spawn, process.kill, process.list。如果需存储文件、素材或创建目录，请使用 vfs.* 并在需要时管理班级和学生。你支持通过 class_create 创建班级, student_create 创建学生, class_add_student 将学生加入班级。当老师要求从提供的数据（如CSV、JSON、Markdown或对话中）创建班级或学生时，请依次发出这些指令。如果上一阶段返回了创建成功的班级ID或学生ID，你需要在后续�? functionCall 中引用这些ID（例如：把刚创建的学生ID加入到刚创建的班级ID中）。通过往复的工具调用，你可以自动完成完整的流程�?'
    : 'You are an educational OS kernel agent. You interpret teacher instructions and use your available tools (commands) to execute them. If the teacher asks to create a lesson, always generate some detailed initial content for it. If the teacher asks to spawn or kill processes, use process tools. Use vfs tools to store assets, and manage classes/students as necessary. You support class_create, student_create, class_add_student. Always use tool chaining if you need to create a class and enroll students: first call class_create/student_create, receive their returned IDs, and then call class_add_student in the next turn. Always answer with a helpful summary.';

  if (currentLessonId) {
    systemInstruction += `\n[Context] The current selected lesson ID is "${currentLessonId}". Use this ID if the teacher's instruction is about modifying or adding to the current lesson.\n\nAvailable tools (functions) can be used multiple times in sequence if needed.`;
  }

  return systemInstruction;
};

const buildAgentFinalMessage = (message: string, attachments?: AgentChatAttachment[]) => {
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

const normalizeToolSchema = (schema: any): any => {
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

const buildOpenAITools = () => {
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

const executeAgentToolCall = async (
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

const buildOpenAIChatUrl = (apiUrl: string) => {
  let cleanUrl = apiUrl.trim();
  if (!cleanUrl.endsWith('/chat/completions')) {
    cleanUrl = cleanUrl.endsWith('/') ? cleanUrl + 'chat/completions' : cleanUrl + '/chat/completions';
  }
  return cleanUrl;
};

const runGeminiAgentChat = async (request: AgentChatRequest) => {
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

const runOpenAIAgentChat = async (provider: StoredAIProvider, request: AgentChatRequest) => {
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

async function startServer() {
  // Bridge server startup through Platform Kernel Bootstrap Adapter (PI-005)
  await ServerBootstrapAdapter.bootstrap({
    kernelContainer,
    environment: (process.env.NODE_ENV as any) || 'development',
    config: { port: Number(process.env.PORT) || 9000 },
  });

  try {

    const existingQuiz = kernelContainer.db.prepare('SELECT id, manifest, source_code FROM plugins WHERE name = ?').get('Quiz Component Plugin') as any;
    if (existingQuiz && (!existingQuiz.manifest || !existingQuiz.manifest.includes('classroomTools') || !existingQuiz.source_code.includes('actorId:'))) {
      console.log('Upgrading old Quiz Component Plugin to add classroomTools and fix Actor...');
      kernelContainer.db.prepare('DELETE FROM plugins WHERE id = ?').run(existingQuiz.id);
    }
    const existingRollCall = kernelContainer.db.prepare('SELECT id, manifest FROM plugins WHERE name = ?').get('Random Student Picker (随机点名小工�?)') as any;
    if (existingRollCall && (!existingRollCall.manifest || !existingRollCall.manifest.includes('classroomTools'))) {
      console.log('Upgrading old Random Student Picker Plugin to add classroomTools...');
      kernelContainer.db.prepare('DELETE FROM plugins WHERE id = ?').run(existingRollCall.id);
    }
  } catch (e) {
    console.error('Error upgrading old default plugins:', e);
  }

  try {
    kernelContainer.db.exec(`
      CREATE TABLE IF NOT EXISTS student_rollcalls (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        class_id TEXT,
        lesson_id TEXT,
        picked_time INTEGER NOT NULL
      );
    `);
    console.log('student_rollcalls table successfully ensured.');
  } catch (e) {
    console.error('Error creating student_rollcalls table:', e);
  }

  // 站点信息设置表（站点名称、口号、Logo）
  try {
    kernelContainer.db.exec(`
      CREATE TABLE IF NOT EXISTS site_settings (
        id TEXT PRIMARY KEY,
        site_name TEXT,
        slogan TEXT,
        logo_url TEXT
      );
    `);
    console.log('site_settings table successfully ensured.');
  } catch (e) {
    console.error('Error creating site_settings table:', e);
  }

  // 内核助手对话记忆表（按 用户+课程 维度持久化对话历史）
  try {
    kernelContainer.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_conversations (
        id TEXT PRIMARY KEY,
        conv_key TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    kernelContainer.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_conv_key ON agent_conversations(conv_key, created_at);`
    );
    console.log('agent_conversations table successfully ensured.');
  } catch (e) {
    console.error('Error creating agent_conversations table:', e);
  }

  // SEC-AUTH-03: client_sessions 添加 expires_at �?
  try {
    kernelContainer.db.exec(`ALTER TABLE client_sessions ADD COLUMN expires_at INTEGER`);
    console.log('client_sessions.expires_at column ensured.');
  } catch { /* 列已存在 */ }

  // SEC-AUTH-03: 启动时清理过�? session
  try {
    const now = Date.now();
    const idleTimeout = 24 * 60 * 60 * 1000;
    const deletedExpired = kernelContainer.db.prepare(
      'DELETE FROM client_sessions WHERE expires_at IS NOT NULL AND expires_at < ?'
    ).run(now);
    const deletedIdle = kernelContainer.db.prepare(
      'DELETE FROM client_sessions WHERE updated_at IS NOT NULL AND (? - updated_at) > ?'
    ).run(now, idleTimeout);
    const totalDeleted = (deletedExpired.changes || 0) + (deletedIdle.changes || 0);
    if (totalDeleted > 0) {
      console.log(`[Session] Cleaned up ${totalDeleted} expired sessions on startup.`);
    }
  } catch (e) {
    console.warn('[Session] Could not clean up expired sessions:', e);
  }

  await kernelContainer.ready;

  // ���� Activity Ecosystem bootstrap (Product Layer, kernel untouched) ����
  // Register the singleton registry as a DI service so plugins can resolve it
  // via the SAME `ctx.resolve(IActivityRegistryToken)` API used for core
  // services. Official activities are registered as Activity Providers and
  // contribute their AI Actions into the existing ActionRegistry.
  const activityRegistry = new ActivityRegistry();
  registerOfficialActivities(activityRegistry, kernelContainer.actionRegistry);
  await kernelContainer.serviceRegistry.register(IActivityRegistryToken, activityRegistry);
  console.log(`[ActivityEcosystem] Registered ${activityRegistry.listProviders().length} official activity providers.`);

  const app = express();
  kernelContainer.pluginHost.setExpressApp(app);
  const PORT = parseInt(process.env.PORT || '9000', 10);

  // SEC-AUTH-03: 信任 Nginx 反向代理�? X-Forwarded-Proto �?
  // �? req.protocol / req.secure 能正确反映浏览器�? Nginx 的实际协�?
  app.set('trust proxy', 1);

  // ── 安全中间�? ────────────────────────────────────────────────────
  // SEC-NET-02: HTTP 安全头（helmet�?
  // 教育平台需要加载外部课件资源（图片、字体、样式），因�? img-src/style-src/font-src 放宽�? https:
  // script-src 保持严格限制，课�? iframe 通过 sandbox 属性提供额外安全层
  // COOP/OAC/COEP 已禁用：HTML Applet �? iframe 中运行时这些策略会导致跨域错�?
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "blob:", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https:", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:", "https:"],
        fontSrc: ["'self'", "data:", "https:", "https://fonts.gstatic.com"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }, // 允许沙箱 iframe（opaque origin）加载静态资�?
    originAgentCluster: false,
    strictTransportSecurity: false, // �? HTTP 部署，禁�? HSTS（否则浏览器缓存后强�? HTTPS，导�? ERR_CONNECTION_REFUSED�?
  }));

  // SEC-AUTH-04: 登录频率限制�?5�?/IP/分钟�?
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 分钟
    max: 5,
    message: { error: '登录尝试过于频繁，请稍后再试。Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(express.json({ limit: '400mb' }));
  app.use(express.urlencoded({ limit: '400mb', extended: true }));
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  app.use('/plugins', express.static(path.join(process.cwd(), 'plugins')));
  // MFE 静态文件服务已移除（v5.0 架构重构：白板和课件已内聚为本地模块�?

  // SEC-NET-01: CORS 中间�? �? 允许沙箱 iframe（origin: null）和同源请求
  // 背景：iframe sandbox 去掉 allow-same-origin 后，浏览器给 iframe 分配 opaque origin�?
  // 导致其中�? fetch()/XHR 变成跨域请求。本中间件使这些请求正常工作�?
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    // 沙箱 iframe 的请求带�? Origin: null；同源请求通常不带 Origin �?
    if (origin === 'null' || origin === undefined) {
      res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400'); // 预检缓存 24h
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // ── Build route context for extracted route modules ──
  const ctx: ServerContext = {
    app, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
    activityRegistry,
  } as ServerContext;

  // SEC-NET-01: CORS 白名单化 — HTTP server + Socket.IO setup (moved up so ctx.io is ready)
  const httpServer = createHttpServer(app);
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : (process.env.NODE_ENV === 'production'
      ? [] // 生产环境必须配置
      : ['http://localhost:5173', 'http://localhost:9000', 'http://localhost:4173']);
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    }
  });
  kernelContainer.pluginHost.setSocketIO(io);
  ctx.io = io;
  registerOsRoutes(ctx);

  // System Resources APIs
  registerResourcesRoutes(ctx);
  // --- AI Courseware APIs ---
  registerCoursewareRoutes(ctx);
  registerBridgeRoutes(ctx);
  registerLessonsRoutes(ctx);
  registerWorkspaceRoutes(ctx);

  // Approvals APIs
  registerProcessesRoutes(ctx);
  registerAdminRoutes(ctx);
  registerRosterRoutes(ctx);
  registerAssignmentsRoutes(ctx);
  registerSchedulesRoutes(ctx);
  registerGradingRoutes(ctx);
  registerPluginsRoutes(ctx);


  kernelContainer.eventBus.subscribe('assignment.graded', (event) => {
    try {
      const payload = event.payload as any;
      const assignment = kernelContainer.db.prepare('SELECT title FROM assignments WHERE id = ?').get(payload.assignmentId) as any;
      const assignmentTitle = assignment ? assignment.title : 'Assignment';

      console.log(`[EventBus -> Socket.IO] Broadcasting assignment-graded-toast to student ${payload.studentId}`);
      io.emit('assignment-graded-toast', {
        assignmentId: payload.assignmentId,
        assignmentTitle,
        studentId: payload.studentId,
        score: payload.score,
        feedback: payload.feedback || ''
      });
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error dispatching assignment graded notification:', e);
    }
  });

  const handleRollcallElement = (elementId: string) => {
    try {
      const el = kernelContainer.db.prepare('SELECT * FROM whiteboard_elements WHERE id = ?').get(elementId) as any;
      if (el && el.type === 'rollcall') {
        const elData = JSON.parse(el.data);
        if (elData && elData.selectedStudent && elData.status === 'picked') {
          const studentId = elData.selectedStudent.id;
          const studentName = elData.selectedStudent.name;
          let classId = elData.classId || '';
          const lessonId = el.lesson_id;
          if (!classId && lessonId) {
            const sched = kernelContainer.db.prepare('SELECT class_id FROM schedules WHERE lesson_id = ? LIMIT 1').get(lessonId) as any;
            if (sched) {
              classId = sched.class_id;
            }
          }
          const pickedTimeStr = elData.pickedTime || new Date().toISOString();
          const pickedTime = new Date(pickedTimeStr).getTime();
          
          const rollcallId = `rollcall-${elementId}-${pickedTime}`;
          
          const exists = kernelContainer.db.prepare('SELECT id FROM student_rollcalls WHERE id = ?').get(rollcallId);
          if (!exists) {
            kernelContainer.db.prepare(
              'INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time) VALUES (?, ?, ?, ?, ?)'
            ).run(rollcallId, studentId, classId, lessonId, pickedTime);
            
            console.log(`[Rollcall] Saved rollcall for student ${studentId} (${studentName})`);
            
            io.emit('student-picked', {
              rollcallId,
              studentId,
              studentName,
              classId,
              lessonId,
              pickedTime
            });
          }
        }
      }
    } catch (e) {
      console.error('Error handling rollcall element:', e);
    }
  };

  kernelContainer.eventBus.subscribe('whiteboard.element_drawn', (event) => {
    try {
      const payload = event.payload as any;
      if (payload.type === 'rollcall') {
        handleRollcallElement(payload.elementId);
      }
      if (payload.lessonId) {
        const syncMsg = { roomId: payload.lessonId, type: 'refresh' };
        // Broadcast to the lesson-specific room (for clients already joined)
        io.to(payload.lessonId).emit('whiteboard-sync', syncMsg);
        // Also broadcast globally so clients not yet in the lesson room can react
        io.to('whiteboard-broadcast').emit('whiteboard-sync', syncMsg);
        console.log(`[EventBus -> Socket.IO] Broadcast whiteboard refresh for lesson "${payload.lessonId}" (element: "${payload.elementId}", type: "${payload.type}")`);
      }
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.element_drawn:', e);
    }
  });

  kernelContainer.eventBus.subscribe('whiteboard.element_updated', (event) => {
    try {
      const payload = event.payload as any;
      handleRollcallElement(payload.elementId);
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.element_updated for rollcall:', e);
    }
  });

  // P0-1：补�? whiteboard.element_deleted、whiteboard.cleared �? Socket.IO 转发
  // 以及 P1-1：whiteboard.batch_drawn 批量事件的转�?
  kernelContainer.eventBus.subscribe('whiteboard.batch_drawn', (event) => {
    try {
      const payload = event.payload as any;
      if (payload.lessonId) {
        io.to(payload.lessonId).emit('whiteboard-sync', {
          roomId: payload.lessonId,
          type: 'refresh'
        });
        console.log(`[EventBus -> Socket.IO] Broadcast refresh after batch_draw (${payload.count} elements) for lesson "${payload.lessonId}"`);
      }
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.batch_drawn:', e);
    }
  });

  kernelContainer.eventBus.subscribe('whiteboard.element_deleted', (event) => {
    try {
      const payload = event.payload as any;
      if (payload.lessonId) {
        io.to(payload.lessonId).emit('whiteboard-sync', {
          roomId: payload.lessonId,
          type: 'refresh'
        });
      }
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.element_deleted:', e);
    }
  });

  kernelContainer.eventBus.subscribe('whiteboard.cleared', (event) => {
    try {
      const payload = event.payload as any;
      if (payload.lessonId) {
        io.to(payload.lessonId).emit('whiteboard-sync', {
          roomId: payload.lessonId,
          type: 'refresh'
        });
      }
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.cleared:', e);
    }
  });

  kernelContainer.eventBus.subscribe('spotlight:state_updated', (event) => {
    try {
      io.emit('spotlight:state_updated', event.payload);
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing spotlight:state_updated:', e);
    }
  });

  kernelContainer.eventBus.subscribe('spotlight.state_updated', (event) => {
    try {
      io.emit('spotlight:state_updated', event.payload);
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing spotlight.state_updated:', e);
    }
  });


  // In-memory status maps
  const onlineStudents = new Map<string, { socketId: string, name: string }>();
  const activeStudentLessons = new Map<string, string>(); // studentId -> lessonId

  const broadcastPresence = () => {
    io.emit('presence-update', {
      onlineStudentIds: Array.from(onlineStudents.keys()),
      activeStudentLessons: Object.fromEntries(activeStudentLessons.entries())
    });
  };

  io.on('connection', (socket: any) => {
    let registeredStudentId: string | null = null;

    socket.on('register-student', (data: { studentId: string, name: string }) => {
      registeredStudentId = data.studentId;
      onlineStudents.set(data.studentId, { socketId: socket.id, name: data.name });
      console.log(`[Presence] Student online: ${data.name} (${data.studentId})`);
      broadcastPresence();
    });

    socket.on('enter-lesson', (data: { studentId: string, lessonId: string }) => {
      activeStudentLessons.set(data.studentId, data.lessonId);
      socket.join(data.lessonId);
      console.log(`[Presence] Student ${data.studentId} entered lesson ${data.lessonId}`);
      broadcastPresence();

      // Send current active segment if it exists
      const activeSeg = lessonActiveSegments.get(data.lessonId);
      if (activeSeg) {
        socket.emit('student-active-segment-changed', {
          lessonId: data.lessonId,
          activeSegmentId: activeSeg
        });
      }
    });

    socket.on('leave-lesson', (data: { studentId: string }) => {
      const oldRoom = activeStudentLessons.get(data.studentId);
      if (oldRoom) {
        socket.leave(oldRoom);
      }
      activeStudentLessons.delete(data.studentId);
      console.log(`[Presence] Student ${data.studentId} left lesson`);
      broadcastPresence();
    });

    socket.on('join-room', (roomId: string) => {
      socket.join(roomId);
    });

    socket.on('whiteboard-update', (data: { roomId: string, type: string, payload: any }) => {
      // 实时绘制事件（temp-draw, temp-end, segment-change）：直接广播，不经过 EventBus
      socket.to(data.roomId).emit('whiteboard-sync', data);
    });

    // Step 4 (v5.0): 白板结构化事�? �? 服务�? EventBus（审计日�? + 广播�?
    socket.on('whiteboard-event', (data: {
      type: string;
      payload: { lessonId: string; elementId?: string; elementType?: string; segmentId?: string };
      id: string;
      timestamp: number;
    }) => {
      // 1. 发布到服务端 EventBus �? 自动写入 events 表（审计日志�?
      kernelContainer.eventBus.publish({
        id: data.id,
        type: data.type,
        source: 'whiteboard',
        payload: data.payload,
        timestamp: data.timestamp,
        correlationId: data.payload.lessonId,
      });

      // 2. 广播到课程房间的其他客户�?
      const lessonId = data.payload.lessonId;
      if (lessonId) {
        const roomName = lessonId.startsWith('assignment-') ? lessonId : `lesson-${lessonId}`;
        socket.to(data.payload.lessonId).emit('whiteboard-sync', {
          type: 'refresh',
          sourceEvent: data.type,
        });
      }
    });

    socket.on('teacher-broadcast-segment', (data: { lessonId: string, activeSegmentId: string }) => {
      // Store the active segment in memory
      lessonActiveSegments.set(data.lessonId, data.activeSegmentId);
      // Broadcast to everyone in the lesson room (including the teacher client)
      io.to(data.lessonId).emit('student-active-segment-changed', data);
    });

    socket.on('teacher-ping-student', (data: { studentId: string, lessonId: string, message?: string }) => {
      console.log(`[Ping] Teacher pinged student ${data.studentId} for lesson ${data.lessonId}`);
      const studentOnlineInfo = onlineStudents.get(data.studentId);
      if (studentOnlineInfo) {
        io.to(studentOnlineInfo.socketId).emit('student-pinged', {
          lessonId: data.lessonId,
          message: data.message
        });
      }
    });

    socket.on('disconnect', () => {
      if (registeredStudentId) {
        onlineStudents.delete(registeredStudentId);
        activeStudentLessons.delete(registeredStudentId);
        console.log(`[Presence] Student offline: ${registeredStudentId}`);
        broadcastPresence();
      }
    });

    // Send initial status immediately on connection
    socket.emit('presence-update', {
      onlineStudentIds: Array.from(onlineStudents.keys()),
      activeStudentLessons: Object.fromEntries(activeStudentLessons.entries())
    });
  });

  // Vite Middleware for Development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static file serving
    const distPath = __dirname || path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} is already in use. Retrying in 1.5 seconds...`);
      setTimeout(() => {
        try {
          httpServer.close();
        } catch (e) {}
        httpServer.listen(PORT, '0.0.0.0');
      }, 1500);
    } else {
      console.error('HTTP Server error:', err);
    }
  });

  // ── 健康检查端�? (OBS-HEALTH-01) ──────────────────────────────────
  const startTime = Date.now();
  app.get('/health', (_req: any, res: any) => {
    res.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000), version: '4.0.0' });
  });

  app.get('/health/ready', (_req: any, res: any) => {
    try {
      kernelContainer.db.prepare('SELECT 1').get();
      const workerCount = kernelContainer.workerManager?.registry?.activeCount ?? 0;
      res.json({ status: 'ready', db: 'connected', workers: workerCount });
    } catch (e: any) {
      res.status(503).json({ status: 'not_ready', error: e.message });
    }
  });

  app.get('/metrics', (_req: any, res: any) => {
    const mem = process.memoryUsage();
    res.json({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      memory: { rss: Math.round(mem.rss / 1024 / 1024) + 'MB', heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB' },
      nodeVersion: process.version,
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    const url = `http://localhost:${PORT}`;
    const OSC = '\x1b]8;;';
    const ST = '\x1b\\';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const green = '\x1b[32m';
    const cyan = '\x1b[36m';
    console.log(`\n  ${bold}${green}Educational OS Kernel${reset} ready at ${bold}${cyan}${OSC}${url}${ST}http://localhost:${PORT}${OSC}${ST}${reset}\n`);
  });
}

// Export for CLI / programmatic usage
export { startServer };

// Auto-start only when run directly (not imported by CLI)
if (process.argv[1]?.endsWith('server.cjs') || process.argv[1]?.endsWith('server.ts')) {
  startServer().catch(console.error);
}

// ── 优雅关闭 (OBS-SHUTDOWN-01) ────────────────────────────────────
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 30000;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] Received ${signal}, starting graceful shutdown...`);

  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // 注意：这些操作在模块作用域无法直接访�? Express �? httpServer
    // 生产环境建议通过 startServer() 返回 cleanup 函数
    console.log('[Server] Shutting down...');
    process.exit(0);
  } catch (e) {
    console.error('[Server] Error during shutdown:', e);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
