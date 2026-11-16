import type { LessonActivity, LessonActivityBlock, LessonProgressSummary, StudentActivityPack } from './api';

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { credentials: 'include', ...init });
  const data = (await res.json().catch(() => ({}))) as T & { success?: boolean; error?: string };
  if (!res.ok || (data && data.success === false)) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export interface ActivityProgressReport {
  lessonId: string;
  studentCount: number;
  activities: Array<{
    activity: LessonActivity;
    totals: {
      students: number;
      notStarted: number;
      inProgress: number;
      submitted: number;
      graded: number;
      verified: number;
    };
    completionRate: number;
    verifiedRate: number;
    incomplete: Array<{ studentId: string; name: string; classId: string; status: string; verified: boolean }>;
  }>;
}

export interface ActivityNudge {
  id: string;
  lessonId: string;
  activityId: string | null;
  studentId: string;
  teacherId: string;
  message: string;
  createdAt: number;
}

export interface PeerReviewCycle {
  id: string;
  courseId: string | null;
  lessonId: string | null;
  title: string | null;
  anonymous: boolean;
  reviewsPerStudent: number;
  rubric: Array<{ id: string; label: string; maxScore: number }>;
  status: 'open' | 'closed';
  createdAt: number;
}

export interface PeerReviewAssignment {
  id: string;
  cycleId: string;
  activityId: string;
  activityTitle: string;
  lessonId: string;
  anonymous: boolean;
  status: string;
  dueAt: number | null;
  reviewerName?: string | null;
  revieweeName?: string | null;
  review?: {
    id: string;
    scores: Record<string, number>;
    comment: string;
    status: string;
    teacherFeedback: string | null;
  } | null;
}

export interface CourseRecord {
  id: string;
  title: string;
  description: string;
  ownerUserId: string;
  term: string | null;
  visibility: 'private' | 'enrolled' | 'public';
  thumbnail: string | null;
  createdAt: number;
  updatedAt: number;
  lessonCount?: number;
}

export interface CourseLessonRef {
  id: string;
  title: string;
  courseOrder: number;
  courseId: string | null;
}

export interface DiscussionThread {
  id: string;
  courseId: string | null;
  lessonId: string | null;
  title: string;
  body: string;
  authorName?: string | null;
  pinned: boolean;
  locked: boolean;
  createdAt: number;
  postCount?: number;
}

export interface DiscussionPost {
  id: string;
  threadId: string;
  parentId: string | null;
  body: string;
  authorName?: string | null;
  createdAt: number;
  deletedAt: number | null;
}

export function fetchActivityPackPreview(lessonId: string) {
  return request<{ pack: StudentActivityPack & { preview: true; previewKind: string; unpublishedCount: number } }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activity-pack/preview`,
  );
}

export function fetchProgressReport(lessonId: string) {
  return request<{ report: ActivityProgressReport }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activity-pack/progress-report`,
  );
}

export function nudgeIncomplete(
  lessonId: string,
  body: { activityId?: string | null; studentIds?: string[]; message?: string },
) {
  return request<{ sent: ActivityNudge[]; skipped: Array<{ studentId: string; reason: string }> }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/activity-pack/nudge`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

export function fetchMyNudges() {
  return request<{ nudges: ActivityNudge[] }>('/api/me/activity-nudges');
}

export async function exportActivityPack(lessonId: string) {
  const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/activity-pack/export`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || '导出失败');
  }
  const blob = await res.blob();
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i.exec(res.headers.get('Content-Disposition') || '');
  const filename = decodeURIComponent(match?.[1] || match?.[2] || 'activity-pack.zip');
  return { blob, filename };
}

export async function importActivityPack(lessonId: string, file: File) {
  const zipBase64 = await fileToBase64(file);
  return request<{
    activities: LessonActivity[];
    blocks: LessonActivityBlock[];
    warnings: string[];
  }>('/api/lesson-activity-packs/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessonId, zipBase64, replace: true }),
  });
}

