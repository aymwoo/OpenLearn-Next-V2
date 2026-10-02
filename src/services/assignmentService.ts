/**
 * AssignmentService — 作业提交 / 自动生成端点的纯 fetch 封装（C1-R1 从 App.tsx 迁出）。
 *
 * 约定：只做 fetch + res.ok 检查 + res.json()（解析失败回落 {}），返回
 * { ok, data? }；分支与 setState 留在调用方，行为与迁移前一致。
 */

export async function getAssignmentSubmissions(assignmentId: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/assignments/${assignmentId}/submissions`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function postAssignmentSubmission(
  assignmentId: string,
  payload: { studentId: string; content: string },
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/assignments/${assignmentId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok };
}

export async function postGenerateAssignment(
  classId: string,
  topic: string,
): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/classes/${classId}/assignments/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json().catch(() => ({})) };
}
