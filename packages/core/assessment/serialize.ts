/**
 * 响应序列化 —— **白名单**（Issue #100 讨论结论 Q10 = a）。
 *
 * 标准答案（`answerKey` / `answer_key_json`）不允许出现在任何学生端响应里。
 * 这里刻意不用"删除敏感字段"的黑名单写法：黑名单漏一个字段就是一次答案泄漏，
 * 而白名单只输出显式列出的字段，新增字段默认不可见。
 *
 * `server/__tests__/assessment-api.test.ts` 用哨兵字符串对所有学生端响应做全量断言。
 */
import type { AssessmentSettings } from './settings.js';
import type { AssessmentItemRecord, AssessmentKind, AssessmentStatus, AttemptStatus, GraderSource } from './types.js';

/** 学生端看到的题目：**没有 answerKey**。 */
export interface StudentItemView {
  id: string;
  section: string | null;
  sortOrder: number;
  type: string;
  stem: string;
  config: Record<string, unknown>;
  maxScore: number;
}

/** 教师端看到的题目：含 answerKey（教师本来就能改答案）。 */
export interface TeacherItemView extends StudentItemView {
  bankItemId: string | null;
  answerKey: unknown;
}

export function toStudentItemView(item: AssessmentItemRecord): StudentItemView {
  return {
    id: item.id,
    section: item.section,
    sortOrder: item.sortOrder,
    type: item.type,
    stem: item.stem,
    config: item.config,
    maxScore: item.maxScore,
  };
}

export function toTeacherItemView(item: AssessmentItemRecord): TeacherItemView {
  return {
    ...toStudentItemView(item),
    bankItemId: item.bankItemId,
    answerKey: item.answerKey,
  };
}

export interface AssessmentSummaryView {
  id: string;
  kind: AssessmentKind;
  title: string;
  description: string | null;
  status: AssessmentStatus;
  academicYear: string | null;
  settings: AssessmentSettings;
  itemCount: number;
  totalScore: number;
  createdAt: number;
  updatedAt: number;
}

/** 学生作答视图：**不含 studentId / anonKey**（匿名问卷的隐私边界在这条上）。 */
export interface StudentAttemptView {
  id: string;
  assignmentId: string;
  attemptNo: number;
  status: AttemptStatus;
  startedAt: number;
  submittedAt: number | null;
  deadlineAt: number | null;
  remainingSeconds: number | null;
  /** 只有结果可见时才给分数 */
  score: number | null;
  maxScore: number | null;
  needsManualReview: boolean;
}

/** 教师作答视图：实名测评带 studentId，匿名问卷一律不带（仅管理员反查端点例外）。 */
export interface TeacherAttemptView extends Omit<StudentAttemptView, 'remainingSeconds'> {
  studentId: string | null;
  /** 匿名问卷的稳定编号（`匿名 1`），不做身份映射 */
  anonymousLabel?: string | null;
  proctor: Record<string, unknown>;
}

/** 逐题结果视图。`correctIndex`-类的标准答案只在允许看解析时出现。 */
export interface ItemResultView {
  itemId: string;
  type: string;
  stem: string;
  maxScore: number;
  score: number | null;
  isCorrect: boolean | null;
  needsManualReview: boolean;
  feedback: string | null;
  /** 学生自己的作答，原样回显 */
  answer: unknown;
  /** 标准答案：仅当允许看解析时提供 */
  answerKey?: unknown;
}

export interface ResultView {
  attempt: StudentAttemptView | TeacherAttemptView;
  items: ItemResultView[];
  scoreReleased: boolean;
  /** 是否允许展示逐题对错与解析 */
  showAnalysis: boolean;
}

export interface ScoreVisibilityInput {
  visibility: AssessmentSettings['resultVisibility'];
  /** 教师是否已发布成绩 */
  scoreReleased: boolean;
  submitted: boolean;
}

/** 学生此刻能否看到分数。 */
export function canStudentSeeScore({ visibility, scoreReleased, submitted }: ScoreVisibilityInput): boolean {
  if (!submitted) return false;
  if (visibility === 'immediate') return true;
  // after_release / score_only 都要等教师发布
  return scoreReleased;
}

