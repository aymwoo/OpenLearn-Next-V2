/**
 * 学案课程（courses 表）CRUD 的纯 fetch 封装。
 * 约定与 lessonService.ts / lessonActivitiesService.ts 一致：只做 fetch + res.ok
 * 检查，返回 { ok, data } / { ok: false, error }；toast、setState 留给调用方。
 */
import type { Course, CourseDetail } from '../types/app';

export type CoursePayload = {
  title: string;
  description?: string;
  term?: string;
  visibility?: string;
};

type Result<T> = { ok: boolean; data?: T; error?: { error?: string } };

function errorOf(res: Response): Promise<{ error?: string }> {
  return res.json().catch(() => ({}));
}

export async function getCourses(): Promise<Result<Course[]>> {
  const res = await fetch('/api/courses');
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  return { ok: true, data: await res.json() };
}

export async function getCourse(id: string): Promise<Result<CourseDetail>> {
  const res = await fetch(`/api/courses/${id}`);
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  return { ok: true, data: await res.json() };
}

export async function createCourse(payload: CoursePayload): Promise<Result<Course>> {
  const res = await fetch('/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  return { ok: true, data: await res.json() };
}

export async function updateCourse(id: string, payload: Partial<CoursePayload>): Promise<Result<Course>> {
  const res = await fetch(`/api/courses/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  return { ok: true, data: await res.json() };
}

export async function deleteCourse(id: string): Promise<Result<{ success: boolean }>> {
  const res = await fetch(`/api/courses/${id}`, { method: 'DELETE' });
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  return { ok: true, data: await res.json() };
}

/** 新建课时并挂到课程（后端一步完成，返回 lessonId）。 */
export async function createCourseLesson(courseId: string, title: string): Promise<Result<{ lessonId: string }>> {
  const res = await fetch(`/api/courses/${courseId}/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  return { ok: true, data: await res.json() };
}

/** 把既有课时挂到课程。 */
export async function attachLesson(courseId: string, lessonId: string): Promise<Result<unknown>> {
  const res = await fetch(`/api/courses/${courseId}/lessons/${lessonId}`, { method: 'PUT' });
  if (!res.ok) return { ok: false, error: await errorOf(res) };
  return { ok: true, data: await res.json() };
}
