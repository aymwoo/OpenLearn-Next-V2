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

/** 与 listMigrationNames 相同：只比较去掉 `.sql` 后的文件名，并丢掉行尾 CR。 */
function migrationRecordName(name: string): string {
  return path.basename(name.replace(/\r/g, '').trim(), '.sql');
}

export function migrationsComplete(expected: string[] | null, applied: string[]): ReadinessCheck {
  if (!expected) return { ok: false, reason: 'migrations' };
  const expectedKeys = new Set(expected.map(migrationRecordName));
  const appliedKeys = new Set(applied.map(migrationRecordName));
  const pending = expected.filter((name) => !appliedKeys.has(migrationRecordName(name)));
  const unknown = applied.filter((name) => !expectedKeys.has(migrationRecordName(name)));
  if (unknown.length > 0) {
    // 名字只进日志。readinessBody 仍然只有 status，避免把库内迁移清单写进 HTTP。
    console.warn(`[health] not ready: unknown migrations ${unknown.join(',')}`);
  }
  if (pending.length > 0) return { ok: false, reason: 'migrations', pendingMigrations: pending };
  if (unknown.length > 0) return { ok: false, reason: 'migrations' };
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
