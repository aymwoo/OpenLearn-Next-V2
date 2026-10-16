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
import { stripReasoningArtifacts } from '../../packages/core/ai/strip-reasoning.js';
import { CLASSROOM_EVENTS, publishClassroomEvent } from '../classroom-events.js';
import { lessonActiveSegments, clearLessonRuntimeState } from '../shared-state.js';
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
  attendanceCount?: number;
  submissionCount?: number;
  peerReviewCount?: number;
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

/**
 * 学科分类 → AI 大纲提示词中的中文学科名。
 * 前端向导的 `<select>` 下发的是英文枚举值（wizardCourseCategory）。
 */
const OUTLINE_CATEGORY_LABELS: Record<string, string> = {
  Mathematics: '数学',
  ComputerScience: '计算机科学',
  Literature: '语文学',
  Physics: '物理',
  History: '历史学',
  Art: '艺术设计',
  Other: '综合素养',
};

/** 时间轴环节 type → 中文教学环节名 */
const OUTLINE_SEGMENT_TYPE_LABELS: Record<string, string> = {
  intro: '导入',
  lecture: '新授',
  practice: '练习',
  summary: '总结',
};

/**
 * 剥掉 LLM 偶发返回的整段 ```markdown / ```md 包裹，避免污染教案正文。
 * 只处理"围栏包住整篇"的情况，正文内部的代码块保持原样。
 */
