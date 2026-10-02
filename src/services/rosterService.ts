/**
 * RosterService — 班级/学生花名册端点的纯 fetch 封装（C1-R1 从 App.tsx 迁出）。
 *
 * 约定：只做 fetch + res.ok 检查 + res.json()，返回 { ok, data? }；
 * setState 等调用方逻辑原样保留，行为与迁移前一致。
 */

export async function getClasses(): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch('/api/classes?pageSize=all');
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function getStudents(): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch('/api/students?pageSize=all');
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function getClassStudents(classId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/classes/${classId}/students`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}