/** 学生此刻能否看到逐题对错与解析（`score_only` 永远不给逐题）。 */
export function canStudentSeeAnalysis({
  visibility,
  scoreReleased,
  submitted,
  showItemAnalysis,
}: ScoreVisibilityInput & { showItemAnalysis: boolean }): boolean {
  if (!showItemAnalysis) return false;
  if (visibility === 'score_only') return false;
  if (!submitted) return false;
  if (visibility === 'immediate') return true;
  return scoreReleased;
}

export interface AttemptRowForView {
  id: string;
  assignmentId: string;
  studentId: string | null;
  anonKey: string | null;
  attemptNo: number;
  status: AttemptStatus;
  startedAt: number;
  submittedAt: number | null;
  deadlineAt: number | null;
  score: number | null;
  maxScore: number | null;
  needsManualReview: boolean;
  proctor: Record<string, unknown>;
}

/** 学生视角的一次作答。分数未可见时 `score` 恒为 null（连"部分分"都不泄露）。 */
export function toStudentAttemptView(
  row: AttemptRowForView,
  now: number,
  options: ScoreVisibilityInput & { remaining?: number | null },
): StudentAttemptView {
  const submitted = row.status !== 'in_progress';
  const showScore = canStudentSeeScore({ ...options, submitted });
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    attemptNo: row.attemptNo,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    deadlineAt: row.deadlineAt,
    remainingSeconds:
      options.remaining !== undefined
        ? options.remaining
        : row.deadlineAt
          ? Math.max(0, Math.round((row.deadlineAt - now) / 1000))
          : null,
    score: showScore ? row.score : null,
    maxScore: showScore ? row.maxScore : null,
    needsManualReview: showScore ? row.needsManualReview : false,
  };
}

/**
 * 教师视角的一次作答。
 *
 * `revealIdentity` 只在**管理员反查**路径传 true；普通教师拿到的匿名作答
 * 既没有 `studentId` 也没有 `anonKey`，只有稳定编号。
 */
export function toTeacherAttemptView(
  row: AttemptRowForView,
  options: { revealIdentity: boolean; anonymousLabel?: string | null },
): TeacherAttemptView {
  const isAnonymous = row.studentId === null;
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    attemptNo: row.attemptNo,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    deadlineAt: row.deadlineAt,
    score: row.score,
    maxScore: row.maxScore,
    needsManualReview: row.needsManualReview,
    studentId: isAnonymous ? (options.revealIdentity ? row.studentId : null) : row.studentId,
    anonymousLabel: isAnonymous ? (options.anonymousLabel ?? null) : null,
    proctor: row.proctor,
  };
}

/** 逐题结果：`withAnswerKey=false` 时根本不构造 `answerKey` 字段。 */
export function buildItemResultView(params: {
  item: AssessmentItemRecord;
  answer: unknown;
  score: number | null;
  isCorrect: boolean | null;
  needsManualReview: boolean;
  feedback: string | null;
  withAnswerKey: boolean;
}): ItemResultView {
  const { item, answer, score, isCorrect, needsManualReview, feedback, withAnswerKey } = params;
  const base: ItemResultView = {
    itemId: item.id,
    type: item.type,
    stem: item.stem,
    maxScore: item.maxScore,
    score,
    isCorrect,
    needsManualReview,
    feedback,
    answer,
  };
  if (withAnswerKey) base.answerKey = item.answerKey;
  return base;
}

/** 判分来源的展示名（教师端批改列表用）。 */
export function graderLabel(grader: GraderSource | null | undefined, zh = true): string {
  if (!grader) return zh ? '未判分' : 'Ungraded';
  if (grader === 'auto') return zh ? '自动判分' : 'Auto';
  if (grader === 'manual') return zh ? '人工批改' : 'Manual';
  if (grader === 'ai_suggested') return zh ? 'AI 建议' : 'AI suggested';
  return grader.replace(/^plugin:/, zh ? '插件：' : 'Plugin: ');
}
