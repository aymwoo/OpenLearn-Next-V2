/**
 * backup-manager.ts — OpenLearn SQLite 数据库备份、校验、轮转与灾难恢复核心模块
 *
 * 核心能力：
 * 1. 热备份（基于 SQLite `VACUUM INTO`，无锁安全生成快照）
 * 2. 快照有效性双重自检（SQLite 幻数特征 + `PRAGMA integrity_check` + 表结构检测）
 * 3. 历史备份保留策略（Retention Policy，防磁盘无限耗尽）
 * 4. 原子灾难恢复（恢复前自动保留安全底座、清理 WAL/SHM 残留锁、恢复后完整性自检）
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface BackupValidationResult {
  ok: boolean;
  lessons?: number;
  tablesCount?: number;
  reason?: string;
}

export interface BackupFileInfo {
  path: string;
  filename: string;
  size: number;
  mtime: Date;
  isValid: boolean;
  lessons?: number;
  reason?: string;
}

export interface BackupOptions {
  dbPath?: string;
  backupDir?: string;
  customName?: string;
  keep?: number;
  dbInstance?: Database.Database;
}

export interface BackupResult {
  ok: boolean;
  backupPath: string;
  filename: string;
  size: number;
  prunedCount: number;
}

export interface RestoreOptions {
  backupFile?: string;
  dbPath?: string;
  backupDir?: string;
  force?: boolean;
}

export interface RestoreResult {
  ok: boolean;
  restoredPath: string;
  safetyBackupPath?: string;
  lessons: number;
  reason?: string;
}

/** 获取默认数据库路径 */
export function getDefaultDbPath(): string {
  if (process.env.OPENLEARN_DB_PATH) {
    return path.resolve(process.cwd(), process.env.OPENLEARN_DB_PATH);
  }
  return path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
}

/** 获取默认备份存储目录 */
export function getDefaultBackupDir(): string {
  if (process.env.BACKUP_DIR) {
    return path.resolve(process.cwd(), process.env.BACKUP_DIR);
  }
  return path.resolve(process.cwd(), 'backups');
}

/** 校验候选文件是否为合法、未损坏且包含必要结构的 OpenLearn 数据库 */
export function validateBackup(filePath: string): BackupValidationResult {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: '备份文件不存在' };
  }
  const stat = fs.statSync(filePath);
  if (stat.size < 100) {
    return { ok: false, reason: '文件体积过小（< 100 字节），非有效 SQLite 数据库' };
  }

  // 1. 快速检查 SQLite 魔数（前 16 字节必须是 "SQLite format 3\0"）
  const fd = fs.openSync(filePath, 'r');
  const magic = Buffer.alloc(16);
  try {
    fs.readSync(fd, magic, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!magic.toString('utf8').startsWith('SQLite format 3')) {
    return { ok: false, reason: '文件头缺失 SQLite 魔数标识' };
  }

  // 2. 通过 SQLite 引擎进行深度完整性检查
  let probe: Database.Database | null = null;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = probe.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      return { ok: false, reason: `完整性校验未通过: ${String(integrity)}` };
    }

    const tables = probe
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map((t) => t.name));

    if (!tableNames.has('lessons')) {
      return { ok: false, reason: '缺少核心 lessons 表，非合法 OpenLearn 业务数据库' };
    }

    const { n } = probe.prepare('SELECT COUNT(*) AS n FROM lessons').get() as { n: number };
    return {
      ok: true,
      lessons: n,
      tablesCount: tables.length,
    };
  } catch (err: any) {
    return { ok: false, reason: err.message || 'SQLite 校验异常' };
  } finally {
    probe?.close();
  }
}

