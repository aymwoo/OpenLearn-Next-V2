/**
 * 班级 / 作业 / 成绩的对象级授权。
 *
 * - 管理员：沿用既有设计，可访问全部班级。
 * - 教师：仅可访问 owner_user_id 指向自己的班级。owner 为空的历史班级不向全体教师开放。
 * - 学生：仅可访问 class_students 中的班级，且只能看到自己的提交与成绩。
 */
import type { Response } from 'express';
import type Database from 'better-sqlite3';

export interface AccessSession {
  userId?: string;
  studentId?: string;
  username?: string;
  role?: string;
  subRole?: string;
}

export type AccessLevel = 'admin' | 'teacher' | 'student';

export type AccessDecision = { ok: true; level: AccessLevel } | { ok: false; status: 403 | 404; error: string };

const ANSWER_KEYS = new Set([
  'correctAnswer',
  'correct_answer',
  'correctAnswers',
  'correct_answers',
  // #107 起 correctIndex 是随堂测验的权威答案字段，学生视角同样必须剥离
  'correctIndex',
  'correct_index',
  'correctIndexes',
  'correct_indexes',
  'answer',
  'answers',
  'referenceAnswer',
  'reference_answer',
  'solution',
  'expected',
  'expectedAnswer',
  'expected_answer',
]);

export function isAdministrator(session: AccessSession | null | undefined): boolean {
  if (!session) return false;
  const role = session.role;
  const sub = session.subRole;
  return (
    role === 'administrator' ||
    role === 'admin' ||
    sub === 'administrator' ||
    sub === 'admin' ||
    session.userId === 'usr_admin' ||
    session.username === 'admin'
  );
}

export function isTeacher(session: AccessSession | null | undefined): boolean {
  if (!session || isAdministrator(session)) return false;
  return session.role === 'teacher' || session.subRole === 'teacher';
}

export function actorUserId(session: AccessSession | null | undefined): string | null {
  const id = session?.userId || session?.studentId;
  return id ? String(id) : null;
}

export function studentActorId(session: AccessSession | null | undefined): string | null {
  const id = session?.studentId || session?.userId;
  return id ? String(id) : null;
}

export function stripClassSecrets<T>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const copy = { ...(row as Record<string, unknown>) };
  delete copy.class_passcode;
  delete copy.class_passcode_expires_at;
  return copy as T;
}

export function redactAnswerKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAnswerKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (ANSWER_KEYS.has(key)) continue;
      out[key] = redactAnswerKeys(nested);
    }
    return out;
  }
  return value;
}

/**
 * 脱敏任意 JSON 字符串 / 对象里的答案字段（作业 content、白板元素 data 等）。
 * 非 JSON 字符串原样返回，避免破坏自由文本。
 */
export function redactAnswerPayload(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return content;
  try {
    return JSON.stringify(redactAnswerKeys(JSON.parse(content)));
  } catch {
    return content;
  }
}

export function redactAssignmentContent(content: unknown): unknown {
  return redactAnswerPayload(content);
}

export function redactAssignmentForStudent<T extends { content?: unknown }>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  return { ...row, content: redactAssignmentContent(row.content) as T['content'] };
}

export function loadClassOwner(
  db: Database.Database,
  classId: string,
): { id: string; owner_user_id: string | null } | undefined {
  return db.prepare('SELECT id, owner_user_id FROM classes WHERE id = ?').get(classId) as
    { id: string; owner_user_id: string | null } | undefined;
}

export function teacherOwnsClass(
  row: { owner_user_id?: string | null },
  session: AccessSession | null | undefined,
): boolean {
  const uid = actorUserId(session);
  if (!uid || !row?.owner_user_id) return false;
  return row.owner_user_id === uid || row.owner_user_id === session?.username;
}

export function studentEnrolled(
  db: Database.Database,
  classId: string,
  session: AccessSession | null | undefined,
): boolean {
  const sid = studentActorId(session);
  if (!sid || !classId) return false;
  const row = db
    .prepare('SELECT 1 AS ok FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1')
    .get(classId, sid) as { ok: number } | undefined;
  return !!row;
}

/**
 * @param level staff = 仅管理该班的教师或管理员；member = staff 或已选课学生
 */
