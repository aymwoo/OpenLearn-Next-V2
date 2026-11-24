/**
 * 教师端学生可见性策略接口封装（Gitee Issue IKW5KV）。
 */
import type {
  EffectiveStudentUiPolicy,
  StudentUiPolicyLayer,
  StudentUiScopeType,
} from '../../packages/core/student-ui-policy/index';

export interface StudentUiPolicyChainResponse {
  stored: {
    scopeType: StudentUiScopeType;
    scopeId: string;
    policy: StudentUiPolicyLayer;
    updatedBy: string | null;
    updatedAt: number;
  } | null;
  inherited: EffectiveStudentUiPolicy;
  effective: EffectiveStudentUiPolicy;
}

async function parse<T>(res: Response): Promise<{ ok: boolean; data?: T; error?: string }> {
  if (!res.ok) {
    try {
      const body = await res.json();
      return { ok: false, error: body?.error || 'Request failed' };
    } catch {
      return { ok: false, error: 'Request failed' };
    }
  }
  return { ok: true, data: (await res.json()) as T };
}

export async function getStudentUiPolicyChain(
  scopeType: StudentUiScopeType,
  scopeId: string,
): Promise<{ ok: boolean; data?: StudentUiPolicyChainResponse; error?: string }> {
  const res = await fetch(
    `/api/teacher/student-ui-policies?scopeType=${encodeURIComponent(scopeType)}&scopeId=${encodeURIComponent(scopeId)}`,
  );
  return parse<StudentUiPolicyChainResponse>(res);
}

export async function saveStudentUiPolicy(
  scopeType: StudentUiScopeType,
  scopeId: string,
  policy: StudentUiPolicyLayer,
): Promise<{ ok: boolean; data?: StudentUiPolicyChainResponse; error?: string }> {
  const res = await fetch('/api/teacher/student-ui-policies', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scopeType, scopeId, policy: { version: 1, ...policy } }),
  });
  return parse<StudentUiPolicyChainResponse>(res);
}

export async function deleteStudentUiPolicy(
  scopeType: StudentUiScopeType,
  scopeId: string,
): Promise<{ ok: boolean; data?: StudentUiPolicyChainResponse & { deleted?: boolean }; error?: string }> {
  const res = await fetch(
    `/api/teacher/student-ui-policies?scopeType=${encodeURIComponent(scopeType)}&scopeId=${encodeURIComponent(scopeId)}`,
    { method: 'DELETE' },
  );
  return parse<StudentUiPolicyChainResponse & { deleted?: boolean }>(res);
}
