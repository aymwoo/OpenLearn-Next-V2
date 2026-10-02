/**
 * SystemService — 系统/进程/VFS 端点的纯 fetch 封装（C1-R1 从 App.tsx 迁出）。
 *
 * 约定：只做 fetch + res.ok 检查 + res.json()，返回 { ok, data?, contentType? }；
 * 分支判断与 setState 全部留在调用方，保证行为与迁移前完全一致。
 */

export async function fetchRegisteredCommands(): Promise<{ ok: boolean; data?: any; contentType: string | null }> {
  const res = await fetch('/api/commands/registered');
  if (!res.ok) return { ok: false, contentType: res.headers.get('content-type') };
  return { ok: true, data: await res.json(), contentType: res.headers.get('content-type') };
}

export async function fetchVfsNodes(parentId: string | null): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/vfs${parentId ? `?parentId=${parentId}` : ''}`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function fetchProcesses(): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch('/api/processes');
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function fetchProcessLogs(id: string): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch(`/api/processes/${id}/logs`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function postClassSchedule(
  classId: string,
  payload: { lessonId: string; scheduledDate: string },
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/classes/${classId}/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok };
}
