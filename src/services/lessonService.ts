/**
 * LessonService — 课时 CRUD / 白板端点的纯 fetch 封装（C1-R1 从 App.tsx 迁出）。
 *
 * 约定：只做 fetch + res.ok 检查 + res.json()（解析失败回落 {}），返回
 * { ok, data }；错误分支、setState、toast 全部留在调用方，行为与迁移前一致。
 */

export async function getLessons(): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch('/api/lessons?pageSize=all');
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function postLesson(payload: { title: string; content: string }): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch('/api/lessons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json().catch(() => ({})) };
}

export async function deleteLesson(lessonId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/lessons/${lessonId}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, data: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json().catch(() => ({})) };
}

export async function postCloneLesson(lessonId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/lessons/${lessonId}/clone`, { method: 'POST' });
  if (!res.ok) return { ok: false, data: await res.json().catch(() => ({})) };
  return { ok: true, data: await res.json().catch(() => ({})) };
}

export async function getLessonWhiteboard(lessonId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/lessons/${lessonId}/whiteboard`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}
