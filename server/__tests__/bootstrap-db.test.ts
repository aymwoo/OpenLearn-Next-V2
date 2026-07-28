import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runStartupMigrations } from '../bootstrap-db.js';

/**
 * Characterization test for the startup DB migrations extracted from server.ts.
 * Pins the exact queries/execs the boot path issues today so a future refactor
 * cannot silently change schema-upgrade or session-cleanup behavior.
 *
 * The mock `prepare` returns a fresh statement per call; we record every
 * statement (with its SQL) so assertions can find `run` calls for a given SQL
 * key regardless of how many times `db.prepare(...)` was invoked.
 */
describe('runStartupMigrations', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function buildMocks() {
    const executed: string[] = [];
    const prepared: { sql: string; get: any; run: any }[] = [];
    const seededGet = new Map<string, unknown>();
    const seededChanges = new Map<string, number>();
    const throwOnExec = new Set<string>();

    const db = {
      exec: (sql: string) => {
        if (throwOnExec.has(sql)) throw new Error('simulated: column already exists');
        executed.push(sql);
      },
      prepare: (sql: string) => {
        const get = vi.fn((...args: unknown[]) => seededGet.get(sql));
        const run = vi.fn((...args: unknown[]) => ({ changes: seededChanges.get(sql) ?? 0 }));
        prepared.push({ sql, get, run });
        return { get, run };
      },
    } as any;

    const runCallsFor = (sql: string) =>
      prepared.filter((p) => p.sql === sql).flatMap((p) => p.run.mock.calls);

    return { db, executed, prepared, seededGet, seededChanges, throwOnExec, runCallsFor };
  }

  it('deletes an outdated Quiz Component Plugin', async () => {
    const m = buildMocks();
    m.seededGet.set('SELECT id, manifest, source_code FROM plugins WHERE name = ?', {
      id: 'q1',
      manifest: '{}',
      source_code: 'x',
    });
    await runStartupMigrations(m.db);
    expect(m.runCallsFor('DELETE FROM plugins WHERE id = ?')).toEqual([['q1']]);
  });

  it('does NOT delete an up-to-date Quiz Component Plugin', async () => {
    const m = buildMocks();
    m.seededGet.set('SELECT id, manifest, source_code FROM plugins WHERE name = ?', {
      id: 'q1',
      manifest: '{"classroomTools":1}',
      source_code: 'actorId:1',
    });
    await runStartupMigrations(m.db);
    expect(m.runCallsFor('DELETE FROM plugins WHERE id = ?')).toEqual([]);
  });

  it('deletes an outdated Random Student Picker plugin', async () => {
    const m = buildMocks();
    m.seededGet.set('SELECT id, manifest FROM plugins WHERE name = ?', { id: 'r1', manifest: '{}' });
    await runStartupMigrations(m.db);
    expect(m.runCallsFor('DELETE FROM plugins WHERE id = ?')).toEqual([['r1']]);
  });

  it('ensures rollcall/site_settings/agent_conversations tables, index, and expires_at column', async () => {
    const m = buildMocks();
    await runStartupMigrations(m.db);
    expect(m.executed.some((s) => s.includes('CREATE TABLE IF NOT EXISTS student_rollcalls'))).toBe(true);
    expect(m.executed.some((s) => s.includes('CREATE TABLE IF NOT EXISTS site_settings'))).toBe(true);
    expect(m.executed.some((s) => s.includes('CREATE TABLE IF NOT EXISTS agent_conversations'))).toBe(true);
    expect(m.executed.some((s) => s.includes('idx_agent_conv_key'))).toBe(true);
    expect(m.executed.some((s) => s.includes('ADD COLUMN expires_at'))).toBe(true);
  });

  it('counts cleaned-up sessions and logs the total', async () => {
    const m = buildMocks();
    m.seededChanges.set('DELETE FROM client_sessions WHERE expires_at IS NOT NULL AND expires_at < ?', 2);
    m.seededChanges.set(
      'DELETE FROM client_sessions WHERE updated_at IS NOT NULL AND (? - updated_at) > ?',
      1,
    );
    await runStartupMigrations(m.db);

    expect(m.runCallsFor('DELETE FROM client_sessions WHERE expires_at IS NOT NULL AND expires_at < ?')).toHaveLength(1);
    expect(
      m.runCallsFor('DELETE FROM client_sessions WHERE updated_at IS NOT NULL AND (? - updated_at) > ?'),
    ).toHaveLength(1);
    const logged = logSpy.mock.calls.some(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('Cleaned up 3 expired sessions'),
    );
    expect(logged).toBe(true);
  });

  it('swallows a failing ALTER (column already exists) and still resolves', async () => {
    const m = buildMocks();
    m.throwOnExec.add('ALTER TABLE client_sessions ADD COLUMN expires_at INTEGER');
    await expect(runStartupMigrations(m.db)).resolves.toBeUndefined();
  });

  it('resolves without throwing on a clean run', async () => {
    const m = buildMocks();
    await expect(runStartupMigrations(m.db)).resolves.toBeUndefined();
  });
});
