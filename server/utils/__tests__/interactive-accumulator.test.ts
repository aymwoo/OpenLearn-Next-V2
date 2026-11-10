import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../packages/core/db/index.js';
import { SessionTouchBatcher, PacingSignalAccumulator } from '../interactive-accumulator.js';

describe('高频互动状态轻量写入节流与微批量落库引擎 (Issue #411)', () => {
  describe('1. 会话活跃度微批量更新 (SessionTouchBatcher)', () => {
    let batcher: SessionTouchBatcher;
    const testTokens = ['test_tok_1', 'test_tok_2', 'test_tok_3'];

    beforeEach(() => {
      // 插入测试会话数据
      const now = Date.now() - 600000;
      for (const tok of testTokens) {
        db.prepare(
          'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
        ).run(tok, JSON.stringify({ userId: tok, role: 'student' }), now, now + 86400000);
      }
      batcher = new SessionTouchBatcher({
        flushIntervalMs: 200,
        maxBatchSize: 5,
        dbProvider: () => db,
      });
    });

    afterEach(() => {
      batcher.close();
      for (const tok of testTokens) {
        db.prepare('DELETE FROM client_sessions WHERE id = ?').run(tok);
      }
    });

    it('touch 会话仅在内存累积脏标记，不立即向 SQLite 执行单条写事务', () => {
      batcher.touch(testTokens[0], Date.now());
      batcher.touch(testTokens[1], Date.now());

      const stats = batcher.getStats();
      expect(stats.pendingCount).toBe(2);
      expect(stats.flushedTotal).toBe(0);
    });

    it('flushSync 以单一事务微批量提交所有积累的 updated_at 时间戳', () => {
      const updateTime = Date.now() + 10000;
      batcher.touch(testTokens[0], updateTime);
      batcher.touch(testTokens[1], updateTime);
      batcher.touch(testTokens[2], updateTime);

      const flushed = batcher.flushSync();
      expect(flushed).toBe(3);

      const stats = batcher.getStats();
      expect(stats.pendingCount).toBe(0);
      expect(stats.flushedTotal).toBe(3);
      expect(stats.batchesTotal).toBe(1);

      // 验证 DB 中数据已批量更新
      const row0 = db.prepare('SELECT updated_at FROM client_sessions WHERE id = ?').get(testTokens[0]) as {
        updated_at: number;
      };
      expect(row0.updated_at).toBe(updateTime);
    });

    it('当累积队列达到 maxBatchSize 阈值时触发自动立即落库', () => {
      for (let i = 0; i < 5; i++) {
        batcher.touch(`token_fill_${i}`, Date.now());
      }
      // 达到 maxBatchSize = 5，自动触发了 flush
      const stats = batcher.getStats();
      expect(stats.batchesTotal).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. 课堂节奏晴雨表内存聚合与微批量落库 (PacingSignalAccumulator)', () => {
    let accumulator: PacingSignalAccumulator;
    const testSessionId = `test_sess_${Date.now()}`;

    beforeEach(() => {
      accumulator = new PacingSignalAccumulator({
        flushIntervalMs: 200,
        maxBatchSize: 10,
        dbProvider: () => db,
      });
    });

    afterEach(() => {
      accumulator.close();
      db.prepare('DELETE FROM classroom_pacing_signals WHERE session_id = ?').run(testSessionId);
    });

    it('recordSignal 立即在内存中维护并返回 O(1) 聚合结果，无需同步阻塞 DB', () => {
      // 学生 1 发送 CLEAR 信号
      const res1 = accumulator.recordSignal({
        sessionId: testSessionId,
        segmentId: 'seg_intro',
        studentId: 'stu_1',
        signal: 'CLEAR',
      });

      expect(res1.currentSignal).toBe('CLEAR');
      expect(res1.summary.CLEAR).toBe(1);
      expect(res1.summary.CONFUSED).toBe(0);
      expect(res1.overallSummary.CLEAR).toBe(1);

      // 学生 2 发送 CONFUSED 信号
      const res2 = accumulator.recordSignal({
        sessionId: testSessionId,
        segmentId: 'seg_intro',
        studentId: 'stu_2',
        signal: 'CONFUSED',
      });

      expect(res2.currentSignal).toBe('CONFUSED');
      expect(res2.summary.CLEAR).toBe(1);
      expect(res2.summary.CONFUSED).toBe(1);
      expect(res2.totalInSegment).toBe(2);

      // 检查此时 DB 尚未写入（暂存于脏队列）
      const countBeforeFlush = (
        db.prepare('SELECT COUNT(*) as cnt FROM classroom_pacing_signals WHERE session_id = ?').get(testSessionId) as {
          cnt: number;
        }
      ).cnt;
      expect(countBeforeFlush).toBe(0);

      // 手动触发微批量落库
      const flushed = accumulator.flushSync();
      expect(flushed).toBe(2);

      const countAfterFlush = (
        db.prepare('SELECT COUNT(*) as cnt FROM classroom_pacing_signals WHERE session_id = ?').get(testSessionId) as {
          cnt: number;
        }
      ).cnt;
      expect(countAfterFlush).toBe(2);
    });

    it('同一学生重复点击相同选项触发 toggle 取消，且落库时同步清理', () => {
      accumulator.recordSignal({
        sessionId: testSessionId,
        segmentId: 'seg_intro',
        studentId: 'stu_toggle',
        signal: 'TOO_FAST',
      });
      expect(accumulator.getSummary(testSessionId, 'seg_intro', 'stu_toggle').currentSignal).toBe('TOO_FAST');

      // 再次点击相同选项并开启 toggle: true
      const toggleRes = accumulator.recordSignal({
        sessionId: testSessionId,
        segmentId: 'seg_intro',
        studentId: 'stu_toggle',
        signal: 'TOO_FAST',
        toggle: true,
      });

      expect(toggleRes.currentSignal).toBeNull();
      expect(toggleRes.summary.TOO_FAST).toBe(0);

      // 落库后验证记录被清理
      accumulator.flushSync();
      const inDb = db
        .prepare('SELECT * FROM classroom_pacing_signals WHERE session_id = ? AND student_id = ?')
        .get(testSessionId, 'stu_toggle');
      expect(inDb).toBeUndefined();
    });

    it('多环节数据在内存中精准归集，环节聚合与课节总体聚合各司其职', () => {
      accumulator.recordSignal({
        sessionId: testSessionId,
        segmentId: 'seg_1',
        studentId: 'stu_multi',
        signal: 'CLEAR',
      });
      accumulator.recordSignal({
        sessionId: testSessionId,
        segmentId: 'seg_2',
        studentId: 'stu_multi',
        signal: 'SLOW',
      });

      const seg1Summary = accumulator.getSummary(testSessionId, 'seg_1', 'stu_multi');
      expect(seg1Summary.currentSignal).toBe('CLEAR');
      expect(seg1Summary.summary.CLEAR).toBe(1);
      expect(seg1Summary.summary.SLOW).toBe(0);
      expect(seg1Summary.overallSummary.CLEAR).toBe(1);
      expect(seg1Summary.overallSummary.SLOW).toBe(1);

      const seg2Summary = accumulator.getSummary(testSessionId, 'seg_2', 'stu_multi');
      expect(seg2Summary.currentSignal).toBe('SLOW');
      expect(seg2Summary.summary.SLOW).toBe(1);
      expect(seg2Summary.summary.CLEAR).toBe(0);
    });
  });
});
