import { describe, expect, it } from 'vitest';
import {
  aggregateVerdicts,
  evaluateBuiltinGate,
  legacyLessonGates,
  resolveSegmentGates,
  type SegmentGateFacts,
} from '../segment-gate.js';

function facts(partial: Partial<SegmentGateFacts> = {}): SegmentGateFacts {
  return {
    quizzes: [],
    assignments: [],
    dwellSecondsBySegment: {},
    checkedIn: false,
    previousSegmentId: 'seg-a',
    ...partial,
  };
}

describe('segment gate builtins', () => {
  it('quiz_completed 只统计来源环节上的练习，缺题则拒绝', () => {
    const empty = evaluateBuiltinGate({ type: 'quiz_completed', params: {} }, facts());
    expect(empty.allowed).toBe(false);
    expect(empty.reason).toContain('没有可核对的练习');

    const pending = evaluateBuiltinGate(
      { type: 'quiz_completed', params: {} },
      facts({
        quizzes: [
          { elementId: 'q1', segmentId: 'seg-a', submitted: true, score: 100, isQuiz: true },
          { elementId: 'q2', segmentId: 'seg-a', submitted: false, score: 0, isQuiz: true },
          { elementId: 'note', segmentId: 'seg-a', submitted: false, score: 0, isQuiz: false },
        ],
      }),
    );
    expect(pending.allowed).toBe(false);
    expect(pending.progress).toEqual({ current: 1, target: 2, unit: '题' });

    const done = evaluateBuiltinGate(
      { type: 'quiz_completed', params: { elementId: 'q2' } },
      facts({
        quizzes: [{ elementId: 'q2', segmentId: 'other', submitted: true, score: 0, isQuiz: true }],
      }),
    );
    expect(done.allowed).toBe(true);
  });

  it('quiz_accuracy 默认 60 分，未交按 0 计入平均', () => {
    const low = evaluateBuiltinGate(
      { type: 'quiz_accuracy', params: {} },
      facts({
        quizzes: [
          { elementId: 'q1', segmentId: 'seg-a', submitted: true, score: 100, isQuiz: true },
          { elementId: 'q2', segmentId: 'seg-a', submitted: false, score: 0, isQuiz: true },
        ],
      }),
    );
    expect(low.allowed).toBe(false);
    expect(low.progress?.current).toBe(50);

    const high = evaluateBuiltinGate(
      { type: 'quiz_accuracy', params: { minScore: 80 } },
      facts({
        quizzes: [{ elementId: 'q1', segmentId: 'seg-a', submitted: true, score: 90, isQuiz: true }],
      }),
    );
    expect(high.allowed).toBe(true);
  });

  it('assignment_submitted 按环节或指定作业核对', () => {
    const missing = evaluateBuiltinGate({ type: 'assignment_submitted', params: {} }, facts());
    expect(missing.reason).toContain('没有可核对的作业');

    const open = evaluateBuiltinGate(
      { type: 'assignment_submitted', params: { assignmentId: 'hw-1' } },
      facts({ assignments: [{ assignmentId: 'hw-1', segmentId: null, submitted: false }] }),
    );
    expect(open.allowed).toBe(false);

    const sent = evaluateBuiltinGate(
      { type: 'assignment_submitted', params: {} },
      facts({ assignments: [{ assignmentId: 'hw-1', segmentId: 'seg-a', submitted: true }] }),
    );
    expect(sent.allowed).toBe(true);
  });

  it('dwell_seconds 要求正数秒，并累计指定或上一环节', () => {
    expect(evaluateBuiltinGate({ type: 'dwell_seconds', params: {} }, facts()).reason).toContain('未配置');
    expect(
      evaluateBuiltinGate({ type: 'dwell_seconds', params: { seconds: 30 } }, facts({ previousSegmentId: null }))
        .reason,
    ).toContain('没有可计时');

    const short = evaluateBuiltinGate(
      { type: 'dwell_seconds', params: { seconds: 30 } },
      facts({ dwellSecondsBySegment: { 'seg-a': 12.9 } }),
    );
    expect(short.allowed).toBe(false);
    expect(short.progress).toEqual({ current: 12, target: 30, unit: '秒' });

    const enough = evaluateBuiltinGate(
      { type: 'dwell_seconds', params: { seconds: 30, segmentId: 'seg-z' } },
      facts({ dwellSecondsBySegment: { 'seg-z': 30 } }),
    );
    expect(enough.allowed).toBe(true);
  });

  it('checked_in 只看签到事实', () => {
    expect(evaluateBuiltinGate({ type: 'checked_in', params: {} }, facts()).allowed).toBe(false);
    expect(evaluateBuiltinGate({ type: 'checked_in', params: {} }, facts({ checkedIn: true })).allowed).toBe(true);
  });

  it('未知类型标记 deferred，聚合时按 AND 拒绝', () => {
    const deferred = evaluateBuiltinGate({ type: 'plugin.custom', params: {} }, facts());
    expect(deferred.deferred).toBe(true);
    expect(deferred.allowed).toBe(false);
    const summary = aggregateVerdicts([
      { type: 'checked_in', allowed: false, reason: '尚未签到' },
      { type: 'quiz_completed', allowed: false, reason: '练习尚未完成（0/1）', progress: { current: 0, target: 1 } },
    ]);
    expect(summary.allowed).toBe(false);
    expect(summary.reason).toContain('尚未签到');
    expect(summary.reason).toContain('练习尚未完成');
    expect(summary.progress).toEqual({ current: 0, target: 1 });
  });
});

describe('resolveSegmentGates', () => {
  it('环节自己的 gates 优先，第一环默认放行', () => {
    const own = resolveSegmentGates({ id: 'seg-a', gates: [{ type: 'checked_in' }] }, 0, 'manual', null);
    expect(own.gates.map((g) => g.type)).toEqual(['checked_in']);
    expect(own.usedDeprecatedProgressConditions).toBe(false);

    const first = resolveSegmentGates({ id: 'seg-a' }, 0, 'gated', { minQuizScore: 80 });
    expect(first.gates).toEqual([]);
  });

  it('第二环在没有 gates 且 progress_mode=gated 时映射已知课级字段', () => {
    const legacy = legacyLessonGates({
      minQuizScore: 70,
      requireQuiz: true,
      requireAttendance: true,
      requireSubmission: true,
      minDwellSeconds: 15,
      ignored: 'nope',
    });
    expect(legacy.map((g) => g.type)).toEqual([
      'quiz_accuracy',
      'quiz_completed',
      'checked_in',
      'assignment_submitted',
      'dwell_seconds',
    ]);

    const resolved = resolveSegmentGates({ id: 'seg-b' }, 1, 'gated', { minQuizScore: 70 });
    expect(resolved.usedDeprecatedProgressConditions).toBe(true);
    expect(resolved.gates[0].params).toEqual({ minScore: 70 });

    const manual = resolveSegmentGates({ id: 'seg-b' }, 1, 'manual', { minQuizScore: 70 });
    expect(manual.gates).toEqual([]);
  });
});
