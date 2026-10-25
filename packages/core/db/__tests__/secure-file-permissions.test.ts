/**
 * 平台自建敏感文件的权限必须**创建即合规**（审计 P1-2 回归）。
 *
 * ## 背景
 *
 * 权限基线（`server/security/file-permissions.ts`）要求「文件 ≤600、目录 ≤700」，
 * 但它只负责**检查**。平台自己创建这些文件时用的是默认 umask，于是：
 *
 * - 主库 `educational_os.db`：better-sqlite3 按默认 umask 创建 → 644；
 * - WAL / SHM 侧车：与主库等价（装着未 checkpoint 的全量学生数据）→ 644；
 * - 备份目录 `backups/`：`mkdirSync` 未带 mode → 755。
 *
 * 后果是「门禁在自己的开箱状态下就是红的」：全新部署启动即报 ERROR，
 * `pnpm ops:check-perms` 立刻以退出码 1 失败。
 *
 * 修复口径见 `packages/core/db/secure-files.ts`：文件在 open 时就带 0600，
 * 目录在 mkdir 时就带 0700 —— 不依赖 umask，也不存在「先 644 再 chmod」的暴露窗口。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../index.js';
import { performBackup } from '../backup-manager.js';
import { ensureSecureDir, ensureSecureFile, hardenFile, hardenDir } from '../secure-files.js';

const modeOf = (p: string): number => fs.statSync(p).mode & 0o777;

describe('平台自建敏感文件创建即合规（审计 P1-2）', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-securefile-test-'));
  });

  afterEach(() => {
    fs.chmodSync(tempDir, 0o700);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('主库与 WAL/SHM 侧车', () => {
    it('createDatabase 产出的主库是 600，侧车也是 600', () => {
      const dbPath = path.join(tempDir, 'data', 'educational_os.db');
      const instance = createDatabase(dbPath);

      // 连接还开着时 WAL/SHM 侧车才存在 —— 必须在 close 之前断言
      expect(modeOf(dbPath)).toBe(0o600);

      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${dbPath}${suffix}`;
        if (fs.existsSync(sidecar)) {
          expect(modeOf(sidecar), `${suffix} 侧车权限`).toBe(0o600);
        }
      }

      instance.close();
    });

    it('已存在但过宽的主库会被收紧到 600', () => {
      const dbPath = path.join(tempDir, 'legacy.db');
      fs.writeFileSync(dbPath, '');
      fs.chmodSync(dbPath, 0o644);

      const instance = createDatabase(dbPath);
      expect(modeOf(dbPath)).toBe(0o600);
      instance.close();
    });
  });

  describe('备份目录与快照', () => {
    it('performBackup 建的备份目录是 700，快照文件是 600', () => {
      const dbPath = path.join(tempDir, 'data', 'educational_os.db');
      const backupDir = path.join(tempDir, 'data', 'backups');
      const instance = createDatabase(dbPath);

      const result = performBackup({ dbPath, backupDir, dbInstance: instance });
      instance.close();

      expect(modeOf(backupDir), '备份目录权限').toBe(0o700);
      expect(modeOf(result.backupPath), '备份文件权限').toBe(0o600);
    });

    it('已存在但过宽的备份目录会被收紧到 700', () => {
      const backupDir = path.join(tempDir, 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      fs.chmodSync(backupDir, 0o755);

      ensureSecureDir(backupDir);
      expect(modeOf(backupDir)).toBe(0o700);
    });
  });

  describe('收紧语义：只收紧，不放宽', () => {
    it('已合规或更严的文件不动（0400 不会被改成 0600）', () => {
      const p = path.join(tempDir, 'strict.txt');
      fs.writeFileSync(p, 'x');
      fs.chmodSync(p, 0o400);

      expect(hardenFile(p)).toBe(false);
      expect(modeOf(p)).toBe(0o400);
    });

    it('含 group/other 位的文件被收敛到 600，并报告变更', () => {
      const p = path.join(tempDir, 'wide.txt');
      fs.writeFileSync(p, 'x');
      fs.chmodSync(p, 0o644);

      expect(hardenFile(p)).toBe(true);
      expect(modeOf(p)).toBe(0o600);
    });

    it('目录同理：755 → 700', () => {
      const d = path.join(tempDir, 'wide-dir');
      fs.mkdirSync(d);
      fs.chmodSync(d, 0o755);

      expect(hardenDir(d)).toBe(true);
      expect(modeOf(d)).toBe(0o700);
    });

    it('ensureSecureFile 新建文件直接是 600（无「先宽后紧」窗口）', () => {
      const p = path.join(tempDir, 'fresh', 'secret.db');
      ensureSecureFile(p);

      expect(fs.existsSync(p)).toBe(true);
      expect(modeOf(p)).toBe(0o600);
    });
  });
});
