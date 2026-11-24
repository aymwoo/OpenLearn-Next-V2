/**
 * 学生端界面可见性策略接口封装（Gitee Issue IKW5KV）。
 *
 * 只负责请求；生效结果由 `packages/core/student-ui-policy` 归一化，
 * 保证服务端新增功能 ID 时旧前端不会整体回退。
 */
import type { EffectiveStudentUiPolicy } from '../../packages/core/student-ui-policy/index';

export interface StudentUiPolicyPayload {
  policy?: EffectiveStudentUiPolicy;
  applied?: unknown;
}

export async function getStudentUiPolicy(
  studentId: string,
  lessonId?: string | null,
): Promise<{ ok: boolean; data?: StudentUiPolicyPayload }> {
  const query = lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : '';
  const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/ui-policy${query}`);
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}
