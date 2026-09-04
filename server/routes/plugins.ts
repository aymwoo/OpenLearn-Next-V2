import express from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { checkVersion, type UpdateSource } from '../services/version-fetcher.js';
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

function isSafeExternalUrl(urlStr: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: 'Only HTTP and HTTPS protocols are allowed' };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      return { safe: false, reason: 'Access to loopback/local addresses is forbidden' };
    }
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number);
      if (
        octets[0] === 127 ||
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 169 && octets[1] === 254) ||
        octets[0] === 0 ||
        octets[0] >= 224
      ) {
        return { safe: false, reason: 'Access to private or link-local IP addresses is forbidden' };
      }
    }
    return { safe: true };
  } catch (e: any) {
    return { safe: false, reason: `Invalid URL format: ${e.message}` };
  }
}

export function registerPluginsRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.get('/api/docs/plugin-guide', (req, res) => {
    try {
      const docPath = path.join(process.cwd(), 'docs_plugin_guide.md');
      if (!fs.existsSync(docPath)) {
        return res.status(404).json({ success: false, error: 'Document not found' });
      }
      const content = fs.readFileSync(docPath, 'utf-8');
      res.json({ success: true, content });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Get recent system logs (for admin/developer console)
  app.get('/api/admin/logs', (req, res) => {
    if (!checkIsTeacherOrAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Access denied: teachers or admins only' });
    }
    try {
      const limit = parseInt(req.query.limit as string) || 200;
      const component = req.query.component as string | undefined;
      const levelFilter = req.query.level as string | undefined;

      const logFile = path.resolve(process.cwd(), 'logs', 'openlearn.log');
      if (!fs.existsSync(logFile)) {
        return res.json({ success: true, logs: [] });
      }

      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      
      let parsedLogs = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { time: Date.now(), level: 30, msg: line };
        }
      });

      const PINO_LEVELS: Record<number, string> = {
        10: 'trace',
        20: 'debug',
        30: 'info',
        40: 'warn',
        50: 'error',
        60: 'fatal'
      };

      parsedLogs = parsedLogs.map(log => ({
        ...log,
        level: typeof log.level === 'number' ? (PINO_LEVELS[log.level] || 'info') : (log.level || 'info'),
        time: log.time ? new Date(log.time).toISOString() : new Date().toISOString()
      }));

      if (component) {
        parsedLogs = parsedLogs.filter(log => log.component === component || (log.component && log.component.includes(component)));
      }
      if (levelFilter) {
        parsedLogs = parsedLogs.filter(log => log.level === levelFilter);
      }

      const sliceStart = Math.max(0, parsedLogs.length - limit);
      res.json({ success: true, logs: parsedLogs.slice(sliceStart) });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Plugin APIs
  app.get('/api/plugins', (req, res) => {
    res.json(kernelContainer.pluginLifecycleManager.listPlugins());
  });

  // Lookup installed plugin by logical manifest.id (for upgrade detection in the wizard)
  // MUST be registered before /api/plugins/:id(*)
  app.get('/api/plugins/by-manifest/:manifestId(*)', (req, res) => {
    try {
      const manifestId = decodeURIComponent(req.params.manifestId);
      const found = kernelContainer.pluginHost.findByManifestId(manifestId);
      if (!found) {
        return res.json({ success: true, installed: false });
      }
      res.json({
        success: true,
        installed: true,
        pluginId: found.pluginId,
        name: found.name,
        version: found.version,
        status: found.status,
        state: found.state,
        manifest: found.manifest,
        isSystem: manifestId.startsWith('@openlearn/') || found.pluginId.startsWith('@openlearn/'),
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

 // 插件市场列表与版本更新检测 API
  app.get('/api/plugins/market', async (req, res) => {
    // Return update info for all installed plugins that declare updateSource
    try {
      const plugins = kernelContainer.db
        .prepare("SELECT id, manifest FROM plugins WHERE manifest LIKE '%updateSource%'")
        .all() as Array<{ id: string; manifest: string }>;

      const results: Array<{
        pluginId: string;
        manifestId: string;
        installedVersion: string;
        latestVersion: string | null;
        hasUpdate: boolean;
        isPrerelease: boolean;
        downloadUrl: string | null;
        changelog: string | null;
        error?: string;
      }> = [];

      for (const p of plugins) {
        let manifest: any;
        try { manifest = JSON.parse(p.manifest); } catch { continue; }
        const src: UpdateSource | undefined = manifest.updateSource;
        if (!src?.type || !src?.repo) continue;
        const result = await checkVersion(src, manifest.version || '0.0.0');
        results.push({
          pluginId: p.id,
          manifestId: manifest.id || p.id,
          installedVersion: manifest.version || '0.0.0',
          ...result,
        });
      }

      res.json({ success: true, market: results });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 手动检查单个插件更新
  app.post('/api/plugins/:id(*)/check-update', async (req, res) => {
    try {
      const rawId = decodeURIComponent(req.params.id);
      const pluginId = kernelContainer.pluginHost.resolvePluginUuid(rawId);
      const row = kernelContainer.db
        .prepare('SELECT manifest FROM plugins WHERE id = ?')
        .get(pluginId) as { manifest: string } | undefined;
      if (!row) return res.status(404).json({ success: false, error: 'Plugin not found' });

      let manifest: any;
      try { manifest = JSON.parse(row.manifest); } catch {
        return res.status(400).json({ success: false, error: 'Invalid manifest JSON' });
      }

      const src: UpdateSource | undefined = manifest.updateSource;
      if (!src?.type || !src?.repo) {
        return res.json({ success: true, hasUpdate: false, message: '该插件未声明更新源' });
      }

      const result = await checkVersion(src, manifest.version || '0.0.0');
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 一键热更新插件 API
  app.post('/api/plugins/:id(*)/one-click-update', requireAuth('administrator'), async (req, res) => {
    try {
      const targetPluginId = decodeURIComponent(req.params.id);
      const { downloadUrl } = req.body || {};

      let zipBuffer: Buffer;

      if (downloadUrl) {
        const urlCheck = isSafeExternalUrl(downloadUrl);
        if (!urlCheck.safe) {
          return res.status(400).json({
            success: false,
            error: `安全拦截: 非法下载地址 (${urlCheck.reason})`,
          });
        }
        // Server-side download with timeout fallback signal
        try {
          const resp = await fetch(downloadUrl, {
            headers: { 'User-Agent': 'OpenLearnV2-PluginUpdater/1.0' },
            signal: AbortSignal.timeout(15000),
          });
          if (!resp.ok) {
            return res.status(400).json({
              success: false,
              error: `下载更新包失败: HTTP ${resp.status}`,
              fallbackToClient: true,
            });
          }
          const arrayBuf = await resp.arrayBuffer();
          zipBuffer = Buffer.from(arrayBuf);
        } catch (e: any) {
          const isTimeout = e.name === 'TimeoutError' || e.message?.includes('timeout');
          return res.status(400).json({
            success: false,
            error: isTimeout ? '服务端下载超时，请尝试从客户端直传' : `下载失败: ${e.message}`,
            fallbackToClient: true,
          });
        }
      } else {
        // Legacy: local file path (backward compat)
        const zipPath = path.resolve(process.cwd(), 'v2_plugins/research-workflow/aymwoo-plugin-research-workflow.zip');
        if (fs.existsSync(zipPath)) {
          zipBuffer = fs.readFileSync(zipPath);
        } else {
          return res.status(404).json({ success: false, error: '未找到更新安装包' });
        }
      }

      const result = await kernelContainer.pluginDistributionManager.updateFromZip(zipBuffer, {
        targetPluginId,
        allowDowngrade: false,
      });

      res.json({
        success: true,
        updated: true,
        pluginId: result.pluginId,
        manifest: result.manifest,
        oldVersion: result.oldVersion,
        newVersion: result.newVersion || '1.2.0',
        wasActive: result.wasActive,
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // V3.0: 查询插件贡献点摘�?
  app.get('/api/plugins/:id(*)/contributions', (req, res) => {
    try {
      const rawId = decodeURIComponent(req.params.id);
      const summary = kernelContainer.pluginHost.listContributions(rawId);
      res.json({ success: true, result: summary });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // V3.1: 读取插件配置（schema + 当前值）
  app.get('/api/plugins/:id(*)/config', (req, res) => {
    try {
      const rawId = decodeURIComponent(req.params.id);
      const pluginId = kernelContainer.pluginHost.resolvePluginUuid(rawId);
      const row = kernelContainer.db
        .prepare('SELECT manifest FROM plugins WHERE id = ?')
        .get(pluginId) as { manifest: string } | undefined;
      if (!row) {
        return res.status(404).json({ success: false, error: 'Plugin not found' });
      }
      const manifest = JSON.parse(row.manifest);
      res.json({
        success: true,
        result: {
          schema: manifest.configuration?.properties ?? {},
          values: kernelContainer.pluginHost.getPluginConfig(pluginId, manifest),
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // V3.1: 更新插件配置
  app.post('/api/plugins/:id(*)/config', requireAuth('administrator'), (req, res) => {
    try {
      const rawId = decodeURIComponent(req.params.id);
      const pluginId = kernelContainer.pluginHost.resolvePluginUuid(rawId);
      const updates = req.body;
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ success: false, error: 'Body must be an object of key-value pairs' });
      }
      const row = kernelContainer.db
        .prepare('SELECT manifest FROM plugins WHERE id = ?')
        .get(pluginId) as { manifest: string } | undefined;
      if (!row) {
        return res.status(404).json({ success: false, error: 'Plugin not found' });
      }
      const manifest = JSON.parse(row.manifest);
      kernelContainer.pluginHost.setPluginConfig(pluginId, manifest, updates);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/plugins/:id(*)/toggle', requireAuth('administrator'), async (req, res) => {
    try {
      const rawId = decodeURIComponent(req.params.id);
      const cmd = kernelContainer.commandBus.createCommand(
        'plugin.toggle',
        { pluginId: rawId },
        getActorId(req)
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/plugins/:id(*)', requireAuth('administrator'), async (req, res) => {
    try {
      const rawId = decodeURIComponent(req.params.id);
      const cmd = kernelContainer.commandBus.createCommand(
        'plugin.uninstall',
        { pluginId: rawId },
        getActorId(req)
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET single plugin by UUID or manifest.id alias (Placed AFTER /config, /toggle, /contributions)
  app.get('/api/plugins/:id(*)', async (req, res) => {
    try {
      const rawId = decodeURIComponent(req.params.id);
      const cmd = kernelContainer.commandBus.createCommand(
        'plugin.info',
        { pluginId: rawId },
        getActorId(req)
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  app.post('/api/plugins', requireAuth('administrator'), async (req, res) => {
    try {
      const { sourceCode } = req.body;
      const cmd = kernelContainer.commandBus.createCommand(
        'plugin.install',
        { sourceCode },
        getActorId(req)
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/plugins/upload-zip', requireAuth('administrator'), async (req, res) => {
    try {
      const { base64Data, filename, executionMode } = req.body;
      const cmd = kernelContainer.commandBus.createCommand(
        'plugin.install_zip',
        { base64Data, filename, executionMode },
        getActorId(req)
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Raw binary upload — avoids base64 overhead for large plugin zips
  app.post('/api/plugins/upload-zip-raw', requireAuth('administrator'), express.raw({ type: 'application/octet-stream', limit: '400mb' }), async (req, res) => {
    try {
      const zipBuffer = req.body;
      const filename = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename'] as string) : 'plugin.zip';
      const executionModeHeader = String(req.headers['x-execution-mode'] || '').toLowerCase();
      const executionMode =
        executionModeHeader === 'worker' || executionModeHeader === 'inline'
          ? (executionModeHeader as 'worker' | 'inline')
          : undefined;
      const modeHeader = String(req.headers['x-install-mode'] || 'install').toLowerCase();
      const allowDowngrade = String(req.headers['x-allow-downgrade'] || '').toLowerCase() === 'true';
      const targetPluginId = req.headers['x-target-plugin-id']
        ? decodeURIComponent(String(req.headers['x-target-plugin-id']))
        : undefined;
      if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
        return res.status(400).json({ success: false, error: 'Empty or invalid zip file' });
      }

      if (modeHeader === 'update') {
        const result = await kernelContainer.pluginDistributionManager.updateFromZip(zipBuffer, {
          targetPluginId,
          executionMode,
          allowDowngrade,
        });
        return res.json({
          success: true,
          updated: true,
          pluginId: result.pluginId,
          manifest: result.manifest,
          oldVersion: result.oldVersion,
          newVersion: result.newVersion,
          wasActive: result.wasActive,
          filename,
        });
      }

      const result = await kernelContainer.pluginDistributionManager.installFromZip(zipBuffer, executionMode);
      // result.pluginId is DB UUID; result.manifest keeps package metadata
      res.json({
        success: true,
        updated: false,
        pluginId: result.pluginId,
        manifest: result.manifest,
        filename,
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Explicit update endpoint (card "Update" button)
  app.post(
    '/api/plugins/:id(*)/update-zip-raw',
    requireAuth('administrator'),
    express.raw({ type: 'application/octet-stream', limit: '400mb' }),
    async (req, res) => {
      try {
        const targetPluginId = decodeURIComponent(req.params.id);
        const zipBuffer = req.body;
        const executionModeHeader = String(req.headers['x-execution-mode'] || '').toLowerCase();
        const executionMode =
          executionModeHeader === 'worker' || executionModeHeader === 'inline'
            ? (executionModeHeader as 'worker' | 'inline')
            : undefined;
        const allowDowngrade = String(req.headers['x-allow-downgrade'] || '').toLowerCase() === 'true';
        if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
          return res.status(400).json({ success: false, error: 'Empty or invalid zip file' });
        }
        const result = await kernelContainer.pluginDistributionManager.updateFromZip(zipBuffer, {
          targetPluginId,
          executionMode,
          allowDowngrade,
        });
        res.json({
          success: true,
          updated: true,
          pluginId: result.pluginId,
          manifest: result.manifest,
          oldVersion: result.oldVersion,
          newVersion: result.newVersion,
          wasActive: result.wasActive,
        });
      } catch (err: any) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
      }
    },
  );

  // Plugin command execution endpoint (V3.0: frontend invokeCommand bridge)
  app.post('/api/plugins/execute-command', async (req, res) => {
    try {
      const { type, payload } = req.body;
      if (!type) {
        return res.status(400).json({ success: false, error: 'Missing command type' });
      }

      // Resolve the prefixed command type. Handlers are registered by the
      // service-host with a plugin-UUID prefix (e.g. 019f6465-?:courseware.open_panel),
      // but some callers (e.g. whiteboard toolbar buttons) may send the bare type.
      // Fallback: if the bare type is not found, try suffix-matching against
      // all registered handler keys.
      let resolvedType = type;
      const bus = kernelContainer.commandBus as any;
      // service-host stores handlers in private 'handlers' / 'legacyHandlers' Maps
      const handlersMap = bus.handlers;
      const legacyMap = bus.legacyHandlers;
      if (!handlersMap?.has?.(resolvedType) && !legacyMap?.has?.(resolvedType)) {
        for (const map of [handlersMap, legacyMap]) {
          if (!map) continue;
          for (const [key] of map) {
            if (key.endsWith(':' + resolvedType) || key.endsWith('.' + resolvedType)) {
              resolvedType = key;
              break;
            }
          }
          if (resolvedType !== type) break;
        }
      }

      // Debug: log all registered handlers when lookup fails
      if (!handlersMap?.has?.(resolvedType) && !legacyMap?.has?.(resolvedType)) {
        console.error('[execute-command] Handler NOT FOUND for type:', resolvedType);
        console.error('[execute-command] Registered handlers:', 
          [...(handlersMap?.keys?.() ?? [])].join(', ') || '(none)');
        const matching = [...(handlersMap?.keys?.() ?? [])].filter(k => k.includes('courseware'));
        console.error('[execute-command] Matching courseware keys:', matching.join(', ') || '(none)');
      }

      const cmd = await kernelContainer.commandBus.createCommand(
        resolvedType,
        payload ?? {},
        getActorId(req),
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json({ success: true, result });
    } catch (err: any) {
      console.error('[execute-command]', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // AI Provider Endpoints
  app.get('/api/ai-providers', (req, res) => {
    try {
      const providers = kernelContainer.db.prepare('SELECT * FROM ai_providers ORDER BY created_at DESC').all() as any[];
      // SEC-DATA-01: 掩码 API Key 后返?
      const masked = providers.map(p => ({
        ...p,
        api_key: maskApiKey(decryptApiKey(p.api_key || '')),
      }));
      res.json(masked);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/ai-providers', requireAuth('administrator'), (req, res) => {
    try {
      const { name, api_url, api_key, model_name } = req.body;
      if (!name || !api_url || !model_name) {
        return res.status(400).json({ error: 'Missing name, api_url or model_name' });
      }
      const id = 'prov_' + Date.now();
      const now = Date.now();
      // SEC-DATA-01: 加密存储 API Key
      const encryptedKey = api_key ? encryptApiKey(api_key) : '';
      kernelContainer.db.prepare('INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, name, api_url, encryptedKey, model_name, now, now);
      res.json({ success: true, id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/ai-providers/:id', requireAuth('administrator'), (req, res) => {
    try {
      const { name, api_url, api_key, model_name } = req.body;
      if (!name || !api_url || !model_name) {
        return res.status(400).json({ error: 'Missing name, api_url or model_name' });
      }
      const now = Date.now();
      // SEC-DATA-01: ? **** 的掩码密? ? 保留原值；纯明? ? 加密存储
      let finalKey: string;
      if (api_key && api_key.trim() !== '' && !api_key.includes('****')) {
        finalKey = encryptApiKey(api_key);
      } else {
        const existing = kernelContainer.db.prepare('SELECT api_key FROM ai_providers WHERE id = ?').get(req.params.id) as any;
        finalKey = existing?.api_key || '';
      }
      kernelContainer.db.prepare('UPDATE ai_providers SET name = ?, api_url = ?, api_key = ?, model_name = ?, updated_at = ? WHERE id = ?')
        .run(name, api_url, finalKey, model_name, now, req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/ai-providers/:id', requireAuth('administrator'), (req, res) => {
    try {
      kernelContainer.db.prepare('DELETE FROM ai_providers WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 站点信息设置端点（站点名称、口号、Logo 图片）
  app.get('/api/site-settings', (req, res) => {
    try {
      const row = kernelContainer.db
        .prepare('SELECT site_name, slogan, logo_url FROM site_settings WHERE id = ?')
        .get('global') as any;
      res.json({
        siteName: row?.site_name || '',
        slogan: row?.slogan || '',
        logoUrl: row?.logo_url || null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/site-settings', requireAuth('administrator'), (req, res) => {
    try {
      const { siteName, slogan, logoUrl } = req.body || {};
      kernelContainer.db
        .prepare(
          `INSERT INTO site_settings (id, site_name, slogan, logo_url) VALUES ('global', ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET site_name = excluded.site_name, slogan = excluded.slogan, logo_url = excluded.logo_url`
        )
        .run(siteName || '', slogan || '', logoUrl || null);
      res.json({
        success: true,
        siteInfo: { siteName: siteName || '', slogan: slogan || '', logoUrl: logoUrl || null },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/ai-providers/test', requireAuth('administrator'), async (req, res) => {
    try {
      const { api_url, api_key: providedKey, model_name } = req.body;
      if (!api_url || !model_name) {
        return res.status(400).json({ error: 'api_url and model_name are required' });
      }

      // SEC-DATA-01: 解密 API Key（掩码密钥表示未修改，需�? DB 获取�?
      let api_key = '';
      if (providedKey && providedKey.includes('****')) {
        // 掩码密钥：用户未输入�? key，尝试从 DB 查询
        const existing = kernelContainer.db.prepare(
          'SELECT api_key FROM ai_providers WHERE api_url = ? AND model_name = ? LIMIT 1'
        ).get(api_url, model_name) as { api_key: string } | undefined;
        api_key = existing ? decryptApiKey(existing.api_key) : '';
      } else if (providedKey) {
        api_key = providedKey.includes(':') ? decryptApiKey(providedKey) : providedKey;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      let cleanUrl = api_url.trim();
      if (!cleanUrl.endsWith('/chat/completions')) {
        cleanUrl = cleanUrl.endsWith('/') ? cleanUrl + 'chat/completions' : cleanUrl + '/chat/completions';
      }

      const urlSafety = isSafeExternalUrl(cleanUrl);
      if (!urlSafety.safe) {
        return res.status(400).json({ error: `Blocked unsafe AI provider URL: ${urlSafety.reason}` });
      }

      const response = await fetch(cleanUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api_key || ''}`
        },
        body: JSON.stringify({
          model: model_name,
          messages: [{ role: 'user', content: 'Say connected' }],
          max_tokens: 5
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const responseText = await response.text();
      if (response.ok) {
        res.json({ success: true, message: 'Successfully connected and received response.' });
      } else {
        res.status(response.status).json({ success: false, error: `API responded with status ${response.status}: ${responseText.slice(0, 200)}` });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: `Connection failed: ${e.message}` });
    }
  });
}
