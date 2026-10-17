/**
 * 时间窗与惰性超时结算（Issue #100 讨论结论）。
 *
 * 三条规则：
 * 1. **`duration_sec` 与 `closes_at` 取更早者**作为实际 deadline —— 教师同时配了"限时 30 分钟"
 *    和"23:00 截止"时，学生不该在 23:05 还能交卷；
 * 2. `opens_at` 之前一律拒绝开始作答（`before_open`）；
 * 3. **惰性结算**：任何读取到 `now > deadlineAt` 的 `in_progress` 尝试都结算为 `submitted`，
 *    不引入后台定时器进程（无守护任务、重启不丢状态、并发安全由 SQL 条件更新保证）。
 */
import type { AttemptStatus } from './types.js';

export interface AssessmentWindow {
  opensAt?: number | null;
  closesAt?: number | null;
  durationSec?: number | null;
}

export type WindowState = 'before_open' | 'open' | 'after_close' | 'untimed';

/** 计算该布置此刻是否可开始作答。 */
export function readWindowState(window: AssessmentWindow, now: number): WindowState {
  const { opensAt, closesAt } = window;
  if (typeof opensAt === 'number' && now < opensAt) return 'before_open';
  if (typeof closesAt === 'number' && now >= closesAt) return 'after_close';
  if (typeof opensAt !== 'number' && typeof closesAt !== 'number' && !window.durationSec) return 'untimed';
  return 'open';
}

/**
 * 计算一次作答的截止时间。三个来源取**最小值**：
 * `startedAt + durationSec`、`closesAt`、以及调用方传入的 `attemptDeadline`（续答时沿用）。
 * 三者都没有则返回 `null`（不限时）。
 */
export function computeDeadline(
  window: AssessmentWindow,
  startedAt: number,
  attemptDeadline?: number | null,
): number | null {
  const candidates: number[] = [];
  if (typeof window.durationSec === 'number' && window.durationSec > 0) {
    candidates.push(startedAt + window.durationSec * 1000);
  }
  if (typeof window.closesAt === 'number') candidates.push(window.closesAt);
  if (typeof attemptDeadline === 'number') candidates.push(attemptDeadline);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export interface SettleInput {
  status: AttemptStatus;
  deadlineAt: number | null;
  submittedAt: number | null;
}

export interface SettleOutcome {
  /** 是否需要写库（只在 in_progress 且已过期时为 true） */
  shouldSettle: boolean;
  status: AttemptStatus;
  submittedAt: number | null;
  /** 结算时用的时间戳：优先 deadline（超时点），让成绩单上的交卷时间与事实一致 */
  settledAt: number | null;
}

/**
 * 惰性结算判定。已是 `submitted`/`graded`/`released` 的尝试不受影响（幂等）。
 */
export function settleAttempt(input: SettleInput, now: number): SettleOutcome {
  const { status, deadlineAt, submittedAt } = input;
  if (status !== 'in_progress') {
    return { shouldSettle: false, status, submittedAt, settledAt: null };
  }
  if (deadlineAt !== null && now > deadlineAt) {
    return { shouldSettle: true, status: 'submitted', submittedAt: deadlineAt, settledAt: deadlineAt };
  }
  return { shouldSettle: false, status, submittedAt, settledAt: null };
}

/** 剩余秒数（用于学生端倒计时展示；已过期给 0，不限时给 null）。 */
export function remainingSeconds(deadlineAt: number | null, now: number): number | null {
  if (deadlineAt === null) return null;
  return Math.max(0, Math.round((deadlineAt - now) / 1000));
}

/** 学生端列表排序键：待完成按 deadline 升序（无截止置底），已完成按交卷时间降序。 */
export function compareStudentAssignments(
  a: { completed: boolean; deadlineAt: number | null; submittedAt: number | null },
  b: { completed: boolean; deadlineAt: number | null; submittedAt: number | null },
): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  if (!a.completed) {
    if (a.deadlineAt === null && b.deadlineAt === null) return 0;
    if (a.deadlineAt === null) return 1;
    if (b.deadlineAt === null) return -1;
    return a.deadlineAt - b.deadlineAt;
  }
  return (b.submittedAt ?? 0) - (a.submittedAt ?? 0);
}
