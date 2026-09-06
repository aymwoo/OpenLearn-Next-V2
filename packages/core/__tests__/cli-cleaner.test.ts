import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { runClean } from '../../../cli-cleaner.mjs';

describe('CLI Cleaner Suite (缓存清理与安全重置测试)', () => {
  let tempDir: string;
  let customNpxDir: string;
  let customDataDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(os.tmpdir(), 'openlearn-cleaner-test-'));
    customNpxDir = join(tempDir, '_npx');
    customDataDir = join(tempDir, 'openlearn-data');

    mkdirSync(customNpxDir, { recursive: true });
    mkdirSync(customDataDir, { recursive: true });

    // 构造模拟 NPX 缓存目录：一个包含 openlearn-next，一个包含 other-package
    const npxOldPkg = join(customNpxDir, 'hash123', 'node_modules', 'openlearn-next');
    mkdirSync(npxOldPkg, { recursive: true });
    writeFileSync(join(npxOldPkg, 'package.json'), JSON.stringify({ name: 'openlearn-next', version: '0.2.5' }));

    const npxOtherPkg = join(customNpxDir, 'hash456', 'node_modules', 'other-tool');
    mkdirSync(npxOtherPkg, { recursive: true });
    writeFileSync(join(npxOtherPkg, 'package.json'), JSON.stringify({ name: 'other-tool', version: '1.0.0' }));

    // 构造模拟本地数据库与运行日志
    writeFileSync(join(customDataDir, 'data.db'), 'mock-sqlite-db-data');
    writeFileSync(join(customDataDir, 'data.db-wal'), 'mock-sqlite-wal-data');
    writeFileSync(join(customDataDir, 'data.db-shm'), 'mock-sqlite-shm-data');

    // 构造模拟临时子目录
    const tempSubDir = join(customDataDir, 'temp');
    mkdirSync(tempSubDir, { recursive: true });
    writeFileSync(join(tempSubDir, 'scratch.log'), 'log-content');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. 默认安全模式：清理 openlearn-next 的 NPX 缓存与 WAL 日志，但严格保留 data.db 业务数据库', () => {
    const res = runClean({
      customNpxDir,
      customDataDir,
      silent: true,
    });

    expect(res.npxCleaned).toBe(1);
    expect(res.dbReset).toBe(false);

    // 验证 NPX 缓存已清理，但其他工具未受影响
    expect(existsSync(join(customNpxDir, 'hash123'))).toBe(false);
    expect(existsSync(join(customNpxDir, 'hash456'))).toBe(true);

    // 验证 WAL 日志与临时目录被清理，但主数据库依然完整
    expect(existsSync(join(customDataDir, 'data.db'))).toBe(true);
    expect(existsSync(join(customDataDir, 'data.db-wal'))).toBe(false);
    expect(existsSync(join(customDataDir, 'temp'))).toBe(false);
  });

  it('2. --npx 选项：仅清理 NPX 缓存，完全不碰本地数据库与运行文件', () => {
    const res = runClean({
      npx: true,
      customNpxDir,
      customDataDir,
      silent: true,
    });

    expect(res.npxCleaned).toBe(1);
    expect(res.dbReset).toBe(false);

    // NPX 缓存清理
    expect(existsSync(join(customNpxDir, 'hash123'))).toBe(false);

    // 本地数据完全不碰
    expect(existsSync(join(customDataDir, 'data.db'))).toBe(true);
    expect(existsSync(join(customDataDir, 'data.db-wal'))).toBe(true);
    expect(existsSync(join(customDataDir, 'temp'))).toBe(true);
  });

  it('3. --db 选项：重置本地数据库与 WAL/SHM，但不清理 NPX 缓存', () => {
    const res = runClean({
      db: true,
      customNpxDir,
      customDataDir,
      silent: true,
    });

    expect(res.npxCleaned).toBe(0);
    expect(res.dbReset).toBe(true);

    // NPX 缓存未受影响
    expect(existsSync(join(customNpxDir, 'hash123'))).toBe(true);

    // 数据库与日志全清空
    expect(existsSync(join(customDataDir, 'data.db'))).toBe(false);
    expect(existsSync(join(customDataDir, 'data.db-wal'))).toBe(false);
  });

  it('4. --all 选项：全量清理（NPX 历史包 + 运行日志 + 重置数据库）', () => {
    const res = runClean({
      all: true,
      customNpxDir,
      customDataDir,
      silent: true,
    });

    expect(res.npxCleaned).toBe(1);
    expect(res.dbReset).toBe(true);

    expect(existsSync(join(customNpxDir, 'hash123'))).toBe(false);
    expect(existsSync(join(customDataDir, 'data.db'))).toBe(false);
    expect(existsSync(join(customDataDir, 'data.db-wal'))).toBe(false);
    expect(existsSync(join(customDataDir, 'temp'))).toBe(false);
  });
});
