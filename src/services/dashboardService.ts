/**
 * DashboardService — 班级/学生学情看板端点的纯 fetch 封装（C1-R1 从 App.tsx 迁出）。
 *
 * 约定：只做 fetch + res.ok 检查 + res.json()，返回 { ok, data? }；
 * setState 等调用方逻辑原样保留，行为与迁移前一致。
 */

export async function getClassProgress(classId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/classes/${classId}/progress`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function getClassDashboard(classId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/classes/${classId}/dashboard`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function getStudentDashboard(studentId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/students/${studentId}/dashboard`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function getStudentAcademicYearComparison(
  studentId: string,
  years?: string[] | string,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  let url = `/api/students/${studentId}/academic-year-comparison`;
  if (years) {
    const yearsStr = Array.isArray(years) ? years.join(',') : years;
    url += `?years=${encodeURIComponent(yearsStr)}`;
  }
  const res = await fetch(url);
  if (!res.ok) {
    try {
      const err = await res.json();
      return { ok: false, error: err.error || 'Request failed' };
    } catch {
      return { ok: false, error: 'Request failed' };
    }
  }
  return { ok: true, data: await res.json() };
}
