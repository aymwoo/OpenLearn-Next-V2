import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveBackupDir, resolveBackupDirForDb, resolveDataDir } from '../backup-paths.js';

const cwd = path.join(path.sep, 'srv', 'app');

describe('backup path resolution (single source of truth)', () => {
  it('resolveDataDir follows DATA_DIR → DB_PATH parent → cwd', () => {
    expect(resolveDataDir({ OPENLEARN_DATA_DIR: path.join(path.sep, 'data') } as NodeJS.ProcessEnv, cwd)).toBe(
      path.join(path.sep, 'data'),
    );
    expect(resolveDataDir({ OPENLEARN_DB_PATH: path.join(path.sep, 'data', 'x.db') } as NodeJS.ProcessEnv, cwd)).toBe(
      path.join(path.sep, 'data'),
    );
    expect(resolveDataDir({} as NodeJS.ProcessEnv, cwd)).toBe(cwd);
  });

  it('resolveBackupDir prefers BACKUP_DIR, otherwise <dataDir>/backups', () => {
    expect(resolveBackupDir({ BACKUP_DIR: path.join(path.sep, 'backups') } as NodeJS.ProcessEnv, cwd)).toBe(
      path.join(path.sep, 'backups'),
    );
    expect(resolveBackupDir({} as NodeJS.ProcessEnv, cwd)).toBe(path.join(cwd, 'backups'));
    expect(resolveBackupDir({ OPENLEARN_DATA_DIR: path.join(path.sep, 'data') } as NodeJS.ProcessEnv, cwd)).toBe(
      path.join(path.sep, 'data', 'backups'),
    );
  });

  it('resolveBackupDirForDb keeps snapshots next to the actual database file', () => {
    const dbFile = path.join(cwd, 'db', 'x.db');
    expect(
      resolveBackupDirForDb(dbFile, { OPENLEARN_DATA_DIR: path.join(path.sep, 'data') } as NodeJS.ProcessEnv, cwd),
    ).toBe(path.join(cwd, 'db', 'backups'));
    expect(
      resolveBackupDirForDb(dbFile, { BACKUP_DIR: path.join(path.sep, 'backups') } as NodeJS.ProcessEnv, cwd),
    ).toBe(path.join(path.sep, 'backups'));
    expect(resolveBackupDirForDb(':memory:', {} as NodeJS.ProcessEnv, cwd)).toBe(path.join(cwd, 'backups'));
  });
});
