import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

import { checkPortAvailable, getNetworkIps, runDoctor } from '../../../cli-doctor.mjs';
import { runBackup, runRestore, runResetAdmin, runPluginsList } from '../../../cli-data.mjs';

describe('CLI Enhanced Suite (系统诊断与数据运维测试)', () => {
  let tempDir: string;
  let dbPath: string;
  let backupPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(os.tmpdir(), 'openlearn-cli-test-'));
    dbPath = join(tempDir, 'data.db');
    backupPath = join(tempDir, 'backup.db');

    // 初始化测试数据库
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        name TEXT,
        created_at INTEGER
      );
      CREATE TABLE plugins (
        id TEXT PRIMARY KEY,
        name TEXT,
        manifest TEXT,
        status TEXT,
        loader_version TEXT
      );
    `);
    db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(
      'u1',
      'admin',
      'old_hashed_password',
      'administrator',
      'Admin',
      Date.now(),
    );
    db.prepare('INSERT INTO plugins VALUES (?, ?, ?, ?, ?)').run(
      'ext-courseware-preview',
      'Courseware Preview',
      JSON.stringify({ id: 'ext-courseware-preview', version: '1.2.0' }),
      'active',
      'inline',
    );
    db.close();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('cli-doctor.mjs', () => {
    it('1. checkPortAvailable 能够正确检测端口可用性', async () => {
      // 随机高位测试端口
      const testPort = 39871;
      const isFree = await checkPortAvailable(testPort);
      expect(typeof isFree).toBe('boolean');
    });

    it('2. getNetworkIps 返回数组且排除 loopback', () => {
      const ips = getNetworkIps();
      expect(Array.isArray(ips)).toBe(true);
      for (const ip of ips) {
        expect(ip.startsWith('127.')).toBe(false);
      }
    });

    it('3. runDoctor 返回合格的系统自检指标清单', async () => {
      const res = await runDoctor({ silent: true, dbPath });
      expect(res.ok).toBe(true);
      expect(res.checks.length).toBeGreaterThanOrEqual(4);
      const names = res.checks.map((c) => c.name);
      expect(names).toContain('Node.js Runtime');
      expect(names).toContain('Hardware & OS');
      expect(names).toContain('Database Storage');
    });
  });

  describe('cli-data.mjs', () => {
    it('4. runBackup 成功生成 SQLite 数据快照', async () => {
      const res = await runBackup(backupPath, { dbPath, silent: true });
      expect(res.ok).toBe(true);
      expect(res.targetFile).toBe(backupPath);
      expect(existsSync(backupPath)).toBe(true);

      // 验证快照可读并包含原有数据
      const snapDb = new Database(backupPath, { readonly: true });
      const user = snapDb.prepare('SELECT * FROM users WHERE username = ?').get('admin') as any;
      expect(user).toBeDefined();
      expect(user.username).toBe('admin');
      snapDb.close();
    });

    it('5. runRestore 具备 SQLite 文件头校验与安全回滚镜像生成', async () => {
      // 先做一次备份
      await runBackup(backupPath, { dbPath, silent: true });

      // 测试非法非 SQLite 文件还原
      const fakeBackup = join(tempDir, 'fake.db');
      writeFileSync(fakeBackup, 'not-a-sqlite-database-file');
      const fakeRes = await runRestore(fakeBackup, { dbPath, silent: true });
      expect(fakeRes.ok).toBe(false);
      expect(fakeRes.error).toMatch(/并非有效的 SQLite 数据库备份/);

      // 测试合法备份还原
      const restoreRes = await runRestore(backupPath, { dbPath, silent: true });
      expect(restoreRes.ok).toBe(true);

      // 验证是否生成了 .bak_ 安全回滚副本
      const files = readdirSync(tempDir);
      const bakFiles = files.filter((f) => f.includes('data.db.bak_'));
      expect(bakFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('6. runResetAdmin 能够重置现有管理员密码', async () => {
      const res = await runResetAdmin('new_password_2026', { dbPath, silent: true });
      expect(res.ok).toBe(true);

      const db = new Database(dbPath, { readonly: true });
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get('admin') as any;
      expect(user).toBeDefined();
      expect(user.password_hash).not.toBe('old_hashed_password');
      db.close();
    });

    it('7. runPluginsList 能够正确读取已安装插件列表', async () => {
      const res = await runPluginsList({ dbPath, silent: true });
      expect(res.ok).toBe(true);
      expect(res.plugins).toHaveLength(1);
      expect(res.plugins![0].id).toBe('ext-courseware-preview');
      expect(res.plugins![0].status).toBe('active');
    });

    it('8. runBackup 在目标目录不存在时能够递归自动创建父目录', async () => {
      const deepBackupPath = join(tempDir, 'nested', 'backups', 'deep_backup.db');
      const res = await runBackup(deepBackupPath, { dbPath, silent: true });
      expect(res.ok).toBe(true);
      expect(existsSync(deepBackupPath)).toBe(true);
    });
  });

  describe('cli.mjs (参数解析器与位置无关性测试)', () => {
    it('9. parseCliArgs 正确识别位置无关的子命令与参数', async () => {
      const { parseCliArgs } = await import('../../../cli.mjs');

      // (a) 子命令在选项之后
      const res1 = parseCliArgs(['--port', '9001', 'doctor']);
      expect(res1.command).toBe('doctor');
      expect(res1.flags.port).toBe('9001');

      // (b) --flag=value 格式解析
      const res2 = parseCliArgs(['--port=8888', '--host=127.0.0.1', 'doctor', '--fix']);
      expect(res2.command).toBe('doctor');
      expect(res2.flags.port).toBe('8888');
      expect(res2.flags.host).toBe('127.0.0.1');
      expect(res2.flags.fix).toBe(true);

      // (c) 带位置参数的子命令与前置选项
      const res3 = parseCliArgs(['--db-path', './custom.db', 'backup', 'my_snap.db']);
      expect(res3.command).toBe('backup');
      expect(res3.flags.dbPath).toBe('./custom.db');
      expect(res3.subcommandArgs).toEqual(['my_snap.db']);

      // (d) 无子命令的服务启动参数
      const res4 = parseCliArgs(['-p', '3000', '-H', '0.0.0.0', '-o', '--demo']);
      expect(res4.command).toBeNull();
      expect(res4.flags.port).toBe('3000');
      expect(res4.flags.host).toBe('0.0.0.0');
      expect(res4.flags.open).toBe(true);
      expect(res4.flags.demo).toBe(true);
    });

    it('10. parseCliArgs 准确拦截缺失数值的选项与未知命令', async () => {
      const { parseCliArgs } = await import('../../../cli.mjs');

      // 缺失端口数值
      expect(() => parseCliArgs(['-p'])).toThrow(/必须指定有效的端口数值/);
      expect(() => parseCliArgs(['--port', '-H', '127.0.0.1'])).toThrow(/必须指定有效的端口数值/);

      // 未知手误命令
      expect(() => parseCliArgs(['docotr'])).toThrow(/未知命令: "docotr"/);
    });
  });
});
