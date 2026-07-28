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


  // Realtime bridge: forward kernel domain events to Socket.IO clients.
  // Extracted to server/realtime-bridge.ts so the monolith can be decomposed
  // without changing broadcast behavior. See server/__tests__/realtime-bridge.test.ts.
  setupRealtimeBridge({ eventBus: kernelContainer.eventBus, io, db: kernelContainer.db });


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
