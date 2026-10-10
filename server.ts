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
import { ClassroomFeedService, attachClassroomFeedService } from './server/services/classroom-feed-service.js';
import { bindAIContextRegistry } from './server/ai-context-registry.js';
import { bindAIPersonaRegistry } from './server/ai-persona-registry.js';
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
import {
  performBackup,
  checkpoint,
  listBackups,
  getDefaultBackupDir,
  getDefaultDbPath,
} from './packages/core/db/index.js';
import { startBackupScheduler } from './server/backup-scheduler.js';
import { encryptApiKey, decryptApiKey, maskApiKey, detectPromptInjection } from './server/utils/crypto.js';
import {
  getCookieToken,
  getValidSession,
  checkIsTeacherOrAdmin,
  getActorId,
  requireAuth,
  enforcePasswordChanged,
  socketAuthMiddleware,
} from './server/middleware/auth.js';
import { csrfGuard } from './server/middleware/csrf.js';
import { sendSafeError } from './server/utils/error-handler.js';
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
import { registerDemoDataRoutes } from './server/routes/demo-data.js';
import { registerRosterRoutes } from './server/routes/roster.js';
import { registerAssignmentsRoutes } from './server/routes/assignments.js';
import { registerAssignmentHubRoutes } from './server/routes/assignment-hub.js';
import { registerSchedulesRoutes } from './server/routes/schedules.js';
import { registerGradingRoutes } from './server/routes/grading.js';
import { registerPluginsRoutes } from './server/routes/plugins.js';
import { registerClassroomRoutes } from './server/routes/classroom.js';
import { registerClassroomExtrasRoutes } from './server/routes/classroom-extras.js';
import { registerClassroomPeerReviewRoutes } from './server/routes/classroom-peer-review.js';

