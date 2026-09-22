import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type {
  ClassroomLifecycleStage,
  ClassroomStageGuard,
  IClassroomLifecycleService,
  IInteractionRuntimeService,
  QuickActivityDescriptor,
  StageGuardResult,
} from '../../packages/core/di/interfaces.js';

export class ClassroomRuntimeService implements IClassroomLifecycleService, IInteractionRuntimeService {
  private db: Database.Database;
  private io?: Server;
  private stageGuards = new Map<string, ClassroomStageGuard>();
  private activityProviders = new Map<string, QuickActivityDescriptor>();

  constructor(db: Database.Database, io?: Server) {
    this.db = db;
    this.io = io;
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
      .get(lessonId, 'ARCHIVED_REPORT') as any;

    if (!session) {
      const id = `cs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const checkinCode = Math.floor(1000 + Math.random() * 9000).toString();
      const now = Date.now();
      this.db
        .prepare(`
          INSERT INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, checkin_code, created_at)
          VALUES (?, ?, ?, ?, 'PRE_CLASS_READY', ?, ?)
        `)
        .run(id, lessonId, classId || null, teacherId, checkinCode, now);

      session = this.db.prepare('SELECT * FROM classroom_sessions WHERE id = ?').get(id);
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

    // Run all registered plugin guards
    for (const [owner, guard] of this.stageGuards) {
      try {
        const check = await guard(currentStage, toStage, { lessonId, classId, actorId });
        if (typeof check === 'boolean' && !check) {
          return { success: false, stage: currentStage, reason: `Guard from '${owner}' blocked transition.` };
        }
        if (typeof check === 'object' && !check.allowed) {
          return { success: false, stage: currentStage, reason: check.reason || `Blocked by guard '${owner}'.` };
        }
      } catch (err: any) {
        console.error(`[ClassroomLifecycle] Guard '${owner}' threw an error:`, err);
      }
    }

    const now = Date.now();
    let session = this.db
      .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1')
      .get(lessonId, 'ARCHIVED_REPORT') as any;

    if (!session) {
      session = await this.getOrCreateSession(lessonId, actorId, classId);
    }

    const startedAt = toStage === 'IN_CLASS_TEACHING' && !session.started_at ? now : session.started_at;
    const endedAt = toStage === 'ARCHIVED_REPORT' ? now : session.ended_at;

    this.db
      .prepare(`
        UPDATE classroom_sessions
        SET stage = ?, class_id = coalesce(?, class_id), started_at = ?, ended_at = ?
        WHERE id = ?
      `)
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
      this.io.to(`lesson-${lessonId}`).emit('classroom:stage_changed', payload);
      if (classId) {
        this.io.to(`class-${classId}`).emit('classroom:stage_changed', payload);
      }
      this.io.emit('classroom:stage_event', payload);
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
