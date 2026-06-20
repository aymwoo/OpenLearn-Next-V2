import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IDatabaseToken,
  ISemesterGradeServiceToken
} from '../core/di/interfaces.js';
import type { PluginContext } from '../core/plugin-host/types.js';

export const AssignmentEvalPlugin = {
  manifest: {
    id: '@openlearn/plugin-assignment-eval',
    name: 'Assignment Evaluation and Peer Review Plugin',
    version: '1.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:ISemesterGradeService@^1.0.0'
    ],
    capabilitiesProposed: ['lesson:read', 'lesson:write']
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const db = await ctx.resolve(IDatabaseToken);
    const gradeService = await ctx.resolve(ISemesterGradeServiceToken);

    // Unregister existing core command handlers to avoid conflict
    commandBus.unregisterHandler('assignment.submit');
    commandBus.unregisterHandler('assignment.grade');

    // Unregister existing action descriptors to avoid ID conflicts
    actionRegistry.unregister('core-assignment-submit');
    actionRegistry.unregister('core-assignment-grade');

    // ── 1. SUBMIT COMMAND ──────────────────────────────────────────────────
    const submitCmd = 'assignment.submit';
    await actionRegistry.register({
      id: 'eval-assignment-submit',
      commandType: submitCmd,
      description: '学生提交作业作品，支持多次覆盖上传',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '关联的课时 ID' },
          studentId: { type: 'STRING', description: '提交作品的学生 ID' },
          filePath: { type: 'STRING', description: '文件相对虚拟文件系统的存储路径' }
        },
        required: ['lessonId', 'studentId', 'filePath']
      }
    });

    await commandBus.registerHandler(submitCmd, {
      async execute(command) {
        const { lessonId, studentId, filePath } = command.payload as any;
        if (!lessonId || !studentId || !filePath) {
          throw new Error('Missing required params: lessonId, studentId, filePath');
        }

        // Check if submission already exists
        const existing = db.prepare('SELECT id, version FROM plugin_submissions WHERE lesson_id = ? AND student_id = ?')
          .get(lessonId, studentId) as { id: string; version: number } | undefined;

        let submissionId: string;
        let version = 1;

        if (existing) {
          submissionId = existing.id;
          version = existing.version + 1;
          db.prepare('UPDATE plugin_submissions SET file_path = ?, version = ?, updated_at = ? WHERE id = ?')
            .run(filePath, version, Date.now(), submissionId);
        } else {
          submissionId = 'sub-' + uuidv7();
          db.prepare('INSERT INTO plugin_submissions (id, lesson_id, student_id, file_path, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(submissionId, lessonId, studentId, filePath, version, Date.now(), Date.now());
        }

        return { success: true, submissionId, version };
      }
    });

    // ── 2. PEER REVIEW COMMAND ─────────────────────────────────────────────
    const peerReviewCmd = 'assignment.peer_review';
    await actionRegistry.register({
      id: 'eval-assignment-peer-review',
      commandType: peerReviewCmd,
      description: '学生对同学已提交的作业作品进行公开互评评分',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          submissionId: { type: 'STRING', description: '被评价的作业提交物 ID' },
          reviewerId: { type: 'STRING', description: '执行评价的学生 ID' },
          score: { type: 'INTEGER', description: '互评分数 (0-100)' },
          comment: { type: 'STRING', description: '互评意见' }
        },
        required: ['submissionId', 'reviewerId', 'score']
      }
    });

    await commandBus.registerHandler(peerReviewCmd, {
      async execute(command) {
        const { submissionId, reviewerId, score, comment } = command.payload as any;
        if (!submissionId || !reviewerId || score === undefined) {
          throw new Error('Missing required params: submissionId, reviewerId, score');
        }

        // T-14-01 Boundary check: score must be between 0 and 100
        const parsedScore = Math.round(Number(score));
        if (isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100) {
          throw new Error('Access Denied: Score must be between 0 and 100');
        }

        // Fetch submission owner
        const submission = db.prepare('SELECT student_id FROM plugin_submissions WHERE id = ?')
          .get(submissionId) as { student_id: string } | undefined;
        if (!submission) {
          throw new Error(`Submission not found: ${submissionId}`);
        }

        // T-14-01 Collusion check: reviewer cannot review their own submission
        if (submission.student_id === reviewerId) {
          throw new Error('Access Denied: Students are not allowed to evaluate their own assignments');
        }

        const reviewId = 'rev-' + uuidv7();
        db.prepare(`
          INSERT INTO plugin_peer_reviews (id, submission_id, reviewer_id, score, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(submission_id, reviewer_id) DO UPDATE SET
            score = excluded.score,
            comment = excluded.comment,
            created_at = excluded.created_at
        `).run(reviewId, submissionId, reviewerId, parsedScore, comment || '', Date.now());

        return { success: true, reviewId };
      }
    });

    // ── 3. TEACHER GRADE COMMAND ───────────────────────────────────────────
    const gradeCmd = 'assignment.grade';
    await actionRegistry.register({
      id: 'eval-assignment-grade',
      commandType: gradeCmd,
      description: '教师对已提交的作业进行终评打分，并可动态设定折算权重与发布成绩',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          submissionId: { type: 'STRING', description: '被评价的作业提交物 ID' },
          teacherScore: { type: 'INTEGER', description: '教师给出的平时分 (0-100)' },
          teacherComment: { type: 'STRING', description: '教师评语反馈' },
          teacherWeight: { type: 'NUMBER', description: '教师打分权重 (默认 0.6)' },
          peerWeight: { type: 'NUMBER', description: '学生互评平均分权重 (默认 0.4)' },
          status: { type: 'STRING', description: '状态，confirmed 为确认并同步，draft 为草稿' }
        },
        required: ['submissionId', 'teacherScore']
      }
    });

    await commandBus.registerHandler(gradeCmd, {
      async execute(command) {
        const { submissionId, teacherScore, teacherComment, teacherWeight = 0.6, peerWeight = 0.4, status = 'draft' } = command.payload as any;
        if (!submissionId || teacherScore === undefined) {
          throw new Error('Missing required params: submissionId, teacherScore');
        }

        // T-14-03 Parameter validation
        const parsedTeacherScore = Math.round(Number(teacherScore));
        if (isNaN(parsedTeacherScore) || parsedTeacherScore < 0 || parsedTeacherScore > 100) {
          throw new Error('Access Denied: Teacher score must be between 0 and 100');
        }

        const totalWeight = Number(teacherWeight) + Number(peerWeight);
        if (Math.abs(totalWeight - 1.0) > 0.001) {
          throw new Error('Access Denied: The sum of teacherWeight and peerWeight must equal 1.0');
        }

        // Fetch submission metadata (lesson_id, student_id)
        const submission = db.prepare('SELECT lesson_id, student_id FROM plugin_submissions WHERE id = ?')
          .get(submissionId) as { lesson_id: string; student_id: string } | undefined;
        if (!submission) {
          throw new Error(`Submission not found: ${submissionId}`);
        }

        // Retrieve peer review average score
        const reviews = db.prepare('SELECT score FROM plugin_peer_reviews WHERE submission_id = ?')
          .all(submissionId) as { score: number }[];

        let peerAverageScore = 0;
        let calculatedFinalScore = parsedTeacherScore;

        if (reviews.length > 0) {
          const sum = reviews.reduce((acc, r) => acc + r.score, 0);
          peerAverageScore = sum / reviews.length;
          calculatedFinalScore = Math.round(parsedTeacherScore * teacherWeight + peerAverageScore * peerWeight);
        }

        const gradeId = 'grd-' + uuidv7();
        db.prepare(`
          INSERT INTO plugin_grades (
            id, submission_id, teacher_score, teacher_comment, teacher_weight, peer_weight, calculated_final_score, status, graded_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(submission_id) DO UPDATE SET
            teacher_score = excluded.teacher_score,
            teacher_comment = excluded.teacher_comment,
            teacher_weight = excluded.teacher_weight,
            peer_weight = excluded.peer_weight,
            calculated_final_score = excluded.calculated_final_score,
            status = excluded.status,
            graded_at = excluded.graded_at
        `).run(gradeId, submissionId, parsedTeacherScore, teacherComment || '', teacherWeight, peerWeight, calculatedFinalScore, status, Date.now());

        // T-14-02 Target synchronization on confirmed status
        if (status === 'confirmed') {
          await gradeService.saveSemesterGrade(submission.lesson_id, submission.student_id, calculatedFinalScore);
        }

        return { success: true, calculatedFinalScore };
      }
    });
  },

  deactivate: async () => {
    // Teardown handled by registry unregister automatically
  }
};
