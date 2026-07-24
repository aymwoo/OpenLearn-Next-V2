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
  provider: string;
  dispatched: boolean;
  result?: unknown;
  error?: string;
}

/** A live (running/paused) activity instance reported by the server. */
export interface RunningActivity {
  id: string;
  name: string;
  icon?: string;
  category?: string;
  provider: string;
  /** Lifecycle state — 'running' | 'paused' on this endpoint. */
  state: string;
  /** Epoch ms when the activity entered `running`, or null. */
  startedAt: number | null;
}

/** Fetch the registered activity providers, optionally filtered by role. */
export async function fetchActivities(
  role: ActivityRole = 'all',
): Promise<ActivityProviderDescriptor[]> {
  const res = await fetch(`/api/activities?role=${encodeURIComponent(role)}`, {
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
  const res = await fetch('/api/activities/running', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to load running activities (${res.status})`);
  }
  const data = (await res.json()) as { activities: RunningActivity[] };
  return data.activities ?? [];
}

/** End a running activity (dashboard management action). */
export async function finishActivity(id: string): Promise<void> {
  const res = await fetch(`/api/activities/${encodeURIComponent(id)}/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Failed to finish activity (${res.status})`);
  }
}

/** Pause a running activity (dashboard management action). */
export async function pauseActivity(id: string): Promise<void> {
  const res = await fetch(`/api/activities/${encodeURIComponent(id)}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Failed to pause activity (${res.status})`);
  }
}

/** Resume a paused activity (dashboard management action). */
export async function resumeActivity(id: string): Promise<void> {
  const res = await fetch(`/api/activities/${encodeURIComponent(id)}/resume`, {
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
  const res = await fetch(`/api/activities/${encodeURIComponent(id)}/start`, {
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
