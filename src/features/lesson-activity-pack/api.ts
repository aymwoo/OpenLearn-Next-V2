/**
 * 学案活动包前端 API（Gitee IKVO15 P0）。
 * 只做 HTTP 与类型，业务规则在服务端。
 */

export const ACTIVITY_TYPES = ['reading', 'courseware', 'quiz', 'submission', 'programming'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const PROGRAMMING_KINDS = ['scratch', 'python', 'flowchart', 'mindmap'] as const;
export type ProgrammingKind = (typeof PROGRAMMING_KINDS)[number];

export const ACTIVITY_STATUSES = ['not_started', 'in_progress', 'submitted', 'graded'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const BLOCK_TYPES = [
  'learning_goals',
  'key_points',
  'resources',
  'operation_tips',
  'work_appreciation',
  'freeform',
] as const;
export type ActivityBlockType = (typeof BLOCK_TYPES)[number];

export interface LessonActivity {
  id: string;
  lessonId: string;
  orderIndex: number;
  type: ActivityType;
  title: string;
  config: Record<string, unknown>;
  required: boolean;
  visible: boolean;
  peerReview: boolean;
  groupMode: boolean;
  submissionType: string | null;
  rubric: unknown;
  releaseAt: number | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  progress?: ActivityProgress;
}

export interface LessonActivityBlock {
  id: string;
  lessonId: string;
  blockType: ActivityBlockType;
  orderIndex: number;
  content: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ActivityProgress {
  studentId: string;
  activityId: string;
  status: ActivityStatus;
  progressPercent: number;
  verified: boolean;
  score: number | null;
  feedback: string | null;
  gradedAt: number | null;
  lastActivityAt: number | null;
  artifact?: ProgrammingArtifact | null;
}

export interface ProgrammingArtifact {
  kind: ProgrammingKind;
  code?: string;
  graph?: unknown;
  scratch?: { fileName?: string; note?: string; pluginProjectId?: string };
  updatedAt: number;
  submittedAt?: number | null;
}

export interface UnresolvedActivityBinding {
  activityId: string;
  title: string;
  type: ActivityType;
  field: 'coursewareId' | 'assessmentId' | 'assessmentAssignmentId' | 'assignmentId';
  originalId: string;
}

export interface LessonProgressSummary {
  displayPercent: number;
  verifiedPercent: number;
  completed: boolean;
  requiredTotal: number;
  requiredVerified: number;
  requiredSubmitted: number;
}

export interface TeacherActivityPack {
  lessonId: string;
  courseId: string | null;
  blocks: LessonActivityBlock[];
  activities: LessonActivity[];
  unresolvedBindings?: UnresolvedActivityBinding[];
}

export interface StudentActivityPack extends TeacherActivityPack {
  activities: Array<LessonActivity & { progress: ActivityProgress }>;
  summary: LessonProgressSummary;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export function fetchActivityPack(lessonId: string) {
  return requestJson<{
    success: boolean;
    role: 'teacher' | 'student';
    pack: TeacherActivityPack | StudentActivityPack;
  }>(`/api/lessons/${encodeURIComponent(lessonId)}/activity-pack`);
}

export function fetchMyActivityPacks(lessonIds: string[]) {
  const query = encodeURIComponent(lessonIds.join(','));
  return requestJson<{
    success: boolean;
    packs: Array<{ lessonId: string; activityCount: number; summary: LessonProgressSummary }>;
  }>(`/api/me/lesson-activity-packs?lessonIds=${query}`);
}

export function saveActivityBlocks(
  lessonId: string,
  blocks: Array<{ id?: string; blockType: ActivityBlockType; content?: Record<string, unknown> }>,
) {
  return requestJson<{ success: boolean; blocks: LessonActivityBlock[] }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activity-blocks`,
    { method: 'PUT', body: JSON.stringify({ blocks }) },
  );
}

export function createActivity(
  lessonId: string,
  input: { type: ActivityType; title: string; config?: Record<string, unknown>; required?: boolean; visible?: boolean },
) {
  return requestJson<{ success: boolean; activity: LessonActivity }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function updateActivity(
  lessonId: string,
  activityId: string,
  input: Partial<LessonActivity> & { config?: Record<string, unknown> },
) {
  return requestJson<{ success: boolean; activity: LessonActivity }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

export function deleteActivity(lessonId: string, activityId: string) {
  return requestJson<{ success: boolean }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}`,
    { method: 'DELETE' },
  );
}

export function reorderActivities(lessonId: string, activityIds: string[]) {
  return requestJson<{ success: boolean; activities: LessonActivity[] }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/reorder`,
    { method: 'PUT', body: JSON.stringify({ activityIds }) },
  );
}

export function startActivity(lessonId: string, activityId: string) {
  return requestJson<{ success: boolean; progress: ActivityProgress }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}/start`,
    { method: 'POST' },
  );
}

export function selfReportActivity(lessonId: string, activityId: string) {
  return requestJson<{ success: boolean; progress: ActivityProgress }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}/self-report`,
    { method: 'POST' },
  );
}

export function fetchActivityProgress(lessonId: string, activityId: string) {
  return requestJson<{ success: boolean; activity: LessonActivity; progress: ActivityProgress[] }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}/progress`,
  );
}

