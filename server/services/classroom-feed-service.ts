/**
 * classroom-feed-service — 课堂动态流持久化与回放
 *
 * 模式对齐 server/realtime-bridge.ts：订阅内核事件总线，把命中白名单的
 * 课堂事件写入 classroom_feed 表并向课节房间广播 socket 事件。
 *
 * 之前 liveClassFeed 是纯前端内存态（上限 50 条），教师离开课堂再回来后
 * 动态流清零；现在落库为会话级事实，重进课堂时通过
 * GET /api/classroom/sessions/:lessonId 的 feedReplay 回放。
 */
import type Database from 'better-sqlite3';
import type { Server } from 'socket.io';
import type { PlatformEvent } from '../../packages/core/event-bus/index.js';
import { ARCHIVED_REPORT_STAGE } from './classroom-runtime-service.js';

/** 计入动态流的事件类型 → feed type 映射（与前端 deriveHighlights 的 HIGHLIGHT_TYPES 口径对齐并扩展） */
const FEED_EVENT_TYPES: Record<string, string> = {
  'whiteboard.quiz_answered': 'quiz_answered',
  'assignment.submitted': 'assignment_submitted',
  'assignment.graded': 'assignment_graded',
  'points.awarded': 'achievement',
  'student.notification_acknowledged': 'checkin',
  'student.progress_updated': 'progress',
  'courseware.attempt_submitted': 'courseware_submitted',
};

/** 回放上限（GET feedReplay 每次最多返回条数） */
const FEED_REPLAY_LIMIT = 50;

interface FeedRow {
  id: string;
  session_id: string | null;
  lesson_id: string;
  class_id: string | null;
  type: string;
  message: string;
  actor_id: string | null;
  actor_name: string | null;
  source: string | null;
  created_at: number;
}

export class ClassroomFeedService {
  private db: Database.Database;
  private io?: Server;

  constructor(db: Database.Database, io?: Server) {
    this.db = db;
    this.io = io;
    this.ensureTable();
  }

