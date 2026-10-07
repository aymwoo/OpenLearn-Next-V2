import type Database from 'better-sqlite3';
import { randomId } from '../utils/id.js';
import type { Server } from 'socket.io';
import { emitClassroomEvent } from '../presence.js';
import type {
  ClassroomLifecycleStage,
  ClassroomStageGuard,
  IClassroomLifecycleService,
  IInteractionRuntimeService,
  QuickActivityDescriptor,
  StageGuardResult,
} from '../../packages/core/di/interfaces.js';

/** 已归档会话阶段：getOrCreateSession/动态流等按「活动会话」查询时排除此阶段 */
export const ARCHIVED_REPORT_STAGE = 'ARCHIVED_REPORT';

/**
 * 单个课堂门禁的执行超时（D-3 决策）。
 *
 * 与 `StageGuardPipeline` 的 1500ms 保持一致 —— 同一类判定不该有两套时限。
 * 可用 `OPENLEARN_CLASSROOM_GUARD_TIMEOUT_MS` 覆盖。
 */
const CLASSROOM_GUARD_TIMEOUT_MS = (() => {
  const raw = process.env.OPENLEARN_CLASSROOM_GUARD_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1500;
})();

/**
 * 门禁执行策略（D-3 决策）：默认 **fail-close**。
 *
 * 旧行为（fail-open）有两个问题，且第二个比第一个严重：
 *   ① 抛异常只记日志就继续 —— 守卫失效被静默吞掉；
 *   ② **根本没有超时** —— 插件 guard 挂起会让这个 HTTP 请求永久挂起。
 *      该方法由 `routes/classroom.ts` 的 `POST /api/classroom/sessions/:id/stage`
 *      调用（教师鉴权端点），一个挂起的插件守卫就能让环节流转接口不可用。
 */
type ClassroomGuardPolicy = 'fail-close' | 'fail-open';

/**
 * 执行单个门禁，带超时与异常保护。
 *
 * 注意与 `StageGuardPipeline` 的区别：这里超时一律 fail-close —— 环节流转是
 * 教师侧的单次请求，超时的守卫几乎总是插件故障（正常判定是内存操作，不该耗秒），
 * 不存在「宁可放行」的合理性。要恢复旧行为可传 `policy: 'fail-open'`。
 */
