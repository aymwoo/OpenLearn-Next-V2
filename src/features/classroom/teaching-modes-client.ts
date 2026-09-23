/**
 * 教学模式客户端 —— 课堂启动门户「教学模式选择器」的数据层。
 *
 * 服务端以「数据库记录优先 + 内置常量兜底」合并返回（见
 * server/routes/classroom.ts 的 BUILTIN_TEACHING_MODES），因此前端无需关心
 * 某个模式来自内置还是管理员自定义。
 *
 * 所有请求走 same-origin cookie 会话（与项目其余前端 API 调用一致）。
 */

export interface TeachingMode {
  id: string;
  name: string;
  nameEn: string | null;
  description: string;
  descriptionEn: string | null;
  /** 语义图标名（lucide-react 组件名），由前端映射到组件 */
  icon: string;
  /** 语义色名（见 TEACHING_MODE_COLORS），不要存具体色值以便跟随主题 */
  color: string;
  isBuiltin: boolean;
  sortOrder: number;
}

export interface CreateTeachingModeInput {
  id: string;
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
}

export type UpdateTeachingModeInput = Partial<Omit<CreateTeachingModeInput, 'id'>>;

const BASE = '/api/classroom/teaching-modes';

async function request<T>(path: string, init?: RequestInit, fetcher?: typeof fetch): Promise<T> {
  const doFetch = fetcher ?? fetch;
  const res = await doFetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // 非 JSON 响应（如网关错误页）由下方统一兜底
  }

  if (!res.ok) {
    throw new Error(payload?.error || `请求失败（HTTP ${res.status}）`);
  }
  return payload as T;
}

/** 拉取可选教学模式（内置 + 自定义，已按 sortOrder 排序）。 */
export async function fetchTeachingModes(fetcher?: typeof fetch): Promise<TeachingMode[]> {
  const data = await request<{ success: boolean; modes: TeachingMode[] }>(BASE, undefined, fetcher);
  return Array.isArray(data?.modes) ? data.modes : [];
}

/** 设置当次课堂选用的教学模式；传 null 表示清除选择。 */
export async function setSessionTeachingMode(
  lessonId: string,
  teachingModeId: string | null,
  classId?: string | null,
): Promise<{ sessionId: string; teachingModeId: string | null }> {
  return request(`${BASE.replace('/teaching-modes', '')}/sessions/${encodeURIComponent(lessonId)}/teaching-mode`, {
    method: 'PUT',
    body: JSON.stringify({ teachingModeId: teachingModeId ?? '', classId: classId ?? undefined }),
  });
}

/** 新增自定义教学模式（仅管理员）。 */
export async function createTeachingMode(input: CreateTeachingModeInput): Promise<{ id: string }> {
  return request(BASE, { method: 'POST', body: JSON.stringify(input) });
}

/** 更新教学模式（仅管理员）；对内置模式是「落库覆盖文案」。 */
export async function updateTeachingMode(
  id: string,
  patch: UpdateTeachingModeInput,
): Promise<{ id: string; created: boolean }> {
  return request(`${BASE}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
}

/** 删除自定义教学模式（仅管理员；内置模式服务端会拒绝）。 */
export async function deleteTeachingMode(id: string): Promise<{ id: string }> {
  return request(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * 语义色名 → 静态 Tailwind 类名。
 * 必须写成完整字面量：Tailwind 在构建期扫描源码里的类名字符串，
 * 动态拼接（如 `bg-${color}-50`）不会被生成。
 */
export const TEACHING_MODE_COLORS: Record<
  string,
  { chipActive: string; iconActive: string; dot: string }
> = {
  indigo: {
    chipActive: 'bg-primary-theme-light border-primary-theme text-primary-theme',
    iconActive: 'text-primary-theme',
    dot: 'bg-primary-theme',
  },
  emerald: {
    chipActive: 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300',
    iconActive: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  amber: {
    chipActive: 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300',
    iconActive: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  violet: {
    chipActive: 'bg-violet-50 border-violet-300 text-violet-700 dark:bg-violet-950/40 dark:border-violet-800 dark:text-violet-300',
    iconActive: 'text-violet-600 dark:text-violet-400',
    dot: 'bg-violet-500',
  },
  rose: {
    chipActive: 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300',
    iconActive: 'text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-500',
  },
  sky: {
    chipActive: 'bg-sky-50 border-sky-300 text-sky-700 dark:bg-sky-950/40 dark:border-sky-800 dark:text-sky-300',
    iconActive: 'text-sky-600 dark:text-sky-400',
    dot: 'bg-sky-500',
  },
};

export function teachingModeColor(color: string | null | undefined) {
  return TEACHING_MODE_COLORS[color ?? 'indigo'] ?? TEACHING_MODE_COLORS.indigo;
}
