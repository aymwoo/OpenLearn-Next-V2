/**
 * 教学环节门槛的纯判定。
 *
 * 配置写在 `lessons.timeline` 的环节对象上：`gates: [{ id?, type, params? }]`。
 * 本模块不读数据库、不调用插件。宿主把事实快照填进来，再对内置类型做 AND 判定。
 * 未知类型返回 `deferred: true`，由服务端去调插件声明的只读命令。
 */

export const BUILTIN_SEGMENT_GATE_TYPES = [
  'quiz_completed',
  'quiz_accuracy',
  'assignment_submitted',
  'dwell_seconds',
  'checked_in',
] as const;

export type BuiltinSegmentGateType = (typeof BUILTIN_SEGMENT_GATE_TYPES)[number];

export interface SegmentGateConfig {
  id?: string;
  type: string;
  params?: Record<string, unknown>;
}

export interface SegmentGateProgress {
  current: number;
  target: number;
  unit?: string;
}

export interface SegmentGateVerdict {
  type: string;
  allowed: boolean;
  reason?: string;
  progress?: SegmentGateProgress;
  /** 不是内置类型，交给插件命令 */
  deferred?: boolean;
}

export interface QuizFact {
  elementId: string;
  segmentId: string | null;
  submitted: boolean;
  score: number;
  /** 练习题（type=quiz、带正确答案，或已有提交）。无 elementId 时只统计这些。 */
  isQuiz: boolean;
}

export interface AssignmentFact {
  assignmentId: string;
  segmentId: string | null;
  submitted: boolean;
}

export interface SegmentGateFacts {
  quizzes: QuizFact[];
  assignments: AssignmentFact[];
  /** 已结束的停留加上仍打开的访问，单位秒 */
  dwellSecondsBySegment: Record<string, number>;
  checkedIn: boolean;
  /** 时间轴上目标环节的前一环。第一环为 null。 */
  previousSegmentId: string | null;
}

export interface TimelineSegmentLike {
  id?: string;
  gates?: unknown;
}

const BUILTIN = new Set<string>(BUILTIN_SEGMENT_GATE_TYPES);

export function parseGateList(raw: unknown): SegmentGateConfig[] {
  if (!Array.isArray(raw)) return [];
  const gates: SegmentGateConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const type = (item as { type?: unknown }).type;
    if (typeof type !== 'string' || type.trim().length === 0) continue;
    const paramsRaw = (item as { params?: unknown }).params;
    const params =
      paramsRaw && typeof paramsRaw === 'object' && !Array.isArray(paramsRaw)
        ? (paramsRaw as Record<string, unknown>)
        : {};
    const id = (item as { id?: unknown }).id;
    gates.push({
      id: typeof id === 'string' && id.trim() ? id.trim() : undefined,
      type: type.trim(),
      params,
    });
  }
  return gates;
}

/**
 * 课级 `progress_mode=gated` + `progress_conditions` 的兼容映射。
 * 只识别历史上测试与文档出现过的字段。新课请把条件写在环节 `gates` 上。
 */
export function legacyLessonGates(conditions: unknown): SegmentGateConfig[] {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) return [];
  const c = conditions as Record<string, unknown>;
  const gates: SegmentGateConfig[] = [];
  if (typeof c.minQuizScore === 'number' && Number.isFinite(c.minQuizScore)) {
    gates.push({ id: 'legacy-min-quiz-score', type: 'quiz_accuracy', params: { minScore: c.minQuizScore } });
  }
  if (c.requireQuiz === true) {
    gates.push({ id: 'legacy-quiz', type: 'quiz_completed', params: {} });
  }
  if (c.requireAttendance === true || c.checkedIn === true) {
    gates.push({ id: 'legacy-attendance', type: 'checked_in', params: {} });
  }
  if (c.requireAssignment === true || c.requireSubmission === true) {
    gates.push({ id: 'legacy-assignment', type: 'assignment_submitted', params: {} });
  }
  if (typeof c.minDwellSeconds === 'number' && Number.isFinite(c.minDwellSeconds)) {
    gates.push({ id: 'legacy-dwell', type: 'dwell_seconds', params: { seconds: c.minDwellSeconds } });
  }
  return gates;
}

export interface ResolvedSegmentGates {
  gates: SegmentGateConfig[];
  /** 本环节没有自己的 gates，用了已废弃的课级 progress_conditions */
  usedDeprecatedProgressConditions: boolean;
}

/**
 * 环节自己的 gates 优先。没有时，仅从第二环起套用课级 gated 兼容规则。
 * 第一环默认放行，避免学生无法开始。
 */
