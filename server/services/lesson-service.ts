/**
 * 课时与备课管理领域服务 (LessonService)
 *
 * 承载课时全生命周期管理：CRUD、多表级联删除事务、课时深克隆事务、
 * 作业互评与成绩批量聚合 (PERF-N1)、AI 助教探针与所有权 IDOR 鉴权逻辑。
 * 独立于 HTTP 传输层，可直接进行无状态单元测试。
 */
import { v7 as uuidv7 } from 'uuid';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { CLASSROOM_EVENTS, publishClassroomEvent } from '../classroom-events.js';
import { lessonActiveSegments } from '../shared-state.js';
import type { Pagination } from '../utils/pagination.js';

export interface LessonOwnershipResult {
  allowed: boolean;
  status: number;
  error?: string;
  lesson?: any;
}

export interface LessonStats {
  whiteboardCount: number;
  scheduleCount: number;
  enrollmentCount: number;
  assignmentCount: number;
}

export interface CreateLessonParams {
  title: string;
  content?: string;
  creatorId: string;
}

export interface UpdateTimelineParams {
  lessonId: string;
  timeline: string | any[];
}

/**
 * 提取最新版本提交物展开字段（文字、链接、文件数组）
 */
const LATEST_VERSION_COLUMNS = `
  (SELECT v.files_json FROM plugin_submission_versions v WHERE v.submission_id = ps.id ORDER BY v.version DESC LIMIT 1) as latest_files_json,
  (SELECT v.text_content FROM plugin_submission_versions v WHERE v.submission_id = ps.id ORDER BY v.version DESC LIMIT 1) as latest_text_content,
  (SELECT v.link_url FROM plugin_submission_versions v WHERE v.submission_id = ps.id ORDER BY v.version DESC LIMIT 1) as latest_link_url
`;

export function withLatestVersion(row: any): any {
  if (!row) return row;
  let files: any[] = [];
  try {
    const parsed = JSON.parse(row.latest_files_json || '[]');
    if (Array.isArray(parsed)) files = parsed;
  } catch {
    files = [];
  }
  const { latest_files_json, latest_text_content, latest_link_url, ...rest } = row;
  return { ...rest, files, textContent: latest_text_content ?? null, linkUrl: latest_link_url ?? null };
}

export class LessonService {
  constructor(
    private db: Database.Database = kernelContainer.db,
    private commandBus: any = kernelContainer.commandBus,
    private aiService: any = kernelContainer.aiService,
  ) {}

