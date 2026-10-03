/**
 * 轮转行为测试。
 *
 * 全部使用 `os.tmpdir()` 下的临时目录，**绝不写入仓库的 `logs/`**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RotatingFileStream, resolveRotationConfig } from '../rotating-file-stream.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-log-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('RotatingFileStream', () => {
  it('未超阈值时只写活动文件，不产生历史文件', () => {
    const filePath = path.join(tmpDir, 'openlearn.log');
    const stream = new RotatingFileStream({ filePath, maxBytes: 1024, maxFiles: 3 });

    stream.write('a'.repeat(100));
    stream.write('b'.repeat(100));
    stream.end();

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toHaveLength(200);
    expect(fs.existsSync(`${filePath}.1`)).toBe(false);
  });

  it('超过阈值后产生新文件，旧内容被保留到 .1', () => {
    const filePath = path.join(tmpDir, 'openlearn.log');
    const stream = new RotatingFileStream({ filePath, maxBytes: 100, maxFiles: 3 });

    stream.write('1'.repeat(60));
    stream.write('2'.repeat(60)); // 60+60 > 100 -> 轮转
    stream.write('3'.repeat(60)); // 60+60 > 100 -> 再次轮转
    stream.end();

    // 活动文件只含最后一段
    expect(fs.readFileSync(filePath, 'utf8')).toBe('3'.repeat(60));
    // 最近一次轮转前的内容 = .1（第二段）
    expect(fs.readFileSync(`${filePath}.1`, 'utf8')).toBe('2'.repeat(60));
    // 更早的轮转内容 = .2（第一段）
    expect(fs.readFileSync(`${filePath}.2`, 'utf8')).toBe('1'.repeat(60));
    expect(fs.existsSync(`${filePath}.3`)).toBe(false);
  });

  it('保留份数有上限，超出的最旧文件被清理', () => {
    const filePath = path.join(tmpDir, 'openlearn.log');
    const stream = new RotatingFileStream({ filePath, maxBytes: 50, maxFiles: 2 });

    // 连续写 6 段，每段都触发轮转
    for (const ch of ['a', 'b', 'c', 'd', 'e', 'f']) {
      stream.write(ch.repeat(60));
    }
    stream.end();

    // 只应保留 2 份历史
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    expect(fs.existsSync(`${filePath}.2`)).toBe(true);
    expect(fs.existsSync(`${filePath}.3`)).toBe(false);
    // 活动文件是最后一段
    expect(fs.readFileSync(filePath, 'utf8')).toBe('f'.repeat(60));
  });

  it('单文件不会超过 maxBytes（预判式轮转）', () => {
    const filePath = path.join(tmpDir, 'openlearn.log');
    const stream = new RotatingFileStream({ filePath, maxBytes: 100, maxFiles: 5 });

    for (let i = 0; i < 10; i += 1) {
      stream.write('x'.repeat(30));
    }
    stream.end();

    for (const p of [filePath, `${filePath}.1`, `${filePath}.2`]) {
      expect(fs.statSync(p).size).toBeLessThanOrEqual(100);
    }
  });

  it('启动时若活动文件已超限，首次写入即触发轮转', () => {
    const filePath = path.join(tmpDir, 'openlearn.log');
    // 预置一个已超限的旧文件（模拟重启前遗留的大文件）
    fs.writeFileSync(filePath, 'z'.repeat(500));

    const stream = new RotatingFileStream({ filePath, maxBytes: 100, maxFiles: 2 });
    stream.write('new-line');
    stream.end();

    expect(fs.readFileSync(filePath, 'utf8')).toBe('new-line');
    expect(fs.statSync(`${filePath}.1`).size).toBe(500);
  });

  it('目标目录不存在时自动创建', () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'openlearn.log');
    const stream = new RotatingFileStream({ filePath, maxBytes: 1024, maxFiles: 2 });
    stream.write('hello');
    stream.end();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('hello');
  });
});

describe('resolveRotationConfig', () => {
  it('未设置环境变量时使用默认值 10MB / 5 份', () => {
    const cfg = resolveRotationConfig({} as NodeJS.ProcessEnv);
    expect(cfg.maxBytes).toBe(10 * 1024 * 1024);
    expect(cfg.maxFiles).toBe(5);
  });

  it('支持通过 LOG_MAX_SIZE_MB / LOG_MAX_FILES 覆盖', () => {
    const cfg = resolveRotationConfig({
      LOG_MAX_SIZE_MB: '1',
      LOG_MAX_FILES: '2',
    } as NodeJS.ProcessEnv);
    expect(cfg.maxBytes).toBe(1024 * 1024);
    expect(cfg.maxFiles).toBe(2);
  });

  it('非法值回退到默认值而不是崩溃', () => {
    const cfg = resolveRotationConfig({
      LOG_MAX_SIZE_MB: 'abc',
      LOG_MAX_FILES: '-3',
    } as NodeJS.ProcessEnv);
    expect(cfg.maxBytes).toBe(10 * 1024 * 1024);
    expect(cfg.maxFiles).toBe(5);
  });
});