async function runClassroomGuard(
  owner: string,
  guard: ClassroomStageGuard,
  currentStage: ClassroomLifecycleStage,
  toStage: ClassroomLifecycleStage,
  meta: { lessonId: string; classId?: string; actorId: string },
  policy: ClassroomGuardPolicy,
): Promise<{ blocked: boolean; reason?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const guardPromise = (async () => guard(currentStage, toStage, meta))();

  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, CLASSROOM_GUARD_TIMEOUT_MS);
  });

  try {
    const check = (await Promise.race([guardPromise, timeoutPromise])) as boolean | StageGuardResult | null;

    if (check === null) {
      console.error(`[ClassroomLifecycle] Guard '${owner}' timed out after ${CLASSROOM_GUARD_TIMEOUT_MS}ms.`);
      if (timedOut) {
        // 超时后 guard 可能仍挂着；吸收迟到的 reject 避免 unhandledRejection
        void Promise.resolve(guardPromise).catch(() => {
          /* 已按超时处理 */
        });
      }
      if (policy === 'fail-open') return { blocked: false };
      return { blocked: true, reason: `门禁插件 '${owner}' 响应超时，环节流转被拒绝。` };
    }

    if (typeof check === 'boolean') {
      return check ? { blocked: false } : { blocked: true, reason: `Guard from '${owner}' blocked transition.` };
    }
    if (typeof check === 'object' && check !== null && !check.allowed) {
      return { blocked: true, reason: check.reason || `Blocked by guard '${owner}'.` };
    }
    return { blocked: false };
  } catch (err) {
    console.error(`[ClassroomLifecycle] Guard '${owner}' threw an error:`, err);
    if (policy === 'fail-open') return { blocked: false };
    return { blocked: true, reason: `门禁插件 '${owner}' 执行出错，环节流转被拒绝。` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class ClassroomRuntimeService implements IClassroomLifecycleService, IInteractionRuntimeService {
  private db: Database.Database;
  private io?: Server;
  private stageGuards = new Map<string, ClassroomStageGuard>();
  private activityProviders = new Map<string, QuickActivityDescriptor>();
  /** D-3：门禁失效策略，默认 fail-close。构造时可用 options 覆盖。 */
  private readonly guardPolicy: ClassroomGuardPolicy;

  /**
   * @param options.guardPolicy 门禁失效策略。默认 `'fail-close'`（D-3 决策）。
   *   传 `'fail-open'` 可恢复旧行为（守卫超时/抛错仍放行）—— 但注意旧行为
   *   **没有超时上限**，插件守卫挂起会让本服务的 HTTP 接口永久不可用。
   */
  constructor(db: Database.Database, io?: Server, options?: { guardPolicy?: ClassroomGuardPolicy }) {
    this.db = db;
    this.io = io;
    this.guardPolicy = options?.guardPolicy ?? 'fail-close';
  }

  public setSocketIO(io: Server): void {
    this.io = io;
  }

  // ── IClassroomLifecycleService Implementation ───────────────────────────

  public async getStage(lessonId: string): Promise<ClassroomLifecycleStage> {
    const row = this.db
      .prepare('SELECT stage FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(lessonId) as { stage: ClassroomLifecycleStage } | undefined;

    return row?.stage || 'PRE_CLASS_READY';
  }

  public async getOrCreateSession(lessonId: string, teacherId: string, classId?: string): Promise<any> {
    let session = this.db
      .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1')
      .get(lessonId, ARCHIVED_REPORT_STAGE) as any;

    if (!session) {
      const id = randomId('cs_');
      const checkinCode = Math.floor(1000 + Math.random() * 9000).toString();
      const now = Date.now();
      this.db
        .prepare(
          `
          INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, checkin_code, created_at)
          VALUES (?, ?, ?, ?, 'PRE_CLASS_READY', ?, ?)
        `,
        )
        .run(id, lessonId, classId || null, teacherId, checkinCode, now);

      session = this.db.prepare('SELECT * FROM classroom_sessions WHERE id = ?').get(id);
    } else if (classId && session.class_id !== classId) {
      // The launch portal lets teachers choose a class each time they enter.
      // Keep the reused lesson session aligned with that explicit selection.
      this.db.prepare('UPDATE classroom_sessions SET class_id = ? WHERE id = ?').run(classId, session.id);
      session = this.db.prepare('SELECT * FROM classroom_sessions WHERE id = ?').get(session.id);
    }
    return session;
  }

  public registerStageGuard(owner: string, guard: ClassroomStageGuard): void {
    this.stageGuards.set(owner, guard);
  }

  public unregisterStageGuard(owner: string): void {
    this.stageGuards.delete(owner);
  }

  public async transitionStage(
    lessonId: string,
    toStage: ClassroomLifecycleStage,
    actorId: string,
    classId?: string,
  ): Promise<{ success: boolean; stage: ClassroomLifecycleStage; reason?: string }> {
    const currentStage = await this.getStage(lessonId);

    // Run all registered plugin guards.
    // D-3：默认 fail-close —— 守卫超时/抛错都拒绝流转（此前无超时且抛错仅记日志）。
    for (const [owner, guard] of this.stageGuards) {
      const outcome = await runClassroomGuard(
        owner,
        guard,
        currentStage,
        toStage,
        { lessonId, classId, actorId },
        this.guardPolicy,
      );
      if (outcome.blocked) {
        return { success: false, stage: currentStage, reason: outcome.reason };
      }
    }

    const now = Date.now();
    let session = this.db
      .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1')
      .get(lessonId, ARCHIVED_REPORT_STAGE) as any;

    if (!session) {
      session = await this.getOrCreateSession(lessonId, actorId, classId);
    }

    const startedAt = toStage === 'IN_CLASS_TEACHING' && !session.started_at ? now : session.started_at;
    const endedAt = toStage === 'ARCHIVED_REPORT' ? now : session.ended_at;

    this.db
      .prepare(
        `
        UPDATE classroom_sessions
        SET stage = ?, class_id = coalesce(?, class_id), started_at = ?, ended_at = ?
        WHERE id = ?
      `,
      )
      .run(toStage, classId || null, startedAt, endedAt, session.id);

    // Broadcast stage transition to both lesson and class socket rooms
    if (this.io) {
      const payload = {
        lessonId,
        sessionId: session.id,
        stage: toStage,
        fromStage: currentStage,
        timestamp: now,
      };
      // 课节房间 + 常驻课堂广播房间
      emitClassroomEvent(this.io, lessonId, 'classroom:stage_changed', payload);
      if (classId) {
        this.io.to(`class-${classId}`).emit('classroom:stage_changed', payload);
      }
    }

    return { success: true, stage: toStage };
  }

  // ── IInteractionRuntimeService Implementation ───────────────────────────

  public registerActivityProvider(owner: string, descriptor: QuickActivityDescriptor): void {
    this.activityProviders.set(`${owner}:${descriptor.id}`, descriptor);
  }

  public unregisterActivityProvider(owner: string, id: string): void {
    this.activityProviders.delete(`${owner}:${id}`);
  }

  public listActivityProviders(): QuickActivityDescriptor[] {
    return Array.from(this.activityProviders.values());
  }
}
