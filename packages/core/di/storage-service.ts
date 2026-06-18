/**
 * StorageService — kernel-level persistent key-value storage.
 *
 * Implements IStorageService using the SQLite `plugin_storage` table.
 * Uses `'__kernel__'` as the plugin_id namespace; per-plugin isolation
 * is provided by PluginRuntime's wrappedStorage wrapper layer, which
 * binds each wrapped call to the plugin's `manifest.id`.
 *
 * ## Design decisions
 *
 * - **No try-catch wrapping**: Errors bubble to the caller — the PluginRuntime
 *   wrapper layer is responsible for error logging in the plugin context.
 * - **Synchronous SQLite API**: better-sqlite3 is synchronous; each method
 *   runs synchronously inside the Promise executor so the async interface
 *   contract is honored without offloading to the thread pool.
 * - **Constructor injection**: Receives `BetterSqlite3.Database` directly,
 *   following the same pattern as `ProcessManager(private kernel: Kernel)`.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { IStorageService } from './interfaces.js';

export class StorageService implements IStorageService {
  constructor(private db: BetterSqlite3.Database) {}

  async get(key: string): Promise<unknown> {
    const row = this.db
      .prepare(
        'SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?',
      )
      .get('__kernel__', key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const valueStr = JSON.stringify(value);
    this.db
      .prepare(
        `INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run('__kernel__', key, valueStr, Date.now());
  }

  async delete(key: string): Promise<void> {
    this.db
      .prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?')
      .run('__kernel__', key);
  }
}
