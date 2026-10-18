/**
 * 测评中心 API 客户端（Issue #100 / 子 issue #121）。
 *
 * 只做 HTTP 与类型；所有业务规则（判分、可见性、匿名）都在服务端。
 * 类型与 `packages/core/assessment` 的领域类型对齐，避免两端漂移。
 */
import type { AssessmentKind, AssessmentSettings, AssessmentStatus } from '../../../packages/core/assessment/index.js';

export interface AssessmentSummary {
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

export interface AssessmentItemView {
  id: string;
  bankItemId?: string | null;
  section: string | null;
  sortOrder: number;
  type: string;
  stem: string;
  config: Record<string, unknown>;
  maxScore: number;
  /** 仅教师端返回 */
  answerKey?: unknown;
}

export interface AssessmentDetail extends AssessmentSummary {
  items: AssessmentItemView[];
}

export interface AssessmentAssignment {
  id: string;
  assessmentId: string;
  classId: string;
  lessonId: string | null;
  scheduleId: string | null;
  opensAt: number | null;
  closesAt: number | null;
  durationSec: number | null;
  status: 'open' | 'closed';
  scoreReleased: boolean;
  academicYear: string | null;
  createdAt: number;
}

export interface TeacherAttempt {
  id: string;
  assignmentId: string;
  attemptNo: number;
  status: string;
  startedAt: number;
  submittedAt: number | null;
  deadlineAt: number | null;
  score: number | null;
  maxScore: number | null;
  needsManualReview: boolean;
  studentId: string | null;
  anonymousLabel?: string | null;
  proctor: Record<string, unknown>;
}

export interface TeacherItemDetail {
  itemId: string;
  type: string;
  stem: string;
  maxScore: number;
  answer: unknown;
  answerKey: unknown;
  score: number | null;
  isCorrect: boolean | null;
  needsManualReview: boolean;
  feedback: string | null;
  grader: string | null;
  manualOverride: boolean;
  config: Record<string, unknown>;
}

/** Issue #187：AI 批改建议（教师确认前的建议，不含落分语义）。 */
export interface AiGradingSuggestion {
  itemId: string;
  maxScore: number;
  suggestedScore: number;
  rationale: string;
  confidence: number | null;
  generatedAt: number;
}

export interface AssessmentStats {
  assignmentId: string;
  attemptCount: number;
  submittedCount: number;
  gradedCount: number;
  needsManualReviewCount: number;
  averageScore: number | null;
  averagePercent: number | null;
  maxScore: number;
  items: Array<{
    itemId: string;
    type: string;
    stem: string;
    maxScore: number;
    answered: number;
    graded: number;
    correct: number;
    correctRate: number | null;
    avgScore: number | null;
    distribution: Record<string, number>;
  }>;
}

export interface BankItem {
  id: string;
  type: string;
  stem: string;
  config: Record<string, unknown>;
  answerKey: unknown;
  tags: string[];
  difficulty: number | null;
  createdAt: number;
  updatedAt: number;
}

/* ─────────────────── 学生端（Issue #122） ─────────────────── */

export interface StudentAssignmentEntry {
  assignmentId: string;
  assessmentId: string;
  kind: AssessmentKind;
  title: string;
  classId: string;
  lessonId: string | null;
  opensAt: number | null;
  closesAt: number | null;
  durationSec: number | null;
  windowState: 'before_open' | 'open' | 'after_close' | 'untimed';
  completed: boolean;
  attempt: {
    id: string;
    assignmentId: string;
    attemptNo: number;
    status: string;
    startedAt: number;
    submittedAt: number | null;
    deadlineAt: number | null;
    remainingSeconds: number | null;
    score: number | null;
    maxScore: number | null;
    needsManualReview: boolean;
  } | null;
}

export interface StudentAttemptPayload {
  newAttempt: boolean;
  assignment: {
    id: string;
    assessmentId: string;
    kind: AssessmentKind;
    title: string;
    description: string | null;
    settings: AssessmentSettings;
  };
  attempt: StudentAssignmentEntry['attempt'] & { remainingSeconds: number | null };
  items: Array<{
    id: string;
    section: string | null;
    sortOrder: number;
    type: string;
    stem: string;
    config: Record<string, unknown>;
    maxScore: number;
  }>;
  answers: Record<string, unknown>;
}

export interface StudentResultPayload {
  assignment: {
    id: string;
    assessmentId: string;
    kind: AssessmentKind;
    title: string;
    classId: string;
    scoreReleased: boolean;
    academicYear: string | null;
  };
  attempt: StudentAssignmentEntry['attempt'];
  showScore: boolean;
  showAnalysis: boolean;
  items: Array<{
    itemId: string;
    type: string;
    stem: string;
    maxScore: number;
    answer: unknown;
    score: number | null;
    isCorrect: boolean | null;
    needsManualReview: boolean;
    feedback: string | null;
    answerKey?: unknown;
  }>;
  aggregate: {
    score: number | null;
    maxScore: number | null;
    attemptId: string | null;
    consideredAttempts: number;
    provisional: boolean;
  };
}

export interface QuestionTypeSummary {
  type: string;
  label: { zh: string; en: string };
  category: string;
  supports: string[];
  autoGradable: boolean;
  pluginId?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, payload?.error || `HTTP ${res.status}`);
  }
  return payload as T;
}

