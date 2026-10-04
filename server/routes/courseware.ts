import path from 'path';
import fs from 'fs';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, getActorId, requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { injectLmsSdk, setCoursewareDocumentCsp } from './shared.js';
import { sendSafeError } from '../utils/error-handler.js';
import { mintCoursewareToken, verifyCoursewareToken } from '../utils/courseware-access.js';
import { CoursewareService } from '../services/courseware-service.js';

export function registerCoursewareRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const coursewareService = new CoursewareService();

  // ── 1. 基础课件包管理（CommandBus）────────────────────────────────────────
  app.post('/api/courseware/upload', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { name, filename, base64Data } = req.body;
      const actorId = getActorId(req) || 'teacher';
      const cmd = kernelContainer.commandBus.createCommand(
        'courseware.upload',
        { name, filename, base64Data },
        actorId,
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/confirm', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { uuid, name, entry } = req.body;
      const actorId = getActorId(req) || 'teacher';
      const cmd = kernelContainer.commandBus.createCommand('courseware.confirm', { uuid, name, entry }, actorId);
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware', requireAuth(), async (req, res) => {
    try {
      const actorId = getActorId(req) || 'system';
      const cmd = kernelContainer.commandBus.createCommand('courseware.list', {}, actorId, { silent: true });
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/courseware/:id', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const actorId = getActorId(req) || 'teacher';
      const cmd = kernelContainer.commandBus.createCommand('courseware.delete', { id: req.params.id }, actorId);
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 2. 作答流水、认领与提交（委托给 CoursewareService）────────────────────
  app.post('/api/courseware/attempts/:attemptId/log', async (req, res) => {
    try {
      const { attemptId } = req.params;
      const { eventType, payload } = req.body;
      const token = getCookieToken(req);
      const session = (req as any).session || (token ? getValidSession(token) : null);

      await coursewareService.logAttemptEvent(attemptId, session, eventType, payload);
      res.json({ success: true });
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/attempts/:attemptId/submit', async (req, res) => {
    try {
      const { attemptId } = req.params;
      const token = getCookieToken(req);
      const session = (req as any).session || (token ? getValidSession(token) : null);

      const { result, autoRecord } = await coursewareService.submitAttempt(
        attemptId,
        session,
        getActorId(req),
        req.body,
      );
      res.json({ ...(result as object), autoRecord });
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/attempts/:attemptId/adopt', async (req, res) => {
    try {
      const { attemptId } = req.params;
      const token = getCookieToken(req);
      const session = (req as any).session || (token ? getValidSession(token) : null);

      const adoptResult = await coursewareService.adoptAttempt(attemptId, session);
      res.json(adoptResult);
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  // ── 3. 榜单查询与进度 ──────────────────────────────────────────────────────
  app.get('/api/courseware/attempts', requireAuth(), (req, res) => {
    try {
      const session = (req as any).session as { role?: string; subRole?: string } | undefined;
      const isStaff =
        session?.role === 'teacher' || session?.role === 'administrator' || session?.subRole === 'administrator';

      const envelope = coursewareService.listAttempts(req.query, isStaff);
      res.json(envelope);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/attempts/:attemptId/progress', requireAuth(), (req, res) => {
    try {
      const { attemptId } = req.params;
      const session = (req as any).session;
      const progress = coursewareService.getAttemptProgress(attemptId, session);
      res.json({ progress });
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ success: false, error: e.message });
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/attempts/:attemptId/raw', requireAuth(), async (req, res) => {
    try {
      const { attemptId } = req.params;
      const session = (req as any).session;
      if (session.role !== 'teacher' && session.role !== 'administrator') {
        const owner = kernelContainer.db
          .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
          .get(attemptId) as { student_id: string } | undefined;
        if (!owner || owner.student_id !== (session.userId || session.studentId)) {
          return res.status(403).json({ error: 'Forbidden: Cannot read another student attempt' });
        }
      }
      const cmd = kernelContainer.commandBus.createCommand(
        'courseware.get_attempt_raw_data',
        { attemptId },
        getActorId(req),
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 4. 成绩转录与自动补录 ──────────────────────────────────────────────────
  app.post('/api/courseware/attempts/mark-absent', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId, classId, studentId, coursewareId } = req.body ?? {};
      const result = coursewareService.markAbsent({ lessonId, classId, studentId, coursewareId });
      res.json({ success: true, studentId: result.studentId, coursewareName: result.coursewareName });
    } catch (e: any) {
      if (e.status) {
        return res.status(e.status).json({ success: false, error: e.message, reason: e.reason });
      }
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/attempts/:attemptId/promote', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { attemptId } = req.params;
      const { lessonId, classId } = req.body;
      const result = await coursewareService.promoteAttempt(attemptId, lessonId, classId);
      res.json({ success: true, assignmentId: result.assignmentId, score: result.score });
    } catch (e: any) {
      if (e.status) {
        return res.status(e.status).json({ success: false, error: e.message, reason: e.reason });
      }
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/attempts/auto-record', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { lessonId, classId, limit } = req.body || {};
      const report = coursewareService.autoRecordForLesson(lessonId, classId, limit);
      res.json({ success: true, ...report });
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  // ── 5. 手写课件落库、Token 铸造与沙箱直出 ──────────────────────────────────
  app.post('/api/courseware/inline', requireAuth(), (req, res) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const uuid = coursewareService.saveInlineCourseware(code);
      res.json({ uuid });
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/:id/access-token', requireAuth(), (req, res) => {
    res.json({ token: mintCoursewareToken(req.params.id) });
  });

  app.get('/api/courseware/:id', (req, res) => {
    try {
      if (!verifyCoursewareToken(req.params.id, typeof req.query.ct === 'string' ? req.query.ct : null)) {
        return res.status(401).send('Courseware access token missing or invalid');
      }
      const node = kernelContainer.db.prepare('SELECT * FROM vfs_nodes WHERE id = ?').get(req.params.id) as any;
      if (!node || node.type !== 'file') return res.status(404).send('Courseware not found');

      const existingCw = kernelContainer.db.prepare('SELECT id FROM courseware WHERE id = ?').get(node.id);
      if (!existingCw) {
        kernelContainer.db
          .prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(node.id, node.id, node.name, 'html', node.name, Date.now());
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      setCoursewareDocumentCsp(res);
      const html = injectLmsSdk(node.content || '', req, { id: node.id, name: node.name, uuid: node.id });
      res.send(html);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/debug', requireAuth(), (req, res) => {
    try {
      const { msg, url, student, courseware } = req.body;
      const safeMsg = typeof msg === 'string' ? msg.slice(0, 2000) : String(msg).slice(0, 2000);
      const safeUrl = typeof url === 'string' ? url.slice(0, 1000) : String(url).slice(0, 1000);
      const logMsg = `[CLIENT DEBUG] ${safeMsg} | URL: ${safeUrl} | Student: ${JSON.stringify(student)?.slice(0, 1000)} | Courseware: ${JSON.stringify(courseware)?.slice(0, 1000)}`;
      console.log(`\x1b[35m[CLIENT DEBUG]\x1b[0m ${safeMsg}`);

      const logFile = path.join(process.cwd(), 'client_debug.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} - ${logMsg}\n`);

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });
}
