/**
 * ProgressService — 学生进度 / 已读通知端点的纯 fetch 封装（C1-R1 从 App.tsx 迁出）。
 *
 * 约定：只做 fetch + res.ok 检查 + res.json()，返回 { ok, data? }；
 * setState / toast 等调用方逻辑原样保留，行为与迁移前一致。
 */

export async function getStudentReadNotifications(studentId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/students/${studentId}/read_notifications`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function postStudentReadNotification(studentId: string, notificationId: string): Promise<void> {
  await fetch(`/api/students/${studentId}/read_notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notificationId }),
  });
}

export async function postStudentProgress(
  studentId: string,
  payload: { lessonId: string; completed: boolean; progressPercent: number },
): Promise<void> {
  await fetch(`/api/students/${studentId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getClassLessonProgress(
  classId: string,
  lessonId: string,
): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/classes/${classId}/lessons/${lessonId}/progress`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function getStudentProgress(studentId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/students/${studentId}/progress`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}