export function resolveSegmentGates(
  segment: TimelineSegmentLike | null | undefined,
  index: number,
  progressMode: string | null | undefined,
  progressConditions: unknown,
): ResolvedSegmentGates {
  const own = parseGateList(segment?.gates);
  if (own.length > 0) return { gates: own, usedDeprecatedProgressConditions: false };
  if (index > 0 && progressMode === 'gated') {
    const legacy = legacyLessonGates(progressConditions);
    if (legacy.length > 0) return { gates: legacy, usedDeprecatedProgressConditions: true };
  }
  return { gates: [], usedDeprecatedProgressConditions: false };
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sourceSegmentId(gate: SegmentGateConfig, facts: SegmentGateFacts): string | null {
  return asId(gate.params?.segmentId) || facts.previousSegmentId;
}

function quizzesFor(gate: SegmentGateConfig, facts: SegmentGateFacts): QuizFact[] {
  const elementId = asId(gate.params?.elementId);
  if (elementId) return facts.quizzes.filter((q) => q.elementId === elementId);
  const segmentId = sourceSegmentId(gate, facts);
  return facts.quizzes.filter((q) => q.isQuiz && segmentId !== null && q.segmentId === segmentId);
}

function assignmentsFor(gate: SegmentGateConfig, facts: SegmentGateFacts): AssignmentFact[] {
  const assignmentId = asId(gate.params?.assignmentId);
  if (assignmentId) return facts.assignments.filter((a) => a.assignmentId === assignmentId);
  const segmentId = sourceSegmentId(gate, facts);
  return facts.assignments.filter((a) => segmentId !== null && a.segmentId === segmentId);
}

function evaluateQuizCompleted(gate: SegmentGateConfig, facts: SegmentGateFacts): SegmentGateVerdict {
  const quizzes = quizzesFor(gate, facts);
  if (quizzes.length === 0) {
    return {
      type: gate.type,
      allowed: false,
      reason: '没有可核对的练习',
      progress: { current: 0, target: 1, unit: '题' },
    };
  }
  const done = quizzes.filter((q) => q.submitted).length;
  const allowed = done === quizzes.length;
  return {
    type: gate.type,
    allowed,
    reason: allowed ? undefined : `练习尚未完成（${done}/${quizzes.length}）`,
    progress: { current: done, target: quizzes.length, unit: '题' },
  };
}

function evaluateQuizAccuracy(gate: SegmentGateConfig, facts: SegmentGateFacts): SegmentGateVerdict {
  const minScoreRaw = gate.params?.minScore;
  const minScore =
    typeof minScoreRaw === 'number' && Number.isFinite(minScoreRaw) ? Math.min(100, Math.max(0, minScoreRaw)) : 60;
  const quizzes = quizzesFor(gate, facts);
  if (quizzes.length === 0) {
    return {
      type: gate.type,
      allowed: false,
      reason: '没有可核对的练习得分',
      progress: { current: 0, target: minScore, unit: '分' },
    };
  }
  const average = quizzes.reduce((sum, q) => sum + (q.submitted ? q.score : 0), 0) / quizzes.length;
  const current = Math.round(average * 10) / 10;
  const allowed = current >= minScore;
  return {
    type: gate.type,
    allowed,
    reason: allowed ? undefined : `练习得分未达到 ${minScore} 分（当前 ${current} 分）`,
    progress: { current, target: minScore, unit: '分' },
  };
}

function evaluateAssignment(gate: SegmentGateConfig, facts: SegmentGateFacts): SegmentGateVerdict {
  const items = assignmentsFor(gate, facts);
  if (items.length === 0) {
    return {
      type: gate.type,
      allowed: false,
      reason: '没有可核对的作业',
      progress: { current: 0, target: 1, unit: '份' },
    };
  }
  const done = items.filter((a) => a.submitted).length;
  const allowed = done === items.length;
  return {
    type: gate.type,
    allowed,
    reason: allowed ? undefined : `作业尚未提交（${done}/${items.length}）`,
    progress: { current: done, target: items.length, unit: '份' },
  };
}

function evaluateDwell(gate: SegmentGateConfig, facts: SegmentGateFacts): SegmentGateVerdict {
  const secondsRaw = gate.params?.seconds;
  const seconds = typeof secondsRaw === 'number' && Number.isFinite(secondsRaw) ? secondsRaw : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { type: gate.type, allowed: false, reason: '停留时长未配置' };
  }
  const segmentId = sourceSegmentId(gate, facts);
  if (!segmentId) {
    return { type: gate.type, allowed: false, reason: '没有可计时的上一环节' };
  }
  const current = Math.floor(facts.dwellSecondsBySegment[segmentId] || 0);
  const target = Math.ceil(seconds);
  const allowed = current >= target;
  return {
    type: gate.type,
    allowed,
    reason: allowed ? undefined : `停留时长不足（${current}/${target} 秒）`,
    progress: { current, target, unit: '秒' },
  };
}

function evaluateCheckedIn(facts: SegmentGateFacts): SegmentGateVerdict {
  return {
    type: 'checked_in',
    allowed: facts.checkedIn,
    reason: facts.checkedIn ? undefined : '尚未签到',
    progress: { current: facts.checkedIn ? 1 : 0, target: 1, unit: '次' },
  };
}

/** 内置类型给出结论；其他类型标记 deferred，不在这里放行。 */
export function evaluateBuiltinGate(gate: SegmentGateConfig, facts: SegmentGateFacts): SegmentGateVerdict {
  if (!BUILTIN.has(gate.type)) {
    return { type: gate.type, allowed: false, deferred: true, reason: `未知条件类型 ${gate.type}` };
  }
  switch (gate.type as BuiltinSegmentGateType) {
    case 'quiz_completed':
      return evaluateQuizCompleted(gate, facts);
    case 'quiz_accuracy':
      return evaluateQuizAccuracy(gate, facts);
    case 'assignment_submitted':
      return evaluateAssignment(gate, facts);
    case 'dwell_seconds':
      return evaluateDwell(gate, facts);
    case 'checked_in':
      return evaluateCheckedIn(facts);
    default:
      return { type: gate.type, allowed: false, deferred: true, reason: `未知条件类型 ${gate.type}` };
  }
}

export function aggregateVerdicts(verdicts: SegmentGateVerdict[]): {
  allowed: boolean;
  reason?: string;
  progress?: SegmentGateProgress;
} {
  const failed = verdicts.filter((v) => !v.allowed);
  if (failed.length === 0) return { allowed: true };
  const reason =
    failed
      .map((v) => v.reason)
      .filter((r): r is string => !!r)
      .join('；') || '未满足进入本环节的条件';
  return { allowed: false, reason, progress: failed.find((v) => v.progress)?.progress };
}

export function parseProgressConditions(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
