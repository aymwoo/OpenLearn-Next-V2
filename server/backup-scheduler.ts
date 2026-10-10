/**
 * backup-scheduler.ts — 应用内定时备份与 WAL 检查点调度。
 *
 * 背景（R2）：备份能力（VACUUM INTO 热备 + 校验 + 保留 10 份）早已在
 * `packages/core/db/backup-manager.ts` 实现完备，但全仓无任何定时调用方，
 * 仅靠人工 `pnpm db:backup` 与部署前手动备份（失败还继续部署）。
 * 长期不重启则 `-wal` 持续膨胀，且误删即丢数据。
 *
 * 策略（默认开启，测试/按需可用环境变量关闭）：
 * - 每小时 `checkpoint('PASSIVE')`；WAL 侧车 > 50MB 时改 `FULL`。
 * - 每天 03:00（本地时区，可用 BACKUP_DAILY_AT=H 配置）`performBackup` 留 10 份。
 * - 失败只记 `console.error`（logger.fatal 等价），不抛、不中断服务；
 *   备份失败在 `/health/ready.lastBackupAgeH` 可见。
 *
 * 环境变量：
 * - BACKUP_SCHEDULE=off → 完全停用（单测/临时实例用）
 * - BACKUP_KEEP=N → 保留份数（默认 10）
 * - BACKUP_DAILY_AT=H → 每日备份小时（0-23，默认 3）
 * - BACKUP_CHECKPOINT_INTERVAL_MS → checkpoint 间隔（默认 3600000）
 */
import fs from 'node:fs';
import path from 'node:path';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WAL_FULL_THRESHOLD_BYTES = 50 * 1024 * 1024;

export interface BackupSchedulerDeps {
  /** better-sqlite3 实例（默认 kernelContainer.db，由调用方传入避免循环依赖） */
  db: any;
  performBackupFn?: (options?: any) => { ok: boolean; backupPath: string };
  checkpointFn?: (mode?: string) => { busy: number; log: number; checkpointed: number };
  dbPath?: string;
}

export interface BackupSchedulerHandle {
  stop: () => void;
}

/** 下一次每日备份时刻距今毫秒数（本地时区，可单测） */
export function msUntilNextDailyRun(nowMs: number, atHour: number, dateCtor: new (...args: any[]) => Date = Date): number {
  const next = new (dateCtor as any)(nowMs);
  next.setHours(atHour, 0, 0, 0);
  if (next.getTime() <= nowMs) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(0, next.getTime() - nowMs);
}

/** WAL 字节数是否达到 FULL 检查点阈值（可单测） */
export function shouldFullCheckpoint(walBytes: number, threshold = WAL_FULL_THRESHOLD_BYTES): boolean {
  return walBytes > threshold;
}

function resolveDbPath(explicit: string | undefined): string {
  if (explicit) return explicit;
  if (process.env.OPENLEARN_DB_PATH) return path.resolve(process.cwd(), process.env.OPENLEARN_DB_PATH);
  return path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
}

export function startBackupScheduler(deps: BackupSchedulerDeps): BackupSchedulerHandle {
  const noop = { stop: () => {} };
  if (process.env.BACKUP_SCHEDULE === 'off') {
    return noop;
  }

  const keep = Number(process.env.BACKUP_KEEP ?? 10) || 10;
  const atHourRaw = Number(process.env.BACKUP_DAILY_AT ?? 3);
  const atHour = Number.isFinite(atHourRaw) ? Math.min(23, Math.max(0, Math.floor(atHourRaw))) : 3;
  const checkpointInterval = Number(process.env.BACKUP_CHECKPOINT_INTERVAL_MS ?? HOUR_MS) || HOUR_MS;
  const dbPath = resolveDbPath(deps.dbPath);

  let stopped = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const track = (t: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> => {
    timers.push(t);
    try {
      (t as any).unref?.();
    } catch {
      // 忽略
    }
    return t;
  };

  const doCheckpoint = () => {
    if (stopped) return;
    try {
      let walBytes = 0;
      try {
        walBytes = fs.statSync(dbPath + '-wal').size;
      } catch {
        walBytes = 0;
      }
      const mode = shouldFullCheckpoint(walBytes) ? 'FULL' : 'PASSIVE';
      if (deps.checkpointFn) {
        deps.checkpointFn(mode);
      }
      if (walBytes > 0) {
        console.log(`[BackupScheduler] checkpoint(${mode}) wal=${(walBytes / 1024 / 1024).toFixed(1)}MB`);
      }
    } catch (err) {
      console.error('[BackupScheduler] checkpoint failed:', err);
    }
    track(setTimeout(doCheckpoint, checkpointInterval));
  };

  const doBackup = () => {
    if (stopped) return;
    try {
      if (!deps.performBackupFn) return;
      const result = deps.performBackupFn({ dbInstance: deps.db, keep });
      console.log(`[BackupScheduler] daily backup ok: ${result.backupPath}`);
    } catch (err) {
      // R2：备份失败必须可见（非零信号给 CI/compose），但不中断服务
      console.error('[BackupScheduler] FATAL daily backup failed:', err);
    }
    track(setTimeout(doBackup, DAY_MS));
  };

  // 打印启动时的库路径与目标，便于排障第一眼定位备错库问题
  console.log(`[BackupScheduler] enabled db=${dbPath} keep=${keep} dailyAt=${atHour}:00 checkpointEvery=${Math.round(checkpointInterval / 60000)}min`);
  track(setTimeout(doCheckpoint, checkpointInterval));
  track(setTimeout(doBackup, msUntilNextDailyRun(Date.now(), atHour)));

  return {
    stop: () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
    },
  };
}