export function stripOuterCodeFence(text: string): string {
  const match = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : text;
}

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
    private readDb?: Database.Database,
  ) {}

  private get reader(): Database.Database {
    return this.readDb || kernelContainer.getReadDb() || this.db;
  }

  /**
   * 分页查询课时列表 (A7 标准分页信封)
   */
  public listLessons(pg: Pagination) {
    const total = (this.reader.prepare('SELECT COUNT(*) AS n FROM lessons').get() as any)?.n || 0;
    const lessons = this.reader
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
    return this.reader.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
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

    const lesson = this.reader.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as any;
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

    return {
      success: true,
      deprecated: true,
      message:
        'progress_mode / progress_conditions 已废弃。进入条件请写在 lessons.timeline 每个环节的 gates 上。gated 模式仅在环节没有 gates 时作为兼容回退。',
    };
  }

  /**
   * 级联删除课时 (事务化，涉及 15+ 张关联表，防孤儿残留与内存防爆)
   */
  public deleteLessonCascade(lessonId: string): { success: boolean; deleted: boolean } {
    const delTx = this.db.transaction(() => {
      // 1. 解除学生屏幕锁定引用，防止学生端长期处于锁屏卡死状态
      try {
        this.db.prepare('UPDATE students SET locked_lesson_id = NULL WHERE locked_lesson_id = ?').run(lessonId);
      } catch {}

      // 2. 白板与学情进度
      this.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
      this.db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(lessonId);

      // 3. 考勤与排课 (先子后父：先删关联当前课节排课的考勤记录，再删排课)
      this.db
        .prepare('DELETE FROM attendance WHERE schedule_id IN (SELECT id FROM schedules WHERE lesson_id = ?)')
        .run(lessonId);
      this.db.prepare('DELETE FROM schedules WHERE lesson_id = ?').run(lessonId);

      // 4. 作业与提交 (先子后父：先删关联当前课节作业的提交，再删作业；同时清理插件作业生态)
      this.db
        .prepare(
          'DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE lesson_id = ?)',
        )
        .run(lessonId);
      this.db.prepare('DELETE FROM assignments WHERE lesson_id = ?').run(lessonId);
      try {
        const subSubquery =
          'SELECT id FROM plugin_submissions WHERE lesson_id = ? OR assignment_id IN (SELECT id FROM plugin_assignments WHERE lesson_id = ?)';
        const assignSubquery = 'SELECT id FROM plugin_assignments WHERE lesson_id = ?';

        this.db
          .prepare(
            `DELETE FROM plugin_assignment_files WHERE submission_id IN (${subSubquery}) OR assignment_id IN (${assignSubquery})`,
          )
          .run(lessonId, lessonId, lessonId);

        this.db
          .prepare(
            `DELETE FROM plugin_peer_review_tasks WHERE submission_id IN (${subSubquery}) OR assignment_id IN (${assignSubquery})`,
          )
          .run(lessonId, lessonId, lessonId);

        this.db
          .prepare(
            `DELETE FROM plugin_peer_reviews WHERE submission_id IN (${subSubquery}) OR assignment_id IN (${assignSubquery})`,
          )
          .run(lessonId, lessonId, lessonId);

        this.db
          .prepare(
            `DELETE FROM plugin_grades WHERE submission_id IN (${subSubquery}) OR assignment_id IN (${assignSubquery})`,
          )
          .run(lessonId, lessonId, lessonId);

        this.db
          .prepare(
            `DELETE FROM plugin_submission_versions WHERE submission_id IN (${subSubquery}) OR assignment_id IN (${assignSubquery})`,
          )
          .run(lessonId, lessonId, lessonId);

        this.db
          .prepare(`DELETE FROM plugin_submissions WHERE lesson_id = ? OR assignment_id IN (${assignSubquery})`)
          .run(lessonId, lessonId);

        this.db.prepare('DELETE FROM plugin_assignments WHERE lesson_id = ?').run(lessonId);
      } catch {}

      // 5. 课堂互动与互评体系 (量规维度、弹幕、提名、徽章、评语、任务按外键依赖安全清理)
      try {
        this.db.prepare('DELETE FROM classroom_peer_rubric_dimensions WHERE lesson_id = ?').run(lessonId);
        this.db.prepare('DELETE FROM classroom_danmaku WHERE lesson_id = ?').run(lessonId);
        this.db.prepare('DELETE FROM classroom_peer_nominations WHERE lesson_id = ?').run(lessonId);
        this.db.prepare('DELETE FROM classroom_peer_badges WHERE lesson_id = ?').run(lessonId);
        this.db.prepare('DELETE FROM classroom_peer_reviews WHERE lesson_id = ?').run(lessonId);
        this.db.prepare('DELETE FROM classroom_peer_review_tasks WHERE lesson_id = ?').run(lessonId);
      } catch {}

      // 6. 随堂信息流、预设投票、随机点名与课件打分配置
      try {
        this.db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(lessonId);
        this.db.prepare('DELETE FROM lesson_preset_polls WHERE lesson_id = ?').run(lessonId);
        this.db.prepare('DELETE FROM student_rollcalls WHERE lesson_id = ?').run(lessonId);
        this.db.prepare('DELETE FROM courseware_score_config WHERE lesson_id = ?').run(lessonId);
      } catch {}

      // 7. 互动课堂会话与子项 (投票票数、投票题目、抢答器、退出测验、步调反馈)
      const sessionRows = this.db.prepare('SELECT id FROM classroom_sessions WHERE lesson_id = ?').all(lessonId) as {
        id: string;
      }[];

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
      const tableExists = (name: string) =>
        !!this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
      if (tableExists('segment_visits')) {
        this.db.prepare('DELETE FROM segment_visits WHERE lesson_id = ?').run(lessonId);
      }
      if (tableExists('segment_gate_overrides')) {
        this.db.prepare('DELETE FROM segment_gate_overrides WHERE lesson_id = ?').run(lessonId);
      }
      if (tableExists('lesson_checkins')) {
        this.db.prepare('DELETE FROM lesson_checkins WHERE lesson_id = ?').run(lessonId);
      }

      // 8. 课节主体删除
      return this.db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    });

    const result = delTx() as any;
    clearLessonRuntimeState(lessonId);

    return {
      success: true,
      deleted: result.changes > 0,
    };
  }

  /**
   * 获取课时关联数据宏观统计 (供删除确认弹窗使用，由只读连接池执行)
   */
  public getLessonStats(lessonId: string): LessonStats {
    const whiteboardCount =
      (
        this.reader
          .prepare('SELECT COUNT(*) as count FROM whiteboard_elements WHERE lesson_id = ?')
          .get(lessonId) as any
      )?.count || 0;

    const scheduleCount =
      (this.reader.prepare('SELECT COUNT(*) as count FROM schedules WHERE lesson_id = ?').get(lessonId) as any)
        ?.count || 0;

    const enrollmentCount =
      (
        this.reader
          .prepare('SELECT COUNT(*) as count FROM student_lesson_progress WHERE lesson_id = ?')
          .get(lessonId) as any
      )?.count || 0;

    const assignmentCount =
      (this.reader.prepare('SELECT COUNT(*) as count FROM assignments WHERE lesson_id = ?').get(lessonId) as any)
        ?.count || 0;

    let attendanceCount = 0;
    try {
      attendanceCount =
        (
          this.reader
            .prepare(
              'SELECT COUNT(*) as count FROM attendance WHERE schedule_id IN (SELECT id FROM schedules WHERE lesson_id = ?)',
            )
            .get(lessonId) as any
        )?.count || 0;
    } catch {}

    let submissionCount = 0;
    try {
      submissionCount =
        (
          this.reader
            .prepare(
              'SELECT COUNT(*) as count FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE lesson_id = ?)',
            )
            .get(lessonId) as any
        )?.count || 0;
    } catch {}

    let peerReviewCount = 0;
    try {
      peerReviewCount =
        (
          this.reader
            .prepare('SELECT COUNT(*) as count FROM classroom_peer_reviews WHERE lesson_id = ?')
            .get(lessonId) as any
        )?.count || 0;
    } catch {}

    return {
      whiteboardCount,
      scheduleCount,
      enrollmentCount,
      assignmentCount,
      attendanceCount,
      submissionCount,
      peerReviewCount,
    };
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
    const rows = this.reader
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
    const submissions = this.reader
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

      const reviewRows = this.reader
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

      const gradeRows = this.reader
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
    return this.reader
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
    const submission = this.reader
      .prepare(
        `
      SELECT ps.*, ${LATEST_VERSION_COLUMNS}
      FROM plugin_submissions ps WHERE ps.lesson_id = ? AND ps.student_id = ?
    `,
      )
      .get(lessonId, studentId) as any;

    const reviewsWritten = this.reader
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
      grade = this.reader.prepare('SELECT * FROM plugin_grades WHERE submission_id = ?').get(submission.id) as any;
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

  /**
   * 课程发布向导 —— AI 教学大纲生成
   *
   * 依据「课程课题 + 学科分类 + 课程简介 + 课堂时间轴环节」调用已配置的 AI Provider，
   * 生成可直接落库的 Markdown 教学大纲正文。
   *
   * 历史背景：向导里的「一键生成专家级教学大纲」原先只是前端 `helpUtils2.generateTemplateContent`
   * 的按学科硬编码字符串拼接，与课题内容无关。此方法用真实的 LLM 调用取代它。
   */
  public async generateOutlineWithAi(params: {
    title: string;
    category?: string;
    description?: string;
    timeline?: { title?: string; type?: string; duration?: string; notes?: string }[];
    lang?: string;
  }): Promise<string> {
    const { title, category, description, timeline, lang = 'zh' } = params;

    const trimmedTitle = (title || '').trim();
    if (!trimmedTitle) {
      const err: any = new Error(lang === 'zh' ? '课程课题不能为空' : 'Course title is required');
      err.status = 400;
      throw err;
    }

    const categoryLabel = OUTLINE_CATEGORY_LABELS[category || ''] || category || 'General';

    const timelineText = (Array.isArray(timeline) ? timeline : [])
      .map((seg, idx) => {
        const segTitle = (seg?.title || '').trim() || `Stage ${idx + 1}`;
        const segType = OUTLINE_SEGMENT_TYPE_LABELS[seg?.type || ''] || seg?.type || '';
        const segNotes = (seg?.notes || '').trim();
        return [
          `${idx + 1}. ${segTitle}`,
          seg?.duration ? `(${seg.duration})` : '',
          segType ? `— ${segType}` : '',
          segNotes ? `: ${segNotes}` : '',
        ].join(' ');
      })
      .join('\n');

    const prompt = `你是一位拥有 15 年经验的${categoryLabel}学科教学设计师。请围绕下面的课程课题，撰写一份可直接用于备课的 Markdown 教学大纲。

## 输入信息
- 课程课题：${trimmedTitle}
- 学科分类：${categoryLabel}
${description ? `- 课程简介与总目标：${String(description).trim()}` : '- 课程简介与总目标：（教师尚未填写，请依据课题自行拟定 2-3 条核心教学目标）'}
${timelineText ? `- 课堂时间轴环节：\n${timelineText}` : '- 课堂时间轴环节：（教师尚未编排，请按导入—精讲—练习—总结的通用节奏自行规划）'}

## 输出要求
1. 只输出 Markdown 正文，**不要**使用 \`\`\` 代码块包裹整个答案，不要输出任何解释性前后缀。
2. 第一行必须是以课程课题为主标题的一级标题 \`# ${trimmedTitle}\`。
3. 正文严格按以下章节顺序组织：
   - \`## 🎯 教学目标\`：3-4 条可观测、可评价的学习目标（使用行为动词）。
   - \`## 🧭 教学重难点\`：重点与难点各列 1-2 条。
   - \`## 🕒 课堂流程设计\`：与上述时间轴环节一一对应，每节写明时长、教学活动与师生活动。
   - \`## ❓ 关键问题链\`：3-5 个由浅入深、用于启发思考的提问。
   - \`## 📝 课堂练习与随堂检测\`：2-3 个具体的练习/检测任务。
   - \`## 📥 课后作业\`：一份明确的课后任务与提交要求。
4. 内容必须紧扣课题本身，禁止使用"公式 A""模块 1"之类的占位符或与课题无关的通用套话。
5. 篇幅控制在 600-1000 字，语言${lang === 'zh' ? '使用简体中文' : 'use English'}。`;

    const raw = await this.aiService.generateText(prompt, { temperature: 0.6, maxTokens: 2048 });
    const outline = stripReasoningArtifacts(stripOuterCodeFence(String(raw || '').trim()));

    if (!outline) {
      const err: any = new Error(
        lang === 'zh' ? 'AI Provider 返回了空内容，请稍后重试或更换模型。' : 'AI Provider returned empty content.',
      );
      err.status = 502;
      throw err;
    }

    return outline;
  }
}
