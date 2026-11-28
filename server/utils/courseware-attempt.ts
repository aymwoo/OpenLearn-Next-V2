/**
 * 课件 attempt 身份解析（单一实现）。
 *
 * 背景：沙箱 iframe 的 `/runtime` 请求不带会话 cookie。v1 只能把匿名访问者
 * 全部塞进同一条 `guest` attempt，再由父页面的 `/adopt` 转移归属。v2 的
 * access token 已绑定 `attemptId + userId`，因此父页面可以预先为本人创建/复用
 * attempt，iframe 直接用 token 声明里 attempt，不再依赖 guest 共享行。
 *
 * 本模块同时供 `/api/courseware/:id/access-token` 与 `injectLmsSdk` 使用，
 * 避免两处各写一套「学生/教师/访客」分支。
 */
import crypto from 'crypto';
import type Database from 'better-sqlite3';

export interface CoursewareAttemptSession {
  userId?: string;
  studentId?: string;
  username?: string;
  name?: string;
  role?: string;
}

export interface ResolvedCoursewareAttempt {
  attemptId: string;
  /** courseware_attempt.student_id 的真实归属（可能是 'teacher' / 'guest' 哨兵） */
  ownerStudentId: string;
  /** 注入到 __LMS_STUDENT__.student_id 的学习者 id */
  learnerId: string;
  /** 注入到 __LMS_STUDENT__.student_name 的展示名 */
  learnerName: string;
  classId: string;
}

function pickActiveAttempt(db: Database.Database, coursewareId: string, studentId: string): { id: string } | undefined {
  return db
    .prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
    .get(coursewareId, studentId, 'active') as { id: string } | undefined;
}

function createAttempt(db: Database.Database, coursewareId: string, studentId: string, prefix: string): string {
  const attemptId = `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare(
    'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
  ).run(attemptId, coursewareId, studentId, Date.now(), 'active');
  return attemptId;
}

/**
 * 解析（不存在则创建）某课件下当前身份的 active attempt。
 *
 * - 学生：按 session.studentId 归属；
 * - 教师 / 管理员：复用固定的 'teacher' 预览 attempt；
 * - 无会话：复用 'guest' 预览 attempt（仅 `/runtime` 的旧 token 兜底路径会用）。
 */
export function resolveOrCreateCoursewareAttempt(
  db: Database.Database,
  coursewareId: string,
  session?: CoursewareAttemptSession | null,
): ResolvedCoursewareAttempt {
  if (session?.role === 'student') {
    const studentId = session.studentId || session.userId || '';
    if (studentId) {
      const existing = pickActiveAttempt(db, coursewareId, studentId);
      const attemptId = existing?.id || createAttempt(db, coursewareId, studentId, 'att');
      let classId: string;
      try {
        const row = db.prepare('SELECT class_id FROM class_students WHERE student_id = ? LIMIT 1').get(studentId) as
          { class_id?: string } | undefined;
        classId = row?.class_id || '';
      } catch {
        classId = '';
      }
      return {
        attemptId,
        ownerStudentId: studentId,
        learnerId: studentId,
        learnerName: session.name || 'Guest Student',
        classId,
      };
    }
  }

  if (session?.role === 'teacher' || session?.role === 'administrator') {
    const existing = pickActiveAttempt(db, coursewareId, 'teacher');
    const attemptId = existing?.id || createAttempt(db, coursewareId, 'teacher', 'att_teacher');
    return {
      attemptId,
      ownerStudentId: 'teacher',
      learnerId: session.userId || 'teacher',
      learnerName: `${session.name || 'Teacher'} (Test)`,
      classId: '',
    };
  }

  const existing = pickActiveAttempt(db, coursewareId, 'guest');
  const attemptId = existing?.id || createAttempt(db, coursewareId, 'guest', 'att_guest');
  return {
    attemptId,
    ownerStudentId: 'guest',
    learnerId: 'guest',
    learnerName: 'Guest Student',
    classId: '',
  };
}

/**
 * 用 v2 token 声明补全注入 iframe 的身份信息。
 *
 * token 里只有 attemptId/userId；展示名与班级需要回查 attempt 归属与 students，
 * 这样 `/runtime` 无需会话也能注入与学生本人一致的身份。
 */
export function resolveLaunchIdentity(
  db: Database.Database,
  claims: { attemptId?: string; userId?: string },
): {
  attemptId: string;
  userId?: string;
  learnerId: string;
  learnerName: string;
  classId: string;
  role: string;
} | null {
  if (!claims?.attemptId) return null;
  let ownerStudentId: string;
  try {
    const row = db.prepare('SELECT student_id FROM courseware_attempt WHERE id = ?').get(claims.attemptId) as
      { student_id?: string } | undefined;
    ownerStudentId = row?.student_id || '';
  } catch {
    ownerStudentId = '';
  }
  if (!ownerStudentId) return null;

  if (ownerStudentId === 'teacher') {
    return {
      attemptId: claims.attemptId,
      userId: claims.userId,
      learnerId: claims.userId || 'teacher',
      learnerName: 'Teacher (Test)',
      classId: '',
      role: 'teacher',
    };
  }
  if (ownerStudentId === 'guest') {
    return {
      attemptId: claims.attemptId,
      userId: claims.userId,
      learnerId: 'guest',
      learnerName: 'Guest Student',
      classId: '',
      role: 'guest',
    };
  }

  let learnerName: string;
  let classId: string;
  try {
    const student = db.prepare('SELECT name FROM students WHERE id = ?').get(ownerStudentId) as
      { name?: string } | undefined;
    learnerName = student?.name || '';
  } catch {
    learnerName = '';
  }
  try {
    const row = db.prepare('SELECT class_id FROM class_students WHERE student_id = ? LIMIT 1').get(ownerStudentId) as
      { class_id?: string } | undefined;
    classId = row?.class_id || '';
  } catch {
    classId = '';
  }
  return {
    attemptId: claims.attemptId,
    userId: claims.userId,
    learnerId: claims.userId || ownerStudentId,
    learnerName: learnerName || 'Guest Student',
    classId,
    role: 'student',
  };
}
