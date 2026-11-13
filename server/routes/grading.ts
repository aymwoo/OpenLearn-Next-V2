import type { Request, Response } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import {
  ISemesterGradeServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
} from '../../packages/core/di/interfaces.js';
import { getActorId, requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { GradingService, type StudentSemesterGrade } from '../services/grading-service.js';
import {
  authorizeClass,
  isAdministrator,
  rejectUnless,
  studentActorId,
  teacherCanSeeStudent,
} from '../services/class-access.js';

interface AttendanceRowItem {
  student_id?: string;
  studentId?: string;
  [key: string]: unknown;
}

function getSession(req: Request): Record<string, unknown> | undefined {
  return (req as unknown as { session?: Record<string, unknown> })?.session;
}

export function registerGradingRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const gradingService = new GradingService();

  const gate = (req: Request, res: Response, classId: string, level: 'staff' | 'member') =>
    rejectUnless(res, authorizeClass(kernelContainer.db, getSession(req), classId, level));

  // ── 1. 考勤聚合与记录 ──────────────────────────────────────────────────────────
  app.get('/api/classes/:classId/attendance-summary', requireScopedAuth('class-staff'), (req, res) => {
    try {
      if (gate(req, res, req.params.classId, 'staff')) return;
      const summary = gradingService.getAttendanceSummary(
        req.params.classId,
        30,
        (req.query.academicYear as string) || null,
      );
      res.json(summary);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/schedules/:scheduleId/attendance', requireScopedAuth('class-member'), (req, res) => {
    try {
      const session = getSession(req);
      const sch = kernelContainer.db
        .prepare('SELECT class_id FROM schedules WHERE id = ?')
        .get(req.params.scheduleId) as { class_id: string } | undefined;
      if (!sch) return res.status(404).json({ error: 'Schedule not found' });
      const decision = authorizeClass(kernelContainer.db, session, sch.class_id, 'member');
      if (rejectUnless(res, decision) || !decision.ok) return;
      let attendance: unknown = gradingService.getScheduleAttendance(req.params.scheduleId);
      if (decision.level === 'student' && Array.isArray(attendance)) {
        const sid = studentActorId(session);
        attendance = (attendance as AttendanceRowItem[]).filter((row) => (row.student_id || row.studentId) === sid);
      }
      res.json(attendance);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/schedules/:scheduleId/attendance', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const sch = kernelContainer.db
        .prepare('SELECT class_id FROM schedules WHERE id = ?')
        .get(req.params.scheduleId) as { class_id: string } | undefined;
      if (!sch) return res.status(404).json({ error: 'Schedule not found' });
      if (gate(req, res, sch.class_id, 'staff')) return;
      const { studentId, status } = req.body;
      gradingService.recordAttendance(req.params.scheduleId, studentId, status);
      res.json({ success: true });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // ── 2. 成绩权重配置 ────────────────────────────────────────────────────────────
  app.get('/api/classes/:classId/grade-weights', requireScopedAuth('class-member'), (req, res) => {
    try {
      if (gate(req, res, req.params.classId, 'member')) return;
      const weights = gradingService.getGradeWeights(req.params.classId);
      res.json(weights);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/grade-weights', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      if (gate(req, res, req.params.classId, 'staff')) return;
      const { attendance_weight, progress_weight, assignment_weight, exam_weight } = req.body;
      gradingService.saveGradeWeights(req.params.classId, {
        attendance_weight,
        progress_weight,
        assignment_weight,
        exam_weight,
      });
      res.json({ success: true });
    } catch (e: unknown) {
      if ((e as Error).message === 'Weights sum must equal 1.0 or 100%') {
        return res.status(400).json({ error: (e as Error).message });
      }
      sendSafeError(res, e);
    }
  });

  // ── 3. 考试管理与分数录入 ──────────────────────────────────────────────────────
  app.get('/api/classes/:classId/exams', requireScopedAuth('class-member'), (req, res) => {
    try {
      if (gate(req, res, req.params.classId, 'member')) return;
      const exams = gradingService.listExams(req.params.classId, (req.query.academicYear as string) || null);
      res.json(exams);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/exams', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      if (gate(req, res, req.params.classId, 'staff')) return;
      const { title, description, max_score } = req.body;
      if (!title) return res.status(400).json({ error: 'Title is required' });
      const examId = gradingService.createExam(req.params.classId, title, description, max_score);
      res.json({ success: true, examId });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/exams/:examId/scores', requireScopedAuth('class-member'), (req, res) => {
    try {
      const session = getSession(req);
      const exam = kernelContainer.db.prepare('SELECT class_id FROM exams WHERE id = ?').get(req.params.examId) as
        { class_id: string } | undefined;
      if (!exam) return res.status(404).json({ error: 'Exam not found' });
      const decision = authorizeClass(kernelContainer.db, session, exam.class_id, 'member');
      if (rejectUnless(res, decision) || !decision.ok) return;
      const scores = gradingService.getExamScores(req.params.examId) as
        AttendanceRowItem[] | { scores?: AttendanceRowItem[]; data?: AttendanceRowItem[] };
      if (decision.level !== 'student') {
        res.json(scores);
        return;
      }
      const sid = studentActorId(session);
      const list = Array.isArray(scores) ? scores : (scores?.scores ?? scores?.data ?? []);
      if (Array.isArray(list)) {
        res.json(list.filter((r) => (r.student_id || r.studentId) === sid));
        return;
      }
      res.json(scores);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/exams/:examId/scores', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const exam = kernelContainer.db.prepare('SELECT class_id FROM exams WHERE id = ?').get(req.params.examId) as
        { class_id: string } | undefined;
      if (!exam) return res.status(404).json({ error: 'Exam not found' });
      if (gate(req, res, exam.class_id, 'staff')) return;
      const { scores } = req.body;
      if (!Array.isArray(scores)) return res.status(400).json({ error: 'Scores array is required' });
      gradingService.batchSaveExamScores(req.params.examId, scores);
      res.json({ success: true });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // ── 4. 学期综合成绩与报告 ──────────────────────────────────────────────────────
  app.get('/api/classes/:classId/semester-grades', requireScopedAuth('class-member'), (req, res) => {
    try {
      const classId = req.params.classId;
      const session = getSession(req);
      const decision = authorizeClass(kernelContainer.db, session, classId, 'member');
      if (rejectUnless(res, decision) || !decision.ok) return;
      const semesterName = (req.query.semesterName as string) || '2026年春季学期';
      const result = gradingService.computeSemesterGrades(
        classId,
        semesterName,
        (req.query.academicYear as string) || null,
      );
      let students: StudentSemesterGrade[] = result?.students ?? [];
      if (decision.level === 'student' && Array.isArray(students)) {
        const sid = studentActorId(session);
        students = students.filter((s) => s.studentId === sid);
      }
      res.json({ success: true, weights: result?.weights, students });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/grade-sync', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { lessonId, studentId, grade } = req.body;
      if (!lessonId || !studentId || grade === undefined) {
        return res.status(400).json({ success: false, error: 'lessonId, studentId, and grade are required' });
      }
      const session = getSession(req);
      if (!isAdministrator(session) && !teacherCanSeeStudent(kernelContainer.db, session, studentId)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const gradeService = await kernelContainer.serviceRegistry.resolve(ISemesterGradeServiceToken);
      await gradeService.saveSemesterGrade(lessonId, studentId, Math.round(Number(grade)), {
        actorId: getActorId(req),
        source: 'manual',
        overrideProtected: true,
      });

      res.json({ success: true });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Points Ledger & Dimension Extensions API
  // ─────────────────────────────────────────────────────────────────
  app.get('/api/classes/:classId/points-dimensions', requireScopedAuth('class-member'), async (req, res) => {
    try {
      if (gate(req, res, req.params.classId, 'member')) return;
      const dimensionRegistry = await kernelContainer.serviceRegistry.resolve(IPointsDimensionRegistryToken);
      const dimensions = dimensionRegistry.listDimensions();
      res.json({ success: true, dimensions });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/students/:studentId/points', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { studentId } = req.params;
      const { classId, dimensionId, deltaPoints, reason, pluginId } = req.body;

      if (!classId || !dimensionId || deltaPoints === undefined || !reason) {
        return res
          .status(400)
          .json({ success: false, error: 'classId, dimensionId, deltaPoints, and reason are required' });
      }
      if (gate(req, res, classId, 'staff')) return;

      const enrolled = kernelContainer.db
        .prepare('SELECT 1 FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1')
        .get(classId, studentId);
      if (!enrolled) {
        return res.status(404).json({ success: false, error: 'Student is not enrolled in this class' });
      }

      const ledgerService = await kernelContainer.serviceRegistry.resolve(IPointsLedgerServiceToken);
      const logItem = await ledgerService.addPoints(
        studentId,
        classId,
        dimensionId,
        Number(deltaPoints),
        reason,
        pluginId,
      );

      // Publish to EventBus & Socket.IO
      await kernelContainer.eventBus
        .publish({
          id: logItem.id,
          type: 'points.awarded',
          source: pluginId || 'points-ledger',
          payload: logItem,
          timestamp: Date.now(),
        })
        .catch((err) => {
          console.error('[Grading] Failed to publish points.awarded event:', err);
        });

      res.json({ success: true, logItem });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/students/:studentId/points-logs', requireScopedAuth('self'), async (req, res) => {
    try {
      const { studentId } = req.params;
      const session = getSession(req);
      const selfId = studentActorId(session);
      const allowed =
        isAdministrator(session) ||
        selfId === studentId ||
        teacherCanSeeStudent(kernelContainer.db, session, studentId);
      if (!allowed) return res.status(403).json({ success: false, error: 'Forbidden' });
      const { classId } = req.query;

      const ledgerService = await kernelContainer.serviceRegistry.resolve(IPointsLedgerServiceToken);
      const logs = await ledgerService.getLogs(studentId, classId as string | undefined);
      const summary = await ledgerService.getStudentDimensionSummary(studentId, (classId as string) || '');

      res.json({ success: true, logs, summary });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/semester-reports/archive', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      if (gate(req, res, req.params.classId, 'staff')) return;
      const { semesterName, reports } = req.body;
      if (!semesterName) return res.status(400).json({ error: 'semesterName is required' });
      if (!Array.isArray(reports)) return res.status(400).json({ error: 'reports array is required' });

      gradingService.archiveSemesterReports(req.params.classId, semesterName, reports);
      res.json({ success: true });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.post(
    '/api/classes/:classId/students/:studentId/semester-ai-evaluation',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        const { classId, studentId } = req.params;
        if (gate(req, res, classId, 'staff')) return;
        const { semesterName = '2026年春季学期', providerId } = req.body;
        const session = getSession(req);
        const userId = (session?.userId as string | undefined) || (session?.username as string | undefined);

        const aiEvaluation = await gradingService.generateSemesterAiEvaluation({
          classId,
          studentId,
          semesterName,
          providerId,
          userId,
        });

        res.json({ success: true, aiEvaluation });
      } catch (e: unknown) {
        const err = e as { message?: string };
        if (err.message === 'Student not found') {
          return res.status(404).json({ error: 'Student not found' });
        }
        if (err.message?.includes('未检测到可用的 AI 提供商')) {
          return res.status(400).json({ error: err.message });
        }
        console.error('AI Semester Evaluation error:', e);
        sendSafeError(res, e);
      }
    },
  );
}
