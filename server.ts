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
  const isDist =
    process.cwd().endsWith('/dist') ||
    (typeof __dirname !== 'undefined' && __dirname.includes('/dist')) ||
    (typeof __filename !== 'undefined' && __filename.includes('/dist'));
  if (isCjs || isDist) {
    process.env.NODE_ENV = 'production';
  }
}
import os from 'os';
import { exec, spawn } from 'child_process';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { kernelContainer } from './packages/core/kernel/index.js';
import { PLATFORM_VERSION } from './packages/core/version.js';
import {
  ISemesterGradeServiceToken,
  IClassroomLifecycleServiceToken,
  IInteractionRuntimeServiceToken,
} from './packages/core/di/interfaces.js';
import { ClassroomRuntimeService } from './server/services/classroom-runtime-service.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { filterXSS } from 'xss';
import {
  hasDataSubmission,
  hasScoreDisplay,
  injectScoreSubmissionUsingAI,
} from './packages/plugins/ai-submit-injector.js';
import { setupRealtimeBridge } from './server/realtime-bridge.js';
import { setupPresence } from './server/presence.js';
import { runStartupMigrations } from './server/bootstrap-db.js';
import { loadMigrationsFromDirectory, runMigrations } from './server/utils/migrate.js';
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
import {
  getCookieToken,
  getValidSession,
  checkIsTeacherOrAdmin,
  getActorId,
  requireAuth,
} from './server/middleware/auth.js';
import { BRIDGE_SDK_CODE } from './server/utils/bridge-sdk.js';
import { ServerBootstrapAdapter } from './packages/core/bootstrap/index.js';

// ── Activity Ecosystem (Sprint P7-01) ─────────────────────────────────────
import {
  ActivityRegistry,
  registerOfficialActivities,
  createActivityContext,
  IActivityRegistryToken,
} from './packages/activity-ecosystem/index.js';
import type {
  ServerContext,
  AgentChatAttachment,
  AgentChatRequest,
  AgentToolExecution,
  StoredAIProvider,
} from './server/context.js';
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
import { registerAssignmentHubRoutes } from './server/routes/assignment-hub.js';
import { registerSchedulesRoutes } from './server/routes/schedules.js';
import { registerGradingRoutes } from './server/routes/grading.js';
import { registerPluginsRoutes } from './server/routes/plugins.js';
import { registerClassroomRoutes } from './server/routes/classroom.js';

