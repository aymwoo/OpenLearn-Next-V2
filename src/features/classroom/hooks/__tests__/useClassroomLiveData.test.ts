import { describe, it, expect } from 'vitest';
import {
  deriveStudentMetrics,
  deriveHighlights,
  deriveStages,
  computeElapsedMin,
} from '../useClassroomLiveData';

/**
 * 课堂真实数据派生层单测。
 *
 * 核心不变量：**绝不编造**。
 *   - 无数据 → 0 / undefined / 空数组（而不是 60 分、98% 这类「看起来合理」的假值）
 *   - 每个派生量都能追溯到具体输入字段
 */
describe('useClassroomLiveData 派生逻辑', () => {
  // ── deriveStudentMetrics ─────────────────────────────────────────
  describe('deriveStudentMetrics', () => {
    it('参与度直接取自真实 progress_percent，不编造', () => {
      const metrics = deriveStudentMetrics(
        [{ id: 's1', name: '甲' }],
        [{ student_id: 's1', progress_percent: 73 }],
        ['s1'],
        [],
        [],
      );
      expect(metrics[0].participationScore).toBe(73);
      expect(metrics[0].progressPercent).toBe(73);
      expect(metrics[0].online).toBe(true);
    });

    it('无进度记录时参与度为 0（而不是回退到 60）', () => {
      const metrics = deriveStudentMetrics([{ id: 's1', name: '甲' }], [], [], [], []);
      expect(metrics[0].participationScore).toBe(0);
      expect(metrics[0].online).toBe(false);
      expect(metrics[0].behaviorTags).toContain('未接入');
      expect(metrics[0].behaviorTags).toContain('暂无进度');
    });

    it('同一学生多条进度取最大值', () => {
      const metrics = deriveStudentMetrics(
        [{ id: 's1', name: '甲' }],
        [
          { student_id: 's1', progress_percent: 30 },
          { student_id: 's1', progress_percent: 80 },
        ],
        ['s1'],
        [],
        [],
      );
      expect(metrics[0].progressPercent).toBe(80);
    });

    it('课件成绩取该生最高分，且排除 teacher/guest 占位 attempt', () => {
      const metrics = deriveStudentMetrics(
        [{ id: 's1', name: '甲' }],
        [],
        ['s1'],
        [
          { studentId: 's1', score: 60, completion: 0.5 },
          { studentId: 's1', score: 88, completion: 1 },
          { studentId: 's1', score: 40, completion: 0.2 },
          { studentId: 'teacher', score: 100, completion: 1 },
          { studentId: 'guest', score: 100, completion: 1 },
        ],
        [],
      );
      expect(metrics[0].quizScore).toBe(88);
      expect(metrics[0].completion).toBe(1);
    });

    it('无 attempt 时 quizScore 为 undefined（不是 0 也不是假分数）', () => {
      const metrics = deriveStudentMetrics([{ id: 's1', name: '甲' }], [], ['s1'], [], []);
      expect(metrics[0].quizScore).toBeUndefined();
      expect(metrics[0].completion).toBeUndefined();
    });

    it('行为标签可追溯到真实来源', () => {
      const metrics = deriveStudentMetrics(
        [{ id: 's1', name: '甲' }],
        [{ student_id: 's1', progress_percent: 90 }],
        ['s1'],
        [{ studentId: 's1', score: 95, completion: 1 }],
        [{ studentId: 's1' }],
      );
      const tags = metrics[0].behaviorTags;
      expect(tags).toContain('在线');
      expect(tags).toContain('进度领先 90%');
      expect(tags).toContain('课件 95 分');
      expect(tags).toContain('课件已完成');
      expect(tags).toContain('发生异常');
      expect(metrics[0].hasError).toBe(true);
    });

    it('studentName 回退顺序：name → student_number → id', () => {
      const metrics = deriveStudentMetrics(
        [
          { id: 's1', name: '甲' },
          { id: 's2', student_number: '2402' },
          { id: 's3' },
        ],
        [],
        [],
        [],
        [],
      );
      expect(metrics[0].studentName).toBe('甲');
      expect(metrics[1].studentName).toBe('2402');
      expect(metrics[2].studentName).toBe('s3');
    });
  });

  // ── deriveHighlights ─────────────────────────────────────────────
  describe('deriveHighlights', () => {
    it('只取真实事件流中命中类型的条目', () => {
      const highlights = deriveHighlights([
        { type: 'success', message: '全班抢答完成', time: '10:01' },
        { type: 'noise', message: '不该出现' },
        { type: 'answer', message: '张同学答对' },
        { type: 'checkin', message: '' },
        { type: 'achievement', message: '达成里程碑' },
      ]);
      expect(highlights).toEqual(['[10:01] 全班抢答完成', '张同学答对', '达成里程碑']);
    });

    it('事件流为空时返回空数组（不编造亮点）', () => {
      expect(deriveHighlights([])).toEqual([]);
    });

    it('最多返回 6 条', () => {
      const feed = Array.from({ length: 10 }, (_, i) => ({ type: 'success', message: `事件 ${i}` }));
      expect(deriveHighlights(feed)).toHaveLength(6);
    });
  });

  // ── deriveStages ─────────────────────────────────────────────────
  describe('deriveStages', () => {
    it('计划分钟来自 timelineSegments.duration（秒→分）', () => {
      const stages = deriveStages(
        [
          { title: '导入', duration: 300 },
          { title: '新授', duration: 1200 },
        ],
        0,
      );
      expect(stages).toEqual([
        { stageName: '导入', plannedMin: 5, actualMin: 0 },
        { stageName: '新授', plannedMin: 20, actualMin: 0 },
      ]);
    });

    it('已用时间按顺序填充，未开始环节 actualMin 为 0', () => {
      const stages = deriveStages(
        [
          { title: '导入', duration: 300 },
          { title: '新授', duration: 1200 },
          { title: '练习', duration: 600 },
        ],
        12, // 已用 12 分钟
      );
      expect(stages[0].actualMin).toBe(5); // 导入吃满 5
      expect(stages[1].actualMin).toBe(7); // 新授吃剩余 7
      expect(stages[2].actualMin).toBe(0); // 练习未开始
    });

    it('无环节时返回空数组（不造默认 45 分钟）', () => {
      expect(deriveStages([], 20)).toEqual([]);
    });

    it('环节缺 title 时使用占位名而不是空字符串', () => {
      const stages = deriveStages([{ duration: 60 }], 0);
      expect(stages[0].stageName).toBe('未命名环节');
    });
  });

  // ── computeElapsedMin ────────────────────────────────────────────
  describe('computeElapsedMin', () => {
    it('由真实 started_at 计算已用分钟', () => {
      const now = 1_700_000_000_000;
      expect(computeElapsedMin(now - 25 * 60 * 1000, now)).toBe(25);
    });

    it('无会话开始时间时为 0（不回退到假时长）', () => {
      expect(computeElapsedMin(null, Date.now())).toBe(0);
      expect(computeElapsedMin(undefined, Date.now())).toBe(0);
      expect(computeElapsedMin(0, Date.now())).toBe(0);
    });

    it('开始时间在未来时为 0（防御时钟漂移）', () => {
      const now = 1_700_000_000_000;
      expect(computeElapsedMin(now + 60_000, now)).toBe(0);
    });
  });
});
