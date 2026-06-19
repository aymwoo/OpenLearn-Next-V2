/**
 * MFE client API — REST client for remote entry resolution.
 *
 * D-23: Fetches remote entry URLs from the backend via /api/mfe/remotes.
 * Follows the existing error handling pattern from src/plugin-host/plugin-host.ts
 * (async functions with try/catch, throw on failure).
 */

import type { MfeRemoteEntry, MfeRemoteCacheEntry } from './types';

/**
 * Fetch a single remote entry by name.
 * Calls GET /api/mfe/remotes?name=<name> and returns the cached entry.
 * Throws if the remote is not found or the request fails.
 */
export async function fetchRemoteEntry(name: string): Promise<MfeRemoteCacheEntry> {
  const resp = await fetch(`/api/mfe/remotes?name=${encodeURIComponent(name)}`);
  const json = await resp.json();
  if (!json.success) throw new Error(json.error || `Remote "${name}" not found`);
  return { ...json.result, timestamp: Date.now() };
}

/**
 * Fetch all registered remote entries.
 * Calls GET /api/mfe/remotes and returns the full list.
 * Throws if the request fails.
 */
export async function fetchAllRemotes(): Promise<MfeRemoteEntry[]> {
  const resp = await fetch('/api/mfe/remotes');
  const json = await resp.json();
  if (!json.success) throw new Error(json.error || 'Failed to fetch remotes');
  return json.result;
}
