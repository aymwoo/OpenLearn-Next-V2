import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {
  validateBackup,
  listBackups,
  pruneBackups,
  performBackup,
  performRestore,
} from '../backup-manager';

describe('SQLite Backup & Disaster Recovery Engine (P1-5)', () => {
  let tempDir: string;
  let testDbPath: string;
  let testBackupDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-backup-test-'));
    testDbPath = path.join(tempDir, 'active.db');
    testBackupDir = path.join(tempDir, 'backups');
    fs.mkdirSync(testBackupDir, { recursive: true });

    // 初始化一个具备标准 schema 的测试库
    const db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT,
        created_at INTEGER
      );
      INSERT INTO lessons (id, title, subject, created_at) VALUES
        ('les_1', '物理探索：牛顿第一定律', 'physics', 1700000001),
        ('les_2', '化学探究：酸碱中和反应', 'chemistry', 1700000002),
        ('les_3', '技术工程：传感器数据拟合', 'engineering', 1700000003);
    `);
    db.close();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略临时文件清理报错
    }
  });

  describe('validateBackup 备份有效性校验', () => {
    it('正确识别合法未损坏的 OpenLearn 备份', () => {
      const res = validateBackup(testDbPath);
      expect(res.ok).toBe(true);
      expect(res.lessons).toBe(3);
      expect(res.tablesCount).toBeGreaterThanOrEqual(1);
    });

    it('拒绝不存在的文件', () => {
      const res = validateBackup(path.join(tempDir, 'nonexistent.db'));
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('不存在');
    });

    it('拒绝空文件或非 SQLite 文件', () => {
      const emptyFile = path.join(tempDir, 'empty.db');
      fs.writeFileSync(emptyFile, '');
      expect(validateBackup(emptyFile).ok).toBe(false);

      const fakeFile = path.join(tempDir, 'fake.db');
      fs.writeFileSync(fakeFile, 'This is a text file, not a sqlite database! '.repeat(5));
      const fakeRes = validateBackup(fakeFile);
      expect(fakeRes.ok).toBe(false);
      expect(fakeRes.reason).toContain('魔数');
    });

    it('拒绝缺少 lessons 核心业务表的 SQLite 文件', () => {
      const otherDbFile = path.join(tempDir, 'other.db');
      const otherDb = new Database(otherDbFile);
      otherDb.exec('CREATE TABLE some_random_table (id INTEGER PRIMARY KEY);');
      otherDb.close();

      const res = validateBackup(otherDbFile);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('缺少核心 lessons 表');
    });
  });

  describe('performBackup 热备份与快照管理', () => {
    it('成功执行 VACUUM INTO 热备份并生成合法快照', () => {
      const result = performBackup({
        dbPath: testDbPath,
        backupDir: testBackupDir,
        keep: 5,
      });

      expect(result.ok).toBe(true);
      expect(fs.existsSync(result.backupPath)).toBe(true);
      expect(result.size).toBeGreaterThan(0);

      // 验证快照内容
      const check = validateBackup(result.backupPath);
      expect(check.ok).toBe(true);
      expect(check.lessons).toBe(3);
    });

    it('支持传递活动数据库连接实例进行备份', () => {
      const activeDb = new Database(testDbPath);
      const result = performBackup({
        dbInstance: activeDb,
        backupDir: testBackupDir,
        customName: 'snapshot_custom.db',
      });
      activeDb.close();

      expect(result.filename).toBe('snapshot_custom.db');
      expect(fs.existsSync(result.backupPath)).toBe(true);
      expect(validateBackup(result.backupPath).ok).toBe(true);
    });

    it('根据保留数量 (keep) 自动轮转并清理过期备份', () => {
      // 连续创建 6 个备份，keep 设置为 3
      for (let i = 1; i <= 6; i++) {
        performBackup({
          dbPath: testDbPath,
          backupDir: testBackupDir,
          customName: `backup_2026-10-04T00-00-0${i}.db`,
          keep: 3,
        });
      }

      const files = listBackups(testBackupDir).filter((f) => f.filename.startsWith('backup_'));
      expect(files.length).toBe(3);
      // 保留的是最新的 3 个（04, 05, 06）
      const filenames = files.map((f) => f.filename).sort();
      expect(filenames).toEqual([
        'backup_2026-10-04T00-00-04.db',
        'backup_2026-10-04T00-00-05.db',
        'backup_2026-10-04T00-00-06.db',
      ]);
    });
  });

  describe('performRestore 灾难恢复端到端闭环', () => {
    it('成功从快照恢复数据库并自动留存 safety 副本', () => {
      // 1. 生成初始健康备份
      const backupRes = performBackup({
        dbPath: testDbPath,
        backupDir: testBackupDir,
        customName: 'backup_golden.db',
      });

      // 2. 模拟破坏/污染：向活跃库写入脏数据并删除原课节
      const activeDb = new Database(testDbPath);
      activeDb.exec(`
        DELETE FROM lessons WHERE id = 'les_1';
        INSERT INTO lessons (id, title, subject, created_at) VALUES
          ('les_corrupt', '脏数据：未经授权篡改的假课节', 'spam', 999999999);
      `);
      activeDb.close();

      // 创建虚拟的 WAL 和 SHM 侧车文件
      fs.writeFileSync(testDbPath + '-wal', 'stale wal data');
      fs.writeFileSync(testDbPath + '-shm', 'stale shm data');

      // 3. 执行灾难恢复
      const restoreRes = performRestore({
        backupFile: backupRes.backupPath,
        dbPath: testDbPath,
        backupDir: testBackupDir,
      });

      expect(restoreRes.ok).toBe(true);
      expect(restoreRes.lessons).toBe(3);
      expect(restoreRes.safetyBackupPath).toBeDefined();
      expect(fs.existsSync(restoreRes.safetyBackupPath!)).toBe(true);

      // 验证侧车残留已被清空
      expect(fs.existsSync(testDbPath + '-wal')).toBe(false);
      expect(fs.existsSync(testDbPath + '-shm')).toBe(false);

      // 4. 读取恢复后的数据库验证精准度
      const restoredDb = new Database(testDbPath, { readonly: true });
      const rows = restoredDb.prepare('SELECT id, title FROM lessons ORDER BY id').all() as Array<{
        id: string;
        title: string;
      }>;
      restoredDb.close();

      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.id)).toEqual(['les_1', 'les_2', 'les_3']);
      expect(rows.some((r) => r.id === 'les_corrupt')).toBe(false);
    });

    it('使用 --force 标志时跳过 safety 副本生成', () => {
      const backupRes = performBackup({
        dbPath: testDbPath,
        backupDir: testBackupDir,
      });

      const restoreRes = performRestore({
        backupFile: backupRes.backupPath,
        dbPath: testDbPath,
        backupDir: testBackupDir,
        force: true,
      });

      expect(restoreRes.ok).toBe(true);
      expect(restoreRes.safetyBackupPath).toBeUndefined();
    });

    it('拒绝从损坏的文件恢复，原数据库保持完好', () => {
      const corruptFile = path.join(testBackupDir, 'bad_backup.db');
      fs.writeFileSync(corruptFile, 'corrupt data');

      expect(() => {
        performRestore({
          backupFile: corruptFile,
          dbPath: testDbPath,
          backupDir: testBackupDir,
        });
      }).toThrow(/无法从损坏或不兼容的备份恢复/);

      // 验证原数据库依然完好
      const check = validateBackup(testDbPath);
      expect(check.ok).toBe(true);
      expect(check.lessons).toBe(3);
    });
  });
});
