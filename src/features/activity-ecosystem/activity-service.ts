/**
 * OpenLearn Activity Ecosystem — Frontend Service (Sprint P7-01)
 *
 * Thin client that talks to the Activity Ecosystem REST API. The frontend does
 * NOT keep its own activity list — it reads the SAME registry the plugins and
 * the host share, so the Workspace always reflects what is actually registered.
 */

import type { ActivityProviderDescriptor, ActivityRole } from '../../../packages/activity-ecosystem/index.js';

export type { ActivityProviderDescriptor, ActivityRole };

export interface StartActivityResponse {
  ok: boolean;
  /** 本次运行的稳定 ID；pause/resume/finish 用它，而不是 provider id。 */
  runId: string;
  provider: string;
  dispatched: boolean;
  result?: unknown;
  error?: string;
}

/** A live (running/paused) activity instance reported by the server. */
export interface RunningActivity {
  /** 运行 ID（管理操作主键）。 */
  id: string;
  runId: string;
  /** provider 定义 ID，仅用于展示/关联。 */
  providerId: string;
  name: string;
  icon?: string;
  category?: string;
  provider: string;
  /** Lifecycle state —— 活跃端点返回 running/paused；通用运行列表可能含 interrupted 等终态。 */
  state: string;
  /** Epoch ms when the activity entered `running`, or null. */
  startedAt: number | null;
}

export type RunStateTone = 'running' | 'paused' | 'interrupted' | 'unknown';

export interface RunStateView {
  label: string;
  tone: RunStateTone;
  /** 服务端状态机：running → paused/finished，paused → running/finished。 */
  canPause: boolean;
  canResume: boolean;
  canFinish: boolean;
}

/**
 * 把运行状态翻译成展示文案与可用操作。
 *
 * 关键点：`interrupted`（服务重启后未能恢复的运行）是终态，既不能恢复也不能结束，
 * 因此不能再按旧逻辑一律回退成「已暂停」并展示恢复按钮（那会稳定拿到 409）。
 */
export function describeRunState(state: string, lang: 'zh' | 'en' = 'en'): RunStateView {
  const zh = lang === 'zh';
  switch (state) {
    case 'running':
      return { label: zh ? '进行中' : 'Running', tone: 'running', canPause: true, canResume: false, canFinish: true };
    case 'paused':
      return { label: zh ? '已暂停' : 'Paused', tone: 'paused', canPause: false, canResume: true, canFinish: true };
    case 'interrupted':
      return {
        label: zh ? '已中断' : 'Interrupted',
        tone: 'interrupted',
        canPause: false,
        canResume: false,
        canFinish: false,
      };
    default:
      return {
        label: state || (zh ? '状态未知' : 'Unknown'),
        tone: 'unknown',
        canPause: false,
        canResume: false,
        canFinish: false,
      };
  }
}

interface ActivityRunDto {
  runId: string;
  providerId: string;
  name?: string;
  icon?: string;
  category?: string;
  provider?: string;
  state: string;
  startedAt?: number;
}

/** Fetch the registered activity providers, optionally filtered by role. */
export async function fetchActivities(role: ActivityRole = 'all'): Promise<ActivityProviderDescriptor[]> {
  const res = await fetch(`/api/activity-providers?role=${encodeURIComponent(role)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to load activities (${res.status})`);
  }
  const data = (await res.json()) as { activities: ActivityProviderDescriptor[] };
  return data.activities ?? [];
}

/** Fetch the activities currently in progress (running / paused). */
export async function fetchRunningActivities(): Promise<RunningActivity[]> {
  const res = await fetch('/api/activity-runs?active=1', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to load running activities (${res.status})`);
  }
  const data = (await res.json()) as { runs?: ActivityRunDto[] };
  return (data.runs ?? []).map((run) => ({
    id: run.runId,
    runId: run.runId,
    providerId: run.providerId,
    name: run.name ?? run.providerId,
    icon: run.icon,
    category: run.category,
    provider: run.provider ?? run.providerId,
    state: run.state,
    startedAt: run.startedAt ?? null,
  }));
}

/** End a running activity (dashboard management action). */
export async function finishActivity(runId: string): Promise<void> {
  const res = await fetch(`/api/activity-runs/${encodeURIComponent(runId)}/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Failed to finish activity (${res.status})`);
  }
}

/** Pause a running activity (dashboard management action). */
export async function pauseActivity(runId: string): Promise<void> {
  const res = await fetch(`/api/activity-runs/${encodeURIComponent(runId)}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Failed to pause activity (${res.status})`);
  }
}

/** Resume a paused activity (dashboard management action). */
export async function resumeActivity(runId: string): Promise<void> {
  const res = await fetch(`/api/activity-runs/${encodeURIComponent(runId)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Failed to resume activity (${res.status})`);
  }
}

/**
 * Start an activity via the host. Reuses the existing classroom command/event
 * pipeline server-side. `actorId` carries the current user for permission
 * isolation.
 */
export async function startActivity(
  id: string,
  payload?: Record<string, unknown>,
  actorId?: string,
): Promise<StartActivityResponse> {
  const res = await fetch(`/api/activity-providers/${encodeURIComponent(id)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: payload ?? {}, actorId }),
  });
  const data = (await res.json()) as StartActivityResponse;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Failed to start activity (${res.status})`);
  }
  return data;
}
