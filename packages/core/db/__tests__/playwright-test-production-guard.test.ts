import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { armPlaywrightProductionRecheck, assertPlaywrightTestNotInProduction, initializeDatabase } from '../index.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const prevNodeEnv = process.env.NODE_ENV;
const prevPlaywright = process.env.PLAYWRIGHT_TEST;

function restoreEnv(): void {
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
  if (prevPlaywright === undefined) delete process.env.PLAYWRIGHT_TEST;
  else process.env.PLAYWRIGHT_TEST = prevPlaywright;
}

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe('assertPlaywrightTestNotInProduction', () => {
  it('NODE_ENV=production 且 PLAYWRIGHT_TEST=1 时抛出致命错误并写日志', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLAYWRIGHT_TEST = '1';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertPlaywrightTestNotInProduction()).toThrow(/PLAYWRIGHT_TEST/);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[SECURITY] FATAL'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PLAYWRIGHT_TEST'));
  });

  it('NODE_ENV=production 且 PLAYWRIGHT_TEST=true 时同样拒绝', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLAYWRIGHT_TEST = 'true';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => initializeDatabase({} as never)).toThrow(/禁止设置 PLAYWRIGHT_TEST/);
  });

  it('生产环境未设置该变量时，初始化助手可以完成迁移和种子', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PLAYWRIGHT_TEST;
    const tempDbPath = path.join(os.tmpdir(), `openlearn_pw_guard_${process.pid}_${Date.now()}.db`);
    const database = new Database(tempDbPath);
    try {
      expect(() => initializeDatabase(database)).not.toThrow();
      const row = database.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
      expect(row.cnt).toBeGreaterThanOrEqual(1);
      const admin = database.prepare('SELECT username FROM users WHERE username = ?').get('admin') as {
        username: string;
      };
      expect(admin.username).toBe('admin');
    } finally {
      database.close();
      for (const suffix of ['', '-wal', '-shm']) {
        const filePath = `${tempDbPath}${suffix}`;
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
  });

  it('Vitest 的 NODE_ENV=test 仍允许 PLAYWRIGHT_TEST，并保留众所周知的种子口令', () => {
    process.env.NODE_ENV = 'test';
    process.env.PLAYWRIGHT_TEST = '1';
    expect(() => assertPlaywrightTestNotInProduction()).not.toThrow();

    const tempDbPath = path.join(os.tmpdir(), `openlearn_pw_guard_test_${process.pid}_${Date.now()}.db`);
    const database = new Database(tempDbPath);
    try {
      initializeDatabase(database);
      const admin = database.prepare('SELECT must_change_password FROM users WHERE username = ?').get('admin') as {
        must_change_password: number;
      };
      expect(admin.must_change_password).toBe(0);
    } finally {
      database.close();
      for (const suffix of ['', '-wal', '-shm']) {
        const filePath = `${tempDbPath}${suffix}`;
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
  });

  it('NODE_ENV 不是精确的 production 时不拒绝', () => {
    process.env.NODE_ENV = 'Production';
    process.env.PLAYWRIGHT_TEST = '1';
    expect(() => assertPlaywrightTestNotInProduction()).not.toThrow();
  });

  it('延迟复查能看见模块求值之后才出现的生产开关，并在监听前退出', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PLAYWRIGHT_TEST;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    armPlaywrightProductionRecheck();
    process.env.NODE_ENV = 'production';
    process.env.PLAYWRIGHT_TEST = 'true';
    await new Promise((resolve) => process.nextTick(resolve));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[SECURITY] FATAL'));
  });

  it('延迟复查在生产环境没有该变量时不会退出', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PLAYWRIGHT_TEST;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    armPlaywrightProductionRecheck();
    await new Promise((resolve) => process.nextTick(resolve));
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
