/**
 * 课件管理领域服务 (CoursewareService)
 *
 * 承载微前端课件沙箱 attempt 认领状态机、原始日志归集与成绩策略计算、
 * 作答最终提交与自动成绩录入、榜单分页脱敏与内联手写课件落库。
 * 独立于 HTTP 传输层，可直接进行无状态单元测试。
 */
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { CLASSROOM_EVENTS, publishClassroomEvent } from '../classroom-events.js';
import { aggregateAttemptScore, describeAggregation } from '../../packages/plugins/courseware-score.js';
import { extractScoreCommentCompletion } from '../utils/score-extract.js';
import { parsePagination, type Pagination } from '../utils/pagination.js';
import {
  autoRecordAttempt,
  autoRecordForLesson,
  describePromoteReason,
  findActiveLessonForStudent,
  markStudentAbsent,
  promoteAttemptToGrade,
} from '../utils/auto-record-score.js';

export interface CoursewareSessionInfo {
  userId?: string;
  studentId?: string;
  role?: string;
  subRole?: string;
}

export interface AdoptAttemptResult {
  attemptId: string;
  adopted: boolean;
  reused: boolean;
  role?: string;
  reason?: string;
}

export interface SubmitAttemptInput {
  score?: any;
  comment?: string;
  completion?: any;
  status?: string;
  extra?: Record<string, any>;
}

export interface AttemptListItem {
  attemptId: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  coursewareId: string;
  coursewareName: string;
  coursewareUuid: string;
  studentName: string;
  studentId: string;
  score: number | null;
  comment?: string | null;
  completion: number | null;
  extra_json?: string | null;
  isPromoted: number;
}

