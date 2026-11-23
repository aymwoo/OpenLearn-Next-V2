/**
 * 测试库回收判定（阶段 13.1）。
 *
 * 回归背景：旧实现把整轮清理包在一个 try/catch 里，并发 worker 删除同一文件时
 * `statSync` 抛错会中断后续所有文件，日积月累把 `/tmp/openlearn_test_dbs`
 * 堆到数 GB，最终导致 SQLite `disk I/O error` 让全量测试大面积失败。
 */
import { describe, expect, it } from 'vitest';
import { parseTestDbFilePid, shouldReclaimTestDbFile } from '../test-db-files.js';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const decide = (entry: string, patch: Partial<Parameters<typeof shouldReclaimTestDbFile>[0]> = {}) =>
  shouldReclaimTestDbFile({
    entry,
    mtimeMs: NOW,
    now: NOW,
    currentPid: 100,
    isAlive: () => true,
    ...patch,
  });

describe('测试库文件回收', () => {
  it('从 db / wal / shm 文件名解析 pid', () => {
    expect(parseTestDbFilePid('openlearn_test_1_4242.db')).toBe(4242);
    expect(parseTestDbFilePid('openlearn_test_3_4242.db-wal')).toBe(4242);
    expect(parseTestDbFilePid('openlearn_test_3_4242.db-shm')).toBe(4242);
    expect(parseTestDbFilePid('openlearn_test_legacy.db')).toBeNull();
    expect(parseTestDbFilePid('other.db')).toBeNull();
  });

  it('当前进程的库永不回收', () => {
    expect(decide('openlearn_test_1_100.db')).toBe(false);
  });

  it('已退出进程的库立即回收', () => {
    expect(decide('openlearn_test_1_200.db', { isAlive: () => false })).toBe(true);
    expect(decide('openlearn_test_1_200.db-wal', { isAlive: () => false })).toBe(true);
  });

  it('仍存活进程的库即使很旧也保留', () => {
    expect(decide('openlearn_test_1_200.db', { mtimeMs: NOW - 10 * DAY, isAlive: () => true })).toBe(false);
  });

  it('无法解析 pid 的历史文件按 24 小时兜底', () => {
    expect(decide('openlearn_test_legacy.db', { mtimeMs: NOW - 2 * DAY })).toBe(true);
    expect(decide('openlearn_test_legacy.db', { mtimeMs: NOW - 1000 })).toBe(false);
  });

  it('旧 pid 哨兵直接回收', () => {
    expect(decide('.reset-12345', { mtimeMs: NOW })).toBe(true);
  });
});
