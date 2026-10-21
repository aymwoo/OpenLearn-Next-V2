import express from 'express';
import path from 'path';
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
import { createAiLimiter, createLoginLimiter, createWriteLimiter } from './server/security/rate-limit.js';
import { resolveTrustProxy } from './server/security/trust-proxy.js';
import { assertStartupEnv } from './server/security/env-validation.js';
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
import { lessonActiveSegments } from './server/shared-state.js';
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
import { performBackup, checkpoint } from './packages/core/db/index.js';
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
import { requestObservability } from './server/middleware/request-observability.js';
import { registerClientErrorRoute } from './server/routes/client-errors.js';
import { captureUnknownError } from './packages/core/observability/error-reporter.js';
import { createCorsMiddleware, createSocketIoCors } from './server/middleware/cors.js';
import { registerHealthRoutes } from './server/routes/health.js';
import { assertRouteDataScopes } from './server/security/route-scope.js';
import { ROUTE_SCOPE_WHITELIST } from './server/security/route-scope-whitelist.js';
import { getNetworkIps, openBrowser, formatTerminalHyperlink } from './server/utils/host-network.js';
import { getUploadsDir, getPluginsDir, getStorageDir } from './server/utils/paths.js';
import { PLUGIN_SANDBOX_FRAME_HTML } from './server/utils/plugin-sandbox-frame.js';
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
import { registerCoursePackageRoutes } from './server/routes/course-packages.js';
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
import { registerAssessmentRoutes } from './server/routes/assessments.js';

// Module-level cleanup reference for graceful shutdown (H-8)
let currentCleanup: (() => Promise<void>) | null = null;

