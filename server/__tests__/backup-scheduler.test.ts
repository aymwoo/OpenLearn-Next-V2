import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  msUntilNextDailyRun,
  shouldFullCheckpoint,
  startBackupScheduler,
} from '../backup-scheduler.js';

describe('backup-scheduler (R2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.BACKUP_SCHEDULE;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.BACKUP_SCHEDULE;
    delete process.env.BACKUP_KEEP;
    delete process.env.BACKUP_DAILY_AT;
  });

  it('msUntilNextDailyRun: 当日未到则指向今日 03:00，已过则指向次日', () => {
    // 2026-10-10 01:00 本地 → 距今日 03:00 约 2h
    const early = new Date(2026, 9, 10, 1, 0, 0, 0).getTime();
    expect(msUntilNextDailyRun(early, 3)).toBe(2 * 60 * 60 * 1000);
    // 04:00 → 次日 03:00 = 23h
    const late = new Date(2026, 9, 10, 4, 0, 0, 0).getTime();
    expect(msUntilNextDailyRun(late, 3)).toBe(23 * 60 * 60 * 1000);
  });

  it('shouldFullCheckpoint: WAL > 50MB 才 FULL', () => {
    expect(shouldFullCheckpoint(0)).toBe(false);
    expect(shouldFullCheckpoint(50 * 1024 * 1024)).toBe(false);
    expect(shouldFullCheckpoint(50 * 1024 * 1024 + 1)).toBe(true);
  });

  it('BACKUP_SCHEDULE=off 时不注册任何定时器', () => {
    process.env.BACKUP_SCHEDULE = 'off';
    const performBackupFn = vi.fn();
    const checkpointFn = vi.fn();
    const handle = startBackupScheduler({ db: {}, performBackupFn, checkpointFn });
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(performBackupFn).not.toHaveBeenCalled();
    expect(checkpointFn).not.toHaveBeenCalled();
    handle.stop();
  });

  it('每小时 checkpoint，失败不抛且继续调度', () => {
    const performBackupFn = vi.fn(() => ({ ok: true, backupPath: '/tmp/x.db' }));
    const checkpointFn = vi.fn(() => {
      throw new Error('locked');
    });
    const handle = startBackupScheduler({ db: {} as any, performBackupFn, checkpointFn });
    vi.advanceTimersByTime(3 * 60 * 60 * 1000 + 1000);
    expect(checkpointFn.mock.calls.length).toBeGreaterThanOrEqual(3);
    handle.stop();
  });
});