export function authorizeClass(
  db: Database.Database,
  session: AccessSession | null | undefined,
  classId: string,
  level: 'staff' | 'member',
): AccessDecision {
  if (!session) return { ok: false, status: 403, error: 'Forbidden' };
  if (!classId) return { ok: false, status: 404, error: 'Class not found' };
  const cls = loadClassOwner(db, classId);
  if (!cls) return { ok: false, status: 404, error: 'Class not found' };
  if (isAdministrator(session)) return { ok: true, level: 'admin' };
  if (isTeacher(session) && teacherOwnsClass(cls, session)) return { ok: true, level: 'teacher' };
  if (level === 'member' && session.role === 'student' && studentEnrolled(db, classId, session)) {
    return { ok: true, level: 'student' };
  }
  return { ok: false, status: 403, error: 'Forbidden' };
}

export function authorizeAssignment(
  db: Database.Database,
  session: AccessSession | null | undefined,
  assignmentId: string,
  level: 'staff' | 'member',
): AccessDecision {
  const row = db.prepare('SELECT id, class_id FROM assignments WHERE id = ?').get(assignmentId) as
    { id: string; class_id: string } | undefined;
  if (!row) return { ok: false, status: 404, error: 'Assignment not found' };
  return authorizeClass(db, session, row.class_id, level);
}

export function rejectUnless(res: Response, decision: AccessDecision): boolean {
  if (decision.ok === false) {
    res.status(decision.status).json({ error: decision.error });
    return true;
  }
  return false;
}

/** null = 管理员，不限制班级集合。 */
export function accessibleClassIds(db: Database.Database, session: AccessSession | null | undefined): string[] | null {
  if (!session) return [];
  if (isAdministrator(session)) return null;
  if (isTeacher(session)) {
    const uid = actorUserId(session);
    if (!uid) return [];
    const rows = db
      .prepare('SELECT id FROM classes WHERE owner_user_id = ? OR owner_user_id = ?')
      .all(uid, session.username || '') as { id: string }[];
    return rows.map((row) => row.id);
  }
  const sid = studentActorId(session);
  if (!sid) return [];
  const rows = db.prepare('SELECT class_id AS id FROM class_students WHERE student_id = ?').all(sid) as {
    id: string;
  }[];
  return rows.map((row) => row.id);
}

export function teacherCanSeeStudent(
  db: Database.Database,
  session: AccessSession | null | undefined,
  studentId: string,
): boolean {
  if (!session || !studentId) return false;
  if (isAdministrator(session)) return true;
  if (!isTeacher(session)) return false;
  const uid = actorUserId(session);
  if (!uid) return false;
  // studentId 兼容学生主键与学号（student_number）两种形态：历史/自报路径写入的
  // attempt.student_id 可能是学号（与 listAttempts 的班级切片同口径，见 courseware-service）。
  const row = db
    .prepare(
      `SELECT 1 AS ok
       FROM class_students cs
       JOIN classes c ON c.id = cs.class_id
       LEFT JOIN students s ON s.id = cs.student_id
       WHERE (cs.student_id = ? OR s.student_number = ?)
         AND (c.owner_user_id = ? OR c.owner_user_id = ?)
       LIMIT 1`,
    )
    .get(studentId, studentId, uid, session.username || '') as { ok: number } | undefined;
  return !!row;
}

/**
 * 课节（lesson）的可见性范围。
 *
 * - 管理员：全部课节。
 * - 教师：**自己教的**课节 —— 自己创建的，或出现在自己所带班级（排课 / 作业 /
 *   课堂会话）里的；另含 `creator_id` 为空的历史课节（与 `authorizeLessonStaff`
 *   的既有约定一致，避免历史数据在教师端变成死数据）。
 * - 学生：**自己班的**课节 —— 出现在自己所在班级（排课 / 作业 / 课堂会话）里的，
 *   或自己有学习进度记录的。
 */
export type LessonVisibilityScope =
  | { mode: 'all' }
  | { mode: 'teacher'; userId: string; username: string; classIds: string[] }
  | { mode: 'student'; studentId: string; classIds: string[] };