async function startServer() {
  // P1 trust boundary：在碰数据库/插件运行时之前先强校验环境变量，配置笔误不允许带着跑。
  assertStartupEnv();

  // Bridge server startup through Platform Kernel Bootstrap Adapter (PI-005)
  await ServerBootstrapAdapter.bootstrap({
    kernelContainer,
    environment: (process.env.NODE_ENV as any) || 'development',
    config: { port: Number(process.env.PORT) || 9000 },
  });

  try {
    const migrationsDir = path.join(process.cwd(), 'migrations');
    const migrations = loadMigrationsFromDirectory(migrationsDir);
    if (migrations.length === 0) {
      throw new Error(`[Migration] FATAL: ${migrationsDir} 中没有迁移文件，拒绝启动。`);
    }
    runMigrations(kernelContainer.db, migrations);
    console.log(`[Migration] 启动复查完成：${migrationsDir}（${migrations.length} 个文件）`);
  } catch (err) {
    console.error('[Migration] FATAL: 数据库迁移失败，拒绝在未完成迁移的库上提供服务。');
    console.error(err);
    throw err;
  }

  // strict: Database 与 MigrationDb 端口类型结构漂移（better-sqlite3 Statement 泛型），运行时相容
  await runStartupMigrations(kernelContainer.db as unknown as import('./server/bootstrap-db.js').MigrationDb);

  await kernelContainer.ready;

  // ── Activity Ecosystem bootstrap (Product Layer, kernel untouched) ──
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

  // 默认不信任 X-Forwarded-*。反代部署必须显式设置 TRUST_PROXY（例如 1 或 loopback）。
  app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY));

  // ── 安全中间件 ────────────────────────────────────────────────────
  // SEC-NET-02: HTTP 安全头（helmet）— CSP 与自适应 HSTS（C-1）
  const isProduction = process.env.NODE_ENV === 'production';

  // P0-1: 生产环境未显式配置 ALLOWED_FRAME_ORIGINS 时，仅允许同源嵌入
  // （"'self'" 已在下方的 frameAncestors / frameSrc 数组首位）。早期实现无条件回退到
  // localhost:*，会让任何能起本地 Web 服务的进程（被攻陷 sidecar、恶意插件起的静态
  // 服务器、共租户邻居）把 LMS 嵌进 click-jacking 页面。开发环境保留 localhost 便于调试。
  const frameAllowedOrigins = process.env.ALLOWED_FRAME_ORIGINS
    ? process.env.ALLOWED_FRAME_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : isProduction
      ? []
      : ['http://localhost:*', 'http://127.0.0.1:*'];

  const ltiAllowedOrigins = process.env.LTI_ALLOWED_LMS_ORIGINS
    ? process.env.LTI_ALLOWED_LMS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const enableHsts = process.env.ENABLE_HSTS === 'true' || (isProduction && process.env.FORCE_HTTPS === 'true');

  app.use(
    helmet({
      // 允许在 AI Studio 及外部受信任环境 iframe 中嵌入
      xFrameOptions: { action: 'sameorigin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // blob: — 浏览器 Worker 与内联单测加载器仍可能使用 Blob URL。
          // 远程插件前端不再在父页面 import()，而是进 /plugin-sandbox/frame
          // （sandbox=allow-scripts、不透明源、postMessage 桥）。
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

  // 登录按账号分桶（含学号），写请求按 trust proxy 解析后的客户端地址分桶。
  // 不把可伪造的 X-Forwarded-For 放进 key；开发环境同样收紧，仅 PLAYWRIGHT_TEST 放宽。
  const loginLimiter = createLoginLimiter(process.env.PLAYWRIGHT_TEST ? 1000 : 5);
  const writeLimiter = createWriteLimiter(process.env.PLAYWRIGHT_TEST ? 10000 : 60);
  const aiLimiter = createAiLimiter(process.env.PLAYWRIGHT_TEST ? 1000 : 10);

  // SEC-03 防御加固：
  // 1. 写请求限流前置：在解析任何请求体前执行，阻止超频与恶意请求消耗 CPU/内存解析 JSON
  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      return writeLimiter(req, res, next);
    }
    next();
  });

  // 2. 局部大文件上传解析器（110MB）：仅向特定大文件上传端点放开，必须在全局 parser 之前挂载
  const largeUploadEndpoints = [
    '/api/upload',
    '/api/courseware/upload',
    '/api/courseware/inline',
    '/api/plugins/upload-zip',
  ];
  app.use(
    largeUploadEndpoints,
    express.json({ limit: '110mb' }),
    express.urlencoded({ limit: '110mb', extended: true }),
  );

  // 3. 全局 JSON 体积收紧为安全默认值 2MB，杜绝非上传业务端点的内存放大 DoS 风险
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ limit: '2mb', extended: true }));
  // Phase B1 CSRF: 全局写请求跨站来源门控（Sec-Fetch-Site/Dest 判定 + 豁免清单，
  // 见 server/middleware/csrf.ts 判定表；SameSite=Lax cookie 兜底）
  app.use(csrfGuard);
  app.use(requestObservability());
  registerClientErrorRoute(app);
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
    express.static(getUploadsDir(), {
      // 禁用目录索引与隐藏文件
      index: false,
      dotfiles: 'ignore',
      fallthrough: false,
      // 敏感文件不做长缓存，避免注销后仍可从缓存读取
      maxAge: 0,
    }),
  );
  app.use(
    '/plugins',
    (req: any, res: any, next: any) => {
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
    express.static(getPluginsDir(), { index: false, dotfiles: 'ignore', fallthrough: false, maxAge: 0 }),
  );
  app.get('/plugin-sandbox/frame', (req: any, res: any) => {
    const token = getCookieToken(req);
    const session = token ? getValidSession(token) : null;
    if (!session) {
      return res.status(401).type('text/plain').send('Authentication required');
    }
    res
      .status(200)
      .setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; style-src 'none'; img-src 'none'; frame-ancestors 'self'",
      )
      .type('html')
      .send(PLUGIN_SANDBOX_FRAME_HTML);
  });
  // MFE 静态文件服务已移除（v5.0 架构重构：白板和课件已内聚为本地模块）

  // SEC-NET-01: Express CORS 中间件与白名单隔离
  app.use(createCorsMiddleware());

  // ── Build route context for extracted route modules ──
  const ctx: ServerContext = {
    app,
    loginLimiter,
    aiLimiter,
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

  // SEC-NET-01: HTTP server + Socket.IO setup (CORS 对齐统一配置)
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: createSocketIoCors(),
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
  registerCoursePackageRoutes(ctx);
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

  // 测评子系统（Issue #100 / #120）。题型注册表由内核 bootstrap 时注册进 DI，这里只挂路由。
  registerAssessmentRoutes(ctx);

  // 四阶段课堂生命周期与教学环节门槛分开：
  // transitionStage 只跑本服务 registerStageGuard 的生命周期守卫。
  // timeline.gates 由 SegmentGateService 在学生进入环节、教师广播环节时判定。
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
  setupRealtimeBridge({
    eventBus: kernelContainer.eventBus,
    io,
    db: kernelContainer.db as unknown as import('./server/realtime-bridge.js').BridgeDb,
  });

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

  // ── 健康检查与指标端点 (存活 / 就绪 / Prometheus) ───────────────────
  const startTime = Date.now();
  registerHealthRoutes(app, { startTime });

  // ── 路由数据范围审计 (Issue #140) ──────────────────────────────────
  // 所有 API 路由注册完成后统一审计：`requireAuth()`（不限角色）必须声明
  // 数据范围（requireScopedAuth），否则启动日志告警；CI / 严格环境可设置
  // ROUTE_SCOPE_ENFORCE=true 让未声明路由直接阻止启动。
  assertRouteDataScopes(app, {
    whitelist: ROUTE_SCOPE_WHITELIST,
    enforce: process.env.ROUTE_SCOPE_ENFORCE === 'true',
  });

  // SEC-ROUTING: API 404 兜底隔离门禁 —— 任何未被上述路由消费的 /api/* 请求
  // 必须直接返回 JSON 格式 404，严禁穿透至下游 Vite 开发服务器引发 HTML 假死与 500 超时
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      success: false,
      error: `API route not found: ${req.method} ${req.path}`,
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
    const distPath = typeof __dirname !== 'undefined' ? __dirname : path.join(process.cwd(), 'dist');
    // SEC-CACHE: 针对 Vite 打包生成的 hash 静态分包开启不可变长效缓存
    app.use(
      '/assets',
      express.static(path.join(distPath, 'assets'), {
        maxAge: '1y',
        immutable: true,
      }),
    );
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      // SEC-CACHE: index.html 必须严格禁用强缓存和协商缓存，杜绝客户端缓存旧入口导致新构建 ChunkLoadError 白屏
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
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

    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const green = '\x1b[32m';
    const cyan = '\x1b[36m';
    const dim = '\x1b[2m';
    const link = formatTerminalHyperlink;

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
    }
    await new Promise<void>((resolve) => {
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
  captureUnknownError('unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] uncaughtException:', err);
  captureUnknownError('uncaught', err);
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