  /**
   * 分页查询课时列表 (A7 标准分页信封)
   */
  public listLessons(pg: Pagination) {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM lessons').get() as any)?.n || 0;
    const lessons = this.db
      .prepare(
        `
      SELECT l.*, u.name as creator_name,
        (SELECT COUNT(*) FROM student_lesson_progress WHERE lesson_id = l.id) as enrollment_count
      FROM lessons l
      LEFT JOIN users u ON l.creator_id = u.id
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(pg.isAll ? -1 : pg.pageSize, pg.offset);

    return {
      data: lessons,
      total,
      page: pg.page,
      pageSize: pg.isAll ? total : pg.pageSize,
    };
  }

  /**
   * 基础详情查询
   */
  public getLesson(lessonId: string): any {
    return this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  }

  /**
   * 校验用户对课时的管理权 (IDOR 防护)
   */
  public checkOwnership(
    lessonId: string,
    session: { userId?: string; username?: string; role?: string } | null,
  ): LessonOwnershipResult {
    if (!session) {
      return { allowed: false, status: 401, error: 'Authentication required' };
    }

    const isAdmin =
      session.username === 'admin' ||
      session.userId === 'usr_admin' ||
      session.role === 'admin' ||
      session.role === 'administrator';

    const isTeacherOrAdmin = isAdmin || session.role === 'teacher';
    if (!isTeacherOrAdmin) {
      return { allowed: false, status: 403, error: 'Forbidden: Only teachers or administrators can modify lessons' };
    }

    const lesson = this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as any;
    if (!lesson) {
      return { allowed: false, status: 404, error: 'Lesson not found' };
    }

    if (isAdmin) {
      return { allowed: true, status: 200, lesson };
    }

    if (!lesson.creator_id || lesson.creator_id === session.userId || lesson.creator_id === session.username) {
      return { allowed: true, status: 200, lesson };
    }

    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: You do not have permission to modify this lesson because it was created by another teacher',
    };
  }

  /**
   * 创建课时 (通过 CommandBus)
   */
  public async createLesson(params: CreateLessonParams, actorId = 'teacher') {
    const cmd = this.commandBus.createCommand('lesson.create', params, actorId, {
      approved: true,
    });
    return await this.commandBus.execute(cmd);
  }

  /**
   * 更新课时时间轴 (通过 CommandBus)
   */
  public async updateTimeline(params: UpdateTimelineParams, actorId = 'teacher') {
    const timelineStr = typeof params.timeline === 'string' ? params.timeline : JSON.stringify(params.timeline ?? []);
    const cmd = this.commandBus.createCommand(
      'lesson.update_timeline',
      { lessonId: params.lessonId, timeline: timelineStr },
      actorId,
      { approved: true },
    );
    return await this.commandBus.execute(cmd);
  }

  /**
   * 更新课时流转模式与进度条件，触发实时课堂广播
   */
  public async updateProgressMode(lessonId: string, progressMode?: string, progressConditions?: any) {
    const mode = progressMode || 'manual';
    const conditionsStr =
      typeof progressConditions === 'string' ? progressConditions : JSON.stringify(progressConditions || null);

    this.db
      .prepare('UPDATE lessons SET progress_mode = ?, progress_conditions = ?, updated_at = ? WHERE id = ?')
      .run(mode, conditionsStr, Date.now(), lessonId);

    await publishClassroomEvent(
      CLASSROOM_EVENTS.LESSON_PROGRESS_MODE_CHANGED,
      {
        lessonId,
        progressMode: mode,
        progressConditions: progressConditions || null,
      },
      { correlationId: lessonId },
    );

    return { success: true };
  }

  /**
   * 级联删除课时 (事务化，涉及 10+ 张关联表，防孤儿残留与内存防爆)
   */
  public deleteLessonCascade(lessonId: string): { success: boolean; deleted: boolean } {
    const delTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
      this.db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(lessonId);
      this.db.prepare('DELETE FROM schedules WHERE lesson_id = ?').run(lessonId);
      this.db.prepare('DELETE FROM assignments WHERE lesson_id = ?').run(lessonId);

      // Cascade delete interactive classroom session data
      const sessionRows = this.db
        .prepare('SELECT id FROM classroom_sessions WHERE lesson_id = ?')
        .all(lessonId) as { id: string }[];

      for (const s of sessionRows) {
        this.db
          .prepare(
            'DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE session_id = ?)',
          )
          .run(s.id);
        this.db.prepare('DELETE FROM classroom_quick_polls WHERE session_id = ?').run(s.id);
        this.db.prepare('DELETE FROM classroom_buzzers WHERE session_id = ?').run(s.id);
        this.db.prepare('DELETE FROM classroom_exit_tickets WHERE session_id = ?').run(s.id);
        this.db.prepare('DELETE FROM classroom_pacing_signals WHERE session_id = ?').run(s.id);
      }

      this.db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(lessonId);
      this.db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?').run(lessonId);
      return this.db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    });

    const result = delTx() as any;
    lessonActiveSegments.delete(lessonId);

    return {
      success: true,
      deleted: result.changes > 0,
    };
  }

  /**
   * 获取课时关联数据宏观统计 (供删除确认弹窗使用)
   */
  public getLessonStats(lessonId: string): LessonStats {
    const whiteboardCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM whiteboard_elements WHERE lesson_id = ?').get(lessonId) as any
    )?.count || 0;

    const scheduleCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM schedules WHERE lesson_id = ?').get(lessonId) as any
    )?.count || 0;

    const enrollmentCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM student_lesson_progress WHERE lesson_id = ?').get(lessonId) as any
    )?.count || 0;

    const assignmentCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM assignments WHERE lesson_id = ?').get(lessonId) as any
    )?.count || 0;

    return { whiteboardCount, scheduleCount, enrollmentCount, assignmentCount };
  }

  /**
   * 深度克隆课时及其白板图元数据
   */
  public cloneLesson(lessonId: string, creatorId: string): any {
    const original = this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as any;
    if (!original) {
      const err: any = new Error('Lesson not found');
      err.status = 404;
      throw err;
    }

    const newId = uuidv7();
    const now = Date.now();
    const newTitle = `副本-${original.title}`;

    const cloneTx = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          newId,
          newTitle,
          original.content,
          original.timeline,
          original.progress_mode,
          original.progress_conditions,
          creatorId,
          now,
          now,
        );

      const whiteboardElements = this.db
        .prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?')
        .all(lessonId) as any[];

      const insertElement = this.db.prepare(
        'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
      );

      for (const el of whiteboardElements) {
        insertElement.run(uuidv7(), newId, el.type, el.data, now);
      }
    });
    cloneTx();

    const cloned = this.db
      .prepare(
        `
      SELECT l.*, u.name as creator_name, 0 as enrollment_count 
      FROM lessons l 
      LEFT JOIN users u ON l.creator_id = u.id
      WHERE l.id = ?
    `,
      )
      .get(newId);

    return cloned;
  }

  /**
   * 获取课时作业提交列表 (含最新版本多模态内容)
   */
  public getEvalSubmissions(lessonId: string): any[] {
    const rows = this.db
      .prepare(
        `
      SELECT ps.*, s.name as student_name,
             ${LATEST_VERSION_COLUMNS}
      FROM plugin_submissions ps
      LEFT JOIN students s ON ps.student_id = s.id
      WHERE ps.lesson_id = ?
    `,
      )
      .all(lessonId) as any[];

    return rows.map(withLatestVersion);
  }

  /**
   * 获取课时作业评定与互评详情 (PERF-N1 500-batch 批量拉取)
   */
  public getEvalGrades(lessonId: string): any[] {
    const submissions = this.db
      .prepare(
        `
      SELECT ps.*, s.name as student_name
      FROM plugin_submissions ps
      LEFT JOIN students s ON ps.student_id = s.id
      WHERE ps.lesson_id = ?
    `,
      )
      .all(lessonId) as any[];

    const submissionIds = submissions.map((s) => s.id);
    const reviewsBySubmission = new Map<string, any[]>();
    const gradesBySubmission = new Map<string, any>();

    for (let i = 0; i < submissionIds.length; i += 500) {
      const batch = submissionIds.slice(i, i + 500);
      if (batch.length === 0) break;
      const placeholders = batch.map(() => '?').join(', ');

      const reviewRows = this.db
        .prepare(
          `
        SELECT pr.*, s.name as reviewer_name
        FROM plugin_peer_reviews pr
        LEFT JOIN students s ON pr.reviewer_id = s.id
        WHERE pr.submission_id IN (${placeholders})
      `,
        )
        .all(...batch) as any[];

      for (const review of reviewRows) {
        let list = reviewsBySubmission.get(review.submission_id);
        if (!list) {
          list = [];
          reviewsBySubmission.set(review.submission_id, list);
        }
        list.push(review);
      }

      const gradeRows = this.db
        .prepare(`SELECT * FROM plugin_grades WHERE submission_id IN (${placeholders})`)
        .all(...batch) as any[];

      for (const grade of gradeRows) {
        gradesBySubmission.set(grade.submission_id, grade);
      }
    }

    const result = [];
    for (const sub of submissions) {
      const reviews = reviewsBySubmission.get(sub.id) || [];

      let peerAverageScore = 0;
      if (reviews.length > 0) {
        const sum = reviews.reduce((acc, r) => acc + r.score, 0);
        peerAverageScore = Math.round(sum / reviews.length);
      }

      const grade = gradesBySubmission.get(sub.id) || null;

      result.push({
        id: sub.id,
        lessonId: sub.lesson_id,
        studentId: sub.student_id,
        studentName: sub.student_name,
        filePath: sub.file_path,
        version: sub.version,
        createdAt: sub.created_at,
        updatedAt: sub.updated_at,
        peerReviews: reviews,
        peerAverageScore,
        grade,
      });
    }

    return result;
  }

  /**
   * 获取指定提交的所有互评
   */
  public getSubmissionReviews(submissionId: string): any[] {
    return this.db
      .prepare(
        `
      SELECT pr.*, s.name as reviewer_name
      FROM plugin_peer_reviews pr
      LEFT JOIN students s ON pr.reviewer_id = s.id
      WHERE pr.submission_id = ?
    `,
      )
      .all(submissionId);
  }

  /**
   * 获取学生在该课时的作业、撰写互评与最终评定状态
   */
  public getStudentEvalStatus(lessonId: string, studentId: string): any {
    const submission = this.db
      .prepare(
        `
      SELECT ps.*, ${LATEST_VERSION_COLUMNS}
      FROM plugin_submissions ps WHERE ps.lesson_id = ? AND ps.student_id = ?
    `,
      )
      .get(lessonId, studentId) as any;

    const reviewsWritten = this.db
      .prepare(
        `
      SELECT pr.*, s.name as student_name 
      FROM plugin_peer_reviews pr
      LEFT JOIN plugin_submissions ps ON pr.submission_id = ps.id
      LEFT JOIN students s ON ps.student_id = s.id
      WHERE pr.reviewer_id = ? AND ps.lesson_id = ?
    `,
      )
      .all(studentId, lessonId);

    let grade = null;
    if (submission) {
      grade = this.db
        .prepare('SELECT * FROM plugin_grades WHERE submission_id = ?')
        .get(submission.id) as any;
    }

    return {
      submission: submission ? withLatestVersion(submission) : null,
      reviewsWritten,
      grade,
    };
  }

  /**
   * AI 助教图元分析与提示词生成并下发白板
   */
  public async generateAiTutorHint(lessonId: string, elements: any[]): Promise<string> {
    const elementsSummary = (elements || [])
      .map((e: any, i: number) => `Element ${i + 1}: type=${e.type}, content=${JSON.stringify(e.data)}`)
      .join('\n');

    const prompt = `You are a real-time AI Tutor monitoring a student's interactive whiteboard.
The student has pressed the "Ask AI" button for help.
Current Whiteboard Elements:
${elementsSummary || 'The whiteboard is empty.'}

Provide a short, friendly, and helpful hint (1-2 sentences) directly related to the student's current progress or to encourage them to start. Do not use markdown. Return ONLY the hint text.`;

    const text = await this.aiService.generateText(prompt);
    const hint = text?.trim() || "I'm here to help! Let me know what you're working on.";

    const cmd = this.commandBus.createCommand(
      'whiteboard.draw',
      {
        lessonId,
        type: 'text',
        data: JSON.stringify({
          text: `🤖 AI Tutor: ${hint}`,
          x: 50,
          y: 50,
          fontSize: 20,
          color: '#8b5cf6',
          page: 0,
        }),
      },
      'system-ai',
      { approved: true },
    );

    await this.commandBus.execute(cmd);
    return hint;
  }
}