/** 列出指定目录下的全部备份文件及其元数据（按时间降序排序） */
export function listBackups(backupDir = getDefaultBackupDir()): BackupFileInfo[] {
  if (!fs.existsSync(backupDir)) return [];
  const entries = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((filename) => {
      const fullPath = path.join(backupDir, filename);
      const stat = fs.statSync(fullPath);
      const validation = validateBackup(fullPath);
      return {
        path: fullPath,
        filename,
        size: stat.size,
        mtime: stat.mtime,
        isValid: validation.ok,
        lessons: validation.lessons,
        reason: validation.reason,
      };
    });

  // 按最新修改时间或文件名降序排序
  return entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/** 按照保留份数修剪过期备份文件 */
export function pruneBackups(backupDir = getDefaultBackupDir(), keepCount = 10): number {
  if (keepCount <= 0 || !fs.existsSync(backupDir)) return 0;
  // 仅修剪常规自动备份（前缀 backup_），保留 pre_restore_ 安全副本
  const backups = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('backup_') && f.endsWith('.db'))
    .map((f) => path.join(backupDir, f))
    .sort()
    .reverse();

  if (backups.length <= keepCount) return 0;

  const toDelete = backups.slice(keepCount);
  let pruned = 0;
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file);
      pruned++;
    } catch {
      // 忽略单个文件清理失败
    }
  }
  return pruned;
}

/** 执行数据库热备份 */
export function performBackup(options: BackupOptions = {}): BackupResult {
  const dbPath = options.dbPath ? path.resolve(options.dbPath) : getDefaultDbPath();
  const backupDir = options.backupDir ? path.resolve(options.backupDir) : getDefaultBackupDir();
  const keep = typeof options.keep === 'number' ? options.keep : 10;

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = options.customName || `backup_${timestamp}.db`;
  const backupPath = path.join(backupDir, filename);

  // 如果已经存在同名备份文件先删除
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }

  let dbInstance = options.dbInstance;
  let shouldClose = false;

  if (!dbInstance) {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`目标源数据库不存在: ${dbPath}`);
    }
    dbInstance = new Database(dbPath);
    shouldClose = true;
  }

  try {
    // 使用 SQLite 原生 VACUUM INTO 生成热备快照（转义单引号防语法注入）
    dbInstance.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  } finally {
    if (shouldClose && dbInstance) {
      dbInstance.close();
    }
  }

  // 验证生成的备份文件完整性
  const check = validateBackup(backupPath);
  if (!check.ok) {
    throw new Error(`备份生成失败，校验未通过: ${check.reason}`);
  }

  const stat = fs.statSync(backupPath);
  const prunedCount = pruneBackups(backupDir, keep);

  return {
    ok: true,
    backupPath,
    filename,
    size: stat.size,
    prunedCount,
  };
}

/** 执行原子灾难恢复 */
export function performRestore(options: RestoreOptions = {}): RestoreResult {
  const dbPath = options.dbPath ? path.resolve(options.dbPath) : getDefaultDbPath();
  const backupDir = options.backupDir ? path.resolve(options.backupDir) : getDefaultBackupDir();

  let targetBackup = options.backupFile;
  if (!targetBackup) {
    const list = listBackups(backupDir).filter((b) => b.isValid);
    if (!list.length) {
      throw new Error(`在目录 ${backupDir} 下未找到任何可用的有效备份快照`);
    }
    targetBackup = list[0].path;
  }

  const resolvedBackup = path.resolve(targetBackup);
  const check = validateBackup(resolvedBackup);
  if (!check.ok) {
    throw new Error(`无法从损坏或不兼容的备份恢复: ${check.reason}`);
  }

  // 恢复前如果现有数据库存在，且未显式指定 force，留存安全副本
  let safetyBackupPath: string | undefined;
  if (fs.existsSync(dbPath)) {
    if (!options.force) {
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      safetyBackupPath = path.join(backupDir, `pre_restore_${stamp}.db`);
      fs.copyFileSync(dbPath, safetyBackupPath);
    }
  }

  // 必须清理目标库残留的 WAL 与 SHM 侧车文件，防止恢复新库后读到旧事务日志
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = dbPath + suffix;
    if (fs.existsSync(sidecar)) {
      try {
        fs.unlinkSync(sidecar);
      } catch {
        // 忽略删除失败
      }
    }
  }

  // 原子复制覆盖
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(resolvedBackup, dbPath);

  // 恢复后验证
  const postCheck = validateBackup(dbPath);
  if (!postCheck.ok) {
    throw new Error(`恢复后目标数据库校验失败: ${postCheck.reason}`);
  }

  return {
    ok: true,
    restoredPath: dbPath,
    safetyBackupPath,
    lessons: postCheck.lessons ?? 0,
  };
}
