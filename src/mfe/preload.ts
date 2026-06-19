/**
 * preload — Manual remote module preload API.
 *
 * D-26: Manual preload API for prefetching remoteEntry.js + main chunk.
 *       Call before navigation to reduce perceived load time.
 *       Safe to call multiple times — @module-federation/runtime caches
 *       already-loaded modules.
 *
 * Usage:
 *   await preload('mfe_whiteboard');
 *   await preloadAll(['mfe_whiteboard', 'mfe_courseware']);
 */

import { loadRemote } from '@module-federation/runtime';

/**
 * Preload a remote module's remoteEntry.js and main chunk.
 *
 * Safe to call multiple times — already-loaded modules are cached
 * by @module-federation/runtime.
 */
export async function preload(name: string): Promise<void> {
  await loadRemote(`${name}/App`);
}

/**
 * Preload multiple remotes in parallel.
 */
export async function preloadAll(names: string[]): Promise<void> {
  await Promise.all(names.map(preload));
}
