/**
 * 课节可见性。与 `server/services/class-access.ts` 原先的实现同一份 SQL。
 *
 * 放在内核里，是为了让课节标题只读服务不必反向 import server。
 * `class-access.ts` 再从这里转出，避免两套口径。
 */
export interface LessonVisibilitySession {
  userId?: string;
  studentId?: string;
  username?: string;
  role?: string;
  subRole?: string;
}

export interface LessonVisibilityDb {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
}

export type LessonVisibilityScope =
  | { mode: 'all' }
  | { mode: 'teacher'; userId: string; username: string; classIds: string[] }
  | { mode: 'student'; studentId: string; classIds: string[] };

const SESSION_ROLE_WHITELIST = new Set(['administrator', 'teacher', 'student', 'anonymous']);

function resolveSessionRole(session: LessonVisibilitySession | null | undefined): string {
  if (!session) return 'anonymous';
  for (const candidate of [session.subRole, session.role]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    const normalized = candidate === 'admin' ? 'administrator' : candidate;
    if (SESSION_ROLE_WHITELIST.has(normalized)) return normalized;
  }
  return 'anonymous';
}

function isAdministrator(session: LessonVisibilitySession | null | undefined): boolean {
  return resolveSessionRole(session) === 'administrator';
}

function isTeacher(session: LessonVisibilitySession | null | undefined): boolean {
  if (!session || isAdministrator(session)) return false;
  return resolveSessionRole(session) === 'teacher';
}

function actorUserId(session: LessonVisibilitySession | null | undefined): string | null {
  const id = session?.userId || session?.studentId;
  return id ? String(id) : null;
}

function studentActorId(session: LessonVisibilitySession | null | undefined): string | null {
  const id = session?.studentId || session?.userId;
  return id ? String(id) : null;
}

function accessibleClassIds(
  db: LessonVisibilityDb,
  session: LessonVisibilitySession | null | undefined,
): string[] | null {
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

/** 从会话推出课节可见性范围。 */
export function lessonVisibilityScope(
  db: LessonVisibilityDb,
  session: LessonVisibilitySession | null | undefined,
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
  const classIdsClause = classIds.length ? `class_id IN (${classIds.map(() => '?').join(',')})` : '1 = 0';

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
 * 与 {@link buildLessonVisibilityClause} 同口径（列表能看到的，单条也能看到）。
 */
export function canSeeLesson(
  db: LessonVisibilityDb,
  session: LessonVisibilitySession | null | undefined,
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