export interface ListAttemptsResult {
  data: AttemptListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export class CoursewareService {
  constructor(private readonly db: Database.Database = kernelContainer.db) {}

  /** 课件 attempt 变更的统一发布入口（log / submit / adopt 三类） */
  private async publishAttemptUpdated(attemptId: string, type: 'log' | 'submit' | 'adopt'): Promise<void> {
    await publishClassroomEvent(
      CLASSROOM_EVENTS.COURSEWARE_ATTEMPT_UPDATED,
      { attemptId, type },
      { correlationId: attemptId },
    );
  }

  // ── 1. 跨域沙箱 Attempt 归属认领 ──────────────────────────────────────────

  /**
   * 归属认领状态机。
   *
   * 背景：课件 iframe 以 `credentialless` + `sandbox` 加载，不带会话 Cookie，
   * 初始生成的 attempt 归属为 'guest' 哨兵。持有 Cookie 的宿主父窗口通过本方法认领：
   * - 教师/管理员：直接幂等放行；
   * - 已是本人 attempt：直接幂等放行；
   * - 哨兵无主 attempt（guest/teacher）：原子转移至该学生名下；
   * - 已被其他学生占用：为当前学生复用或新建独立的 active attempt，彻底杜绝串号。
   */
  public async adoptAttempt(attemptId: string, session?: CoursewareSessionInfo | null): Promise<AdoptAttemptResult> {
    if (!session) {
      const err: any = new Error('Authentication required to adopt an attempt');
      err.status = 401;
      throw err;
    }

    const attemptRow = this.db
      .prepare('SELECT id, courseware_id, student_id, status FROM courseware_attempt WHERE id = ?')
      .get(attemptId) as { id: string; courseware_id: string; student_id: string; status: string } | undefined;

    if (!attemptRow) {
      const err: any = new Error('Attempt not found');
      err.status = 404;
      throw err;
    }

    // 教师/管理员：预览用，不参与归属约束
    if (session.role === 'teacher' || session.role === 'administrator') {
      return { attemptId, adopted: false, reused: true, role: session.role };
    }

    const studentId = session.userId || session.studentId;
    if (!studentId) {
      const err: any = new Error('Session has no student identity');
      err.status = 400;
      throw err;
    }

    // 已归属当前学生 → 幂等返回
    if (attemptRow.student_id === studentId) {
      return { attemptId, adopted: false, reused: true };
    }

    // 无主 attempt（injectLmsSdk 写入的匿名/预览哨兵）→ 直接认领，保留已产生的原始流水
    const UNOWNED_OWNERS = ['guest', 'teacher', 'teacher_preview', ''];
    if (UNOWNED_OWNERS.includes(attemptRow.student_id)) {
      const info = this.db
        .prepare(
          "UPDATE courseware_attempt SET student_id = ? WHERE id = ? AND student_id IN ('guest','teacher','teacher_preview','')",
        )
        .run(studentId, attemptId);

      if (info.changes > 0) {
        await this.publishAttemptUpdated(attemptId, 'adopt');
        return { attemptId, adopted: true, reused: true };
      }
    }

    // attempt 已被其他真实学生占用 → 为当前学生复用/新建他自己的 active attempt
    let own = this.db
      .prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
      .get(attemptRow.courseware_id, studentId, 'active') as { id: string } | undefined;

    if (!own) {
      const newId = 'att_' + crypto.randomBytes(8).toString('hex');
      this.db
        .prepare(
          'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(newId, attemptRow.courseware_id, studentId, Date.now(), 'active');
      own = { id: newId };
    }

    await this.publishAttemptUpdated(own.id, 'adopt');
    return {
      attemptId: own.id,
      adopted: false,
      reused: true,
      reason: 'attempt-owned-by-another-student',
    };
  }

  // ── 2. 原始作答日志记录与增量成绩归集 ──────────────────────────────────────

  public async logAttemptEvent(
    attemptId: string,
    session: CoursewareSessionInfo | null | undefined,
    eventType: string,
    payload: any,
  ): Promise<void> {
    if (!session) {
      const err: any = new Error('Authentication required');
      err.status = 401;
      throw err;
    }

    if (session.role !== 'teacher' && session.role !== 'administrator') {
      const attemptRow = this.db
        .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
        .get(attemptId) as { student_id: string } | undefined;
      if (attemptRow && attemptRow.student_id !== session.userId) {
        const err: any = new Error('Forbidden: Cannot modify logs for another student');
        err.status = 403;
        throw err;
      }
    }

    const rawId = 'raw_' + crypto.randomBytes(8).toString('hex');
    this.db
      .prepare(
        'INSERT INTO submission_raw (id, attempt_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(rawId, attemptId, eventType, JSON.stringify(payload), Date.now());

    const extracted = extractScoreCommentCompletion(payload);
    const comment = extracted.comment;
    const completion = extracted.completion;

    // 原生成绩归集：按课件成绩配置的策略从样本历史算出官方成绩
    let aggregatedScore: number | null = null;
    let aggregationExtra: Record<string, unknown> = {};
    try {
      const aggregation = aggregateAttemptScore(this.db as any, attemptId);
      if (aggregation.finalScore !== null) aggregatedScore = aggregation.finalScore;
      aggregationExtra = { score_aggregation: describeAggregation(aggregation) };
    } catch (aggErr) {
      console.warn('[courseware.log] score aggregation failed, fallback to latest score:', aggErr);
    }

    if (aggregatedScore !== null || comment !== undefined || completion !== undefined) {
      let parsedScore: number | null = null;
      if (extracted.score !== undefined && extracted.score !== null) {
        const num = parseFloat(extracted.score);
        if (!isNaN(num)) parsedScore = num;
      }
      let parsedCompletion: number | null = null;
      if (completion !== undefined && completion !== null) {
        const num = parseFloat(completion);
        if (!isNaN(num)) parsedCompletion = num;
      }

      const existing = this.db
        .prepare('SELECT * FROM submission_result WHERE attempt_id = ?')
        .get(attemptId) as any;

      if (!existing) {
        this.db
          .prepare(
            'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            'res_' + crypto.randomBytes(8).toString('hex'),
            attemptId,
            aggregatedScore !== null ? aggregatedScore : parsedScore,
            comment || null,
            parsedCompletion,
            JSON.stringify({
              ...(payload && typeof payload === 'object' ? payload : {}),
              ...aggregationExtra,
            }),
          );
      } else {
        const finalScore =
          aggregatedScore !== null ? aggregatedScore : parsedScore !== null ? parsedScore : existing.score;
        const finalComment = comment || existing.comment;
        const finalCompletion = parsedCompletion !== null ? parsedCompletion : existing.completion;

        let mergedExtra = {};
        try {
          mergedExtra = JSON.parse(existing.extra_json || '{}');
        } catch {}
        if (payload && typeof payload === 'object') {
          mergedExtra = { ...mergedExtra, ...payload };
        }
        mergedExtra = { ...mergedExtra, ...aggregationExtra };

        this.db
          .prepare(
            'UPDATE submission_result SET score = ?, comment = ?, completion = ?, extra_json = ? WHERE attempt_id = ?',
          )
          .run(finalScore, finalComment, finalCompletion, JSON.stringify(mergedExtra), attemptId);
      }
    }

    await this.publishAttemptUpdated(attemptId, 'log');
    void kernelContainer.eventBus.publish({
      id: 'evt_' + crypto.randomBytes(8).toString('hex'),
      type: 'courseware.event_logged',
      source: 'builtin.courseware',
      payload: { attemptId, eventType, payload },
      timestamp: Date.now(),
      correlationId: attemptId,
    });
  }

  // ── 3. 学生提交与学期成绩实时录入 ──────────────────────────────────────────

  public async submitAttempt(
    attemptId: string,
    session: CoursewareSessionInfo | null | undefined,
    normalizedActorId: string | null | undefined,
    input: SubmitAttemptInput,
  ): Promise<{ result: any; autoRecord: { recorded: boolean; reason?: string } | null }> {
    if (!session) {
      const err: any = new Error('Authentication required to submit attempt scores');
      err.status = 401;
      throw err;
    }

    const attemptRow = this.db
      .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
      .get(attemptId) as { student_id: string } | undefined;

    if (session.role !== 'teacher' && session.role !== 'administrator') {
      if (attemptRow && attemptRow.student_id !== session.userId) {
        const err: any = new Error('Forbidden: Cannot submit scores for another student');
        err.status = 403;
        throw err;
      }
    }

    let { score, comment, completion, status, extra = {} } = input;
    const extracted = extractScoreCommentCompletion({ ...input, ...extra });
    if (score === undefined || score === null) score = extracted.score;
    if (comment === undefined || comment === null) comment = extracted.comment;
    if (completion === undefined || completion === null) completion = extracted.completion;

    let parsedScore: number | null = null;
    if (score !== undefined && score !== null) {
      const num = parseFloat(score);
      // V4 纵深：伪造成绩直达落库。此前 NaN 静默忽略、超大值照收；现拒绝非有限/越界分数
      if (typeof score === 'boolean' || !Number.isFinite(num) || num < 0 || num > 1000) {
        const err: any = new Error('Invalid score: must be a finite number in [0, 1000]');
        err.status = 400;
        throw err;
      }
      parsedScore = num;
    }
    let parsedCompletion: number | null = null;
    if (completion !== undefined && completion !== null) {
      const num = parseFloat(completion);
      if (!Number.isFinite(num) || num < 0 || num > 100) {
        const err: any = new Error('Invalid completion: must be a finite number in [0, 100]');
        err.status = 400;
        throw err;
      }
      parsedCompletion = num;
    }

    const actorId =
      normalizedActorId && normalizedActorId !== 'anonymous'
        ? normalizedActorId
        : `user:${session.userId || session.studentId || 'student'}:${session.role || 'student'}`;

    const payload: Record<string, any> = { attemptId };
    if (parsedScore !== null) payload.score = parsedScore;
    if (parsedCompletion !== null) payload.completion = parsedCompletion;
    if (comment !== undefined && comment !== null) payload.comment = comment;
    if (status !== undefined && status !== null) payload.status = status;
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) payload.extra = extra;

    const cmd = kernelContainer.commandBus.createCommand('courseware.submit_attempt', payload, actorId);
    const result = await kernelContainer.commandBus.execute(cmd);
    await this.publishAttemptUpdated(attemptId, 'submit');

    // 自动录入（实时路径）：教师预设规则后，学生提交即刻写入学期成绩
    let autoRecord: { recorded: boolean; reason?: string } | null;
    try {
      const studentId = attemptRow?.student_id || session.userId || session.studentId;
      const activeLesson = studentId ? findActiveLessonForStudent(this.db as any, studentId) : null;
      if (activeLesson) {
        const outcome = autoRecordAttempt(this.db as any, attemptId, activeLesson);
        autoRecord = outcome.ok ? { recorded: true } : { recorded: false, reason: outcome.reason };
      } else {
        autoRecord = { recorded: false, reason: 'no-active-lesson' };
      }
    } catch (autoErr) {
      console.warn('[courseware.submit] auto-record skipped:', autoErr);
      autoRecord = { recorded: false, reason: 'auto-record-error' };
    }

    return { result, autoRecord };
  }

  // ── 4. 榜单查询与脱敏投影 ──────────────────────────────────────────────────

  public listAttempts(
    queryParams: { coursewareUuid?: string; page?: any; pageSize?: any },
    isStaff: boolean,
    requesterStudentId?: string,
  ): ListAttemptsResult {
    const coursewareUuid =
      typeof queryParams.coursewareUuid === 'string' ? queryParams.coursewareUuid.trim() : '';
    // V3 修复：非教师此前返回全量榜单（含他生 score/studentId）。现非 staff 仅返本人。
    const ownerFilter = !isStaff && requesterStudentId ? 'a.student_id = ?' : null;

    const baseSql = `
      SELECT a.id as attemptId, a.started_at, a.finished_at, a.status,
             cw.id as coursewareId, cw.name as coursewareName, cw.uuid as coursewareUuid,
             COALESCE(s.name, CASE WHEN a.student_id = 'teacher' THEN 'Teacher (Test)' WHEN a.student_id = 'guest' THEN 'Guest Student' ELSE a.student_id END) as studentName,
             a.student_id as studentId,
             r.score, r.comment, r.completion, r.extra_json,
             (
               SELECT COUNT(*) FROM assignment_submissions sub
               JOIN assignments ast ON sub.assignment_id = ast.id
               WHERE sub.student_id = a.student_id
                 AND ast.title = '互动课件: ' || cw.name
             ) as isPromoted
      FROM courseware_attempt a
      JOIN courseware cw ON a.courseware_id = cw.id
      LEFT JOIN students s ON a.student_id = s.id
      LEFT JOIN submission_result r ON a.id = r.attempt_id
    `;

    const where: string[] = [];
    const args: any[] = [];
    if (coursewareUuid) {
      where.push('cw.uuid = ?');
      args.push(coursewareUuid);
    }
    if (ownerFilter && requesterStudentId) {
      where.push(ownerFilter);
      args.push(requesterStudentId);
    }
    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const sql = `${baseSql}${whereSql} ORDER BY a.started_at DESC LIMIT ? OFFSET ?`;

    const pg: Pagination = parsePagination(queryParams as any);
    const countSql = `SELECT COUNT(*) AS n FROM courseware_attempt a JOIN courseware cw ON a.courseware_id = cw.id${whereSql}`;

    const total = (this.db.prepare(countSql).get(...args) as any).n;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...args, pg.isAll ? -1 : pg.pageSize, pg.offset) as AttemptListItem[];

    const sanitizedData = isStaff
      ? rows
      : rows.map((row) => {
          const sanitized = { ...row };
          delete sanitized.extra_json;
          delete sanitized.comment;
          return sanitized;
        });

    return {
      data: sanitizedData,
      total,
      page: pg.page,
      pageSize: pg.isAll ? total : pg.pageSize,
    };
  }

  // ── 5. 作答进度查询 ────────────────────────────────────────────────────────

  public getAttemptProgress(attemptId: string, session?: CoursewareSessionInfo | null): any {
    if (
      session &&
      session.role !== 'teacher' &&
      session.role !== 'administrator' &&
      session.subRole !== 'administrator'
    ) {
      const owner = this.db
        .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
        .get(attemptId) as { student_id: string } | undefined;
      if (!owner || owner.student_id !== (session.userId || session.studentId)) {
        const err: any = new Error('Forbidden: Cannot read another student attempt');
        err.status = 403;
        throw err;
      }
    }

    const result = this.db
      .prepare('SELECT score, comment, completion, extra_json FROM submission_result WHERE attempt_id = ?')
      .get(attemptId) as any;

    if (!result) {
      return null;
    }

    let extra = {};
    try {
      extra = JSON.parse(result.extra_json || '{}');
    } catch {}

    return {
      score: result.score,
      comment: result.comment,
      completion: result.completion,
      extra,
    };
  }

  // ── 6. 手写内联课件落库 ────────────────────────────────────────────────────

  public saveInlineCourseware(code: string): string {
    if (!code || !code.trim()) {
      const err: any = new Error('Missing code');
      err.status = 400;
      throw err;
    }

    if (code.length > 512 * 1024) {
      const err: any = new Error('Inline courseware too large (512KB max)');
      err.status = 413;
      throw err;
    }

    const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
    const uuid = `inline-${hash}`;
    const existing = this.db.prepare('SELECT id FROM system_resources WHERE id = ?').get(uuid);

    if (!existing) {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(uuid, 'index.html', 'html', code, Date.now());
    }

    return uuid;
  }

  // ── 7. 成绩转录与缺考管理 ──────────────────────────────────────────────────

  public markAbsent(params: { lessonId: string; classId: string; studentId: string; coursewareId: string }): any {
    const { lessonId, classId, studentId, coursewareId } = params;
    if (!lessonId || !classId || !studentId || !coursewareId) {
      const err: any = new Error('Missing lessonId, classId, studentId or coursewareId');
      err.status = 400;
      throw err;
    }

    const result = markStudentAbsent(this.db as any, { lessonId, classId, studentId, coursewareId });
    if (!result.ok) {
      const text =
        result.reason === 'student-not-in-class'
          ? '该学生不在所选班级中，无法标记缺考'
          : '课件不存在，无法标记缺考';
      const err: any = new Error(text);
      err.status = 422;
      err.reason = result.reason;
      throw err;
    }

    return { studentId: result.studentId, coursewareName: result.coursewareName };
  }

  public async promoteAttempt(attemptId: string, lessonId: string, classId: string): Promise<any> {
    if (!lessonId || !classId) {
      const err: any = new Error('Missing lessonId or classId');
      err.status = 400;
      throw err;
    }

    const result = promoteAttemptToGrade(this.db as any, attemptId, {
      lessonId,
      classId,
      sourceLabel: '教师在课堂中保存录入',
      source: 'manual',
      ignoreMinCompletion: true,
      ignoreNotFinished: true,
    });

    if (!result.ok) {
      const err: any = new Error(describePromoteReason(result.reason));
      err.status = result.reason === 'attempt-not-found' ? 404 : 422;
      err.reason = result.reason;
      throw err;
    }

    await publishClassroomEvent(
      CLASSROOM_EVENTS.STUDENT_PROGRESS_UPDATED,
      {
        studentId: result.studentId,
        lessonId,
        progressPercent: 100,
        completed: true,
        completedSegments: [],
      },
      { correlationId: lessonId },
    );

    return { assignmentId: result.assignmentId, score: result.score };
  }

  public autoRecordForLesson(lessonId: string, classId: string, limit?: number): any {
    if (!lessonId || !classId) {
      const err: any = new Error('Missing lessonId or classId');
      err.status = 400;
      throw err;
    }
    return autoRecordForLesson(this.db as any, { lessonId, classId, limit });
  }
}
