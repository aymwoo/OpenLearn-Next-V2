/**
 * 进行中课堂的班级锁定。
 *
 * 教师在起始门户选定班级并进入授课后，IN_CLASS_TEACHING / WRAP_UP_EXIT_TICKET
 * 阶段的 classroom_sessions.class_id 不可再改。PRE_CLASS_READY 仍允许门户重选；
 * 归档（ARCHIVED_REPORT）之后新会话可以绑新班级。
 */

export const CLASS_LOCK_MESSAGE = '本节课进行中，不能更换班级。请先结束或归档本节课后再换班。';

const LOCKED_STAGES = new Set(['IN_CLASS_TEACHING', 'WRAP_UP_EXIT_TICKET']);

export function isInProgressClassLocked(stage: string | null | undefined): boolean {
  return !!stage && LOCKED_STAGES.has(stage);
}

export class ClassroomClassLockedError extends Error {
  status = 409;
  constructor(message = CLASS_LOCK_MESSAGE) {
    super(message);
    this.name = 'ClassroomClassLockedError';
  }
}

type SessionClassRow = { class_id?: string | null; stage?: string | null } | null | undefined;

/** 进行中会话已绑定班级且请求要换成另一个班时抛 409。未传 classId 或相同则放行。 */
export function assertSessionClassChangeAllowed(session: SessionClassRow, requestedClassId?: string | null): void {
  if (!requestedClassId || !session?.class_id || session.class_id === requestedClassId) return;
  if (!isInProgressClassLocked(session.stage)) return;
  throw new ClassroomClassLockedError();
}

type DbLike = { prepare: (sql: string) => { get: (...args: any[]) => unknown } };

const SESSION_CLASS_SQL = `SELECT class_id, stage FROM classroom_sessions
  WHERE lesson_id = ? AND stage != 'ARCHIVED_REPORT'
  ORDER BY created_at DESC LIMIT 1`;

/** 进行中会话已绑定的班级；没有进行中会话或查询失败时返回 null（不阻断无关广播）。 */
export function loadInProgressSessionClass(db: DbLike, lessonId: string): string | null {
  try {
    const row = db.prepare(SESSION_CLASS_SQL).get(lessonId) as SessionClassRow;
    if (!row?.class_id || !isInProgressClassLocked(row.stage)) return null;
    return row.class_id;
  } catch {
    return null;
  }
}

/**
 * 课节当前归属的班级：优先取最近一次未归档的课堂会话，其次取课表。
 * 用于把课堂事件投递到班级房间（学生离开课节视图后仍能收到）。
 */
export function loadLessonClassId(db: DbLike, lessonId: string): string | null {
  try {
    const session = db.prepare(SESSION_CLASS_SQL).get(lessonId) as SessionClassRow;
    if (session?.class_id) return session.class_id;
    const scheduled = db.prepare('SELECT class_id FROM schedules WHERE lesson_id = ? LIMIT 1').get(lessonId) as
      { class_id?: string | null } | undefined;
    return scheduled?.class_id ?? null;
  } catch {
    return null;
  }
}
