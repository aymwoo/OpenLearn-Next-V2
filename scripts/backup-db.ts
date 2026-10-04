/**
 * backup-db.ts — 执行 SQLite 数据库热备份并根据保留策略进行自动轮转
 *
 * 用法：
 *   pnpm run db:backup                     # 默认生成快照并保留最新 10 份
 *   pnpm run db:backup -- --keep 5         # 指定最多保留 5 份历史快照
 *   pnpm run db:backup -- --dir /my/dir    # 指定备份目录
 *   pnpm run db:backup -- my_snapshot.db   # 指定自定义快照文件名
 */
import { db, performBackup, getDefaultBackupDir, getDefaultDbPath } from '../packages/core/db/index.js';

const args = process.argv.slice(2);
const getArgValue = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
};

const keepStr = getArgValue('--keep');
const keep = keepStr ? parseInt(keepStr, 10) : 10;
const customDir = getArgValue('--dir');
const customName = getArgValue('--name') || args.find((a) => !a.startsWith('--'));

try {
  const result = performBackup({
    dbInstance: db,
    backupDir: customDir,
    customName,
    keep,
  });

  const sizeMb = (result.size / 1024 / 1024).toFixed(2);
  console.log('═'.repeat(64));
  console.log('✓ SQLite 数据库安全热备份成功');
  console.log('═'.repeat(64));
  console.log(`  源库路径 : ${getDefaultDbPath()}`);
  console.log(`  快照路径 : ${result.backupPath} (${sizeMb} MB)`);
  if (result.prunedCount > 0) {
    console.log(`  自动轮转 : 已按 --keep ${keep} 清理 ${result.prunedCount} 份历史旧备份`);
  }
} catch (err: any) {
  console.error(`✗ Database backup failed: ${err.message}`);
  process.exit(1);
}
