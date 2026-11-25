/**
 * 测评只读服务（P0，`assessment:read`）。
 *
 * 设计约束与 `XueanActivityProgressService` 同构：
 * - 身份由 `currentLessonViewer()` 派生，插件不能自报 userId/role；
 * - 只读、无副作用（不清算过期作答、不写审计表）；
 * - 返回值全部白名单投影，`answerKey` / `answer_key_json` / 逐生作答永不出现。
 *
 * 权限：
 * - 教师 / 管理员：自己名下（管理员为全部）的试卷与发布记录；
 * - 学生：所在班级的已发布/已关闭试卷，以及**自己**的作答摘要；
 * - 题库只对教师开放，学生恒为空。
 */
import type { Database } from 'better-sqlite3';
import type {
  AssessmentAssignmentBrief,
  AssessmentAttemptBrief,
  AssessmentBankItemBrief,
  AssessmentBrief,
  AssessmentStatsItemView,
  AssessmentStatsView,
  IAssessmentReadService,
} from './interfaces.js';
import { normalizeViewerRole, currentLessonViewer, studentIdFromViewer } from './lesson-viewer.js';
import { roundScore } from '../assessment/index.js';

/**
 * 允许输出「作答值分布」的题型白名单。
 *
 * 只包含取值空间有限的客观题；填空/简答/作文与未知插件题型的作答都是自由文本，
 * 不能作为分布键（否则等于把逐生作答原文交给插件）。
 */
const DISTRIBUTABLE_QUESTION_TYPES = new Set(['single_choice', 'multiple_choice', 'true_false']);

interface AssessmentRow {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  owner_id: string;
  status: string;
  academic_year: string | null;
  created_at: number;
  updated_at: number;
  item_count: number | null;
  total_score: number | null;
}

interface AssignmentRow {
  id: string;
  assessment_id: string;
  class_id: string;
  lesson_id: string | null;
  opens_at: number | null;
  closes_at: number | null;
  duration_sec: number | null;
  status: string;
  score_released: number;
  created_at: number;
}

interface AttemptRow {
  id: string;
  assignment_id: string;
  attempt_no: number;
  status: string;
  submitted_at: number | null;
  score: number | null;
  max_score: number | null;
  needs_manual_review: number;
  student_id: string | null;
  deadline_at: number | null;
}

interface ItemRow {
  id: string;
  type: string;
  stem: string;
  max_score: number;
  sort_order: number;
}

interface AnswerRow {
  item_id: string;
  answer_json: string | null;
  score: number | null;
  is_correct: number | null;
}

const BRIEF_COLUMNS = `
  a.id, a.kind, a.title, a.description, a.owner_id, a.status, a.academic_year,
  a.created_at, a.updated_at,
  (SELECT COUNT(*) FROM assessment_items i WHERE i.assessment_id = a.id) AS item_count,
  (SELECT COALESCE(SUM(i.max_score), 0) FROM assessment_items i WHERE i.assessment_id = a.id) AS total_score
`;

