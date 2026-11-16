/**
 * 学案跨课节互评（Gitee IKVO15 P1）。
 *
 * 一次互评轮次可覆盖同一课程下多个课节的活动，任务按提交者循环分配。
 * 每位被评人只接受已分配评审人的一份评价，防止刷票；互评分数不写入
 * activity_progress.score。评论按 UGC 规则去 HTML、隐藏外链。
 */
import type Database from 'better-sqlite3';
import { sanitizeUgcText } from '../../packages/core/security/ugc-sanitize.js';
import { randomId } from '../utils/id.js';
import { LessonActivityError, LessonActivityService, parseJsonObject } from './lesson-activity-service.js';
import { listStudentsForLesson } from './lesson-roster.js';

export const PEER_REVIEW_ASSIGNMENT_STATUSES = ['pending', 'submitted', 'rejected'] as const;
export const PEER_REVIEW_STATUSES = ['submitted', 'teacher_confirmed', 'teacher_overridden', 'rejected'] as const;
export const PEER_REPORT_STATUSES = ['open', 'dismissed', 'upheld'] as const;

export interface RubricDimension {
  id: string;
  label: string;
  maxScore: number;
}

export interface PeerReviewCycleRecord {
  id: string;
  courseId: string | null;
  lessonId: string | null;
  title: string | null;
  anonymous: boolean;
  reviewsPerStudent: number;
  rubric: RubricDimension[];
  status: 'open' | 'closed';
  createdBy: string;
  createdAt: number;
  closedAt: number | null;
}

export interface PeerReviewAssignmentView {
  id: string;
  cycleId: string;
  activityId: string;
  activityTitle: string;
  lessonId: string;
  anonymous: boolean;
  status: (typeof PEER_REVIEW_ASSIGNMENT_STATUSES)[number];
  dueAt: number | null;
  reviewerStudentId?: string;
  revieweeStudentId?: string;
  reviewerName?: string | null;
  revieweeName?: string | null;
  review?: PeerReviewRecord | null;
}

export interface PeerReviewRecord {
  id: string;
  assignmentId: string;
  cycleId: string;
  activityId: string;
  scores: Record<string, number>;
  comment: string;
  status: (typeof PEER_REVIEW_STATUSES)[number];
  teacherFeedback: string | null;
  teacherId: string | null;
  reviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
  anonymous: boolean;
  reviewerStudentId?: string;
  revieweeStudentId?: string;
}

export interface StartPeerReviewInput {
  activityIds: string[];
  title?: string;
  anonymous?: boolean;
  reviewsPerStudent?: number;
  rubric?: RubricDimension[];
  dueAt?: number | null;
  createdBy: string;
  courseId?: string | null;
}

interface AssignmentRow {
  id: string;
  cycle_id: string;
  activity_id: string;
  reviewer_student_id: string;
  reviewee_student_id: string;
  anonymous: number;
  status: string;
  due_at: number | null;
  created_at: number;
  activity_title?: string;
  lesson_id?: string;
  reviewer_name?: string | null;
  reviewee_name?: string | null;
}

function defaultRubric(): RubricDimension[] {
  return [
    { id: 'quality', label: '完成质量', maxScore: 5 },
    { id: 'clarity', label: '表达清晰', maxScore: 5 },
  ];
}

export function parseRubric(raw: unknown): RubricDimension[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { dimensions?: unknown })?.dimensions)
      ? (raw as { dimensions: unknown[] }).dimensions
      : [];
  const parsed: RubricDimension[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id || '').trim();
    const label = String(rec.label || '').trim();
    const maxScore = Number(rec.maxScore ?? rec.max_score ?? 5);
    if (!id || !label || !Number.isFinite(maxScore) || maxScore <= 0) continue;
    parsed.push({ id, label, maxScore: Math.min(100, Math.max(1, Math.round(maxScore))) });
  }
  return parsed.length > 0 ? parsed : defaultRubric();
}