  public setSocketIO(io: Server): void {
    this.io = io;
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS classroom_feed (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        lesson_id TEXT NOT NULL,
        class_id TEXT,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        source TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_classroom_feed_lesson ON classroom_feed(lesson_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_classroom_feed_session ON classroom_feed(session_id, created_at);
    `);
  }

  /** 当前 lesson 的活动会话 id（无会话返回 null — 动态仍落表，挂不上会话） */
  private resolveSessionId(lessonId: string): { session_id: string | null; class_id: string | null } {
    try {
      const row = this.db
        .prepare(
          'SELECT id, class_id FROM classroom_sessions WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(lessonId, ARCHIVED_REPORT_STAGE) as { id: string; class_id: string | null } | undefined;
      return { session_id: row?.id ?? null, class_id: row?.class_id ?? null };
    } catch {
      return { session_id: null, class_id: null };
    }
  }

  /**
   * 事件总线订阅入口：命中白名单 → 落表 → 课节房间广播。
   * 单事件失败被吞掉（动态流是旁路数据，绝不影响业务主流程）。
   */
  public handleEvent = (event: PlatformEvent): void => {
    try {
      const feedType = FEED_EVENT_TYPES[event.type];
      if (!feedType) return;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const lessonId = typeof payload.lessonId === 'string' ? payload.lessonId : null;
      if (!lessonId) return;

      const { session_id, class_id } = this.resolveSessionId(lessonId);
      const row: FeedRow = {
        id: `feed_${event.id}`,
        session_id,
        lesson_id: lessonId,
        class_id,
        type: feedType,
        message: this.buildMessage(feedType, payload),
        actor_id: typeof payload.studentId === 'string' ? payload.studentId : null,
        actor_name: typeof payload.studentName === 'string' ? payload.studentName : null,
        source: typeof event.source === 'string' ? event.source : null,
        created_at: event.timestamp || Date.now(),
      };

      this.db
        .prepare(
          `INSERT OR IGNORE INTO classroom_feed
             (id, session_id, lesson_id, class_id, type, message, actor_id, actor_name, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.session_id,
          row.lesson_id,
          row.class_id,
          row.type,
          row.message,
          row.actor_id,
          row.actor_name,
          row.source,
          row.created_at,
        );

      // 与 event-routing 的 attachMeta 惯例一致：payload 携带 _meta 便于前端去重
      if (this.io) {
        const socketPayload = {
          id: row.id,
          lessonId: row.lesson_id,
          type: row.type,
          message: row.message,
          time: new Date(row.created_at).toTimeString().slice(0, 5),
          actorId: row.actor_id,
          actorName: row.actor_name,
          _meta: { eventId: event.id, type: event.type, source: event.source, timestamp: row.created_at },
        };
        this.io.to(`lesson-${lessonId}`).emit('classroom:feed_appended', socketPayload);
        if (class_id) this.io.to(`class-${class_id}`).emit('classroom:feed_appended', socketPayload);
      }
    } catch (e) {
      console.error('[classroom-feed] handleEvent failed:', e);
    }
  };

  /** 事件 payload → 人类可读动态文案（信息不足时兜底「有新的课堂动态」） */
  private buildMessage(feedType: string, p: Record<string, unknown>): string {
    const name = typeof p.studentName === 'string' && p.studentName ? p.studentName : null;
    switch (feedType) {
      case 'quiz_answered':
        return name ? `${name} 完成了随堂练习作答` : '有学生完成随堂练习作答';
      case 'assignment_submitted':
        return name ? `${name} 提交了作业` : '有学生提交了作业';
      case 'assignment_graded':
        return name ? `${name} 的作业已完成批改` : '有作业完成批改';
      case 'achievement':
        return name ? `${name} 获得课堂表彰` : '有学生获得课堂表彰';
      case 'checkin':
        return name ? `${name} 已确认课堂通知` : '有学生确认课堂通知';
      case 'progress':
        return name ? `${name} 更新了课节进度` : '有学生更新课节进度';
      case 'courseware_submitted':
        return name ? `${name} 提交了互动课件成果` : '有学生提交互动课件成果';
      default:
        return '有新的课堂动态';
    }
  }

  /**
   * 回放：当前活动会话最近 N 条动态（按时间升序返回，前端直接按序渲染）。
   * 按活动会话过滤（而非 lesson）—— 同一课程重开的新会话绝不回放上一次课的动态。
   * 无活动会话（未开课/已归档）返回空数组。
   */
  public getFeedReplay(lessonId: string, limit = 20): Array<Record<string, unknown>> {
    try {
      const { session_id } = this.resolveSessionId(lessonId);
      if (!session_id) return [];
      const rows = this.db
        .prepare(
          `SELECT id, type, message, actor_id, actor_name, created_at
             FROM classroom_feed WHERE session_id = ?
            ORDER BY created_at DESC LIMIT ?`,
        )
        .all(session_id, Math.min(Math.max(1, limit), FEED_REPLAY_LIMIT)) as Array<
        Omit<FeedRow, 'session_id' | 'class_id' | 'source'>
      >;
      return rows
        .map((r) => ({
          id: r.id,
          type: r.type,
          message: r.message,
          actorId: r.actor_id,
          actorName: r.actor_name,
          time: new Date(r.created_at).toTimeString().slice(0, 5),
        }))
        .reverse(); // 存储取 DESC，回放转 ASC
    } catch (e) {
      console.error('[classroom-feed] getFeedReplay failed:', e);
      return [];
    }
  }

  /** 统计某课节已落库的动态条数（测试辅助 / 诊断用） */
  public countByLesson(lessonId: string): number {
    try {
      return (
        this.db.prepare('SELECT COUNT(*) AS c FROM classroom_feed WHERE lesson_id = ?').get(lessonId) as { c: number }
      ).c;
    } catch {
      return 0;
    }
  }
}

/** 事件总线订阅（返回取消订阅函数，由调用方管理生命周期） */
export function attachClassroomFeedService(
  feedService: ClassroomFeedService,
  eventBus: {
    subscribe(type: string, handler: (e: PlatformEvent) => void): unknown;
    unsubscribe?(type: string, handler: (e: PlatformEvent) => void): unknown;
  },
): () => void {
  for (const type of Object.keys(FEED_EVENT_TYPES)) {
    eventBus.subscribe(type, feedService.handleEvent);
  }
  // 返回取消订阅函数；宿主 eventBus 若支持 unsubscribe 则真正撤销（进程生命周期内
  // feed 服务与宿主同生命周期，通常不调用）。
  return () => {
    if (typeof eventBus.unsubscribe !== 'function') return;
    for (const type of Object.keys(FEED_EVENT_TYPES)) {
      try {
        eventBus.unsubscribe(type, feedService.handleEvent);
      } catch {
        /* 忽略 */
      }
    }
  };
}
