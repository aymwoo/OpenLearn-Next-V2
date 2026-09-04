import express from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ISemesterGradeServiceToken } from '../../packages/core/di/interfaces.js';
import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { filterXSS } from 'xss';
import { hasDataSubmission, hasScoreDisplay, injectScoreSubmissionUsingAI } from '../../packages/plugins/ai-submit-injector.js';
import { verifyPassword, hashPassword as bcryptHashPassword } from '../../packages/core/db/index.js';
import { encryptApiKey, decryptApiKey, maskApiKey, detectPromptInjection } from '../utils/crypto.js';
import { getCookieToken, getValidSession, checkIsTeacherOrAdmin, getActorId, requireAuth } from '../middleware/auth.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { ServerBootstrapAdapter } from '../../packages/core/bootstrap/index.js';
import {
  ActivityRegistry,
  registerOfficialActivities,
  createActivityContext,
  IActivityRegistryToken,
} from '../../packages/activity-ecosystem/index.js';
import type { ServerContext, AgentChatAttachment, AgentChatRequest, AgentToolExecution, StoredAIProvider } from '../context.js';
import { validateMagicBytes, BLOCKED_EXTENSIONS } from './shared.js';

export function registerOsRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
    activityRegistry,
  } = ctx;

  app.post('/api/upload', async (req, res) => {
    try {
      const { filename, base64Data } = req.body;
      if (!filename || !base64Data) {
        return res.status(400).json({ error: 'Filename and base64Data are required' });
      }

      const ext = path.extname(filename).toLowerCase();
      // SEC-DATA-03: 拒绝可执行文件上�?
      if (BLOCKED_EXTENSIONS.includes(ext)) {
        return res.status(400).json({ error: `File type ${ext} is not allowed for security reasons.` });
      }
      if (ext !== '.pdf' && ext !== '.pptx') {
        return res.status(400).json({ error: 'Only .pdf and .pptx files are supported' });
      }

      const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
      const fileBuffer = Buffer.from(base64Content, 'base64');

      // SEC-DATA-03: Magic bytes 校验
      if (!validateMagicBytes(fileBuffer, filename)) {
        return res.status(400).json({ error: 'File content does not match the declared file type.' });
      }

      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const filePath = path.join(uploadsDir, uniqueName);

      fs.writeFileSync(filePath, fileBuffer);

      let slideCount = 1;
      if (ext === '.pdf') {
        try {
          await new Promise<void>((resolve) => {
            exec(`pdfinfo "${filePath}"`, (error, stdout) => {
              if (error) {
                console.error('Error running pdfinfo:', error);
                return resolve();
              }
              const lines = stdout.split('\n');
              const pagesLine = lines.find(line => line.startsWith('Pages:'));
              if (pagesLine) {
                const match = pagesLine.match(/Pages:\s+(\d+)/);
                if (match) {
                  slideCount = parseInt(match[1], 10);
                }
              }
              resolve();
            });
          });
        } catch (pdfErr) {
          console.error('Failed to parse PDF pages:', pdfErr);
        }
      }

      res.json({
        success: true,
        fileUrl: `/uploads/${uniqueName}`,
        fileName: filename,
        fileType: ext.substring(1),
        slideCount
      });
    } catch (e: any) {
      console.error('Upload error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // OS Capability: Submit Command Manually via Web App Shell API
  app.post('/api/commands', requireAuth(), async (req, res) => {
    try {
      const { commandType, payload } = req.body;
      
      const cmd = kernelContainer.commandBus.createCommand(
        commandType, 
        payload, 
        getActorId(req)
      );
      
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/commands/registered', (req, res) => {
    try {
      const actions = kernelContainer.actionRegistry.getAllActions();
      res.json(actions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ���� Activity Ecosystem REST (Sprint P7-01) ������������������������������������������������������������
  // List registered activity providers, filtered by role. Reuses the same
  // registry the Workspace and plugins share. No business logic is duplicated.
  app.get('/api/activities', async (req, res) => {
    try {
      const role = (req.query.role as string) || 'all';
      const list =
        role === 'all'
          ? activityRegistry.listDescriptors()
          : activityRegistry.listByRole(role as any).map((p) => p.descriptor);
      res.json({ activities: list });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Start an activity: builds an ActivityContext from the existing kernel
  // services and drives the provider lifecycle (reuses Command Bus + Event Bus
  // + Permission runtime). Permission isolation is enforced by startActivity().
  app.post('/api/activities/:id/start', async (req, res) => {
    try {
      const { payload, actorId } = req.body || {};
      const context = createActivityContext({
        commandBus: kernelContainer.commandBus,
        eventBus: kernelContainer.eventBus,
        actionRegistry: kernelContainer.actionRegistry,
        capability: kernelContainer.capabilityGuard as any,
        ai: kernelContainer.aiService,
      });
      const result = await activityRegistry.startActivity(
        req.params.id,
        context,
        payload ?? {},
        actorId,
      );
      res.json({ ok: true, ...result });
    } catch (err: any) {
      const status = err?.code === 'PERMISSION_DENIED' ? 403 : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  // List activities that are currently in progress (running or paused). Used by
  // the dashboard "Activity Center" status monitor �� it shows live status and
  // hides itself when nothing is running. State is in-memory on the provider
  // instances, so this reflects the live server process only.
  app.get('/api/activities/running', (_req, res) => {
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Finish (end) a running activity �� the management action exposed to the
  // dashboard. Reuses the same ActivityContext as start().
  app.post('/api/activities/:id/finish', async (req, res) => {
    try {
      const provider = activityRegistry.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ ok: false, error: 'Activity provider not found' });
      }
      const context = createActivityContext({
        commandBus: kernelContainer.commandBus,
        eventBus: kernelContainer.eventBus,
        actionRegistry: kernelContainer.actionRegistry,
        capability: kernelContainer.capabilityGuard as any,
        ai: kernelContainer.aiService,
      });
      await provider.finish(context);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Pause a running activity (dashboard management action).
  app.post('/api/activities/:id/pause', async (req, res) => {
    try {
      const provider = activityRegistry.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ ok: false, error: 'Activity provider not found' });
      }
      const context = createActivityContext({
        commandBus: kernelContainer.commandBus,
        eventBus: kernelContainer.eventBus,
        actionRegistry: kernelContainer.actionRegistry,
        capability: kernelContainer.capabilityGuard as any,
        ai: kernelContainer.aiService,
      });
      await provider.pause(context);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Resume a paused activity (dashboard management action).
  app.post('/api/activities/:id/resume', async (req, res) => {
    try {
      const provider = activityRegistry.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ ok: false, error: 'Activity provider not found' });
      }
      const context = createActivityContext({
        commandBus: kernelContainer.commandBus,
        eventBus: kernelContainer.eventBus,
        actionRegistry: kernelContainer.actionRegistry,
        capability: kernelContainer.capabilityGuard as any,
        ai: kernelContainer.aiService,
      });
      await provider.resume(context);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // OS Agent interaction
  app.post('/api/agent/chat', async (req, res) => {
    try {
      let { message, lang = 'zh', currentLessonId, attachments, providerId } = req.body as AgentChatRequest;

      // SEC-NET-03: XSS 消毒用户输入
      message = filterXSS(message);
      if (attachments) {
        attachments = attachments.map((att: AgentChatAttachment) => ({
          ...att,
          name: filterXSS(att.name),
        }));
      }

      // SEC-NET-04: Prompt 注入检�?
      if (detectPromptInjection(message)) {
        return res.status(400).json({
          success: false,
          error: lang === 'zh'
            ? '检测到潜在�? prompt 注入尝试，请修改您的输入�?'
            : 'Potential prompt injection detected. Please rephrase your input.',
        });
      }

      // Determine the caller's role (and identity) from the session cookie
      let callerRole: string | undefined;
      let userId: string | undefined;
      const token = getCookieToken(req);
      if (token) {
        const session = getValidSession(token);
        if (session) {
          callerRole = session.role;
          userId = session.userId;
        }
      }

      // Build a per-user / per-lesson memory key and load prior turns
      const convKey = `agent:${userId || 'anonymous'}:${currentLessonId || 'global'}`;
      const MEMORY_TURNS = 20;
      const historyRows = kernelContainer.db.prepare(
        'SELECT role, content FROM agent_conversations WHERE conv_key = ? ORDER BY created_at ASC LIMIT ?'
      ).all(convKey, MEMORY_TURNS) as { role: string; content: string }[];
      const history = historyRows.map(r => ({
        role: (r.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: r.content
      }));

      // Resolve which AI backend handles this request. Precedence:
      //   1. An explicit provider chosen in the UI (providerId)
      //   2. A provider configured in the admin panel — this means the
      //      legacy GEMINI_API_KEY env var is NOT required
      //   3. The GEMINI_API_KEY environment variable (kept as a fallback for
      //      backward compatibility)
      let provider: StoredAIProvider | undefined;
      if (providerId) {
        provider = kernelContainer.db.prepare('SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE id = ?').get(providerId) as StoredAIProvider | undefined;
      } else {
        provider = kernelContainer.db.prepare("SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1").get() as StoredAIProvider | undefined;
      }

      // SEC-DATA-01: 解密 API Key
      if (provider?.api_key) provider.api_key = decryptApiKey(provider.api_key);

      const result = provider
        ? await runOpenAIAgentChat(provider, { message, lang, currentLessonId, attachments, callerRole, history })
        : await runGeminiAgentChat({ message, lang, currentLessonId, attachments, callerRole, history });

      // Persist this exchange so the kernel assistant remembers it next time
      if (result && typeof result.agentText === 'string') {
        const now = Date.now();
        kernelContainer.db.prepare('INSERT INTO agent_conversations (id, conv_key, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('ac_' + crypto.randomUUID(), convKey, 'user', message, now);
        kernelContainer.db.prepare('INSERT INTO agent_conversations (id, conv_key, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run('ac_' + crypto.randomUUID(), convKey, 'assistant', result.agentText, now + 1);
      }

      res.json({
        success: true,
        ...result,
        providerUsed: provider
          ? { id: provider.id, name: provider.name, model_name: provider.model_name }
          : { id: 'system', name: 'Gemini', model_name: 'gemini-3.5-flash' }
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Retrieve the kernel assistant's stored memory for the current user + lesson
  app.get('/api/agent/conversations', (req, res) => {
    try {
      const token = getCookieToken(req);
      let userId: string | undefined;
      if (token) {
        const session = getValidSession(token);
        if (session) userId = session.userId;
      }
      const currentLessonId = (req.query.lessonId as string) || undefined;
      const convKey = `agent:${userId || 'anonymous'}:${currentLessonId || 'global'}`;
      const rows = kernelContainer.db.prepare(
        'SELECT role, content, created_at FROM agent_conversations WHERE conv_key = ? ORDER BY created_at ASC'
      ).all(convKey) as { role: string; content: string; created_at: number }[];
      res.json({
        messages: rows.map(r => ({ role: r.role, content: r.content, createdAt: r.created_at }))
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Clear the kernel assistant's memory for the current user + lesson
  app.delete('/api/agent/conversations', (req, res) => {
    try {
      const token = getCookieToken(req);
      let userId: string | undefined;
      if (token) {
        const session = getValidSession(token);
        if (session) userId = session.userId;
      }
      const currentLessonId = (req.query.lessonId as string) || undefined;
      const convKey = `agent:${userId || 'anonymous'}:${currentLessonId || 'global'}`;
      kernelContainer.db.prepare('DELETE FROM agent_conversations WHERE conv_key = ?').run(convKey);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
