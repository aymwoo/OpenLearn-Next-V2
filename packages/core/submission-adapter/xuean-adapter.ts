/**
 * 学案 SubmissionAdapter：把 activity_progress 投影为统一成绩面板视图。
 * 真值仍在 activity_progress；本适配器只读投影，不另建存储。
 * 门禁仍由 lesson-engine 裁决 —— 本适配器不写 gate / 不放行环节。
 */
import type {
  NormalizedSubmission,
  SubmissionAdapter,
  SubmissionFilter,
  SubmissionStatus,
  GradeWriteInputView,
} from './types.js';

/** 最小 DB 面：只需 prepare().all()（兼容 better-sqlite3 Statement 泛型） */
export type XueanAdapterDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare: (sql: string) => { all: (...params: any[]) => any[] };
};

export const XUEAN_SUBMISSION_ADAPTER_ID = 'xuean-adapter';

type ProgressRow = {
  activity_id: string;
  student_id: string;
  lesson_id: string;
  activity_title: string;
  activity_type: string;
  status: string;
  progress_percent: number;
  score: number | null;
  verified: number;
  last_activity_at: number | null;
  submission_json: string | null;
};

function mapStatus(raw: string): SubmissionStatus {
  switch (raw) {
    case 'in_progress':
      return 'started';
    case 'submitted':
      return 'submitted';
    case 'graded':
      return 'graded';
    case 'not_started':
      return 'draft';
    default:
      return 'draft';
  }
}

function rowToSubmission(row: ProgressRow): NormalizedSubmission {
  const externalId = `${row.activity_id}:${row.student_id}`;
  return {
    id: `${XUEAN_SUBMISSION_ADAPTER_ID}:${externalId}`,
    source: {
      pluginId: '@openlearn/plugin-classroom-flow-server',
      adapterId: XUEAN_SUBMISSION_ADAPTER_ID,
      externalId,
      modeId: 'xuean',
    },
    lessonId: row.lesson_id,
    classId: '',
    studentId: row.student_id,
    kind: row.activity_type === 'quiz' ? 'quiz' : 'artifact',
    status: mapStatus(row.status),
    submittedAt: row.last_activity_at,
    score: row.score,
    completion: Math.max(0, Math.min(1, (row.progress_percent ?? 0) / 100)),
    rawRef: `activity_progress:${row.activity_id}:${row.student_id}`,
    visibility: 'teacher',
  };
}

/** 创建只读投影适配器（需注入平台 SQLite） */
export function createXueanSubmissionAdapter(db: XueanAdapterDb): SubmissionAdapter {
  return {
    descriptor: {
      id: XUEAN_SUBMISSION_ADAPTER_ID,
      owner: '@openlearn/plugin-classroom-flow-server',
      kinds: ['artifact', 'quiz'],
      modeIds: ['xuean'],
      label: '学案活动进度',
    },
    listSubmissions(filter: SubmissionFilter): NormalizedSubmission[] {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter.lessonId) {
        clauses.push('la.lesson_id = ?');
        params.push(filter.lessonId);
      }
      if (filter.studentId) {
        clauses.push('ap.student_id = ?');
        params.push(filter.studentId);
      }
      // activity_progress 无 class_id 列：班级过滤由 HTTP 层鉴权保证，此处不二次收窄。
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = typeof filter.limit === 'number' && filter.limit > 0 ? Math.min(filter.limit, 500) : 200;
      const sql = `
        SELECT ap.activity_id, ap.student_id, ap.status, ap.progress_percent, ap.score, ap.verified,
               ap.last_activity_at, ap.submission_json,
               la.lesson_id, la.title AS activity_title, la.type AS activity_type
        FROM activity_progress ap
        JOIN lesson_activities la ON la.id = ap.activity_id
        ${where}
        ORDER BY (ap.last_activity_at IS NULL), ap.last_activity_at DESC
        LIMIT ?
      `;
      try {
        const rows = db.prepare(sql).all(...params, limit) as ProgressRow[];
        return rows.map(rowToSubmission);
      } catch {
        // 表尚未迁移或库不可用时返回空，不炸面板
        return [];
      }
    },
    toGradeInput(sub: NormalizedSubmission): GradeWriteInputView | null {
      if (sub.score === null || sub.score === undefined) return null;
      // 学案活动无独立 assignment 行：用 activity 外键作 assignmentId 占位，source=plugin
      const activityId = sub.source.externalId.split(':')[0];
      if (!activityId) return null;
      return {
        assignmentId: `xuean-activity:${activityId}`,
        studentId: sub.studentId,
        score: sub.score,
        status: sub.status === 'graded' ? 'graded' : 'submitted',
        source: 'plugin',
        reason: 'xuean-adapter',
      };
    },
  };
}