function toBrief(row: AssessmentRow): AssessmentBrief {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    status: row.status,
    itemCount: Number(row.item_count ?? 0),
    totalScore: roundScore(Number(row.total_score ?? 0)),
    academicYear: row.academic_year,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toAssignmentBrief(row: AssignmentRow): AssessmentAssignmentBrief {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    classId: row.class_id,
    lessonId: row.lesson_id,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    durationSec: row.duration_sec,
    status: row.status,
    scoreReleased: row.score_released === 1,
    createdAt: Number(row.created_at),
  };
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class AssessmentReadService implements IAssessmentReadService {
  constructor(private readonly db: Database) {}

  private role(): 'teacher' | 'administrator' | 'student' | 'anonymous' {
    return normalizeViewerRole(currentLessonViewer()) as 'teacher' | 'administrator' | 'student' | 'anonymous';
  }

  private userId(): string | null {
    const viewer = currentLessonViewer();
    return viewer?.userId && viewer.userId.length > 0 ? viewer.userId : null;
  }

  private studentId(): string | null {
    return studentIdFromViewer(currentLessonViewer());
  }

  private studentClassIds(): string[] {
    const studentId = this.studentId();
    if (!studentId) return [];
    return (
      this.db.prepare('SELECT class_id FROM class_students WHERE student_id = ?').all(studentId) as Array<{
        class_id: string;
      }>
    ).map((row) => row.class_id);
  }

  async listAssessments(filter: { kind?: string; status?: string } = {}): Promise<AssessmentBrief[]> {
    const role = this.role();
    const params: unknown[] = [];
    const where: string[] = [];
    let join = '';
    if (role === 'student') {
      const classIds = this.studentClassIds();
      if (classIds.length === 0) return [];
      join =
        'JOIN assessment_assignments aa ON aa.assessment_id = a.id ' +
        'JOIN class_students cs ON cs.class_id = aa.class_id AND cs.student_id = ?';
      params.push(this.studentId());
      where.push("a.status IN ('published','closed')");
    } else if (role === 'teacher' || role === 'administrator') {
      if (role === 'teacher') {
        const userId = this.userId();
        if (!userId) return [];
        where.push('a.owner_id = ?');
        params.push(userId);
      }
    } else {
      return [];
    }
    if (filter.kind) {
      where.push('a.kind = ?');
      params.push(filter.kind);
    }
    if (filter.status) {
      where.push('a.status = ?');
      params.push(filter.status);
    }
    const sql =
      `SELECT DISTINCT ${BRIEF_COLUMNS} FROM assessments a ${join}` +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY a.updated_at DESC LIMIT 200';
    const rows = this.db.prepare(sql).all(...params) as AssessmentRow[];
    return rows.map(toBrief);
  }

  async getAssessmentBrief(assessmentId: string): Promise<AssessmentBrief | null> {
    const id = typeof assessmentId === 'string' ? assessmentId.trim() : '';
    if (!id) return null;
    const row = this.db.prepare(`SELECT ${BRIEF_COLUMNS} FROM assessments a WHERE a.id = ?`).get(id) as
      AssessmentRow | undefined;
    if (!row) return null;

    const role = this.role();
    if (role === 'student') {
      const classIds = this.studentClassIds();
      if (classIds.length === 0 || !['published', 'closed'].includes(row.status)) return null;
      const hit = this.db
        .prepare(
          `SELECT 1 AS hit FROM assessment_assignments aa
            JOIN class_students cs ON cs.class_id = aa.class_id AND cs.student_id = ?
           WHERE aa.assessment_id = ? LIMIT 1`,
        )
        .get(this.studentId(), id);
      return hit ? toBrief(row) : null;
    }
    if (role === 'administrator') return toBrief(row);
    if (role === 'teacher' && this.userId() && row.owner_id === this.userId()) return toBrief(row);
    return null;
  }

  async listAssignments(assessmentId: string): Promise<AssessmentAssignmentBrief[]> {
    const id = typeof assessmentId === 'string' ? assessmentId.trim() : '';
    if (!id) return [];
    const brief = await this.getAssessmentBrief(id);
    if (!brief) return [];

    const role = this.role();
    const params: unknown[] = [id];
    let extra = '';
    if (role === 'student') {
      const classIds = this.studentClassIds();
      if (classIds.length === 0) return [];
      extra = ` AND aa.class_id IN (${classIds.map(() => '?').join(',')})`;
      params.push(...classIds);
    }
    const rows = this.db
      .prepare(
        `SELECT aa.* FROM assessment_assignments aa
          WHERE aa.assessment_id = ?${extra}
          ORDER BY aa.created_at DESC`,
      )
      .all(...params) as AssignmentRow[];
    return rows.map(toAssignmentBrief);
  }

  async getAssignmentStats(assignmentId: string): Promise<AssessmentStatsView | null> {
    const role = this.role();
    if (role !== 'teacher' && role !== 'administrator') return null;
    const id = typeof assignmentId === 'string' ? assignmentId.trim() : '';
    if (!id) return null;

    const assignment = this.db.prepare('SELECT * FROM assessment_assignments WHERE id = ?').get(id) as
      AssignmentRow | undefined;
    if (!assignment) return null;
    const assessment = this.db.prepare('SELECT * FROM assessments WHERE id = ?').get(assignment.assessment_id) as
      AssessmentRow | undefined;
    if (!assessment) return null;
    if (role === 'teacher' && assessment.owner_id !== this.userId()) return null;

    const now = Date.now();
    const attempts = this.db
      .prepare(
        `SELECT id, assignment_id, attempt_no, status, submitted_at, score, max_score,
                needs_manual_review, student_id, deadline_at
           FROM assessment_attempts WHERE assignment_id = ?`,
      )
      .all(id) as AttemptRow[];
    const submitted = attempts.filter(
      (row) => row.status !== 'in_progress' || (row.deadline_at !== null && row.deadline_at < now),
    );
    const scored = submitted.filter((row) => typeof row.score === 'number');

    const items = this.db
      .prepare(
        'SELECT id, type, stem, max_score, sort_order FROM assessment_items WHERE assessment_id = ? ORDER BY sort_order ASC',
      )
      .all(assignment.assessment_id) as ItemRow[];
    const answers = this.db
      .prepare(
        `SELECT ans.item_id, ans.answer_json, ans.score, ans.is_correct
           FROM assessment_answers ans
           JOIN assessment_attempts t ON t.id = ans.attempt_id
          WHERE t.assignment_id = ?`,
      )
      .all(id) as AnswerRow[];

    const byItem = new Map<string, AnswerRow[]>();
    for (const answer of answers) {
      const list = byItem.get(answer.item_id) ?? [];
      list.push(answer);
      byItem.set(answer.item_id, list);
    }

    const itemStats: AssessmentStatsItemView[] = items.map((item) => {
      const rows = byItem.get(item.id) ?? [];
      const graded = rows.filter((row) => typeof row.score === 'number');
      const correct = rows.filter((row) => row.is_correct === 1);
      // 只有「有限选项」题型才能安全地按作答值聚合：填空题/简答题的 answer_json
      // 是自由文本，用它做分布键等于把逐生作答原文交给插件（且键数量随作答膨胀）。
      // 未知插件题型一律按主观题处理，省略分布。
      const distribution: Record<string, number> = {};
      if (DISTRIBUTABLE_QUESTION_TYPES.has(item.type)) {
        for (const row of rows) {
          const parsed = parseJson(row.answer_json);
          const key = Array.isArray(parsed) ? parsed.join(',') : String(parsed);
          distribution[key] = (distribution[key] ?? 0) + 1;
        }
      }
      return {
        itemId: item.id,
        type: item.type,
        stem: item.stem,
        maxScore: Number(item.max_score),
        answered: rows.length,
        graded: graded.length,
        correct: correct.length,
        correctRate: graded.length > 0 ? roundScore((correct.length / graded.length) * 100) : null,
        avgScore:
          graded.length > 0
            ? roundScore(graded.reduce((sum, row) => sum + Number(row.score), 0) / graded.length)
            : null,
        distribution,
      };
    });

    const maxScore = items.reduce((sum, item) => sum + Number(item.max_score), 0);
    const averageScore =
      scored.length > 0 ? roundScore(scored.reduce((sum, row) => sum + Number(row.score), 0) / scored.length) : null;
    const averagePercent = averageScore !== null && maxScore > 0 ? roundScore((averageScore / maxScore) * 100) : null;

    return {
      assignmentId: id,
      assessmentId: assignment.assessment_id,
      attemptCount: attempts.length,
      submittedCount: submitted.length,
      gradedCount: scored.length,
      needsManualReviewCount: submitted.filter((row) => row.needs_manual_review === 1).length,
      averageScore,
      averagePercent,
      maxScore: roundScore(maxScore),
      items: itemStats,
    };
  }

  async listBankItems(filter: { type?: string } = {}): Promise<AssessmentBankItemBrief[]> {
    const role = this.role();
    if (role !== 'teacher' && role !== 'administrator') return [];
    const userId = this.userId();
    if (!userId) return [];
    const params: unknown[] = [userId];
    let sql =
      'SELECT id, owner_id, type, stem, tags_json, difficulty, visibility, created_at, updated_at ' +
      "FROM question_bank_items WHERE (owner_id = ? OR visibility = 'school')";
    if (filter.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }
    sql += ' ORDER BY updated_at DESC LIMIT 500';
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      owner_id: string;
      type: string;
      stem: string;
      tags_json: string | null;
      difficulty: number | null;
      visibility: string;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      stem: row.stem,
      tags: parseStringArray(row.tags_json),
      difficulty: row.difficulty === null ? null : Number(row.difficulty),
      visibility: row.visibility === 'school' ? 'school' : 'private',
      ownerIsSelf: row.owner_id === userId,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  async getAttemptSummary(attemptId: string): Promise<AssessmentAttemptBrief | null> {
    const id = typeof attemptId === 'string' ? attemptId.trim() : '';
    if (!id) return null;
    const row = this.db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(id) as AttemptRow | undefined;
    if (!row) return null;

    const role = this.role();
    if (role === 'student') {
      const studentId = this.studentId();
      if (!studentId || row.student_id !== studentId) return null;
    } else if (role === 'teacher') {
      const assignment = this.db
        .prepare('SELECT assessment_id FROM assessment_assignments WHERE id = ?')
        .get(row.assignment_id) as { assessment_id: string } | undefined;
      if (!assignment) return null;
      const owner = this.db.prepare('SELECT owner_id FROM assessments WHERE id = ?').get(assignment.assessment_id) as
        { owner_id: string } | undefined;
      if (!owner || owner.owner_id !== this.userId()) return null;
    } else if (role !== 'administrator') {
      return null;
    }

    return {
      attemptId: row.id,
      assignmentId: row.assignment_id,
      attemptNo: Number(row.attempt_no),
      status: row.status,
      submittedAt: row.submitted_at,
      score: row.score,
      maxScore: row.max_score,
      needsManualReview: row.needs_manual_review === 1,
    };
  }
}

function parseStringArray(raw: string | null): string[] {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
}
