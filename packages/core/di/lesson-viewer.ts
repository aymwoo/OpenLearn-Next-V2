/**
 * 课节只读的当前用户（与 GET /api/lessons/:id 同一会话口径）。
 *
 * 插件不能自己声明「我是谁」。宿主只在两类可信入口写入：
 * - 命令 actor 为 `user:<id>:<role>`（CommandBus 经 resolver 还原会话）；
 * - 已登录的 HTTP 请求（插件命令路由 / 插件 HTTP 网关）显式 `runWithLessonViewer`。
 *
 * 进程隔离插件的 RPC 不在这条异步链上。宿主在派发 executeCommand / httpRequest
 * 时把当前 viewer 登记到 invocationId，子进程回调用这个 id 带回，主线程再
 * `runWithLessonViewer`。插件改不了这个 id：它由引导脚本从 AsyncLocalStorage 附上。
 */
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface LessonViewer {
  userId?: string;
  studentId?: string;
  username?: string;
  role?: string;
  subRole?: string;
}

export interface LessonViewerDb {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
  };
}

const viewerStore = new AsyncLocalStorage<LessonViewer>();
const invocations = new Map<string, LessonViewer>();

let viewerFromActor: (actorId: string) => LessonViewer | null = () => null;

/** 内核启动时注入。用数据库把 `user:` actor 还原成会话，而不是信任插件入参。 */
export function setLessonViewerResolver(resolver: (actorId: string) => LessonViewer | null): void {
  viewerFromActor = resolver;
}

export function currentLessonViewer(): LessonViewer | null {
  return viewerStore.getStore() ?? null;
}

/** 把会话角色归一为 administrator / teacher / student / anonymous。 */
export function normalizeViewerRole(viewer: LessonViewer | null | undefined): string {
  if (!viewer) return 'anonymous';
  for (const candidate of [viewer.subRole, viewer.role]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    const normalized = candidate === 'admin' ? 'administrator' : candidate;
    if (normalized === 'administrator' || normalized === 'teacher' || normalized === 'student') return normalized;
  }
  return 'anonymous';
}

/** 从会话取学生 id：学生 actor 的 userId 与 studentId 同值。非学生返回 null。 */
export function studentIdFromViewer(viewer: LessonViewer | null | undefined): string | null {
  if (!viewer || normalizeViewerRole(viewer) !== 'student') return null;
  const id = viewer.studentId || viewer.userId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function runWithLessonViewer<T>(viewer: LessonViewer, fn: () => T): T {
  return viewerStore.run(viewer, fn);
}

export function lessonViewerForActor(actorId: string): LessonViewer | null {
  if (!actorId.startsWith('user:')) return null;
  try {
    return viewerFromActor(actorId);
  } catch {
    return null;
  }
}

const USER_ACTOR = /^user:([^:]+):([^:]+)$/;

/**
 * 从可信 actor 还原会话。用户表命中时角色以库为准；没有行时才退回 actor 上的角色，
 * 以便创建者 id 与 actor 中段一致的课节仍能通过 `canSeeLesson`。
 */
export function lessonViewerFromActorId(db: LessonViewerDb, actorId: string): LessonViewer | null {
  const match = USER_ACTOR.exec(actorId);
  if (!match) return null;
  const userId = match[1];
  const roleFromActor = match[2] === 'admin' ? 'administrator' : match[2];

  try {
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId) as
      { id: string; username: string; role: string } | undefined;
    if (user) {
      const role = user.role === 'admin' ? 'administrator' : user.role;
      return { userId: user.id, username: user.username, role, subRole: role };
    }
    const student = db.prepare('SELECT id, student_number FROM students WHERE id = ?').get(userId) as
      { id: string; student_number: string | null } | undefined;
    if (student) {
      return {
        userId: student.id,
        studentId: student.id,
        username: student.student_number ?? '',
        role: 'student',
      };
    }
  } catch {
    // 调用方库还没有 users / students 时，退回 actor 上的角色。
  }

  if (roleFromActor === 'administrator' || roleFromActor === 'teacher' || roleFromActor === 'student') {
    return { userId, role: roleFromActor, username: '' };
  }
  return null;
}

export function openLessonInvocation(viewer: LessonViewer): string {
  const id = crypto.randomUUID();
  invocations.set(id, viewer);
  return id;
}

export function closeLessonInvocation(id: string): void {
  invocations.delete(id);
}

export function lessonViewerForInvocation(id: string | null | undefined): LessonViewer | null {
  if (!id) return null;
  return invocations.get(id) ?? null;
}
