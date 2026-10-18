/**
 * 测评 REST 路由（Issue #100 / 子 issue #120）。
 *
 * 权威模型、判分口径、匿名与序列化规则全在 `packages/core/assessment` 与
 * `server/services/assessment-service.ts`；本文件只做 HTTP 适配与授权。
 *
 * 授权要点：
 * - 教师侧：一律按 `assessments.owner_id` 判归属（service 内部校验），管理员同样走 owner 校验
 *   （管理员要看别人的试卷走 `GET /api/assessments?all=1` 留待 P1，不在本期）。
 * - 学生侧：先用 `authorizeClass(member)` 校验班级成员关系，再由 service 校验 attempt 归属；
 *   匿名问卷的 attempt 用 anon_key 复现校验。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { ServerContext } from '../context.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import {
  accessibleClassIds,
  actorUserId,
  authorizeClass,
  isAdministrator,
  rejectUnless,
  studentActorId,
} from '../services/class-access.js';
import { recordSecurityAudit } from '../../packages/core/observability/audit-log.js';
import { sendSafeError } from '../utils/error-handler.js';
import { AssessmentService, assessmentService } from '../services/assessment-service.js';
import { assessmentGraderRegistry } from '../services/assessment-grader-registry.js';

function teacherActor(req: any): string {
  return actorUserId((req as any).session) || 'unknown-actor';
}

function studentActor(req: any): string | null {
  return studentActorId((req as any).session);
}

export function registerAssessmentRoutes(ctx: ServerContext, service: AssessmentService = assessmentService) {
  const { app } = ctx;

  /* ───────────────────────── 元信息：已注册题型 ───────────────────────── */

  app.get('/api/assessment-question-types', requireScopedAuth('authenticated'), (_req, res) => {
    try {
      res.json({ questionTypes: assessmentGraderRegistry.listQuestionTypes() });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /* ───────────────────────── 教师：试卷 CRUD ───────────────────────── */

  app.get('/api/assessments', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const items = service.listAssessments(teacherActor(req), {
        kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      res.json({ items });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/assessments', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const body = req.body ?? {};
      const created = service.createAssessment({
        ownerId: teacherActor(req),
        kind: body.kind,
        title: body.title,
        description: body.description ?? null,
        settings: body.settings,
        academicYear: body.academicYear ?? null,
      });
      res.status(201).json(created);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/assessments/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(service.getAssessment(req.params.id, teacherActor(req)));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/assessments/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const body = req.body ?? {};
      res.json(
        service.updateAssessment(req.params.id, teacherActor(req), {
          title: body.title,
          description: body.description,
          settings: body.settings,
          academicYear: body.academicYear,
        }),
      );
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/assessments/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      service.deleteAssessment(req.params.id, teacherActor(req));
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /** 整卷覆盖：组卷即快照（每次提交视为试卷的完整内容）。 */
  app.put('/api/assessments/:id/items', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(service.replaceItems(req.params.id, teacherActor(req), req.body?.items ?? []));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /* ───────────────────────── 教师：题库 ───────────────────────── */

  app.get('/api/question-bank', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json({
        items: service.listBankItems(teacherActor(req), {
          type: typeof req.query.type === 'string' ? req.query.type : undefined,
        }),
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/question-bank', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const body = req.body ?? {};
      const created = service.createBankItem({
        ownerId: teacherActor(req),
        type: body.type,
        stem: body.stem,
        config: body.config,
        answerKey: body.answerKey,
        tags: body.tags,
        difficulty: body.difficulty ?? null,
        maxScore: body.maxScore,
      });
      res.status(201).json(created);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/question-bank/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(service.getBankItem(req.params.id, teacherActor(req)));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/question-bank/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      service.deleteBankItem(req.params.id, teacherActor(req));
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /* ───────────────────────── 教师：发布 / 关闭 / 发布成绩 ───────────────────────── */

  /** 某份试卷的全部发布记录（关闭 / 批改 / 统计的入口） */
  app.get('/api/assessments/:id/assignments', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json({ items: service.listAssignments(req.params.id, teacherActor(req)) });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /** 教师视角的作答详情（批改页数据源；始终含标准答案） */
  app.get('/api/assessment-attempts/:id/teacher-view', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(service.getAttemptForTeacher(req.params.id, teacherActor(req)));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/assessments/:id/publish', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const body = req.body ?? {};
      const assignment = service.publish(req.params.id, teacherActor(req), {
        classId: body.classId,
        lessonId: body.lessonId ?? null,
        scheduleId: body.scheduleId ?? null,
        opensAt: body.opensAt ?? null,
        closesAt: body.closesAt ?? null,
        durationSec: body.durationSec ?? null,
        academicYear: body.academicYear ?? null,
        createdBy: teacherActor(req),
      });
      res.status(201).json(assignment);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/assessment-assignments/:id/close', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(service.closeAssignment(req.params.id, teacherActor(req)));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/assessment-assignments/:id/release', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(service.releaseScores(req.params.id, teacherActor(req)));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /* ───────────────────────── 教师：批改 / 统计 / 导出 ───────────────────────── */

  app.get('/api/assessment-assignments/:id/attempts', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json({ items: service.listAttempts(req.params.id, teacherActor(req)) });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/assessment-assignments/:id/stats', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(service.stats(req.params.id, teacherActor(req)));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/assessment-assignments/:id/export', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const format = String(req.query.format ?? 'csv').toLowerCase();
      if (format !== 'csv') {
        return res.status(400).json({ error: 'only format=csv is supported in this version' });
      }
      const { filename, csv } = service.exportCsv(req.params.id, teacherActor(req));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      // BOM：让 Excel 正确识别 UTF-8 中文
      res.send(`\uFEFF${csv}`);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/assessment-attempts/:id/answers/:itemId/grade', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const body = req.body ?? {};
      res.json(
        service.manualGrade(req.params.id, teacherActor(req), req.params.itemId, {
          score: Number(body.score),
          feedback: body.feedback ?? null,
          gradedBy: teacherActor(req),
        }),
      );
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/assessment-attempts/:id/regrade', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      res.json(service.regradeAttempt(req.params.id, teacherActor(req)));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 匿名反查（仅管理员 + 必写审计）。
   *
   * 服务端不存 key → student 的反向映射，用候选人重算 HMAC 比对；
   * 这类操作必然要在审计里留痕，否则"匿名"就是一句空话。
   */
  app.post('/api/assessment-attempts/:id/reveal-identity', requireAuth('administrator'), (req, res) => {
    try {
      const session = (req as any).session;
      if (!isAdministrator(session)) return res.status(403).json({ error: 'Forbidden' });
      const revealed = service.revealAnonymousIdentity(req.params.id, teacherActor(req));
      recordSecurityAudit('assessment.anonymous_identity_revealed', {
        attemptId: revealed.attemptId,
        studentId: revealed.studentId,
        actorId: teacherActor(req),
      });
      res.json(revealed);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /* ───────────────────────── 学生：列表 / 作答 / 交卷 / 结果 ───────────────────────── */

  app.get('/api/me/assessments', requireAuth('student', 'teacher', 'administrator'), (req, res) => {
    try {
      const sid = studentActor(req);
      if (!sid) return res.status(403).json({ error: 'Forbidden' });
      const classIds = accessibleClassIds(kernelContainer.db as any, (req as any).session) ?? [];
      res.json({ items: service.listStudentAssignments(sid, classIds) });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/assessment-assignments/:id/attempts', requireAuth('student'), (req, res) => {
    try {
      const sid = studentActor(req);
      if (!sid) return res.status(403).json({ error: 'Forbidden' });
      const asg = service.getAssignment(req.params.id);
      const decision = authorizeClass(kernelContainer.db as any, (req as any).session, asg.classId, 'member');
      if (rejectUnless(res, decision) || !decision.ok) return;
      res.status(201).json(service.startAttempt(asg.id, sid));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /** 自动保存单题作答（防抖由前端负责）。 */
  app.put('/api/assessment-attempts/:id/answers/:itemId', requireAuth('student'), (req, res) => {
    try {
      const sid = studentActor(req);
      if (!sid) return res.status(403).json({ error: 'Forbidden' });
      res.json(service.saveAnswer(req.params.id, sid, req.params.itemId, req.body?.answer ?? null));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/assessment-attempts/:id/submit', requireAuth('student'), (req, res) => {
    try {
      const sid = studentActor(req);
      if (!sid) return res.status(403).json({ error: 'Forbidden' });
      res.json(service.submitAttempt(req.params.id, sid));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/assessment-attempts/:id/result', requireAuth('student'), (req, res) => {
    try {
      const sid = studentActor(req);
      if (!sid) return res.status(403).json({ error: 'Forbidden' });
      res.json(service.getAttemptResult(req.params.id, sid));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });
}