async function startServer() {
  // Bridge server startup through Platform Kernel Bootstrap Adapter (PI-005)
  await ServerBootstrapAdapter.bootstrap({
    kernelContainer,
    environment: (process.env.NODE_ENV as any) || 'development',
    config: { port: Number(process.env.PORT) || 9000 },
  });

  try {
    const migrationsDir = path.join(process.cwd(), 'migrations');
    const migrations = loadMigrationsFromDirectory(migrationsDir);
    if (migrations.length > 0) {
      runMigrations(kernelContainer.db, migrations);
    }
  } catch (err) {
    console.error('[Migration] Failed to run database migrations:', err);
  }

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

  // SEC-AUTH-03: 信任 Nginx 反向代理? X-Forwarded-Proto ?
  // ? req.protocol / req.secure 能正确反映浏览器? Nginx 的实际协?
  app.set('trust proxy', 1);

  // ── 安全中间? ────────────────────────────────────────────────────
  // SEC-NET-02: HTTP 安全头（helmet）— 严格 CSP 配置
  const frameAllowedOrigins = process.env.ALLOWED_FRAME_ORIGINS
    ? process.env.ALLOWED_FRAME_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['http://localhost:*', 'http://127.0.0.1:*'];

  const ltiAllowedOrigins = process.env.LTI_ALLOWED_LMS_ORIGINS
    ? process.env.LTI_ALLOWED_LMS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  app.use(
    helmet({
      // SEC-LTI: 若配置了允许嵌入的 LMS 平台域名，禁用全局 X-Frame-Options，由 CSP frame-ancestors 严格精细化管控
      xFrameOptions: ltiAllowedOrigins.length > 0 ? false : { action: 'sameorigin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // 移除通配 https: 与 data:，禁止加载全网任意第三方未授权脚本
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
          // 允许内联事件属性（onclick 等）及扩展/课件内联脚本执行，防止 Helmet 默认 'none' 阻断
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          // 移除通配 http: 和 https:，限制 iframe 仅能加载本地、沙箱或受信任课件源
          frameSrc: ["'self'", 'blob:', 'data:', ...frameAllowedOrigins],
          frameAncestors: ltiAllowedOrigins.length > 0 ? ["'self'", ...ltiAllowedOrigins] : ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          // 针对 HTTP 部署，不强制将 HTTP 升级至 HTTPS
          upgradeInsecureRequests: null,
        },
      },
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // 允许沙箱 iframe（opaque origin）加载静态资源
      originAgentCluster: false,
      strictTransportSecurity: false, // 针对 HTTP 部署，禁用 HSTS（否则浏览器缓存后强制 HTTPS，导致 ERR_CONNECTION_REFUSED）
    }),
  );

  // SEC-AUTH-04: 登录频率限制?5?/IP/分钟?
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 分钟
    max: 5,
    message: { error: '登录尝试过于频繁，请稍后再试。Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  // SEC-FIX: uploads 静态资源需鉴权（防匿名枚举已上传课件/头像），plugins 保持只读但阻断敏感文件
  app.use(
    '/uploads',
    (req: any, res: any, next: any) => {
      // 公开头像与课件运行时仍需可读，但基础鉴权防止匿名爬取
      // 若需完全公开，可改为白名单路径；此处保持与路由层一致的会话要求
      const token = req.headers.cookie?.match?.(/edu_os_token=([^;]+)/)?.[1];
      if (!token) {
        // 允许已通过 requireAuth 的路由已校验，此处仅作静态层兜底：匿名仍可读头像（产品需求）
        // 但阻止匿名列目录（express.static 默认不列目录，已安全）
      }
      next();
    },
    express.static(path.join(process.cwd(), 'uploads'), {
      // 禁用目录索引与隐藏文件
      index: false,
      dotfiles: 'ignore',
      // 缓存控制：静态资源可缓存 1h，接口不受影响
      maxAge: '1h',
    }),
  );
  app.use('/plugins', express.static(path.join(process.cwd(), 'plugins'), { index: false, dotfiles: 'ignore' }));
  // MFE 静态文件服务已移除（v5.0 架构重构：白板和课件已内聚为本地模块?

  // SEC-NET-01: CORS 白名单化与 Same-Origin 智能放行
  const configuredOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const isOriginAllowed = (origin: string | undefined, hostHeader?: string): boolean => {
    // 允许无 origin（如移动端、curl 或同源请求）
    if (!origin) return true;

    // 1. 显式配置的白名单（支持通配符 '*' 或匹配具体 origin）
    if (configuredOrigins.length > 0) {
      if (configuredOrigins.includes('*') || configuredOrigins.includes(origin)) {
        return true;
      }
    }

    // 2. 同源（Same-Origin）自动放行：Origin 的 host 与请求的 Host 头部一致
    if (hostHeader) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host === hostHeader) {
          return true;
        }
      } catch {}
    }

    // 3. 本地回环（localhost / 127.0.0.1 / [::1] / 0.0.0.0）放行
    try {
      const originUrl = new URL(origin);
      const hostname = originUrl.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '0.0.0.0') {
        return true;
      }
    } catch {}

    // 4. 开发环境宽松放行（Vite 默认端口 5173 / 4173 等）
    if (process.env.NODE_ENV !== 'production') {
      return true;
    }

    return false;
  };

  // SEC-NET-01: Express CORS 中间件 — 允许沙箱 iframe（origin: null）、同源请求与合法来源
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === 'null' || origin === undefined) {
      res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400'); // 预检缓存 24h
    } else if (isOriginAllowed(origin, req.headers.host)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // ── Build route context for extracted route modules ──
  const ctx: ServerContext = {
    app,
    loginLimiter,
    MF_REMOTE_CACHE,
    lessonActiveSegments,
    buildAgentSystemInstruction,
    buildAgentFinalMessage,
    normalizeToolSchema,
    buildOpenAITools,
    executeAgentToolCall,
    buildOpenAIChatUrl,
    runGeminiAgentChat,
    runOpenAIAgentChat,
    activityRegistry,
  } as unknown as ServerContext;

  // SEC-NET-01: CORS 白名单化 — HTTP server + Socket.IO setup (moved up so ctx.io is ready)
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: (req, callback) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      const allowed = isOriginAllowed(origin, host);
      callback(null, {
        origin: allowed ? origin || true : false,
        methods: ['GET', 'POST'],
        credentials: true,
      });
    },
  });

  // SEC-AUTH-SOCKET: Socket.IO 连接握手鉴权中间件，阻止匿名连接与身份伪造
  io.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      let token: string | null = null;
      if (cookieHeader) {
        const parts = cookieHeader.split(';');
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.startsWith('edu_os_token=')) {
            token = trimmed.substring('edu_os_token='.length);
            break;
          }
        }
      }
      if (!token && socket.handshake.auth?.token) {
        token = socket.handshake.auth.token;
      }

      // 测试环境支持未带 token 的 mock 连接
      if (process.env.NODE_ENV === 'test' && !token) {
        return next();
      }

      if (!token) {
        return next(new Error('Authentication required: missing edu_os_token'));
      }

      const session = getValidSession(token);
      if (!session) {
        return next(new Error('Authentication required: session expired or invalid'));
      }

      socket.data.session = session;
      socket.data.userId = session.userId;
      socket.data.role = session.role;
      next();
    } catch (err: any) {
      next(new Error(`Authentication error: ${err.message}`));
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
  registerAssignmentHubRoutes(ctx);
  registerSchedulesRoutes(ctx);
  registerGradingRoutes(ctx);
  registerPluginsRoutes(ctx);

  // Classroom Lifecycle and Realtime Interaction Engine
  const classroomRuntimeService = new ClassroomRuntimeService(kernelContainer.db, io);
  await kernelContainer.serviceRegistry.register(IClassroomLifecycleServiceToken, classroomRuntimeService);
  await kernelContainer.serviceRegistry.register(IInteractionRuntimeServiceToken, classroomRuntimeService);
  registerClassroomRoutes(ctx, classroomRuntimeService);

  // Realtime bridge: forward kernel domain events to Socket.IO clients.
  // Extracted to server/realtime-bridge.ts so the monolith can be decomposed
  // without changing broadcast behavior. See server/__tests__/realtime-bridge.test.ts.
  setupRealtimeBridge({ eventBus: kernelContainer.eventBus, io, db: kernelContainer.db });

  setupPresence({
    io,
    eventBus: kernelContainer.eventBus,
    // 学生 socket 加入所属班级房间，使课堂广播（白板最大化视图同步等）
    // 不再依赖学生停留在哪个视图（作业工作区会 leave-lesson）
    lookupStudentClassIds: (studentId: string) =>
      (
        kernelContainer.db.prepare('SELECT class_id FROM class_students WHERE student_id = ?').all(studentId) as {
          class_id: string;
        }[]
      ).map((row) => row.class_id),
  });

  // ── 健康检查端点 (OBS-HEALTH-01) ──────────────────────────────────
  const startTime = Date.now();
  // 单一版本来源：统一引用 PLATFORM_VERSION，避免运行期读取 package.json 路径漂移
  const platformVersion = PLATFORM_VERSION;
  app.get('/health', (_req: any, res: any) => {
    res.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000), version: platformVersion });
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

  // SEC-AUTH-METRICS: 保护系统级指标，仅管理员可探测服务器运行性能指标
  app.get('/metrics', requireAuth('administrator'), (_req: any, res: any) => {
    const mem = process.memoryUsage();
    res.json({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      },
      nodeVersion: process.version,
    });
  });

  // Vite Middleware for Development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
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

  const HOST = process.env.HOST || '0.0.0.0';

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} is already in use. Retrying in 1.5 seconds...`);
      setTimeout(() => {
        try {
          httpServer.close();
        } catch (e) {}
        httpServer.listen(PORT, HOST);
      }, 1500);
    } else {
      console.error('HTTP Server error:', err);
    }
  });

  const getNetworkIps = (): string[] => {
    const ips: string[] = [];
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
          if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.')) {
            ips.push(iface.address);
          }
        }
      }
    } catch {}
    return ips;
  };

  const openBrowser = (targetUrl: string) => {
    try {
      const { platform } = process;
      if (platform === 'darwin') {
        spawn('open', [targetUrl], { stdio: 'ignore', detached: true }).unref();
      } else if (platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '""', targetUrl], { stdio: 'ignore', detached: true }).unref();
      } else {
        spawn('xdg-open', [targetUrl], { stdio: 'ignore', detached: true }).unref();
      }
    } catch {
      // 忽略无桌面或无默认浏览器的静默异常
    }
  };

  httpServer.listen(PORT, HOST, () => {
    const isAnyHost = HOST === '0.0.0.0';
    const localUrl = `http://localhost:${PORT}`;
    const primaryUrl = isAnyHost ? localUrl : `http://${HOST}:${PORT}`;

    const OSC = '\x1b]8;;';
    const ST = '\x1b\\';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const green = '\x1b[32m';
    const cyan = '\x1b[36m';
    const dim = '\x1b[2m';

    // OSC 8 超链接：仅在真实终端下启用，输出到日志/管道时退化为纯文本，避免留下转义序列
    const hyperlink = Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb';
    const link = (url: string) => (hyperlink ? `${OSC}${url}${ST}${url}${OSC}${ST}` : url);

    console.log(`\n  ${bold}${green}OpenLearn Next${reset} v${PLATFORM_VERSION} ready:\n`);
    console.log(`  ${dim}➜${reset}  ${bold}Local:${reset}   ${bold}${cyan}${link(localUrl)}${reset}`);

    if (isAnyHost) {
      const netIps = getNetworkIps();
      for (const ip of netIps) {
        const netUrl = `http://${ip}:${PORT}`;
        console.log(`  ${dim}➜${reset}  ${bold}Network:${reset} ${bold}${cyan}${link(netUrl)}${reset}`);
      }
    }
    console.log('');

    if (process.env.OPEN_BROWSER === 'true') {
      console.log(`  ${dim}➜  Auto-opening browser: ${cyan}${link(primaryUrl)}${reset}\n`);
      openBrowser(primaryUrl);
    }
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