export const assessmentApi = {
  /* 元信息 */
  listQuestionTypes: () => request<{ questionTypes: QuestionTypeSummary[] }>('/api/assessment-question-types'),

  /* 试卷 */
  list: (filter: { kind?: string; status?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.kind) params.set('kind', filter.kind);
    if (filter.status) params.set('status', filter.status);
    const qs = params.toString();
    return request<{ items: AssessmentSummary[] }>(`/api/assessments${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<AssessmentDetail>(`/api/assessments/${encodeURIComponent(id)}`),
  create: (input: {
    kind: AssessmentKind;
    title: string;
    description?: string | null;
    settings?: Partial<AssessmentSettings>;
  }) =>
    request<AssessmentDetail>('/api/assessments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    patch: { title?: string; description?: string | null; settings?: Partial<AssessmentSettings> },
  ) =>
    request<AssessmentDetail>(`/api/assessments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  remove: (id: string) =>
    request<{ success: boolean }>(`/api/assessments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  replaceItems: (id: string, items: Array<Partial<AssessmentItemView>>) =>
    request<AssessmentDetail>(`/api/assessments/${encodeURIComponent(id)}/items`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

  /* 题库 */
  listBank: (type?: string) =>
    request<{ items: BankItem[] }>(`/api/question-bank${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  createBankItem: (input: {
    type: string;
    stem: string;
    config: Record<string, unknown>;
    answerKey?: unknown;
    maxScore?: number;
    tags?: string[];
  }) =>
    request<BankItem>('/api/question-bank', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  removeBankItem: (id: string) =>
    request<{ success: boolean }>(`/api/question-bank/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** 某份试卷的全部发布记录（关闭/批改/统计入口） */
  getAssignments: (assessmentId: string) =>
    request<{
      items: Array<
        AssessmentAssignment & {
          className: string | null;
          attemptCount: number;
          submittedCount: number;
          pendingReviewCount: number;
        }
      >;
    }>(`/api/assessments/${encodeURIComponent(assessmentId)}/assignments`),

  /** 教师视角的作答详情（批改页数据源；始终含标准答案） */
  getTeacherView: (attemptId: string) =>
    request<{ attempt: TeacherAttempt; items: TeacherItemDetail[] }>(
      `/api/assessment-attempts/${encodeURIComponent(attemptId)}/teacher-view`,
    ),

  /* 发布 / 关闭 / 发布成绩 */
  publish: (
    id: string,
    input: {
      classId: string;
      lessonId?: string | null;
      opensAt?: number | null;
      closesAt?: number | null;
      durationSec?: number | null;
      academicYear?: string | null;
    },
  ) =>
    request<AssessmentAssignment>(`/api/assessments/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  closeAssignment: (assignmentId: string) =>
    request<AssessmentAssignment>(`/api/assessment-assignments/${encodeURIComponent(assignmentId)}/close`, {
      method: 'POST',
    }),
  releaseScores: (assignmentId: string) =>
    request<AssessmentAssignment>(`/api/assessment-assignments/${encodeURIComponent(assignmentId)}/release`, {
      method: 'POST',
    }),
  syncGradebook: (assignmentId: string) =>
    request<{ examId: string; syncedCount: number; skippedCount: number }>(
      `/api/assessment-assignments/${encodeURIComponent(assignmentId)}/sync-gradebook`,
      { method: 'POST' },
    ),
  getAssignmentProgress: (assignmentId: string) =>
    request<{
      assignmentId: string;
      title: string;
      kind: string;
      totalStudents: number;
      submittedCount: number;
      inProgressCount: number;
      notStartedCount: number;
      avgScore: number | null;
      students: Array<{
        studentId: string;
        name: string;
        studentNumber: string;
        status: string;
        score: number | null;
        proctor: any;
        submittedAt: number | null;
      }>;
    }>(`/api/assessment-assignments/${encodeURIComponent(assignmentId)}/progress`),

  /* 批改 / 统计 / 导出 */
  listAttempts: (assignmentId: string) =>
    request<{ items: TeacherAttempt[] }>(`/api/assessment-assignments/${encodeURIComponent(assignmentId)}/attempts`),
  stats: (assignmentId: string) =>
    request<AssessmentStats>(`/api/assessment-assignments/${encodeURIComponent(assignmentId)}/stats`),
  gradeAnswer: (
    attemptId: string,
    itemId: string,
    input: { score: number; feedback?: string | null; acceptedAiSuggestion?: boolean; suggestedScore?: number },
  ) =>
    request<{ attempt: TeacherAttempt }>(
      `/api/assessment-attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(itemId)}/grade`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  /** Issue #187：AI 批改建议（只返回建议，不改分）。 */
  aiSuggestGrade: (attemptId: string, itemId: string) =>
    request<AiGradingSuggestion>(
      `/api/assessment-attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(itemId)}/ai-suggest`,
      { method: 'POST' },
    ),
  regrade: (attemptId: string) =>
    request<{ attempt: TeacherAttempt }>(`/api/assessment-attempts/${encodeURIComponent(attemptId)}/regrade`, {
      method: 'POST',
    }),
  exportCsvUrl: (assignmentId: string) =>
    `/api/assessment-assignments/${encodeURIComponent(assignmentId)}/export?format=csv`,

  /* ── 课内发起与进度 ── */
  startClassroomAssessment: (
    lessonId: string,
    input: { assessmentId: string; durationSec?: number; opensAt?: number; closesAt?: number },
  ) =>
    request<{ success: boolean; assignment: AssessmentAssignment }>(
      `/api/classroom/sessions/${encodeURIComponent(lessonId)}/assessment`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  getClassroomAssessmentProgress: (lessonId: string, assignmentId?: string) =>
    request<{
      success: boolean;
      progress: {
        assignmentId: string;
        title: string;
        kind: string;
        totalStudents: number;
        submittedCount: number;
        inProgressCount: number;
        notStartedCount: number;
        avgScore: number | null;
        students: Array<{
          studentId: string;
          name: string;
          studentNumber: string;
          status: string;
          score: number | null;
          proctor: any;
          submittedAt: number | null;
        }>;
      };
    }>(
      `/api/classroom/sessions/${encodeURIComponent(lessonId)}/assessment-progress${
        assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : ''
      }`,
    ),

  /* ── 学生端 ── */
  myAssessments: () => request<{ items: StudentAssignmentEntry[] }>('/api/me/assessments'),
  startAttempt: (assignmentId: string) =>
    request<StudentAttemptPayload>(`/api/assessment-assignments/${encodeURIComponent(assignmentId)}/attempts`, {
      method: 'POST',
    }),
  reportProctor: (
    attemptId: string,
    event: { type: 'blur' | 'visibility_hidden' | 'fullscreen_exit'; at?: number; detail?: string },
  ) =>
    request<{ ok: boolean; blurCount: number; switchTabCount: number; fullscreenExitCount: number }>(
      `/api/assessment-attempts/${encodeURIComponent(attemptId)}/proctor`,
      { method: 'PUT', body: JSON.stringify(event) },
    ),
  saveAnswer: (attemptId: string, itemId: string, answer: unknown) =>
    request<{ ok: boolean }>(
      `/api/assessment-attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(itemId)}`,
      { method: 'PUT', body: JSON.stringify({ answer }) },
    ),
  submitAttempt: (attemptId: string) =>
    request<StudentResultPayload>(`/api/assessment-attempts/${encodeURIComponent(attemptId)}/submit`, {
      method: 'POST',
    }),
  attemptResult: (attemptId: string) =>
    request<StudentResultPayload>(`/api/assessment-attempts/${encodeURIComponent(attemptId)}/result`),
};