// Module-level cleanup reference for graceful shutdown (H-8)
let currentCleanup: (() => Promise<void>) | null = null;

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

  // strict: Database 与 MigrationDb 端口类型结构漂移（better-sqlite3 Statement 泛型），运行时相容
  await runStartupMigrations(kernelContainer.db as unknown as import('./server/bootstrap-db.js').MigrationDb);

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

  // SEC-AUTH-03: 信任反向代理（H-2: 环境变量可配置，直连环境防 X-Forwarded-Proto 伪造）
  const rawTrustProxy = process.env.TRUST_PROXY;
  if (rawTrustProxy !== undefined) {
    const isBool = rawTrustProxy === 'true' || rawTrustProxy === 'false';
    const parsed = isBool
      ? rawTrustProxy === 'true'
      : !isNaN(Number(rawTrustProxy))
        ? Number(rawTrustProxy)
        : rawTrustProxy;
    app.set('trust proxy', parsed);
  } else {
    // 默认开启 1 层代理信任（如果未显式配置），但允许通过 TRUST_PROXY=false 显式关闭
    app.set('trust proxy', 1);
  }

  // ── 安全中间件 ────────────────────────────────────────────────────
  // SEC-NET-02: HTTP 安全头（helmet）— CSP 与自适应 HSTS（C-1）
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

  const isProduction = process.env.NODE_ENV === 'production';
  const enableHsts = process.env.ENABLE_HSTS === 'true' || (isProduction && process.env.FORCE_HTTPS === 'true');

  app.use(
    helmet({
      // 允许在 AI Studio 及外部受信任环境 iframe 中嵌入
      xFrameOptions: { action: 'sameorigin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // blob: — 插件前端加载通道：FrontendPluginHost 将插件源码包装为 Blob URL
          // 再 dynamic import（见 src/plugin-host/plugin-host.ts activateRemotePlugin）。
          // 缺失会导致所有插件前端激活失败（CSP 违规），扩展点永不渲染。
          //
          // SEC-NET-02: 生产 scriptSrc 不再含 'unsafe-inline' —— SPA 构建产物无内联
          // 脚本；第三方课件 HTML 由独立路由直出并用自有宽松 CSP 覆盖
          // （setCoursewareDocumentCsp，见 server/routes/shared.ts），不再继承全局头。
          // 手写 HTML 课件已改经 POST /api/courseware/inline 落库走 /runtime 加载
          // （srcdoc 会继承父页面 CSP，是此前无法收紧的根因）。
          scriptSrc: isProduction ? ["'self'", 'blob:'] : ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
          // G-4a：收紧 script-src-attr。'unsafe-inline' 在此仅覆盖 **HTML 属性里的
          // 内联事件处理器**（onclick="..." / javascript: URL），不覆盖 <script> 块
          //（那是 script-src 管）—— 所以它对 SPA 构建产物毫无作用，却能让任何被
          // 注入的 HTML 属性直接执行代码。
          //
          // 收紧前的前置实测（2026-10-07，全部为「实际执行路径」而非源码猜测）：
          //   ① 全新 `pnpm build` 后扫描 dist/：内联 handler 属性 **0 处**、
          //      `javascript:` 协议 **0 处**（唯一命中在 vendor-react 的
          //      "React has blocked a javascript: URL" 报错文案里，不是真实用法）
          //   ② 源码 dangerouslySetInnerHTML：**0 处** —— 1788 个 JSX on* 属性
          //      全部经 React 合成事件绑定到 addEventListener，**不进 HTML 属性**
          //   ③ 三条服务端直出 HTML 的路径（routes/courseware.ts:236、
          //      routes/resources.ts:28、routes/bridge.ts:265）**各自调用
          //      setCoursewareDocumentCsp() 覆盖本头**，用的是宽松的
          //      COURSEWARE_DOCUMENT_CSP（含 script-src-attr 'unsafe-inline'）
          //      —— 第三方课件 HTML 不受本次收紧影响
          //   ④ index.html 无任何内联 <script> 内容，只有一个 type="module" src
          //
          // 结论：SPA 侧可以安全收紧为 'none'。
          //
          // **不影响 script-src 的开发态宽松**：非生产环境 scriptSrc 仍含
          // 'unsafe-eval'（Vite HMR 需要），那只影响 <script> 块，与本指令正交。
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          // SEC-NET-02: 去掉 'http: https:'（等于无出站限制，前端可外传任意数据）。
          // 前端所有 API 调用均走同源相对路径，WebSocket 同源（ws:/wss: 兜底旧浏览器
          // 对 'self' 覆盖 ws 协议的实现差异）。
          connectSrc: ["'self'", 'ws:', 'wss:'],
          frameSrc: ["'self'", 'blob:', 'data:', ...frameAllowedOrigins, ...ltiAllowedOrigins],
          frameAncestors: ["'self'", ...frameAllowedOrigins, ...ltiAllowedOrigins],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          ...(enableHsts ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // 允许沙箱 iframe（opaque origin）加载静态资源
      originAgentCluster: false,
      strictTransportSecurity: enableHsts ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false, // 针对 HTTP / 局域网部署不锁死 HSTS，避免无证书机房被浏览器强制 HTTPS
    }),
  );

  // SEC-AUTH-04: 登录频率限制器（测试环境下放宽，生产环境 5次/IP/分钟）
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 分钟
    max: process.env.PLAYWRIGHT_TEST ? 1000 : 5,
    message: { error: '登录尝试过于频繁，请稍后再试。Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.PLAYWRIGHT_TEST ? 10000 : 60,
    message: { error: '请求过于频繁，请稍后再试。Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.PLAYWRIGHT_TEST ? 1000 : 10,
    message: { error: 'AI 请求过于频繁，请稍后再试。Too many AI requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      return writeLimiter(req, res, next);
    }
    next();
  });
  // Phase B1 CSRF: 全局写请求跨站来源门控（Sec-Fetch-Site/Dest 判定 + 豁免清单，
  // 见 server/middleware/csrf.ts 判定表；SameSite=Lax cookie 兜底）
  app.use(csrfGuard);
  // SEC-FIX: uploads 静态资源需鉴权（防匿名枚举已上传课件/附件），plugins 保持只读但阻断敏感文件
  // V1 修复：此前仅判 Cookie 字符串存在，任意值放行；现校验 session 有效性
  app.use(
    '/uploads',
    (req: any, res: any, next: any) => {
      const reqPath = (req.path || '') as string;
      if (reqPath.startsWith('/avatars/')) {
        return next();
      }
      const token = getCookieToken(req);
      if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const session = getValidSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Session expired or invalid' });
      }
      next();
    },
    express.static(path.join(process.cwd(), 'uploads'), {
      // 禁用目录索引与隐藏文件
      index: false,
      dotfiles: 'ignore',
      fallthrough: false,
      // 敏感文件不做长缓存，避免注销后仍可从缓存读取
      maxAge: 0,
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

    // 1. 显式配置的白名单
    if (configuredOrigins.length > 0) {
      if (configuredOrigins.includes(origin)) {
        return true;
      }
      if (configuredOrigins.includes('*')) {
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
      } catch (err) {
        // 无效 URL 格式，不判定为同源
      }
    }

    // 3. 本地回环（localhost / 127.0.0.1 / [::1] / 0.0.0.0）放行
    try {
      const originUrl = new URL(origin);
      const hostname = originUrl.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '0.0.0.0') {
        return true;
      }
    } catch (err) {
      // 无效 URL 格式，不判定为本地回环
    }

    // 4. 开发环境宽松放行（Vite 默认端口 5173 / 4173 等）
    if (process.env.NODE_ENV !== 'production') {
      return true;
    }

    return false;
  };

  // SEC-NET-01: Express CORS 中间件 — 允许沙箱 iframe（origin: null）、同源请求与合法来源
  // V2 修复：ALLOWED_ORIGINS=* 时不得同时 Allow-Credentials:true（规范禁止，浏览器会忽略），
  // 此时降级为无凭证的 *，避免运维误以为“放行且带凭证”生效
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const wildcard = configuredOrigins.includes('*');
    if (origin && origin !== 'null' && origin !== undefined) {
      if (wildcard) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Max-Age', '86400');
      } else if (isOriginAllowed(origin, req.headers.host)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Max-Age', '86400');
      }
    } else {
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
    aiLimiter,
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

  // SEC-AUTH-06: 默认密码强制改密 —— 种子账号（admin/admin、teacher/teacher）登录后
  // 会话带 mustChangePassword 标记，除查询/登出/改密外的写操作一律 403（前端另有全屏改密门）
  app.use(enforcePasswordChanged);

  // SEC-AUTH-SOCKET: Socket.IO 连接握手鉴权中间件，阻止匿名连接与身份伪造；
  // 含 SEC-AUTH-06 兜底 —— mustChangePassword 会话握手直接拒绝（见 auth.ts）。
  io.use(socketAuthMiddleware);
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
  registerDemoDataRoutes(ctx);
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

  // Classroom Feed：课堂动态流持久化（会话保存与恢复）——订阅内核事件总线
  // 落库 classroom_feed 并向课节房间广播 classroom:feed。
  const classroomFeedService = new ClassroomFeedService(kernelContainer.db, io);
  attachClassroomFeedService(classroomFeedService, kernelContainer.eventBus);
  registerClassroomRoutes(ctx, classroomRuntimeService, classroomFeedService);
  registerClassroomExtrasRoutes(ctx.app);
  registerClassroomPeerReviewRoutes(ctx.app);

  // Realtime bridge: forward kernel domain events to Socket.IO clients.
  // Extracted to server/realtime-bridge.ts so the monolith can be decomposed
  // without changing broadcast behavior. See server/__tests__/realtime-bridge.test.ts.
  // strict: Database 与 BridgeDb 端口类型结构漂移（better-sqlite3 Statement 泛型），运行时相容
  setupRealtimeBridge({ eventBus: kernelContainer.eventBus, io, db: kernelContainer.db as unknown as import('./server/realtime-bridge.js').BridgeDb });

  // P2: ai.context.provider —— 把插件上下文注册表委托给 kernel AIService
  // （Inline 插件经 ctx.services.ai.registerAIContextProvider 注册的切片，
  //   /agent/chat 组装 system instruction 时逐个收集）
  bindAIContextRegistry(kernelContainer.aiService as any);
  bindAIPersonaRegistry(kernelContainer.aiService as any);

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
    // SEC-AUTH: join-room / enter-lesson 的课节房间归属校验 —— 开课中的课节
    // 仅班级成员可进入（映射在 classroom_sessions；未开课的课节返回 null 不设限）
    lookupLessonClassId: (lessonId: string) => {
      const row = kernelContainer.db
        .prepare('SELECT class_id FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(lessonId) as { class_id: string } | undefined;
      return row?.class_id ?? null;
    },
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
      // R4 加深：WAL 体积 + 最新备份年龄纳入就绪信号（仅上报，不因此 503，避免新实例无备份时自杀）
      let walBytes: number | null = null;
      try {
        walBytes = fs.statSync(getDefaultDbPath() + '-wal').size;
      } catch {
        walBytes = 0;
      }
      let lastBackupAgeH: number | null = null;
      try {
        const files = listBackups(getDefaultBackupDir()).filter((b) => b.isValid);
        if (files.length > 0) {
          lastBackupAgeH = Math.max(0, (Date.now() - new Date(files[0].mtime).getTime()) / 3600000);
          lastBackupAgeH = Math.round(lastBackupAgeH * 10) / 10;
        }
      } catch {
        lastBackupAgeH = null;
      }
      res.json({ status: 'ready', db: 'connected', workers: workerCount, walBytes, lastBackupAgeH });
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
        hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false,
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

  // Phase B2: 全局 Express 错误处理兜底 —— 任何 next(err) / 同步抛错统一走
  // sendSafeError（生产不泄露内部信息），必须在全部路由与 SPA 兜底之后注册。
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Unhandled API Error]:', err);
    sendSafeError(res, err, 500);
  });

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} is already in use. Retrying in 1.5 seconds...`);
      setTimeout(() => {
        try {
          httpServer.close();
        } catch (e) {
          console.warn('[Server] Error closing server during port retry:', e);
        }
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
    } catch (err) {
      console.warn('[Server] Failed to inspect network interfaces:', err);
    }
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
    } catch (err) {
      // 忽略无桌面或无默认浏览器的静默异常
      console.info('[Server] Auto-open browser skipped or unsupported in current environment.');
    }
  };

  // R2 定时化：应用内备份调度（每日 03:00 热备 + 每小时 WAL checkpoint），
  // 测试/临时实例可用 BACKUP_SCHEDULE=off 关闭
  const backupScheduler = startBackupScheduler({
    db: kernelContainer.db,
    performBackupFn: (options) => performBackup(options),
    checkpointFn: (mode) => checkpoint(mode as any),
  });

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

  const cleanup = async () => {
    console.log('[Server] Cleaning up server resources...');
    try {
      backupScheduler.stop();
    } catch (err) {
      console.warn('[Server] Error while stopping backup scheduler:', err);
    }    await new Promise<void>((resolve) => {
      httpServer.close((err) => {
        if (err) console.warn('[Server] Error while closing HTTP server:', err);
        resolve();
      });
    });
    try {
      io.close();
    } catch (err) {
      console.warn('[Server] Error while closing Socket.IO:', err);
    }
    try {
      if (kernelContainer?.db) {
        kernelContainer.db.close();
      }
    } catch (err) {
      console.warn('[Server] Error while closing SQLite database:', err);
    }
    console.log('[Server] Cleanup complete.');
  };

  currentCleanup = cleanup;

  return { app, httpServer, io, cleanup };
}

// Export for CLI / programmatic usage
export { startServer };

// Auto-start only when run directly (not imported by CLI)
if (process.argv[1]?.endsWith('server.cjs') || process.argv[1]?.endsWith('server.ts')) {
  startServer().catch((e) => {
    console.error('[Server] Fatal startup error:', e);
    process.exit(1);
  });
}

// R1 修复：宿主进程最后防线 —— 运行期未捕获异常只记日志 + 优雅退出，避免单次抛错即静默崩溃
process.on('unhandledRejection', (reason) => {
  console.error('[Server] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] uncaughtException:', err);
  gracefulShutdown('UNCAUGHT').catch(() => process.exit(1));
});

// ── 优雅关闭 (OBS-SHUTDOWN-01) ────────────────────────────────────
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 30000;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] Received ${signal}, starting graceful shutdown...`);

  const forceTimeout = setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    if (currentCleanup) {
      await currentCleanup();
    }
    clearTimeout(forceTimeout);
    console.log('[Server] Graceful shutdown completed cleanly.');
    process.exit(0);
  } catch (e) {
    clearTimeout(forceTimeout);
    console.error('[Server] Error during shutdown:', e);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
