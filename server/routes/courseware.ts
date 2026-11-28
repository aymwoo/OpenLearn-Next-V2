import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, getActorId, requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import type { ServerContext } from '../context.js';
import { injectLmsSdk, setCoursewareDocumentCsp } from './shared.js';
import { sendSafeError } from '../utils/error-handler.js';
import { mintCoursewareToken, verifyCoursewareTokenClaims } from '../utils/courseware-access.js';
import { resolveOrCreateCoursewareAttempt, resolveLaunchIdentity } from '../utils/courseware-attempt.js';
import { CoursewareService } from '../services/courseware-service.js';
import { buildCoursewareScoreView } from '../services/courseware-score-view.js';
import { resolveCoursewareHost } from '../services/courseware-host-catalog.js';
import {
  authorizeClass,
  isAdministrator,
  isTeacher,
  rejectUnless,
  teacherCanSeeStudent,
} from '../services/class-access.js';

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

  // 当前生效的课件宿主（内置 / 插件接管）。前端容器与运维排查共用；
  // 必须在 `/api/courseware/:id` 之前注册，避免被动态段吞掉。
  app.get('/api/courseware/host', requireScopedAuth('authenticated'), (_req, res) => {
    res.json({ ok: true, data: resolveCoursewareHost() });
  });

  app.get('/api/courseware', requireScopedAuth('authenticated'), async (req, res) => {
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
  // 阶段 G：courseware_attempt 与 learning_surface_attempts 的统一只读成绩视图。
  // 教师必须给 classId（按班授权）；管理员可跨班查询。
  app.get('/api/courseware/scores/view', requireScopedAuth('class-staff'), (req, res) => {
    try {
      const session = (req as any).session;
      const classId = typeof req.query.classId === 'string' ? req.query.classId : '';
      if (classId) {
        const decision = authorizeClass(kernelContainer.db, session, classId, 'staff');
        if (rejectUnless(res, decision)) return;
      } else if (!isAdministrator(session)) {
        return res.status(400).json({ success: false, error: 'classId is required for teachers' });
      }
      const data = buildCoursewareScoreView(kernelContainer.db, {
        coursewareUuid: typeof req.query.coursewareUuid === 'string' ? req.query.coursewareUuid : undefined,
        lessonId: typeof req.query.lessonId === 'string' ? req.query.lessonId : undefined,
        classId: classId || undefined,
        studentId: typeof req.query.studentId === 'string' ? req.query.studentId : undefined,
      });
      res.json({ success: true, data });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/attempts', requireScopedAuth('class-member'), (req, res) => {
    try {
      const session = (req as any).session as any;
      const envelope = coursewareService.listAttempts(req.query, session);
      res.json(envelope);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/attempts/:attemptId/progress', requireScopedAuth('self'), (req, res) => {
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

  app.get('/api/courseware/attempts/:attemptId/raw', requireScopedAuth('self'), async (req, res) => {
    try {
      const { attemptId } = req.params;
      const session = (req as any).session;
      const owner = kernelContainer.db
        .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
        .get(attemptId) as { student_id: string } | undefined;

      if (!owner) {
        return res.status(404).json({ error: 'Attempt not found' });
      }

      if (isAdministrator(session)) {
        // 管理员放行
      } else if (isTeacher(session)) {
        const uid = session.userId || '';
        const username = session.username || '';
        const isSelf = owner.student_id === uid || owner.student_id === username || owner.student_id === 'teacher';
        if (!isSelf && !teacherCanSeeStudent(kernelContainer.db, session, owner.student_id)) {
          return res.status(403).json({ error: 'Forbidden: Cannot read attempt of a student outside your classes' });
        }
      } else {
        const selfId = session.userId || session.studentId;
        if (owner.student_id !== selfId) {
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
      const session = (req as any).session;
      const { lessonId, classId, studentId, coursewareId } = req.body ?? {};
      if (!classId) {
        return res.status(400).json({ success: false, error: 'classId is required' });
      }
      const decision = authorizeClass(kernelContainer.db, session, classId, 'staff');
      if (rejectUnless(res, decision)) return;
      if (studentId && isTeacher(session) && !teacherCanSeeStudent(kernelContainer.db, session, studentId)) {
        return res.status(403).json({ success: false, error: 'Forbidden: student does not belong to your class' });
      }
      const result = coursewareService.markAbsent({
        lessonId,
        classId,
        studentId,
        coursewareId,
        actorId: getActorId(req),
      });
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
      const session = (req as any).session;
      const { attemptId } = req.params;
      const { lessonId, classId } = req.body ?? {};
      if (!classId) {
        return res.status(400).json({ success: false, error: 'classId is required' });
      }
      const decision = authorizeClass(kernelContainer.db, session, classId, 'staff');
      if (rejectUnless(res, decision)) return;
      const result = await coursewareService.promoteAttempt(attemptId, lessonId, classId, {
        actorId: getActorId(req),
      });
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
      const session = (req as any).session;
      const { lessonId, classId, limit } = req.body || {};
      if (!classId) {
        return res.status(400).json({ error: 'classId is required' });
      }
      const decision = authorizeClass(kernelContainer.db, session, classId, 'staff');
      if (rejectUnless(res, decision)) return;
      const report = coursewareService.autoRecordForLesson(lessonId, classId, limit);
      res.json({ success: true, ...report });
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  // ── 5. 手写课件落库、Token 铸造与沙箱直出 ──────────────────────────────────
  // V4 修复：学生可写任意 HTML/JS 并经 /runtime 执行 + 伪造满分，此前 requireAuth() 未限角色
  app.post('/api/courseware/inline', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const uuid = coursewareService.saveInlineCourseware(code);
      res.json({ uuid });
    } catch (e: any) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/:id/access-token', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const idOrUuid = req.params.id;
      const session =
        (req as any).session || (getCookieToken(req) ? getValidSession(getCookieToken(req) as string) : null);

      // 尽量把 uuid/id 收敛到课件真实行；内联课件在首次 /runtime 前可能尚未登记，
      // 此时以 URL 里的 id 作为 courseware_id 创建 attempt（/runtime 会补齐课件行）。
      let coursewareId = idOrUuid;
      let coursewareUuid = idOrUuid;
      try {
        const row = kernelContainer.db
          .prepare('SELECT id, uuid FROM courseware WHERE id = ? OR uuid = ? LIMIT 1')
          .get(idOrUuid, idOrUuid) as { id: string; uuid: string } | undefined;
        if (row) {
          coursewareId = row.id;
          coursewareUuid = row.uuid;
        }
      } catch {
        // 查库失败时沿用 URL 标识
      }

      let attemptId: string | undefined;
      if (session) {
        attemptId = resolveOrCreateCoursewareAttempt(kernelContainer.db, coursewareId, session).attemptId;
      }

      // token 绑定 coursewareId + attemptId + userId + lessonId + exp（v2）。
      // 这里用 URL 标识签名，保证与 `/runtime/:uuid` 的验签键一致（内联课件 id === uuid）。
      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : undefined;
      const token = mintCoursewareToken(idOrUuid, {
        attemptId,
        userId: session?.userId || session?.studentId,
        lessonId,
      });
      res.json({ token, attemptId, coursewareId, coursewareUuid });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/:id', (req, res) => {
    try {
      const launchToken = typeof req.query.ct === 'string' ? req.query.ct : null;
      const claims = verifyCoursewareTokenClaims(req.params.id, launchToken);
      if (!claims) {
        return res.status(401).send('Courseware access token missing or invalid');
      }
      const node = kernelContainer.db
        .prepare('SELECT id, parent_id, type, name, content, created_at, updated_at FROM vfs_nodes WHERE id = ?')
        .get(req.params.id) as any;
      if (!node || node.type !== 'file') return res.status(404).send('Courseware not found');

      const existingCw = kernelContainer.db.prepare('SELECT id FROM courseware WHERE id = ?').get(node.id);
      if (!existingCw) {
        kernelContainer.db
          .prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(node.id, node.id, node.name, 'html', node.name, Date.now());
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      setCoursewareDocumentCsp(res);
      const launch = claims.attemptId ? resolveLaunchIdentity(kernelContainer.db, claims) : null;
      const html = injectLmsSdk(
        node.content || '',
        req,
        { id: node.id, name: node.name, uuid: node.id },
        { launch: launch || undefined, launchToken: launchToken || undefined },
      );
      res.send(html);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });
}
