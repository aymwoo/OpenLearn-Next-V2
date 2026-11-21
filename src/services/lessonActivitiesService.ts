/**
 * Lesson Activities (学案式课时包) 前端 API 封装。
 * 与 lessonService.ts 约定一致：纯 fetch + res.ok 检查 + { ok, data } 返回。
 * Issue IKVO15 · P0
 */

// ── 活动（lesson_activities）──────────────────────────────────────────────
export async function getLessonActivities(lessonId: string) {
  const res = await fetch(`/api/lessons/${lessonId}/activities`);
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

export async function createLessonActivity(lessonId: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/lessons/${lessonId}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

export async function updateLessonActivity(id: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/lesson-activities/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

export async function deleteLessonActivity(id: string) {
  const res = await fetch(`/api/lesson-activities/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

export async function reorderLessonActivities(lessonId: string, ids: string[]) {
  const res = await fetch(`/api/lessons/${lessonId}/activities/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

// ── 学案首页块（lesson_activity_blocks）────────────────────────────────────
export async function getLessonBlocks(lessonId: string) {
  const res = await fetch(`/api/lessons/${lessonId}/blocks`);
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

export async function createLessonBlock(lessonId: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/lessons/${lessonId}/blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

export async function updateLessonBlock(id: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/blocks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

export async function deleteLessonBlock(id: string) {
  const res = await fetch(`/api/blocks/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

// ── 学案聚合（学生端）────────────────────────────────────────────────────
export async function getXuean(lessonId: string, studentId?: string) {
  const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
  const res = await fetch(`/api/lessons/${lessonId}/xuean${qs}`);
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

// ── 活动进度上报（学生自报 + 提交内容）──────────────────────────────────────
export type ActivitySubmission = string | { type: 'text' | 'file' | 'link'; content: string; url?: string };

export async function postActivityProgress(
  activityId: string,
  payload: {
    status?: string;
    progressPercent?: number;
    studentId?: string;
    submission?: ActivitySubmission;
    selfEval?: { score: number; comment: string };
  },
) {
  const res = await fetch(`/api/lesson-activities/${activityId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

// ── 教师批阅（verified=1）───────────────────────────────────────────────
export async function verifyActivityProgress(
  activityId: string,
  payload: { studentId: string; status?: string; score?: number },
) {
  const res = await fetch(`/api/lesson-activities/${activityId}/progress/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

// ── 一键催办（教师端）─────────────────────────────────────────────
export async function nudgeActivity(activityId: string, studentId: string) {
  const res = await fetch(`/api/lesson-activities/${activityId}/nudge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId }),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

// ── 活动级进度面板（教师端）─────────────────────────────────────────────
export async function getActivityProgressPanel(lessonId: string) {
  const res = await fetch(`/api/lessons/${lessonId}/activity-progress`);
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

// ── 学案包导入导出 ──────────────────────────────────────────────
export async function exportXueanPackage(lessonId: string) {
  const res = await fetch(`/api/lessons/${lessonId}/xuean/export`);
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}

export async function importXueanPackage(
  lessonId: string,
  payload: { activities: Record<string, unknown>[]; blocks: Record<string, unknown>[] },
) {
  const res = await fetch(`/api/lessons/${lessonId}/xuean/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json() };
}
