import path from 'path';

/**
 * 获取统一数据根目录 (OPENLEARN_DATA_DIR SSOT)
 *
 * 优先级：
 * 1. 显式环境变量 `OPENLEARN_DATA_DIR`
 * 2. 既有 `OPENLEARN_DB_PATH` 的父目录（若由 CLI/环境变量注入，例如 ~/openlearn-next/data.db -> ~/openlearn-next）
 * 3. 回退到 `process.cwd()`（开发环境或测试环境兼容）
 */
export function getDataDir(): string {
  if (process.env.OPENLEARN_DATA_DIR) {
    return path.resolve(process.env.OPENLEARN_DATA_DIR);
  }
  if (process.env.OPENLEARN_DB_PATH) {
    return path.dirname(path.resolve(process.env.OPENLEARN_DB_PATH));
  }
  return process.cwd();
}

/**
 * 课件上传、头像等用户附件存储根目录
 */
export function getUploadsDir(): string {
  return path.join(getDataDir(), 'uploads');
}

/**
 * 课件解压缓存与作业提交物理存储根目录
 */
export function getStorageDir(): string {
  return path.join(getDataDir(), 'storage');
}

/**
 * 插件目录
 */
export function getPluginsDir(): string {
  if (process.env.OPENLEARN_PLUGINS_DIR) {
    return path.resolve(process.env.OPENLEARN_PLUGINS_DIR);
  }
  return path.join(getDataDir(), 'plugins');
}

/**
 * 数据库冷备存储目录
 */
export function getBackupsDir(): string {
  if (process.env.BACKUP_DIR) {
    return path.resolve(process.env.BACKUP_DIR);
  }
  return path.join(getDataDir(), 'backups');
}
