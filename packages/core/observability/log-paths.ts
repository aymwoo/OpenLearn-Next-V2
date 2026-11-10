import path from 'node:path';

/** 平台文件日志文件名（轮转后为 openlearn.log.1、.2 …）。 */
export const LOG_FILE_NAME = 'openlearn.log';

/**
 * 解析日志目录。
 *
 * logger 写入端与管理端 /api/admin/logs 读取端必须使用同一份解析，
 * 否则设置 LOG_DIR 后日志页会读到空目录。
 */
export function resolveLogDir(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return path.resolve(env.LOG_DIR || path.join(cwd, 'logs'));
}

/** 解析主日志文件绝对路径。 */
export function resolveLogFilePath(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return path.join(resolveLogDir(env, cwd), LOG_FILE_NAME);
}
