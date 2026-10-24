/**
 * file-permissions.ts — 敏感文件权限基线自检（Issue #233）。
 *
 * `.env`（含 ENCRYPTION_KEY）、SQLite 主库与 backups/ 下的全部数据库快照
 * 是等价于全量学生数据的敏感文件。默认 umask 下它们落在 644（全局可读），
 * 多用户机器上任何本地账号都能读走。本模块在启动期做一次自检并打 WARN
 * （不阻断启动），并给 `scripts/check-file-permissions.ts` 供部署后人工跑。
 *
 * 口径：文件不得含 group/other 位（600 或更严），目录不得含 group/other
 * 位（700 或更严）。Windows 无 POSIX 权限模型，整体跳过。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface FilePermissionIssue {
  path: string;
  /** 实际八进制权限，如 0o644 */
  mode: number;
  /** 期望基线，'600' 或 '700' */
  expected: string;
  kind: 'env' | 'database' | 'backup-dir' | 'backup-file' | 'encryption-key';
}

export interface FilePermissionCheckOptions {
  envPath?: string;
  dbPath?: string;
  backupDir?: string;
  encryptionKeyPath?: string;
  /** 注入平台便于测试；默认 process.platform，win32 整体跳过 */
  platform?: string;
  /** 备份目录内扫描的 .db 文件数上限，防异常目录拖慢启动 */
  maxBackupFiles?: number;
}

export const FILE_PERMISSION_BASELINE_DOC =
  '修复：chmod 600 <file>（目录 chmod 700）；详见 docs/administrator-guide/admin-manual.md 文件权限基线一节。';

function modeOf(p: string): number | null {
  try {
    return fs.statSync(p).mode & 0o777;
  } catch {
    return null;
  }
}

function defaultPaths() {
  const dbPath = process.env.OPENLEARN_DB_PATH
    ? path.resolve(process.cwd(), process.env.OPENLEARN_DB_PATH)
    : path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  const backupDir = process.env.BACKUP_DIR
    ? path.resolve(process.cwd(), process.env.BACKUP_DIR)
    : path.join(path.dirname(dbPath), 'backups');
  return {
    envPath: path.resolve(process.cwd(), '.env'),
    dbPath,
    backupDir,
    encryptionKeyPath: path.resolve(process.cwd(), 'storage', 'encryption-key'),
  };
}

/** 检查敏感文件权限，返回不符合基线的清单（不抛错，自检绝不阻断启动） */
export function checkSensitiveFilePermissions(options: FilePermissionCheckOptions = {}): FilePermissionIssue[] {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return [];

  const defaults = defaultPaths();
  const envPath = options.envPath ?? defaults.envPath;
  const dbPath = options.dbPath ?? defaults.dbPath;
  const backupDir = options.backupDir ?? defaults.backupDir;
  const encryptionKeyPath = options.encryptionKeyPath ?? defaults.encryptionKeyPath;
  const maxBackupFiles = options.maxBackupFiles ?? 200;

  const issues: FilePermissionIssue[] = [];
  const checkFile = (p: string, expected: string, kind: FilePermissionIssue['kind']) => {
    const mode = modeOf(p);
    // 不存在的目标（如未生成 .env / 未建库）不是权限问题，跳过
    if (mode === null) return;
    if ((mode & 0o077) !== 0) {
      issues.push({ path: p, mode, expected, kind });
    }
  };

  checkFile(envPath, '600', 'env');
  checkFile(dbPath, '600', 'database');
  checkFile(encryptionKeyPath, '600', 'encryption-key');

  const dirMode = modeOf(backupDir);
  if (dirMode !== null && (dirMode & 0o077) !== 0) {
    issues.push({ path: backupDir, mode: dirMode, expected: '700', kind: 'backup-dir' });
  }
  if (dirMode !== null) {
    let scanned = 0;
    for (const entry of fs.readdirSync(backupDir)) {
      if (scanned >= maxBackupFiles) break;
      if (!entry.endsWith('.db')) continue;
      scanned++;
      checkFile(path.join(backupDir, entry), '600', 'backup-file');
    }
  }

  return issues;
}

/** 启动期自检：逐条 WARN（生产环境升格 console.error），不阻断启动 */
export function warnSensitiveFilePermissions(options: FilePermissionCheckOptions = {}): FilePermissionIssue[] {
  let issues: FilePermissionIssue[] = [];
  try {
    issues = checkSensitiveFilePermissions(options);
  } catch (err) {
    // 自检自身失败（如 NFS stat 异常）只记日志，不影响启动
    console.warn('[Security] 敏感文件权限自检失败（忽略）:', err);
    return issues;
  }
  if (issues.length === 0) return issues;

  const isProduction = process.env.NODE_ENV === 'production';
  const log = isProduction ? console.error : console.warn;
  log(
    `[Security] 敏感文件权限宽于基线（${issues.length} 项）——多用户机器上等同于向本机所有账号暴露学生数据：\n` +
      issues
        .map(
          (i) =>
            `  [${isProduction ? 'ERROR' : 'WARN'}] ${i.path} → ${i.mode.toString(8)}（期望 ≤${i.expected}，${i.kind}）`,
        )
        .join('\n') +
      `\n  ${FILE_PERMISSION_BASELINE_DOC}`,
  );
  return issues;
}
