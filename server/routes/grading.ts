import { kernelContainer } from '../../packages/core/kernel/index.js';
import {
  ISemesterGradeServiceToken,
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
} from '../../packages/core/di/interfaces.js';
import { requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { GradingService } from '../services/grading-service.js';

export function registerGradingRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const gradingService = new GradingService();

  // ── 1. 考勤聚合与记录 ──────────────────────────────────────────────────────────
  app.get('/api/classes/:classId/attendance-summary', requireAuth(), (req, res) => {
    try {
      const summary = gradingService.getAttendanceSummary(req.params.classId);
      res.json(summary);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/schedules/:scheduleId/attendance', requireAuth(), (req, res) => {
    try {
      const attendance = gradingService.getScheduleAttendance(req.params.scheduleId);
      res.json(attendance);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/schedules/:scheduleId/attendance', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { studentId, status } = req.body;
      gradingService.recordAttendance(req.params.scheduleId, studentId, status);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 2. 成绩权重配置 ────────────────────────────────────────────────────────────
  app.get('/api/classes/:classId/grade-weights', requireAuth(), (req, res) => {
    try {
      const weights = gradingService.getGradeWeights(req.params.classId);
      res.json(weights);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/grade-weights', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { attendance_weight, progress_weight, assignment_weight, exam_weight } = req.body;
      gradingService.saveGradeWeights(req.params.classId, {
        attendance_weight,
        progress_weight,
        assignment_weight,
        exam_weight,
      });
      res.json({ success: true });
    } catch (e: any) {
      if (e.message === 'Weights sum must equal 1.0 or 100%') {
        return res.status(400).json({ error: e.message });
      }
      sendSafeError(res, e);
    }
  });

  // ── 3. 考试管理与分数录入 ──────────────────────────────────────────────────────
  app.get('/api/classes/:classId/exams', requireAuth(), (req, res) => {
    try {
      const exams = gradingService.listExams(req.params.classId);
      res.json(exams);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/exams', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { title, description, max_score } = req.body;
      if (!title) return res.status(400).json({ error: 'Title is required' });
      const examId = gradingService.createExam(req.params.classId, title, description, max_score);
      res.json({ success: true, examId });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/exams/:examId/scores', requireAuth(), (req, res) => {
    try {
      const scores = gradingService.getExamScores(req.params.examId);
      res.json(scores);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/exams/:examId/scores', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { scores } = req.body;
      if (!Array.isArray(scores)) return res.status(400).json({ error: 'Scores array is required' });
      gradingService.batchSaveExamScores(req.params.examId, scores);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── 4. 学期综合成绩与报告 ──────────────────────────────────────────────────────
  app.get('/api/classes/:classId/semester-grades', requireAuth(), (req, res) => {
    try {
      const classId = req.params.classId;
      const semesterName = (req.query.semesterName as string) || '2026年春季学期';
      const result = gradingService.computeSemesterGrades(classId, semesterName);
      res.json({ success: true, weights: result.weights, students: result.students });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/grade-sync', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { lessonId, studentId, grade } = req.body;
      if (!lessonId || !studentId || grade === undefined) {
        return res.status(400).json({ success: false, error: 'lessonId, studentId, and grade are required' });
      }

      const gradeService = await kernelContainer.serviceRegistry.resolve(ISemesterGradeServiceToken);
      await gradeService.saveSemesterGrade(lessonId, studentId, Math.round(Number(grade)));

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Points Ledger & Dimension Extensions API
  // ─────────────────────────────────────────────────────────────────
  app.get('/api/classes/:classId/points-dimensions', requireAuth(), async (req, res) => {
    try {
      const dimensionRegistry = await kernelContainer.serviceRegistry.resolve(IPointsDimensionRegistryToken);
      const dimensions = dimensionRegistry.listDimensions();
      res.json({ success: true, dimensions });
    } catch (e: any) {
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
      kernelContainer.eventBus.publish({
        id: logItem.id,
        type: 'points.awarded',
        source: pluginId || 'points-ledger',
        payload: logItem,
        timestamp: Date.now(),
      });

      res.json({ success: true, logItem });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/students/:studentId/points-logs', requireAuth(), async (req, res) => {
    try {
      const { studentId } = req.params;
      const { classId } = req.query;

      const ledgerService = await kernelContainer.serviceRegistry.resolve(IPointsLedgerServiceToken);
      const logs = await ledgerService.getLogs(studentId, classId as string | undefined);
      const summary = await ledgerService.getStudentDimensionSummary(studentId, (classId as string) || '');

      res.json({ success: true, logs, summary });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/semester-reports/archive', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { semesterName, reports } = req.body;
      if (!semesterName) return res.status(400).json({ error: 'semesterName is required' });
      if (!Array.isArray(reports)) return res.status(400).json({ error: 'reports array is required' });

      gradingService.archiveSemesterReports(req.params.classId, semesterName, reports);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post(
    '/api/classes/:classId/students/:studentId/semester-ai-evaluation',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        const { classId, studentId } = req.params;
        const { semesterName = '2026年春季学期', providerId } = req.body;

        const aiEvaluation = await gradingService.generateSemesterAiEvaluation({
          classId,
          studentId,
          semesterName,
          providerId,
        });

        res.json({ success: true, aiEvaluation });
      } catch (e: any) {
        if (e.message === 'Student not found') {
          return res.status(404).json({ error: 'Student not found' });
        }
        if (e.message?.includes('未检测到可用的 AI 提供商')) {
          return res.status(400).json({ error: e.message });
        }
        console.error('AI Semester Evaluation error:', e);
        sendSafeError(res, e);
      }
    },
  );
}
