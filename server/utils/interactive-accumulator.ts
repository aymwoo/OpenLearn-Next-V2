/**
 * 课堂高频互动状态轻量写入节流与微批量落库引擎 (Issue #411)
 *
 * 核心目标：
 * 1. 会话心跳合并 (SessionTouchBatcher)：将高频分散的 client_sessions.updated_at 刷新暂存内存，
 *    通过微事务（默认 1000ms 或达到 50 条阈值）批量写盘，降低单写者提交频率。
 * 2. 晴雨表互动状态聚合器 (PacingSignalAccumulator)：
 *    课堂节奏信号（听懂/不懂/太快/太慢）按 (sessionId, segmentId, studentId) 在内存维护权威状态，
 *    实现 O(1) 内存读写、毫秒级即时聚合与秒级最终一致性（500ms 批量落库），
 *    彻底消除 100~500 并发学生集中点击时的微事务碎片与重复表全扫描。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';

export interface PacingSignalRecord {
  id: string;
  sessionId: string;
  segmentId: string;
  studentId: string;
  signalType: string | null; // null 表示取消/清空
  updatedAt: number;
}

export interface PacingSummaryResult {
  currentSignal: string | null;
  summary: Record<string, number>;
  overall: Record<string, number>;
  overallSummary: Record<string, number>;
  totalInSegment: number;
  totalOverall: number;
}

export interface BatcherStats {
  pendingCount: number;
  flushedTotal: number;
  batchesTotal: number;
  lastFlushedAt: number;
}

/**
 * 1. 客户端会话活跃度微批量更新器 (SessionTouchBatcher)
 */
export class SessionTouchBatcher {
  private queue = new Map<string, number>(); // token -> timestamp
  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private flushedTotal = 0;
  private batchesTotal = 0;
  private lastFlushedAt = 0;
  private dbProvider: () => Database.Database;

  constructor(options?: { flushIntervalMs?: number; maxBatchSize?: number; dbProvider?: () => Database.Database }) {
    this.flushIntervalMs = options?.flushIntervalMs ?? 1000;
    this.maxBatchSize = options?.maxBatchSize ?? 50;
    this.dbProvider = options?.dbProvider ?? (() => kernelContainer.db);
  }

