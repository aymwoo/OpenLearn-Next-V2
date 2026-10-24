import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSensitiveFilePermissions } from '../security/file-permissions.js';

/**
 * Issue #233 回归：敏感文件权限基线自检。
 * 文件不得含 group/other 位（≤600），目录不得含 group/other 位（≤700）；
 * win32 跳过；不存在的目标不算违规。
 */
describe('checkSensitiveFilePermissions（Issue #233）', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-perms-test-'));
    fs.chmodSync(tempDir, 0o700);
  });

  afterEach(() => {
    fs.chmodSync(tempDir, 0o700);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const seed = (rel: string, mode: number) => {
    const p = path.join(tempDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
    fs.chmodSync(p, mode);
    return p;
  };

  it('644 的 .env / 主库 / 备份 / 密钥全部上报，600/700 通过', () => {
    const envPath = seed('.env', 0o644);
    const dbPath = seed('data/educational_os.db', 0o644);
    const backupDir = path.join(tempDir, 'data', 'backups');
    seed('data/backups/backup_1.db', 0o644);
    seed('data/backups/pre_migration_1.db', 0o640);
    seed('storage/encryption-key', 0o644);
    fs.chmodSync(backupDir, 0o755);

    const issues = checkSensitiveFilePermissions({
      envPath,
      dbPath,
      backupDir,
      encryptionKeyPath: path.join(tempDir, 'storage', 'encryption-key'),
      platform: 'linux',
    });

    const kinds = issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(['backup-dir', 'backup-file', 'backup-file', 'database', 'encryption-key', 'env']);
    expect(issues.every((i) => i.expected === '600' || i.expected === '700')).toBe(true);
    expect(issues.find((i) => i.kind === 'backup-dir')?.mode.toString(8)).toBe('755');
  });

  it('全部符合基线时返回空清单', () => {
    const envPath = seed('.env', 0o600);
    const dbPath = seed('data/educational_os.db', 0o600);
    const backupDir = path.join(tempDir, 'data', 'backups');
    seed('data/backups/backup_1.db', 0o600);
    fs.chmodSync(backupDir, 0o700);
    seed('storage/encryption-key', 0o600);

    const issues = checkSensitiveFilePermissions({
      envPath,
      dbPath,
      backupDir,
      encryptionKeyPath: path.join(tempDir, 'storage', 'encryption-key'),
      platform: 'linux',
    });
    expect(issues).toEqual([]);
  });

  it('不存在的目标不算违规；win32 整体跳过', () => {
    const issues = checkSensitiveFilePermissions({
      envPath: path.join(tempDir, 'missing.env'),
      dbPath: path.join(tempDir, 'missing.db'),
      backupDir: path.join(tempDir, 'missing-backups'),
      encryptionKeyPath: path.join(tempDir, 'missing-key'),
      platform: 'linux',
    });
    expect(issues).toEqual([]);

    const wide = seed('.env', 0o666);
    expect(
      checkSensitiveFilePermissions({ envPath: wide, platform: 'win32' }),
    ).toEqual([]);
  });
});
