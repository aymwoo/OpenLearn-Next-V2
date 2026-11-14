import path from 'path';
import crypto from 'crypto';
import { filterXSS } from 'xss';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { detectPromptInjection } from '../utils/crypto.js';
import { getCookieToken, getValidSession, getActorId, requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { createActivityContext } from '../../packages/activity-ecosystem/index.js';
import { validateMagicBytes, BLOCKED_EXTENSIONS } from './shared.js';
import {
  AdminPersonaError,
  deleteAdminPersona,
  getAIPersona,
  getDefaultPersonaIdForRole,
  isPersonaVisibleToRole,
  listAIPersonas,
  upsertAdminPersona,
} from '../ai-persona-registry.js';
import { sendSafeError } from '../utils/error-handler.js';
import { getFileStorageService } from '../services/file-storage/index.js';
import { resolveAccessibleAiProvider } from '../services/ai-provider-resolver.js';
import type { ServerContext, StoredAIProvider, AgentChatAttachment, AgentChatRequest } from '../context.js';

export function registerOsRoutes(ctx: ServerContext) {
  const { app, runOpenAIAgentChat, activityRegistry, aiLimiter } = ctx;

  // 轻量连通性探测端点：课堂启动门户的顶部遥测岛用它测 HTTP 往返时延。
  // 刻意不鉴权、不访问数据库、无副作用，以便在登录页等未认证场景也能复用。
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.post('/api/upload', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { filename, base64Data, context } = req.body;
      if (!filename || !base64Data) {
        return res.status(400).json({ error: 'Filename and base64Data are required' });
      }

      const ext = path.extname(filename).toLowerCase();
      // SEC-DATA-03: 拒绝可执行文件上传
      if (BLOCKED_EXTENSIONS.includes(ext)) {
        return res.status(400).json({ error: `File type ${ext} is not allowed for security reasons.` });
      }
      if (ext !== '.pdf' && ext !== '.pptx') {
        return res.status(400).json({ error: 'Only .pdf and .pptx files are supported' });
      }

      const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
      const fileBuffer = Buffer.from(base64Content, 'base64');

      // v0.6.1：上传大小按管理后台配置强制执行（site_settings.upload_max_file_mb，
      // NULL = 默认 10MB）。JSON 体积上限已抬到 110MB（server.ts），此处按
      // **解码后**的文件字节数逐请求裁决，管理员可在 1–90MB 间调整。
      const settingsRow = kernelContainer.db
        .prepare('SELECT upload_max_file_mb FROM site_settings WHERE id = ?')
        .get('global') as { upload_max_file_mb?: number | null } | undefined;
      const maxFileMb = settingsRow?.upload_max_file_mb ?? 10;
      if (fileBuffer.length > maxFileMb * 1024 * 1024) {
        return res.status(413).json({
          error: `课件文件超过 ${maxFileMb}MB 上限（上限可在管理后台 → 站点设置调整）。`,
        });
      }

      // SEC-DATA-03: Magic bytes 校验
      if (!validateMagicBytes(fileBuffer, filename)) {
        return res.status(400).json({ error: 'File content does not match the declared file type.' });
      }

      const session = (req as any).session as { userId?: string } | undefined;
      const allowedPurposes = new Set(['lesson-asset', 'courseware', 'attachment']);
      const requestedPurpose =
        context &&
        typeof context === 'object' &&
        typeof context.purpose === 'string' &&
        allowedPurposes.has(context.purpose)
          ? context.purpose
          : 'lesson-asset';
      const courseId =
        context && typeof context === 'object' && typeof context.courseId === 'string' && context.courseId.trim()
          ? context.courseId.trim()
          : null;
      const lessonId =
        context && typeof context === 'object' && typeof context.lessonId === 'string' && context.lessonId.trim()
          ? context.lessonId.trim()
          : null;

      const mime =
        ext === '.pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

      const stored = await getFileStorageService().store({
        buffer: fileBuffer,
        originalName: filename,
        mime,
        context: {
          purpose: requestedPurpose,
          accessScope: 'authenticated',
          authorId: session?.userId ?? null,
          courseId,
          lessonId,
        },
      });

      const slideCount =
        ext === '.pdf' && typeof stored.metadata?.slideCount === 'number' && stored.metadata.slideCount > 0
          ? stored.metadata.slideCount
          : 1;

      res.json({
        success: true,
        assetId: stored.assetId,
        fileUrl: stored.fileUrl,
        fileName: filename,
        fileType: ext.substring(1),
        slideCount,
      });
    } catch (e: unknown) {
      console.error('Upload error:', e);
      sendSafeError(res, e);
    }
  });

  // OS Capability: Submit Command Manually via Web App Shell API (SEC: 仅限教师与管理员调用)
  app.post('/api/commands', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { commandType, payload } = req.body;

      const cmd = kernelContainer.commandBus.createCommand(commandType, payload, getActorId(req));

      // v0.6.1 审计 R-6：命令执行加 10s 上限 —— 此前直接 await，挂死的
      // kernel/插件 handler 会令教师端工具下发按钮永久 pending（前端亦无
      // AbortSignal）。10s 为宽上限：覆盖合法的慢命令（如对接外部网关的
      // 插件命令），又不至于无限挂死。
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        kernelContainer.commandBus.execute(cmd),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Command execution timed out after 10s: ${commandType}`)),
            10_000,
          );
        }),
      ]).finally(() => {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      });
      res.json({ success: true, result });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/commands/registered', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const actions = kernelContainer.actionRegistry.getAllActions();
      res.json(actions);
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // ── Activity Ecosystem REST (Sprint P7-01) ──────────────────────────────
  // List registered activity providers, filtered by role. Reuses the same
  // registry the Workspace and plugins share. No business logic is duplicated.
  app.get('/api/activities', requireScopedAuth('authenticated'), async (req, res) => {
    try {
      const role = (req.query.role as string) || 'all';
      const list =
        role === 'all'
          ? activityRegistry.listDescriptors()
          : activityRegistry
              .listByRole(role as Parameters<typeof activityRegistry.listByRole>[0])
              .map((p) => p.descriptor);
      res.json({ activities: list });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // Start an activity: builds an ActivityContext from the existing kernel
  // services and drives the provider lifecycle (reuses Command Bus + Event Bus
  // + Permission runtime). Permission isolation is enforced by startActivity().
  app.post('/api/activities/:id/start', requireScopedAuth('authenticated'), async (req, res) => {
    try {
      const { payload, actorId } = req.body || {};
      const context = createActivityContext({
        commandBus: kernelContainer.commandBus,
        eventBus: kernelContainer.eventBus,
        actionRegistry: kernelContainer.actionRegistry,
        capability: kernelContainer.capabilityGuard as any,
        ai: kernelContainer.aiService,
      });
      const result = await activityRegistry.startActivity(req.params.id, context, payload ?? {}, actorId);
      res.json({ ok: true, ...result });
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
      const status = code === 'PERMISSION_DENIED' ? 403 : 500;
      sendSafeError(res, err, status);
    }
  });

  // List activities that are currently in progress (running or paused). Used by
  // the dashboard "Activity Center" status monitor — it shows live status and
  // hides itself when nothing is running. State is in-memory on the provider
  // instances, so this reflects the live server process only.
  app.get('/api/activities/running', requireScopedAuth('authenticated'), (_req, res) => {
    try {
      const activities = activityRegistry
        .listProviders()
        .filter((p) => p.state === 'running' || p.state === 'paused')
        .map((p) => ({
          id: p.descriptor.id,
          name: p.descriptor.name,
          icon: p.descriptor.icon,
          category: p.descriptor.category,
          provider: p.descriptor.provider,
          state: p.state,
          startedAt: p.startedAt ?? null,
        }));
      res.json({ activities });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // Finish (end) a running activity — the management action exposed to the
  // dashboard. Reuses the same ActivityContext as start().
  app.post('/api/activities/:id/finish', requireScopedAuth('authenticated'), async (req, res) => {
    try {
      const provider = activityRegistry.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ ok: false, error: 'Activity provider not found' });
      }
      const context = createActivityContext({
        commandBus: kernelContainer.commandBus,
        eventBus: kernelContainer.eventBus,
        actionRegistry: kernelContainer.actionRegistry,
        capability: kernelContainer.capabilityGuard as unknown as Parameters<
          typeof createActivityContext
        >[0]['capability'],
        ai: kernelContainer.aiService,
      });
      await provider.finish(context);
      res.json({ ok: true });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // Pause a running activity (dashboard management action).
  app.post('/api/activities/:id/pause', requireScopedAuth('authenticated'), async (req, res) => {
    try {
      const provider = activityRegistry.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ ok: false, error: 'Activity provider not found' });
      }
      const context = createActivityContext({
        commandBus: kernelContainer.commandBus,
        eventBus: kernelContainer.eventBus,
        actionRegistry: kernelContainer.actionRegistry,
        capability: kernelContainer.capabilityGuard as unknown as Parameters<
          typeof createActivityContext
        >[0]['capability'],
        ai: kernelContainer.aiService,
      });
      await provider.pause(context);
      res.json({ ok: true });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // Resume a paused activity (dashboard management action).
  app.post('/api/activities/:id/resume', requireScopedAuth('authenticated'), async (req, res) => {
    try {
      const provider = activityRegistry.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ ok: false, error: 'Activity provider not found' });
      }
      const context = createActivityContext({
        commandBus: kernelContainer.commandBus,
        eventBus: kernelContainer.eventBus,
        actionRegistry: kernelContainer.actionRegistry,
        capability: kernelContainer.capabilityGuard as unknown as Parameters<
          typeof createActivityContext
        >[0]['capability'],
        ai: kernelContainer.aiService,
      });
      await provider.resume(context);
      res.json({ ok: true });
    } catch (err: unknown) {
      sendSafeError(res, err);
    }
  });

  // OS Agent interaction
  // P2: ai.agent.persona —— 角色模板列表（按当前用户角色过滤 visibility；管理员传 scope=all 查看全量）
  app.get('/api/agent/personas', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const session = (req as any).session || (getCookieToken(req) ? getValidSession(getCookieToken(req)!) : null);
      const callerRole = session?.role as string | undefined;
      const includeAll = req.query.scope === 'all' && callerRole === 'administrator';
      const personas = includeAll ? listAIPersonas() : listAIPersonas(callerRole);
      res.json({
        success: true,
        personas,
        defaultPersonaId: getDefaultPersonaIdForRole(callerRole),
      });
    } catch (e: any) {
      sendSafeError(res, e, 500);
    }
  });

  app.post('/api/agent/personas', requireScopedAuth('admin'), (req, res) => {
    try {
      const persona = upsertAdminPersona(req.body ?? {}, {
        isUpdate: false,
        actorId: getActorId(req),
      });
      res.status(201).json({ success: true, persona });
    } catch (e: any) {
      if (e instanceof AdminPersonaError) {
        return res.status(e.status).json({ success: false, error: e.code, message: e.message });
      }
      sendSafeError(res, e, 500);
    }
  });

  app.patch('/api/agent/personas/:id', requireScopedAuth('admin'), (req, res) => {
    try {
      const persona = upsertAdminPersona(
        { ...(req.body ?? {}), id: req.params.id },
        { isUpdate: true, actorId: getActorId(req) },
      );
      res.json({ success: true, persona });
    } catch (e: any) {
      if (e instanceof AdminPersonaError) {
        return res.status(e.status).json({ success: false, error: e.code, message: e.message });
      }
      sendSafeError(res, e, 500);
    }
  });

  app.delete('/api/agent/personas/:id', requireScopedAuth('admin'), (req, res) => {
    try {
      deleteAdminPersona(req.params.id, getActorId(req));
      res.json({ success: true });
    } catch (e: any) {
      if (e instanceof AdminPersonaError) {
        return res.status(e.status).json({ success: false, error: e.code, message: e.message });
      }
      sendSafeError(res, e, 500);
    }
  });

  app.post('/api/agent/chat', requireScopedAuth('self'), aiLimiter, async (req, res) => {
    try {
      let { message, lang = 'zh', currentLessonId, attachments, providerId } = req.body as AgentChatRequest;

      if (typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: lang === 'zh' ? 'message 参数不能为空。' : 'message is required',
        });
      }

      // SEC-NET-03: XSS 消毒用户输入
      message = filterXSS(message);
      if (Array.isArray(attachments)) {
        attachments = attachments.map((att: AgentChatAttachment) => ({
          ...att,
          name: typeof att?.name === 'string' ? filterXSS(att.name) : '',
        }));
      }

      // SEC-NET-04: Prompt 注入检测
      if (detectPromptInjection(message)) {
        return res.status(400).json({
          success: false,
          error:
            lang === 'zh'
              ? '检测到潜在的 prompt 注入尝试，请修改您的输入。'
              : 'Potential prompt injection detected. Please rephrase your input.',
        });
      }

      // Determine the caller's role (and identity) from session
      let callerRole: string | undefined;
      let userId: string | undefined;
      const session = (req as any).session || (getCookieToken(req) ? getValidSession(getCookieToken(req)!) : null);
      if (session) {
        callerRole = session.role;
        userId = session.userId || session.username;
      }

      const requestedPersonaId =
        typeof (req.body as AgentChatRequest)?.personaId === 'string'
          ? (req.body as AgentChatRequest).personaId!.trim()
          : '';
      if (requestedPersonaId) {
        const persona = getAIPersona(requestedPersonaId);
        if (!persona) {
          return res.status(404).json({
            success: false,
            error: 'PERSONA_NOT_FOUND',
            message: lang === 'zh' ? '指定的 AI 角色模板不存在。' : 'Requested AI persona was not found.',
          });
        }
        if (!isPersonaVisibleToRole(persona, callerRole)) {
          return res.status(403).json({
            success: false,
            error: 'PERSONA_FORBIDDEN',
            message:
              lang === 'zh'
                ? '当前角色无权使用该 AI 角色模板。'
                : 'Current role is not allowed to use this AI persona.',
          });
        }
      }

      // Build a per-user / per-lesson memory key and load prior turns
      const convKey = `agent:${userId || 'anonymous'}:${currentLessonId || 'global'}`;
      const MEMORY_TURNS = 20;
      const historyRows = kernelContainer.db
        .prepare('SELECT role, content FROM agent_conversations WHERE conv_key = ? ORDER BY created_at ASC LIMIT ?')
        .all(convKey, MEMORY_TURNS) as { role: string; content: string }[];
      const history = historyRows.map((r) => ({
        role: (r.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: r.content,
      }));

      // Resolve which AI backend handles this request:
      //   1. An explicit provider chosen in the UI (providerId, checked for ownership / shared)
      //   2. Fallback to current user's accessible active provider (private > shared)
      let provider: StoredAIProvider;
      try {
        provider = resolveAccessibleAiProvider(kernelContainer.db, {
          providerId,
          userId,
          lang,
        });
      } catch (err: unknown) {
        const errObj = err as { status?: number; code?: string; message?: string };
        return res.status(errObj.status || 400).json({
          success: false,
          error: errObj.code || 'NO_AI_PROVIDER',
          message: errObj.message || 'AI provider error',
        });
      }

      const actorId = getActorId(req);
      const result = await runOpenAIAgentChat(provider, {
        message,
        lang,
        currentLessonId,
        attachments,
        callerRole,
        actorId,
        history,
        personaId: (req.body as AgentChatRequest)?.personaId ?? null,
      });

      // Persist this exchange so the kernel assistant remembers it next time
      if (result && typeof result.agentText === 'string') {
        const now = Date.now();
        kernelContainer.db
          .prepare('INSERT INTO agent_conversations (id, conv_key, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('ac_' + crypto.randomUUID(), convKey, 'user', message, now);
        kernelContainer.db
          .prepare('INSERT INTO agent_conversations (id, conv_key, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('ac_' + crypto.randomUUID(), convKey, 'assistant', result.agentText, now + 1);
      }

      res.json({
        success: true,
        ...result,
        providerUsed: { id: provider.id, name: provider.name, model_name: provider.model_name },
      });
    } catch (err: unknown) {
      console.error(err);
      sendSafeError(res, err);
    }
  });

  // Retrieve the kernel assistant's stored memory for the current user + lesson
  app.get('/api/agent/conversations', requireScopedAuth('self'), (req, res) => {
    try {
      const token = getCookieToken(req);
      let userId: string | undefined;
      const session =
        (req as { session?: { userId?: string; username?: string } }).session ||
        (token ? getValidSession(token) : null);
      if (session) {
        userId = session.userId || session.username;
      }
      const currentLessonId = (req.query.lessonId as string) || undefined;
      const convKey = `agent:${userId || 'anonymous'}:${currentLessonId || 'global'}`;
      const rows = kernelContainer.db
        .prepare('SELECT role, content, created_at FROM agent_conversations WHERE conv_key = ? ORDER BY created_at ASC')
        .all(convKey) as { role: string; content: string; created_at: number }[];
      res.json({
        messages: rows.map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at })),
      });
    } catch (e: unknown) {
      sendSafeError(res, e);
    }
  });

  // Clear the kernel assistant's memory for the current user + lesson
  app.delete('/api/agent/conversations', requireScopedAuth('self'), (req, res) => {
    try {
      const token = getCookieToken(req);
      let userId: string | undefined;
      const session =
        (req as { session?: { userId?: string; username?: string } }).session ||
        (token ? getValidSession(token) : null);
      if (session) {
        userId = session.userId || session.username;
      }
      const currentLessonId = (req.query.lessonId as string) || undefined;
      const convKey = `agent:${userId || 'anonymous'}:${currentLessonId || 'global'}`;
      kernelContainer.db.prepare('DELETE FROM agent_conversations WHERE conv_key = ?').run(convKey);
      res.json({ success: true });
    } catch (e: unknown) {
      sendSafeError(res, e);
    }
  });
}
