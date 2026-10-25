/**
 * secure-files.ts — 平台自建敏感文件的权限收紧（Issue #233 / 审计 P1-2）。
 *
 * ## 为什么需要这一层
 *
 * 权限基线（`server/security/file-permissions.ts`）的口径是「文件不得含 group/other
 * 位（≤600），目录不得含 group/other 位（≤700）」。但**基线只负责检查**，
 * 而平台自己创建这些文件时用的是默认 umask —— 实测：
 *
 * - 主库 `educational_os.db`：better-sqlite3 按默认 umask 创建 → **644**；
 * - WAL / SHM 侧车（`educational_os.db-wal` / `-shm`）：与主库等价，装着全量学生数据
 *   → 同样 **644**；
 * - 备份目录 `backups/`：`mkdirSync` 未带 mode → **755**。
 *
 * 结果是「门禁在自己的开箱状态下就是红的」：全新部署启动即报 2 条 ERROR，
 * `pnpm ops:check-perms` 立刻失败（退出码 1）。
 *
 * ## 口径
 *
 * - **创建即合规**：文件在 `open(..., 0o600)` 时产生，目录用 `mkdir(mode: 0o700)`；
 *   不依赖 umask，也不存在「先 644 再 chmod」的时间窗。
 * - **只收紧不放宽**：目标已合规（或比基线更严，如 0400）时**不动** —— 只在
 *   真的含有 group/other 位时才 chmod，且收敛到 600/700，不会把 0400 改成 0644。
 * - **Windows / 不支持 chmod 的环境**：全部 try/catch 吞掉，不阻断启动。
 *
 * 本模块只负责**平台自建产物**（主库、侧车、备份目录、备份文件）。
 * 用户自己写的 `.env` 不在这里自动处理 —— 那要管理员显式执行
 * `pnpm ops:check-perms --fix`。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 敏感文件基线：不得含 group/other 位 */
export const SECURE_FILE_MODE = 0o600;
/** 敏感目录基线：不得含 group/other 位 */
export const SECURE_DIR_MODE = 0o700;

/** group/other 位掩码：任何一位为 1 即视为「宽于基线」 */
const GROUP_OTHER_BITS = 0o077;

function currentMode(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mode & 0o777;
  } catch {
    return null;
  }
}

/**
 * 把已存在的文件收紧到基线（600）。
 * @returns 是否发生了实际变更
 */
export function hardenFile(filePath: string): boolean {
  const mode = currentMode(filePath);
  // 不存在 → 无事可做；已合规（或更严）→ 不动，避免把 0400 放宽成 0600。
  if (mode === null || (mode & GROUP_OTHER_BITS) === 0) return false;
  try {
    fs.chmodSync(filePath, SECURE_FILE_MODE);
    return true;
  } catch {
    // Windows 等不支持 chmod 的环境忽略
    return false;
  }
}

/**
 * 把已存在的目录收紧到基线（700）。
 * @returns 是否发生了实际变更
 */
export function hardenDir(dirPath: string): boolean {
  const mode = currentMode(dirPath);
  if (mode === null || (mode & GROUP_OTHER_BITS) === 0) return false;
  try {
    fs.chmodSync(dirPath, SECURE_DIR_MODE);
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保目录存在且合规：不存在则按 0700 创建，已存在但过宽则收紧。
 */
export function ensureSecureDir(dirPath: string): void {
  try {
    // mode 只对**新建**目录生效，且会被 umask 掩码；0700 不含 group/other 位，
    // 因此 umask（如 022）不会削掉任何一位。
    fs.mkdirSync(dirPath, { recursive: true, mode: SECURE_DIR_MODE });
  } catch {
    // 目录可能已存在或不可创建；后续 hardenDir 会再判断一次
  }
  hardenDir(dirPath);
}

/**
 * 确保文件存在且合规：不存在则以 0600 创建（`open` 的 mode 直接决定权限，
 * 没有「先建后 chmod」的暴露窗口），已存在但过宽则收紧。
 */
export function ensureSecureFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      hardenFile(filePath);
      return;
    }
    // 父目录不在基线管辖范围内（共享卷等场景可能需要组可访问）→ 保持默认权限，
    // 只保证它存在，否则 openSync 会 ENOENT。
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const fd = fs.openSync(filePath, 'a', SECURE_FILE_MODE);
    fs.closeSync(fd);
  } catch {
    // 不可写等场景交给调用方后续处理（打开数据库时会自然报错）
  }
  hardenFile(filePath);
}

/**
 * 主库及其 WAL / SHM 侧车：WAL 模式下侧车与主库等价（内含全量学生数据），
 * 必须一起收紧，否则「主库 600 + WAL 644」等于没设防。
 *
 * @returns 实际被收紧的文件列表
 */
export function secureDatabaseFiles(dbPath: string): string[] {
  const hardened: string[] = [];
  for (const target of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (hardenFile(target)) hardened.push(target);
  }
  return hardened;
}