export function verifyActivityProgress(
  lessonId: string,
  activityId: string,
  studentId: string,
  input: { score?: number | null; feedback?: string | null } = {},
) {
  return requestJson<{ success: boolean; progress: ActivityProgress }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}/students/${encodeURIComponent(studentId)}/verify`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function gradeActivityProgress(
  lessonId: string,
  activityId: string,
  studentId: string,
  input: { score: number; feedback?: string | null },
) {
  return requestJson<{ success: boolean; progress: ActivityProgress }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}/students/${encodeURIComponent(studentId)}/grade`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function relinkActivity(
  lessonId: string,
  activityId: string,
  input: {
    coursewareId?: string;
    assessmentId?: string;
    assessmentAssignmentId?: string;
    assignmentId?: string;
  },
) {
  return requestJson<{
    success: boolean;
    activity: LessonActivity;
    unresolvedBindings: UnresolvedActivityBinding[];
  }>(`/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}/relink`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function saveProgrammingArtifact(
  lessonId: string,
  activityId: string,
  artifact: ProgrammingArtifact,
  submit = false,
) {
  return requestJson<{ success: boolean; progress: ActivityProgress }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activities/${encodeURIComponent(activityId)}/programming-artifact`,
    { method: 'POST', body: JSON.stringify({ artifact, submit }) },
  );
}

export function awardStudentPoints(
  studentId: string,
  input: { classId: string; dimensionId: string; deltaPoints: number; reason: string },
) {
  return requestJson<{ success: boolean }>(`/api/students/${encodeURIComponent(studentId)}/points`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchCoursewareList() {
  return requestJson<unknown>('/api/courseware');
}

export function fetchAssessmentList() {
  return requestJson<unknown>('/api/assessments');
}

export function fetchAssignmentList(lessonId: string) {
  return requestJson<unknown>(`/api/assignments?lessonId=${encodeURIComponent(lessonId)}`);
}

export function fetchPointDimensions(classId: string) {
  return requestJson<unknown>(`/api/classes/${encodeURIComponent(classId)}/points-dimensions`);
}

export function extractNamedList(
  payload: unknown,
): Array<{ id: string; name?: string; title?: string; uuid?: string }> {
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === 'object' && 'id' in (item as object)) as Array<{
      id: string;
      name?: string;
      title?: string;
      uuid?: string;
    }>;
  }
  if (payload && typeof payload === 'object') {
    for (const key of ['courseware', 'items', 'assessments', 'assignments', 'dimensions', 'data']) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return extractNamedList(value);
    }
  }
  return [];
}

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, { zh: string; en: string }> = {
  reading: { zh: '阅读任务', en: 'Reading' },
  courseware: { zh: '网页课件', en: 'Courseware' },
  quiz: { zh: '测验', en: 'Quiz' },
  submission: { zh: '作品提交', en: 'Submission' },
  programming: { zh: '编程活动', en: 'Programming' },
};

export const PROGRAMMING_KIND_LABELS: Record<ProgrammingKind, { zh: string; en: string }> = {
  scratch: { zh: 'Scratch 图形化编程', en: 'Scratch' },
  python: { zh: 'Python', en: 'Python' },
  flowchart: { zh: '流程图', en: 'Flowchart' },
  mindmap: { zh: '思维导图', en: 'Mind map' },
};

export const BLOCK_TYPE_LABELS: Record<ActivityBlockType, { zh: string; en: string }> = {
  learning_goals: { zh: '学习目标', en: 'Learning goals' },
  key_points: { zh: '重难点', en: 'Key points' },
  resources: { zh: '资源准备', en: 'Resources' },
  operation_tips: { zh: '操作要点', en: 'Tips' },
  work_appreciation: { zh: '作品赏析', en: 'Exemplars' },
  freeform: { zh: '自由图文', en: 'Freeform' },
};

export const STATUS_LABELS: Record<ActivityStatus, { zh: string; en: string }> = {
  not_started: { zh: '未开始', en: 'Not started' },
  in_progress: { zh: '进行中', en: 'In progress' },
  submitted: { zh: '已提交', en: 'Submitted' },
  graded: { zh: '已批阅', en: 'Graded' },
};