export function parseRubricJson(raw: unknown): RubricDimension[] {
  if (Array.isArray(raw)) return parseRubric(raw);
  if (typeof raw !== 'string' || !raw.trim()) return parseRubric([]);
  try {
    return parseRubric(JSON.parse(raw));
  } catch {
    return parseRubric([]);
  }
}

export function assignReviewPairs(
  studentIds: string[],
  reviewsPerStudent: number,
): Array<{ reviewerStudentId: string; revieweeStudentId: string }> {
  const unique = Array.from(new Set(studentIds.filter(Boolean)));
  const n = unique.length;
  const k = Math.min(Math.max(1, reviewsPerStudent), n - 1);
  if (n < 2) {
    throw new LessonActivityError(400, '至少需要两名已提交的学生才能开始互评');
  }
  const pairs: Array<{ reviewerStudentId: string; revieweeStudentId: string }> = [];
  for (let offset = 1; offset <= k; offset++) {
    for (let i = 0; i < n; i++) {
      const revieweeStudentId = unique[i];
      const reviewerStudentId = unique[(i + offset) % n];
      if (reviewerStudentId === revieweeStudentId) continue;
      pairs.push({ reviewerStudentId, revieweeStudentId });
    }
  }
  return pairs;
}

export class ActivityPeerReviewService {
  constructor(private readonly db: Database.Database) {}

