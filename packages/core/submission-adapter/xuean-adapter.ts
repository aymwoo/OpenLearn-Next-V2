/**
 * 学案 SubmissionAdapter：把 activity_progress 投影为统一成绩面板视图。
 * 投影本身只读；只有教师经统一面板写回成绩时，才补建 `xuean-activity:*`
 * 的 assignment 壳行（让成绩能进平台成绩册），并把分数回写 activity_progress。
 * 门禁仍由 lesson-engine 裁决 —— 本适配器不写 gate / 不放行环节。
 */
import type {
  NormalizedSubmission,
  SubmissionAdapter,
  SubmissionFilter,
  SubmissionStatus,
  GradeWriteInputView,
} from './types.js';

/** 最小 DB 面：读投影用 all()，补建作业壳/回写得用 get()/run()（better-sqlite3 均支持） */
export type XueanAdapterDb = {
  prepare: (sql: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    all: (...params: any[]) => any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get?: (...params: any[]) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run?: (...params: any[]) => any;
  };
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

function rowToSubmission(row: ProgressRow, classId: string): NormalizedSubmission {
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
    classId,
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

/** 课节 → 班级：课堂会话优先，其次课表/作业绑定。表缺失时返回 null（无映射信息）。 */
const LESSON_CLASS_IDS_SQL = `
  SELECT class_id FROM classroom_sessions WHERE lesson_id = ? AND class_id IS NOT NULL
  UNION
  SELECT class_id FROM schedules WHERE lesson_id = ? AND class_id IS NOT NULL
  UNION
  SELECT class_id FROM assignments WHERE lesson_id = ? AND class_id IS NOT NULL
`;

/** 班级 → 课节（仅 classId 过滤时用）。表缺失时返回 null。 */
const CLASS_LESSON_IDS_SQL = `
  SELECT lesson_id FROM classroom_sessions WHERE class_id = ? AND lesson_id IS NOT NULL
  UNION
  SELECT lesson_id FROM schedules WHERE class_id = ? AND lesson_id IS NOT NULL
  UNION
  SELECT lesson_id FROM assignments WHERE class_id = ? AND lesson_id IS NOT NULL
`;

function queryStrings(db: XueanAdapterDb, sql: string, args: unknown[], column: string): string[] | null {
  try {
    const rows = db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
    return [...new Set(rows.map((r) => r[column]).filter((v): v is string => typeof v === 'string' && v.length > 0))];
  } catch {
    // 表尚未迁移 / 简化库：无法判定归属，交给调用方决定是否 fail closed
    return null;
  }
}

/**
 * 解析一条提交的班级归属。
 *
 * activity_progress 本身没有 class_id，但聚合器会按 filter.classId 二次收窄，
 * 所以适配器必须给出真实 classId，不能留空串（否则按班级查询时会整批被过滤掉）。
 * requestedClassId 已经过 HTTP 层鉴权，这里只做交叉校验：
 * - 课节能反查到班级且与 requested 不一致 → 拒绝（防止用 A 班授权读 B 班数据）；
 * - 课节无班级绑定 → 沿用 requested（开放课节按请求班级归属）；
 * - 无法查询映射表 → 沿用 requested（不因缺表阻断面板）。
 */
function resolveClassId(
  db: XueanAdapterDb,
  lessonId: string | undefined,
  requestedClassId: string | undefined,
): { ok: true; classId: string } | { ok: false } {
  const requested = requestedClassId ?? '';
  if (!lessonId) return { ok: true, classId: requested };
  const linked = queryStrings(db, LESSON_CLASS_IDS_SQL, [lessonId, lessonId, lessonId], 'class_id');
  if (linked === null || linked.length === 0) return { ok: true, classId: requested };
  if (requested) return linked.includes(requested) ? { ok: true, classId: requested } : { ok: false };
  // 未指定班级时，只有唯一归属才能可靠落库；多班共用课节留空，等前端带 classId 再查。
  return { ok: true, classId: linked.length === 1 ? linked[0] : '' };
}

/** 确保成绩册里有对应的作业壳行：没有 assignment，grade-writer 会直接拒绝写分。 */
function ensureAssignmentShell(
  db: XueanAdapterDb,
  args: { assignmentId: string; activityId: string; classId: string; lessonId: string | null },
): boolean {
  try {
    const lookup = db.prepare('SELECT id FROM assignments WHERE id = ?');
    if (!lookup.get) return false;
    if (lookup.get(args.assignmentId)) return true;

    let title = `学案活动 ${args.activityId}`;
    try {
      const activity = db.prepare('SELECT title FROM lesson_activities WHERE id = ?').get?.(args.activityId) as
        { title?: string | null } | undefined;
      if (activity?.title) title = `学案活动：${activity.title}`;
    } catch {
      // 标题只是展示信息，查不到就用兜底
    }

    const insert = db.prepare(
      `INSERT OR IGNORE INTO assignments (id, class_id, lesson_id, title, description, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    if (!insert.run) return false;
    insert.run(
      args.assignmentId,
      args.classId,
      args.lessonId,
      title,
      null,
      JSON.stringify({ adapter: XUEAN_SUBMISSION_ADAPTER_ID, activityId: args.activityId }),
      Date.now(),
    );
    return true;
  } catch {
    return false;
  }
}

function activityIdOf(sub: NormalizedSubmission): string {
  return sub.source.externalId.split(':')[0];
}

/** 创建投影适配器（需注入平台 SQLite） */
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
      let effectiveClassId = filter.classId ?? '';

      if (filter.lessonId) {
        const resolved = resolveClassId(db, filter.lessonId, filter.classId);
        if (!resolved.ok) return [];
        effectiveClassId = resolved.classId;
        clauses.push('la.lesson_id = ?');
        params.push(filter.lessonId);
      } else if (filter.classId) {
        // 只给了班级：先反查该班课节，避免把其它班的行也标成这个班。
        const lessonIds = queryStrings(
          db,
          CLASS_LESSON_IDS_SQL,
          [filter.classId, filter.classId, filter.classId],
          'lesson_id',
        );
        if (lessonIds === null || lessonIds.length === 0) return [];
        clauses.push(`la.lesson_id IN (${lessonIds.map(() => '?').join(',')})`);
        params.push(...lessonIds);
      }

      if (filter.studentId) {
        clauses.push('ap.student_id = ?');
        params.push(filter.studentId);
      }

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
        return rows.map((row) => rowToSubmission(row, effectiveClassId));
      } catch {
        // 表尚未迁移或库不可用时返回空，不炸面板
        return [];
      }
    },
    toGradeInput(sub: NormalizedSubmission): GradeWriteInputView | null {
      const activityId = activityIdOf(sub);
      if (!activityId || !sub.classId) return null;
      const assignmentId = `xuean-activity:${activityId}`;
      // 学案活动没有独立 assignment 行；首次写分时补一个壳行，成绩才能进入平台成绩册。
      if (!ensureAssignmentShell(db, { assignmentId, activityId, classId: sub.classId, lessonId: sub.lessonId })) {
        return null;
      }
      // 未出分的提交同样允许教师打分：分数以本次 grade 请求为准。
      return {
        assignmentId,
        studentId: sub.studentId,
        score: sub.score ?? null,
        status: sub.status === 'graded' ? 'graded' : 'submitted',
        source: 'plugin',
        reason: 'xuean-adapter',
      };
    },
    afterGrade(sub: NormalizedSubmission, grade: { score: number | null }): void {
      const activityId = activityIdOf(sub);
      if (!activityId) return;
      try {
        db.prepare('UPDATE activity_progress SET score = ?, status = ? WHERE activity_id = ? AND student_id = ?').run?.(
          grade.score,
          grade.score === null ? 'submitted' : 'graded',
          activityId,
          sub.studentId,
        );
      } catch {
        // 回写失败不影响已写入的成绩册记录
      }
    },
  };
}