  /**
   * 记录需要更新 updated_at 的会话令牌
   */
  public touch(token: string, timestamp = Date.now()): void {
    if (!token) return;
    this.queue.set(token, timestamp);

    if (this.queue.size >= this.maxBatchSize) {
      this.flushSync();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushSync();
      }, this.flushIntervalMs);
      if (typeof this.timer?.unref === 'function') {
        this.timer.unref();
      }
    }
  }

  /**
   * 同步清空队列并以单一事务批量更新 SQLite
   */
  public flushSync(): number {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.size === 0) return 0;

    const entries = Array.from(this.queue.entries());
    this.queue.clear();

    const db = this.dbProvider();
    if (!db || !db.open) return 0;

    try {
      const stmt = db.prepare('UPDATE client_sessions SET updated_at = ? WHERE id = ?');
      const tx = db.transaction((items: Array<[string, number]>) => {
        for (const [tok, time] of items) {
          stmt.run(time, tok);
        }
      });
      tx(entries);

      this.flushedTotal += entries.length;
      this.batchesTotal += 1;
      this.lastFlushedAt = Date.now();
      return entries.length;
    } catch {
      // 容错回退：不抛出阻断业务请求
      return 0;
    }
  }

  public getStats(): BatcherStats {
    return {
      pendingCount: this.queue.size,
      flushedTotal: this.flushedTotal,
      batchesTotal: this.batchesTotal,
      lastFlushedAt: this.lastFlushedAt,
    };
  }

  public resetStats(): void {
    this.flushedTotal = 0;
    this.batchesTotal = 0;
    this.lastFlushedAt = 0;
  }

  public close(): void {
    this.flushSync();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * 2. 课堂节奏晴雨表内存聚合与微批量落库器 (PacingSignalAccumulator)
 */
export class PacingSignalAccumulator {
  // key: `${sessionId}::${segmentId}::${studentId}` -> PacingSignalRecord
  private signals = new Map<string, PacingSignalRecord>();
  // dirtyQueue: key -> PacingSignalRecord
  private dirtyQueue = new Map<string, PacingSignalRecord>();
  // 已初始化的 session 集合，防止多次重复全表同步
  private initializedSessions = new Set<string>();

  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private flushedTotal = 0;
  private batchesTotal = 0;
  private lastFlushedAt = 0;
  private dbProvider: () => Database.Database;

  constructor(options?: { flushIntervalMs?: number; maxBatchSize?: number; dbProvider?: () => Database.Database }) {
    this.flushIntervalMs = options?.flushIntervalMs ?? 500;
    this.maxBatchSize = options?.maxBatchSize ?? 50;
    this.dbProvider = options?.dbProvider ?? (() => kernelContainer.db);
  }

  private makeKey(sessionId: string, segmentId: string, studentId: string): string {
    return `${sessionId}::${segmentId || 'default'}::${studentId}`;
  }

  /**
   * 确保 session 的历史信号已载入内存
   */
  public ensureSessionLoaded(sessionId: string): void {
    if (this.initializedSessions.has(sessionId)) return;
    this.initializedSessions.add(sessionId);

    const db = this.dbProvider();
    if (!db || !db.open) return;

    try {
      const rows = db
        .prepare(
          'SELECT id, session_id, student_id, signal_type, segment_id, created_at FROM classroom_pacing_signals WHERE session_id = ?',
        )
        .all(sessionId) as Array<{
        id: string;
        session_id: string;
        student_id: string;
        signal_type: string;
        segment_id?: string | null;
        created_at: number;
      }>;

      for (const r of rows) {
        const seg = r.segment_id || 'default';
        const key = this.makeKey(r.session_id, seg, r.student_id);
        if (!this.signals.has(key)) {
          this.signals.set(key, {
            id: r.id,
            sessionId: r.session_id,
            segmentId: seg,
            studentId: r.student_id,
            signalType: r.signal_type,
            updatedAt: r.created_at,
          });
        }
      }
    } catch {
      // 容错处理
    }
  }

  /**
   * 记录学生节奏信号（内存立即更新并返回聚合，脏记录加入异步批写队列）
   */
  public recordSignal(params: {
    sessionId: string;
    segmentId: string;
    studentId: string;
    signal?: string | null;
    action?: string;
    toggle?: boolean;
    signalType?: string | null;
    now?: number;
    existingId?: string;
  }): PacingSummaryResult {
    const { sessionId, studentId } = params;
    const segmentId = params.segmentId || 'default';
    const rawSignal = params.signal !== undefined ? params.signal : params.signalType;
    const isCancelAction = params.action === 'cancel' || rawSignal === null || rawSignal === 'CANCEL';
    const now = params.now ?? Date.now();

    this.ensureSessionLoaded(sessionId);

    const key = this.makeKey(sessionId, segmentId, studentId);
    const existing = this.signals.get(key);

    let nextSignal: string | null = null;
    if (isCancelAction || (params.toggle && existing && existing.signalType === rawSignal)) {
      // 取消操作或重复点击同一选项触发 toggle 取消
      nextSignal = null;
    } else {
      nextSignal = rawSignal ?? null;
    }

    const id = existing?.id || params.existingId || `ps_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const record: PacingSignalRecord = {
      id,
      sessionId,
      segmentId,
      studentId,
      signalType: nextSignal,
      updatedAt: now,
    };

    if (nextSignal === null) {
      this.signals.delete(key);
    } else {
      this.signals.set(key, record);
    }

    // 加入脏队列待批写落库
    this.dirtyQueue.set(key, record);

    if (this.dirtyQueue.size >= this.maxBatchSize) {
      this.flushSync();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushSync();
      }, this.flushIntervalMs);
      if (typeof this.timer?.unref === 'function') {
        this.timer.unref();
      }
    }

    return this.getSummary(sessionId, segmentId, studentId);
  }

  /**
   * 获取会话在特定环节与全局的节奏统计及当前学生状态
   */
  public getSummary(sessionId: string, segmentId = 'default', studentId?: string): PacingSummaryResult {
    this.ensureSessionLoaded(sessionId);

    const summary: Record<string, number> = { TOO_FAST: 0, SLOW: 0, CONFUSED: 0, CLEAR: 0 };
    const overall: Record<string, number> = { TOO_FAST: 0, SLOW: 0, CONFUSED: 0, CLEAR: 0 };
    let currentSignal: string | null = null;
    let totalInSegment = 0;
    let totalOverall = 0;

    // 单次遍历内存 Map 完成聚合
    for (const record of this.signals.values()) {
      if (record.sessionId !== sessionId || !record.signalType) continue;

      // 累加总体统计
      overall[record.signalType] = (overall[record.signalType] || 0) + 1;
      totalOverall += 1;

      // 环节维度聚合
      if (
        record.segmentId === segmentId ||
        (segmentId === 'default' && (!record.segmentId || record.segmentId === 'default'))
      ) {
        summary[record.signalType] = (summary[record.signalType] || 0) + 1;
        totalInSegment += 1;
        if (studentId && record.studentId === studentId) {
          currentSignal = record.signalType;
        }
      }
    }

    return {
      currentSignal,
      summary,
      overall,
      overallSummary: overall,
      totalInSegment,
      totalOverall,
    };
  }

  /**
   * 获取按环节细分与全课总体的完整明细聚合（直接在内存中计算，避免 SQLite GROUP BY 慢查穿透）
   */
  public getBreakdown(
    sessionId: string,
    targetSegmentId = 'default',
  ): {
    segmentsBreakdown: Record<string, Record<string, number>>;
    overallSummary: Record<string, number>;
    currentSegmentSummary: Record<string, number>;
  } {
    this.ensureSessionLoaded(sessionId);

    const segmentsBreakdown: Record<string, Record<string, number>> = {};
    const overallSummary: Record<string, number> = { TOO_FAST: 0, SLOW: 0, CONFUSED: 0, CLEAR: 0 };
    const currentSegmentSummary: Record<string, number> = { TOO_FAST: 0, SLOW: 0, CONFUSED: 0, CLEAR: 0 };

    for (const record of this.signals.values()) {
      if (record.sessionId !== sessionId || !record.signalType) continue;
      const segKey = record.segmentId || 'default';
      if (!segmentsBreakdown[segKey]) {
        segmentsBreakdown[segKey] = { TOO_FAST: 0, SLOW: 0, CONFUSED: 0, CLEAR: 0 };
      }
      segmentsBreakdown[segKey][record.signalType] = (segmentsBreakdown[segKey][record.signalType] || 0) + 1;
      overallSummary[record.signalType] = (overallSummary[record.signalType] || 0) + 1;
      if (segKey === targetSegmentId) {
        currentSegmentSummary[record.signalType] = (currentSegmentSummary[record.signalType] || 0) + 1;
      }
    }

    return { segmentsBreakdown, overallSummary, currentSegmentSummary };
  }

  /**
   * 同步落库当前脏队列（单一原子事务）
   */
  public flushSync(): number {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.dirtyQueue.size === 0) return 0;

    const records = Array.from(this.dirtyQueue.values());
    this.dirtyQueue.clear();

    const db = this.dbProvider();
    if (!db || !db.open) return 0;

    try {
      const deleteStmt = db.prepare(
        "DELETE FROM classroom_pacing_signals WHERE session_id = ? AND student_id = ? AND (segment_id = ? OR (segment_id IS NULL AND ? = 'default'))",
      );
      const upsertStmt = db.prepare(
        `INSERT OR REPLACE INTO classroom_pacing_signals (id, session_id, student_id, signal_type, segment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );

      const tx = db.transaction((items: PacingSignalRecord[]) => {
        for (const item of items) {
          if (item.signalType === null) {
            deleteStmt.run(item.sessionId, item.studentId, item.segmentId, item.segmentId);
          } else {
            upsertStmt.run(item.id, item.sessionId, item.studentId, item.signalType, item.segmentId, item.updatedAt);
          }
        }
      });
      tx(records);

      this.flushedTotal += records.length;
      this.batchesTotal += 1;
      this.lastFlushedAt = Date.now();
      return records.length;
    } catch {
      // 容错处理
      return 0;
    }
  }

  /**
   * 清除会话内存缓存（会话结束或清除时调用）
   */
  public clearSession(sessionId: string): void {
    for (const [key, record] of Array.from(this.signals.entries())) {
      if (record.sessionId === sessionId) {
        this.signals.delete(key);
      }
    }
    for (const [key, record] of Array.from(this.dirtyQueue.entries())) {
      if (record.sessionId === sessionId) {
        this.dirtyQueue.delete(key);
      }
    }
    this.initializedSessions.delete(sessionId);
  }

  public getStats(): BatcherStats & { activeSignalsCount: number; dirtyQueueSize: number } {
    return {
      pendingCount: this.dirtyQueue.size,
      dirtyQueueSize: this.dirtyQueue.size,
      activeSignalsCount: this.signals.size,
      flushedTotal: this.flushedTotal,
      batchesTotal: this.batchesTotal,
      lastFlushedAt: this.lastFlushedAt,
    };
  }

  public resetStats(): void {
    this.flushedTotal = 0;
    this.batchesTotal = 0;
    this.lastFlushedAt = 0;
  }

  public close(): void {
    this.flushSync();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** 单例导出 */
export const sessionTouchBatcher = new SessionTouchBatcher();
export const pacingSignalAccumulator = new PacingSignalAccumulator();