  startCycle(input: StartPeerReviewInput): {
    cycle: PeerReviewCycleRecord;
    assignmentCount: number;
    skippedActivities: Array<{ activityId: string; reason: string }>;
  } {
    const activityIds = Array.from(new Set((input.activityIds || []).filter(Boolean)));
    if (activityIds.length === 0) {
      throw new LessonActivityError(400, '请选择至少一个活动');
    }

    const activities = activityIds.map((id) => {
      const row = this.db
        .prepare('SELECT id, lesson_id, title, peer_review, rubric_json, visible FROM lesson_activities WHERE id = ?')
        .get(id) as
        | {
            id: string;
            lesson_id: string;
            title: string;
            peer_review: number;
            rubric_json: string | null;
            visible: number;
          }
        | undefined;
      if (!row) throw new LessonActivityError(404, 'Activity not found');
      return row;
    });

    const lessonIds = Array.from(new Set(activities.map((item) => item.lesson_id)));
    let courseId = input.courseId ?? null;
    if (!courseId && lessonIds.length > 0) {
      const courses = this.db
        .prepare(`SELECT DISTINCT course_id FROM lessons WHERE id IN (${lessonIds.map(() => '?').join(',')})`)
        .all(...lessonIds) as Array<{ course_id: string | null }>;
      const present = Array.from(new Set(courses.map((row) => row.course_id).filter(Boolean))) as string[];
      if (present.length === 1) courseId = present[0];
      if (lessonIds.length > 1 && present.length === 0) {
        throw new LessonActivityError(400, '跨课节互评需要这些课节同属一门课程');
      }
      if (present.length > 1) {
        throw new LessonActivityError(400, '跨课节互评不能跨越不同课程');
      }
    }

    const reviewsPerStudent = Math.min(5, Math.max(1, Math.round(input.reviewsPerStudent ?? 2)));
    const anonymous = !!input.anonymous;
    const rubric = parseRubric(input.rubric ?? parseRubricJson(activities[0]?.rubric_json));
    const now = Date.now();
    const cycleId = randomId('prc_');
    const skipped: Array<{ activityId: string; reason: string }> = [];
    const pairRows: Array<{ activityId: string; reviewerStudentId: string; revieweeStudentId: string }> = [];

    for (const activity of activities) {
      const submitted = this.listSubmittedStudentIds(activity.id);
      if (submitted.length < 2) {
        skipped.push({ activityId: activity.id, reason: '已提交学生不足两人' });
        continue;
      }
      for (const pair of assignReviewPairs(submitted, reviewsPerStudent)) {
        pairRows.push({ activityId: activity.id, ...pair });
      }
    }
    if (pairRows.length === 0) {
      throw new LessonActivityError(400, '没有可分配的互评任务（每个活动至少需要两名已提交学生）');
    }

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO activity_peer_review_cycles (
             id, course_id, lesson_id, title, anonymous, reviews_per_student, rubric_json, status, created_by, created_at, closed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)`,
        )
        .run(
          cycleId,
          courseId,
          lessonIds.length === 1 ? lessonIds[0] : null,
          (input.title || '互评').slice(0, 80),
          anonymous ? 1 : 0,
          reviewsPerStudent,
          JSON.stringify(rubric),
          input.createdBy,
          now,
        );
      const insert = this.db.prepare(
        `INSERT INTO activity_peer_review_assignments (
           id, cycle_id, activity_id, reviewer_student_id, reviewee_student_id, anonymous, status, due_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      );
      for (const pair of pairRows) {
        insert.run(
          randomId('pra_'),
          cycleId,
          pair.activityId,
          pair.reviewerStudentId,
          pair.revieweeStudentId,
          anonymous ? 1 : 0,
          input.dueAt ?? null,
          now,
        );
      }
    });
    tx();

    return {
      cycle: this.getCycle(cycleId),
      assignmentCount: pairRows.length,
      skippedActivities: skipped,
    };
  }

  getCycle(cycleId: string): PeerReviewCycleRecord {
    const row = this.db.prepare('SELECT * FROM activity_peer_review_cycles WHERE id = ?').get(cycleId) as
      Record<string, unknown> | undefined;
    if (!row) throw new LessonActivityError(404, '互评轮次不存在');
    return this.mapCycle(row);
  }

  listCyclesForLesson(lessonId: string): PeerReviewCycleRecord[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT c.*
           FROM activity_peer_review_cycles c
           LEFT JOIN activity_peer_review_assignments a ON a.cycle_id = c.id
           LEFT JOIN lesson_activities la ON la.id = a.activity_id
          WHERE c.lesson_id = ? OR la.lesson_id = ?
          ORDER BY c.created_at DESC`,
      )
      .all(lessonId, lessonId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapCycle(row));
  }

  closeCycle(cycleId: string): PeerReviewCycleRecord {
    const cycle = this.getCycle(cycleId);
    if (cycle.status === 'closed') return cycle;
    this.db
      .prepare(`UPDATE activity_peer_review_cycles SET status = 'closed', closed_at = ? WHERE id = ?`)
      .run(Date.now(), cycleId);
    return this.getCycle(cycleId);
  }

  listAssignmentsForStudent(
    studentId: string,
    opts: { lessonId?: string; cycleId?: string } = {},
  ): PeerReviewAssignmentView[] {
    const clauses = ['a.reviewer_student_id = ?'];
    const params: unknown[] = [studentId];
    if (opts.cycleId) {
      clauses.push('a.cycle_id = ?');
      params.push(opts.cycleId);
    }
    if (opts.lessonId) {
      clauses.push('la.lesson_id = ?');
      params.push(opts.lessonId);
    }
    const rows = this.db
      .prepare(
        `SELECT a.*, la.title AS activity_title, la.lesson_id, s.name AS reviewee_name
           FROM activity_peer_review_assignments a
           JOIN lesson_activities la ON la.id = a.activity_id
           LEFT JOIN students s ON s.id = a.reviewee_student_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY a.created_at DESC`,
      )
      .all(...params) as AssignmentRow[];
    return rows.map((row) => this.toAssignmentView(row, { forStudent: true, viewerId: studentId }));
  }

  listAssignmentsForTeacher(cycleId: string): PeerReviewAssignmentView[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, la.title AS activity_title, la.lesson_id,
                reviewer.name AS reviewer_name, reviewee.name AS reviewee_name
           FROM activity_peer_review_assignments a
           JOIN lesson_activities la ON la.id = a.activity_id
           LEFT JOIN students reviewer ON reviewer.id = a.reviewer_student_id
           LEFT JOIN students reviewee ON reviewee.id = a.reviewee_student_id
          WHERE a.cycle_id = ?
          ORDER BY la.lesson_id, a.created_at`,
      )
      .all(cycleId) as AssignmentRow[];
    return rows.map((row) => this.toAssignmentView(row, { forStudent: false }));
  }

  submitReview(
    assignmentId: string,
    reviewerStudentId: string,
    input: { scores: Record<string, number>; comment?: string },
  ): PeerReviewRecord {
    const assignment = this.requireAssignment(assignmentId);
    if (assignment.reviewer_student_id !== reviewerStudentId) {
      throw new LessonActivityError(403, '只能提交分配给自己的互评');
    }
    if (assignment.reviewer_student_id === assignment.reviewee_student_id) {
      throw new LessonActivityError(400, '不能评价自己的作品');
    }
    const cycle = this.getCycle(assignment.cycle_id);
    if (cycle.status !== 'open') {
      throw new LessonActivityError(409, '该互评轮次已结束');
    }
    const existing = this.db
      .prepare('SELECT id, status FROM activity_peer_reviews WHERE assignment_id = ?')
      .get(assignmentId) as { id: string; status: string } | undefined;
    if (existing && (existing.status === 'teacher_confirmed' || existing.status === 'teacher_overridden')) {
      throw new LessonActivityError(409, '教师已复核，不能再修改互评');
    }

    const scores = this.normalizeScores(cycle.rubric, input.scores);
    const comment = sanitizeUgcText(input.comment ?? '', 2000);
    const now = Date.now();
    const tx = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            `UPDATE activity_peer_reviews
                SET scores_json = ?, comment = ?, status = 'submitted', updated_at = ?
              WHERE id = ?`,
          )
          .run(JSON.stringify(scores), comment, now, existing.id);
      } else {
        this.db
          .prepare(
            `INSERT INTO activity_peer_reviews (
               id, assignment_id, cycle_id, activity_id, reviewer_student_id, reviewee_student_id,
               anonymous, scores_json, comment, status, teacher_feedback, teacher_id, reviewed_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', NULL, NULL, NULL, ?, ?)`,
          )
          .run(
            randomId('prv_'),
            assignmentId,
            assignment.cycle_id,
            assignment.activity_id,
            assignment.reviewer_student_id,
            assignment.reviewee_student_id,
            assignment.anonymous,
            JSON.stringify(scores),
            comment,
            now,
            now,
          );
      }
      this.db
        .prepare(`UPDATE activity_peer_review_assignments SET status = 'submitted' WHERE id = ?`)
        .run(assignmentId);
    });
    tx();
    return this.requireReviewByAssignment(assignmentId);
  }

  teacherReview(
    reviewId: string,
    teacherId: string,
    action: 'confirm' | 'override' | 'reject',
    input: { scores?: Record<string, number>; teacherFeedback?: string } = {},
  ): PeerReviewRecord {
    const current = this.requireReview(reviewId);
    const cycle = this.getCycle(current.cycleId);
    const now = Date.now();
    const feedback = sanitizeUgcText(input.teacherFeedback ?? '', 2000);
    let status: PeerReviewRecord['status'] = 'teacher_confirmed';
    let scores = current.scores;
    if (action === 'override') {
      status = 'teacher_overridden';
      scores = this.normalizeScores(cycle.rubric, input.scores ?? current.scores);
    } else if (action === 'reject') {
      status = 'rejected';
    }
    this.db
      .prepare(
        `UPDATE activity_peer_reviews
            SET scores_json = ?, status = ?, teacher_feedback = ?, teacher_id = ?, reviewed_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(JSON.stringify(scores), status, feedback || null, teacherId, now, now, reviewId);
    if (action === 'reject') {
      this.db
        .prepare(`UPDATE activity_peer_review_assignments SET status = 'rejected' WHERE id = ?`)
        .run(current.assignmentId);
    }
    return this.requireReview(reviewId);
  }

  reportReview(reviewId: string, reporterStudentId: string, reason: string): { id: string; status: string } {
    const review = this.requireReview(reviewId);
    if (review.reviewerStudentId !== reporterStudentId && review.revieweeStudentId !== reporterStudentId) {
      throw new LessonActivityError(403, '只能举报与自己相关的互评');
    }
    const cleaned = sanitizeUgcText(reason, 1000);
    if (!cleaned) throw new LessonActivityError(400, '请填写举报原因');
    const id = randomId('prp_');
    try {
      this.db
        .prepare(
          `INSERT INTO activity_peer_review_reports (id, review_id, reporter_student_id, reason, status, created_at)
           VALUES (?, ?, ?, ?, 'open', ?)`,
        )
        .run(id, reviewId, reporterStudentId, cleaned, Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (/UNIQUE/i.test(message)) {
        throw new LessonActivityError(409, '已经举报过这条互评');
      }
      throw err;
    }
    return { id, status: 'open' };
  }

  resolveReport(reportId: string, status: 'dismissed' | 'upheld'): void {
    const row = this.db.prepare('SELECT id FROM activity_peer_review_reports WHERE id = ?').get(reportId) as
      { id: string } | undefined;
    if (!row) throw new LessonActivityError(404, '举报不存在');
    this.db.prepare('UPDATE activity_peer_review_reports SET status = ? WHERE id = ?').run(status, reportId);
  }

  listOpenReports(cycleId?: string): Array<Record<string, unknown>> {
    const sql = cycleId
      ? `SELECT r.*, prv.cycle_id, prv.activity_id
           FROM activity_peer_review_reports r
           JOIN activity_peer_reviews prv ON prv.id = r.review_id
          WHERE r.status = 'open' AND prv.cycle_id = ?
          ORDER BY r.created_at DESC`
      : `SELECT r.*, prv.cycle_id, prv.activity_id
           FROM activity_peer_review_reports r
           JOIN activity_peer_reviews prv ON prv.id = r.review_id
          WHERE r.status = 'open'
          ORDER BY r.created_at DESC`;
    return cycleId
      ? (this.db.prepare(sql).all(cycleId) as Array<Record<string, unknown>>)
      : (this.db.prepare(sql).all() as Array<Record<string, unknown>>);
  }

  cycleBelongsToLesson(cycleId: string, lessonId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok
           FROM activity_peer_review_cycles c
           LEFT JOIN activity_peer_review_assignments a ON a.cycle_id = c.id
           LEFT JOIN lesson_activities la ON la.id = a.activity_id
          WHERE c.id = ? AND (c.lesson_id = ? OR la.lesson_id = ?)
          LIMIT 1`,
      )
      .get(cycleId, lessonId, lessonId) as { ok: number } | undefined;
    return !!row;
  }

  assignmentLessonId(assignmentId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT la.lesson_id
           FROM activity_peer_review_assignments a
           JOIN lesson_activities la ON la.id = a.activity_id
          WHERE a.id = ?`,
      )
      .get(assignmentId) as { lesson_id: string } | undefined;
    return row?.lesson_id ?? null;
  }

  reviewLessonId(reviewId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT la.lesson_id
           FROM activity_peer_reviews r
           JOIN lesson_activities la ON la.id = r.activity_id
          WHERE r.id = ?`,
      )
      .get(reviewId) as { lesson_id: string } | undefined;
    return row?.lesson_id ?? null;
  }

  private listSubmittedStudentIds(activityId: string): string[] {
    const fromProgress = this.db
      .prepare(
        `SELECT student_id FROM activity_progress
          WHERE activity_id = ? AND status IN ('submitted', 'graded')`,
      )
      .all(activityId) as Array<{ student_id: string }>;
    const ids = new Set(fromProgress.map((row) => row.student_id));
    // 回退：若尚未写入进度表，尝试从关联提交系统对齐一次
    if (ids.size === 0) {
      const activityService = new LessonActivityService(this.db);
      const activity = activityService.getActivity(activityId);
      const roster = listStudentsForLesson(this.db, activity.lessonId);
      for (const student of roster) {
        const synced = activityService.reconcileStudentActivity(activity, student.id);
        if (synced.status === 'submitted' || synced.status === 'graded') ids.add(student.id);
      }
    }
    return Array.from(ids);
  }

  private requireAssignment(assignmentId: string): AssignmentRow {
    const row = this.db.prepare('SELECT * FROM activity_peer_review_assignments WHERE id = ?').get(assignmentId) as
      AssignmentRow | undefined;
    if (!row) throw new LessonActivityError(404, '互评任务不存在');
    return row;
  }

  private requireReview(reviewId: string): PeerReviewRecord {
    const row = this.db.prepare('SELECT * FROM activity_peer_reviews WHERE id = ?').get(reviewId) as
      Record<string, unknown> | undefined;
    if (!row) throw new LessonActivityError(404, '互评不存在');
    return this.mapReview(row, false);
  }

  private requireReviewByAssignment(assignmentId: string): PeerReviewRecord {
    const row = this.db.prepare('SELECT * FROM activity_peer_reviews WHERE assignment_id = ?').get(assignmentId) as
      Record<string, unknown> | undefined;
    if (!row) throw new LessonActivityError(404, '互评不存在');
    return this.mapReview(row, false);
  }

  private normalizeScores(rubric: RubricDimension[], scores: Record<string, number>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const dim of rubric) {
      const raw = Number((scores || {})[dim.id]);
      if (!Number.isFinite(raw)) {
        throw new LessonActivityError(400, `请为「${dim.label}」打分`);
      }
      result[dim.id] = Math.min(dim.maxScore, Math.max(0, raw));
    }
    return result;
  }

  private mapCycle(row: Record<string, unknown>): PeerReviewCycleRecord {
    return {
      id: String(row.id),
      courseId: (row.course_id as string | null) ?? null,
      lessonId: (row.lesson_id as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      anonymous: Number(row.anonymous) === 1,
      reviewsPerStudent: Number(row.reviews_per_student) || 2,
      rubric: parseRubric(parseRubricJson(row.rubric_json)),
      status: row.status === 'closed' ? 'closed' : 'open',
      createdBy: String(row.created_by),
      createdAt: Number(row.created_at),
      closedAt: row.closed_at == null ? null : Number(row.closed_at),
    };
  }

  private toAssignmentView(
    row: AssignmentRow,
    opts: { forStudent: boolean; viewerId?: string },
  ): PeerReviewAssignmentView {
    const reviewRow = this.db.prepare('SELECT * FROM activity_peer_reviews WHERE assignment_id = ?').get(row.id) as
      Record<string, unknown> | undefined;
    const review = reviewRow ? this.mapReview(reviewRow, opts.forStudent) : null;
    const hideNames = opts.forStudent && row.anonymous === 1;
    return {
      id: row.id,
      cycleId: row.cycle_id,
      activityId: row.activity_id,
      activityTitle: row.activity_title || '',
      lessonId: row.lesson_id || '',
      anonymous: row.anonymous === 1,
      status: row.status as PeerReviewAssignmentView['status'],
      dueAt: row.due_at,
      reviewerStudentId: hideNames ? undefined : row.reviewer_student_id,
      revieweeStudentId: hideNames ? undefined : row.reviewee_student_id,
      reviewerName: hideNames ? null : row.reviewer_name,
      revieweeName: hideNames ? null : row.reviewee_name,
      review,
    };
  }

  private mapReview(row: Record<string, unknown>, forStudent: boolean): PeerReviewRecord {
    const anonymous = Number(row.anonymous) === 1;
    const hide = forStudent && anonymous;
    return {
      id: String(row.id),
      assignmentId: String(row.assignment_id),
      cycleId: String(row.cycle_id),
      activityId: String(row.activity_id),
      scores: parseJsonObject(String(row.scores_json || '{}')) as Record<string, number>,
      comment: String(row.comment || ''),
      status: row.status as PeerReviewRecord['status'],
      teacherFeedback: (row.teacher_feedback as string | null) ?? null,
      teacherId: hide ? null : ((row.teacher_id as string | null) ?? null),
      reviewedAt: row.reviewed_at == null ? null : Number(row.reviewed_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      anonymous,
      reviewerStudentId: hide ? undefined : String(row.reviewer_student_id),
      revieweeStudentId: hide ? undefined : String(row.reviewee_student_id),
    };
  }
}
