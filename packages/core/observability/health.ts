/**
 * 就绪检查。对外只返回 ready / not_ready，失败原因只进日志。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type ReadinessReason = 'database' | 'storage' | 'migrations';

export interface ReadinessCheck {
  ok: boolean;
  reason?: ReadinessReason;
  pendingMigrations?: string[];
}

export function probeStorageWritable(dir: string): boolean {
  const probe = path.join(dir, `.ready-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'ok', { flag: 'w' });
    fs.unlinkSync(probe);
    return true;
  } catch {
    try {
      fs.unlinkSync(probe);
    } catch {
      /* 探针文件可能根本没写出来 */
    }
    return false;
  }
}

export function listMigrationNames(migrationsDir: string): string[] | null {
  try {
    if (!fs.existsSync(migrationsDir)) return null;
    const names = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => path.basename(file, '.sql'));
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
}

export function migrationsComplete(expected: string[] | null, applied: string[]): ReadinessCheck {
  if (!expected) return { ok: false, reason: 'migrations' };
  const have = new Set(applied);
  const pending = expected.filter((name) => !have.has(name));
  if (pending.length > 0) return { ok: false, reason: 'migrations', pendingMigrations: pending };
  return { ok: true };
}

export interface ReadinessInput {
  pingDatabase: () => void;
  storageDir: string;
  migrationsDir: string;
  appliedMigrations: () => string[];
}

export function checkReadiness(input: ReadinessInput): ReadinessCheck {
  try {
    input.pingDatabase();
  } catch {
    return { ok: false, reason: 'database' };
  }
  if (!probeStorageWritable(input.storageDir)) {
    return { ok: false, reason: 'storage' };
  }
  let applied: string[];
  try {
    applied = input.appliedMigrations();
  } catch {
    return { ok: false, reason: 'migrations' };
  }
  return migrationsComplete(listMigrationNames(input.migrationsDir), applied);
}

/** 存活探针与就绪探针的公开响应。不带数据库路径、错误文本或备份细节。 */
export function livenessBody(
  uptimeSeconds: number,
  version: string,
): { status: 'ok'; uptime: number; version: string } {
  return { status: 'ok', uptime: uptimeSeconds, version };
}

export function readinessBody(ok: boolean): { status: 'ready' | 'not_ready' } {
  return { status: ok ? 'ready' : 'not_ready' };
}
