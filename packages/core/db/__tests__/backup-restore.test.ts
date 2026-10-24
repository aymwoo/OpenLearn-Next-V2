import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { validateBackup, listBackups, pruneBackups, pruneMigratorSnapshots, performBackup, performRestore } from '../backup-manager';

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
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );
      INSERT INTO lessons (id, title, subject, created_at) VALUES
        ('les_1', '物理探索：牛顿第一定律', 'physics', 1700000001),
        ('les_2', '化学探究：酸碱中和反应', 'chemistry', 1700000002),
        ('les_3', '技术工程：传感器数据拟合', 'engineering', 1700000003);
      INSERT INTO _migrations (name, applied_at, checksum) VALUES ('000_initial_schema', 1, 'test');
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

    it('拒绝缺少 _migrations 表的 SQLite 文件', () => {
      const noMigrations = path.join(tempDir, 'no-migrations.db');
      const otherDb = new Database(noMigrations);
      otherDb.exec('CREATE TABLE lessons (id TEXT PRIMARY KEY, title TEXT NOT NULL);');
      otherDb.close();

      const res = validateBackup(noMigrations);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('_migrations');
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

describe('迁移前快照保留策略（Issue #234）', () => {
  let tempDir: string;
  let backupDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-premig-test-'));
    backupDir = path.join(tempDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    delete process.env.PRE_MIGRATION_KEEP;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.PRE_MIGRATION_KEEP;
  });

  const seed = (name: string) => fs.writeFileSync(path.join(backupDir, name), 'x');

  it('超过保留份数时删最旧的 pre_migration_，pre_restore_ 与 backup_ 不受影响', () => {
    for (let i = 1; i <= 8; i++) {
      seed(`pre_migration_2026010${i}_000000.db`);
    }
    seed('pre_restore_20260101_000000.db');
    seed('backup_20260101_000000.db');

    const pruned = pruneMigratorSnapshots(backupDir, 5);
    expect(pruned).toBe(3);

    const left = fs.readdirSync(backupDir).sort();
    expect(left.filter((f) => f.startsWith('pre_migration_')).length).toBe(5);
    // 最旧的 3 份被删（时间戳字典序 = 时间序）
    expect(left).not.toContain('pre_migration_20260101_000000.db');
    expect(left).not.toContain('pre_migration_20260102_000000.db');
    expect(left).not.toContain('pre_migration_20260103_000000.db');
    expect(left).toContain('pre_migration_20260108_000000.db');
    // 其他前缀原样保留
    expect(left).toContain('pre_restore_20260101_000000.db');
    expect(left).toContain('backup_20260101_000000.db');
  });

  it('PRE_MIGRATION_KEEP 环境变量生效，且 0 也会兜底保留 1 份', () => {
    for (let i = 1; i <= 4; i++) {
      seed(`pre_migration_2026010${i}_000000.db`);
    }
    process.env.PRE_MIGRATION_KEEP = '2';
    expect(pruneMigratorSnapshots(backupDir)).toBe(2);
    expect(fs.readdirSync(backupDir).filter((f) => f.startsWith('pre_migration_')).length).toBe(2);

    // 兜底：配置为 0 也会保留最近 1 份恢复点（2 → 1）
    process.env.PRE_MIGRATION_KEEP = '0';
    expect(pruneMigratorSnapshots(backupDir)).toBe(1);
    expect(fs.readdirSync(backupDir).filter((f) => f.startsWith('pre_migration_')).length).toBe(1);
    // 已只剩 1 份（=兜底下限），再剪不再删
    expect(pruneMigratorSnapshots(backupDir, 0)).toBe(0);
    expect(fs.readdirSync(backupDir).filter((f) => f.startsWith('pre_migration_')).length).toBe(1);
  });

  it('不足保留份数时不删除', () => {
    seed('pre_migration_20260101_000000.db');
    expect(pruneMigratorSnapshots(backupDir, 5)).toBe(0);
    expect(fs.readdirSync(backupDir).length).toBe(1);
  });
});
