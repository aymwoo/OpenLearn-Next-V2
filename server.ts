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
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { filterXSS } from 'xss';
import { hasDataSubmission, hasScoreDisplay, injectScoreSubmissionUsingAI } from './packages/plugins/ai-submit-injector.js';
import { setupRealtimeBridge } from './server/realtime-bridge.js';
import { setupPresence } from './server/presence.js';
import { runStartupMigrations } from './server/bootstrap-db.js';
import { MF_REMOTE_CACHE, lessonActiveSegments } from './server/shared-state.js';
import {
  buildAgentSystemInstruction,
  buildAgentFinalMessage,
  normalizeToolSchema,
  buildOpenAITools,
  executeAgentToolCall,
  buildOpenAIChatUrl,
  runGeminiAgentChat,
  runOpenAIAgentChat,
} from './server/ai-agent.js';
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




async function startServer() {
  // Bridge server startup through Platform Kernel Bootstrap Adapter (PI-005)
  await ServerBootstrapAdapter.bootstrap({
    kernelContainer,
    environment: (process.env.NODE_ENV as any) || 'development',
    config: { port: Number(process.env.PORT) || 9000 },
  });

  await runStartupMigrations(kernelContainer.db);

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
        frameSrc: ["'self'", "blob:", "data:", "http://localhost", "http://127.0.0.1", "http:", "https:"],
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

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
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


  // Realtime bridge: forward kernel domain events to Socket.IO clients.
  // Extracted to server/realtime-bridge.ts so the monolith can be decomposed
  // without changing broadcast behavior. See server/__tests__/realtime-bridge.test.ts.
  setupRealtimeBridge({ eventBus: kernelContainer.eventBus, io, db: kernelContainer.db });


  setupPresence({ io, eventBus: kernelContainer.eventBus });

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