export function startPeerReviewCycle(
  lessonId: string,
  body: { activityIds?: string[]; title?: string; anonymous?: boolean; reviewsPerStudent?: number },
) {
  return request<{ cycle: PeerReviewCycle; assignmentCount: number }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/peer-reviews/cycles`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

export function fetchPeerReviewCycles(lessonId: string) {
  return request<{ cycles: PeerReviewCycle[] }>(`/api/lessons/${encodeURIComponent(lessonId)}/peer-reviews/cycles`);
}

export function fetchMyPeerReviewAssignments(lessonId?: string) {
  const query = lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : '';
  return request<{ assignments: PeerReviewAssignment[] }>(`/api/me/peer-review-assignments${query}`);
}

export function submitPeerReview(
  lessonId: string,
  assignmentId: string,
  body: { scores: Record<string, number>; comment?: string },
) {
  return request<{ review: NonNullable<PeerReviewAssignment['review']> }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/peer-reviews/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

export function reportPeerReview(lessonId: string, reviewId: string, reason: string) {
  return request(`/api/lessons/${encodeURIComponent(lessonId)}/peer-reviews/${encodeURIComponent(reviewId)}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export function moderatePeerReview(
  lessonId: string,
  reviewId: string,
  body: { action: 'confirm' | 'override' | 'reject'; teacherFeedback?: string },
) {
  return request(`/api/lessons/${encodeURIComponent(lessonId)}/peer-reviews/${encodeURIComponent(reviewId)}/moderate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchTeacherPeerAssignments(lessonId: string, cycleId: string) {
  return request<{ assignments: PeerReviewAssignment[] }>(
    `/api/lessons/${encodeURIComponent(lessonId)}/peer-reviews/cycles/${encodeURIComponent(cycleId)}/assignments`,
  );
}

export function fetchCourses() {
  return request<{ courses: CourseRecord[] }>('/api/courses');
}

export function createCourse(body: {
  title: string;
  description?: string;
  visibility?: CourseRecord['visibility'];
  term?: string;
}) {
  return request<{ course: CourseRecord }>('/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchCourse(courseId: string) {
  return request<{ course: CourseRecord; lessons: CourseLessonRef[] }>(`/api/courses/${encodeURIComponent(courseId)}`);
}

export function attachCourseLessons(courseId: string, lessonIds: string[]) {
  return request<{ lessons: CourseLessonRef[] }>(`/api/courses/${encodeURIComponent(courseId)}/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessonIds }),
  });
}

export function enrollCourseClass(courseId: string, classId: string) {
  return request(`/api/courses/${encodeURIComponent(courseId)}/enrollments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classId }),
  });
}

export function startCourseLessonSession(courseId: string, lessonId: string, classId?: string) {
  return request<{ session: { id: string }; created: boolean }>(
    `/api/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/start-session`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId }) },
  );
}

export function fetchDiscussions(opts: { courseId?: string; lessonId?: string }) {
  const params = new URLSearchParams();
  if (opts.courseId) params.set('courseId', opts.courseId);
  if (opts.lessonId) params.set('lessonId', opts.lessonId);
  return request<{ threads: DiscussionThread[] }>(`/api/discussions?${params.toString()}`);
}

export function createDiscussion(body: { courseId?: string; lessonId?: string; title: string; body: string }) {
  return request<{ thread: DiscussionThread }>('/api/discussions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchDiscussion(threadId: string) {
  return request<{ thread: DiscussionThread; posts: DiscussionPost[] }>(
    `/api/discussions/${encodeURIComponent(threadId)}`,
  );
}

export function replyDiscussion(threadId: string, body: string) {
  return request<{ post: DiscussionPost }>(`/api/discussions/${encodeURIComponent(threadId)}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
}

export function reportDiscussion(threadId: string, reason: string, postId?: string) {
  return request(`/api/discussions/${encodeURIComponent(threadId)}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, postId }),
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取学案包文件'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export type { LessonProgressSummary };