/** 从会话推出课节可见性范围。 */
export function lessonVisibilityScope(
  db: Database.Database,
  session: AccessSession | null | undefined,
): LessonVisibilityScope {
  if (!session) return { mode: 'student', studentId: '', classIds: [] };
  if (isAdministrator(session)) return { mode: 'all' };

  const classIds = accessibleClassIds(db, session) ?? [];

  if (isTeacher(session)) {
    return {
      mode: 'teacher',
      userId: actorUserId(session) || '',
      username: session.username || '',
      classIds,
    };
  }

  return {
    mode: 'student',
    studentId: studentActorId(session) || session.userId || '',
    classIds,
  };
}

/**
 * 构造课节可见性的 SQL 片段（供列表与单条查询共用，避免两套口径漂移）。
 *
 * 返回的片段一律带 `l.` 前缀（列表查询里 lessons 的别名是 `l`）。
 */
export function buildLessonVisibilityClause(scope: LessonVisibilityScope): {
  where: string;
  params: unknown[];
} {
  if (scope.mode === 'all') {
    return { where: '1 = 1', params: [] };
  }

  const classIds = scope.classIds;
  // 班级集合为空时不必再查关联表（也避免生成 `IN ()` 这种非法 SQL）
  const classIdsClause = classIds.length
    ? `class_id IN (${classIds.map(() => '?').join(',')})`
    : '1 = 0';

  const linkedByClass = [
    `l.id IN (SELECT lesson_id FROM schedules WHERE ${classIdsClause})`,
    `l.id IN (SELECT lesson_id FROM assignments WHERE ${classIdsClause})`,
    `l.id IN (SELECT lesson_id FROM classroom_sessions WHERE ${classIdsClause})`,
  ];

  if (scope.mode === 'teacher') {
    const params: unknown[] = [...classIds, ...classIds, ...classIds];
    return {
      where: `(l.creator_id = ? OR l.creator_id = ? OR l.creator_id IS NULL OR ${linkedByClass.join(' OR ')})`,
      params: [scope.userId, scope.username, ...params],
    };
  }

  const params: unknown[] = [...classIds, ...classIds, ...classIds, scope.studentId];
  return {
    where: `(${linkedByClass.join(' OR ')} OR l.id IN (SELECT lesson_id FROM student_lesson_progress WHERE student_id = ?))`,
    params,
  };
}

/**
 * 单条课节是否对当前会话可见。
 *
 * 与 {@link buildLessonVisibilityClause} 同口径（列表能看到的，单条也能看到）。
 */
export function canSeeLesson(
  db: Database.Database,
  session: AccessSession | null | undefined,
  lessonId: string,
): boolean {
  if (!session || !lessonId) return false;
  if (isAdministrator(session)) return true;

  const scope = lessonVisibilityScope(db, session);
  const { where, params } = buildLessonVisibilityClause(scope);
  const row = db
    .prepare(`SELECT 1 AS ok FROM lessons l WHERE l.id = ? AND ${where} LIMIT 1`)
    .get(lessonId, ...params) as { ok: number } | undefined;
  return !!row;
}

/**
 * 课时作业/互评：创建者教师或管理员可读全班；creator_id 为空的历史课时保持向教师开放。
 * 没有 lessons 行时不在这里判 404（部分互评数据只挂在 plugin_submissions 上）。
 */
export function authorizeLessonStaff(
  db: Database.Database,
  session: AccessSession | null | undefined,
  lessonId: string,
): AccessDecision {
  if (!session) return { ok: false, status: 403, error: 'Forbidden' };
  if (isAdministrator(session)) return { ok: true, level: 'admin' };
  if (!isTeacher(session)) return { ok: false, status: 403, error: 'Forbidden' };
  const lesson = db.prepare('SELECT id, creator_id FROM lessons WHERE id = ?').get(lessonId) as
    { id: string; creator_id: string | null } | undefined;
  if (!lesson || !lesson.creator_id) return { ok: true, level: 'teacher' };
  const uid = actorUserId(session);
  if (lesson.creator_id === uid || lesson.creator_id === session.username) return { ok: true, level: 'teacher' };
  return { ok: false, status: 403, error: 'Forbidden' };
}
