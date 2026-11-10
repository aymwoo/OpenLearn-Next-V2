import path from 'node:path';

/**
 * 数据根目录单一来源（与 server/utils/paths.ts 的 getDataDir 口径一致）。
 *
 * 优先级：OPENLEARN_DATA_DIR → OPENLEARN_DB_PATH 的父目录 → cwd。
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  if (env.OPENLEARN_DATA_DIR) return path.resolve(cwd, env.OPENLEARN_DATA_DIR);
  if (env.OPENLEARN_DB_PATH) return path.dirname(path.resolve(cwd, env.OPENLEARN_DB_PATH));
  return cwd;
}

/**
 * 部署级备份目录：BACKUP_DIR 优先，否则 <数据根目录>/backups。
 * 供健康检查、备份列表/轮转等「不知道具体库文件」的场景使用。
 */
export function resolveBackupDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  if (env.BACKUP_DIR) return path.resolve(cwd, env.BACKUP_DIR);
  return path.join(resolveDataDir(env, cwd), 'backups');
}

/**
 * 针对具体数据库文件的备份目录：BACKUP_DIR 优先，否则落在库文件同级的 backups/。
 *
 * 迁移前快照与文件权限自检必须用这个：它们操作的是传入的 db 句柄，
 * 快照落点必须与库文件同一目录（测试 / 多库脚本会传入不同于环境变量的路径）。
 */
export function resolveBackupDirForDb(
  dbFilePath: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  if (env.BACKUP_DIR) return path.resolve(cwd, env.BACKUP_DIR);
  if (dbFilePath && dbFilePath !== ':memory:') {
    return path.join(path.dirname(path.resolve(cwd, dbFilePath)), 'backups');
  }
  return resolveBackupDir(env, cwd);
}
