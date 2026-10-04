/**
 * restore-db.ts — 从备份恢复 SQLite 数据库。
 *
 * 用法：
 *   pnpm run db:restore                        # 使用 backups/ 下最新的备份
 *   pnpm run db:restore -- path/to/backup.db   # 指定备份文件
 *   pnpm run db:restore -- --list              # 列出可用备份
 *   pnpm run db:restore -- --force             # 覆盖现有数据库前不留安全副本
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  listBackups,
  performRestore,
  getDefaultDbPath,
  getDefaultBackupDir,
} from '../packages/core/db/index.js';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const positional = args.filter((a) => !a.startsWith('--'));

const dbPath = getDefaultDbPath();
const backupDir = getDefaultBackupDir();

function main(): void {
  if (has('--list')) {
    const files = listBackups(backupDir);
    if (!files.length) {
      console.log(`（${backupDir} 下没有备份文件）`);
      return;
    }
    console.log(`可用备份（${backupDir}）：`);
    for (const f of files) {
      const sizeMb = (f.size / 1024 / 1024).toFixed(2);
      const verdict = f.isValid ? `✓ 校验通过（lessons=${f.lessons}）` : `✗ ${f.reason}`;
      console.log(`  ${f.filename}  ${sizeMb}MB  ${verdict}`);
    }
    return;
  }

  const backups = listBackups(backupDir).filter((b) => b.isValid);
  const target = positional[0] || backups[0]?.path;
  if (!target) {
    console.error('✗ 找不到任何有效备份。请先运行 `pnpm run db:backup`，或用 --list 查看。');
    process.exit(1);
  }

  const resolved = path.resolve(target);
  console.log('═'.repeat(64));
  console.log('OpenLearn SQLite 数据库灾难恢复');
  console.log('═'.repeat(64));
  console.log(`  备份源 : ${resolved}`);
  console.log(`  目标库 : ${dbPath}`);
  console.log('');

  try {
    const result = performRestore({
      backupFile: resolved,
      dbPath,
      backupDir,
      force: has('--force'),
    });

    if (result.safetyBackupPath) {
      console.log(`✓ 已为原数据库留存安全副本：${result.safetyBackupPath}`);
    } else if (has('--force')) {
      console.log('⚠️  --force：跳过安全副本留存');
    }

    console.log(`✓ 恢复完成并通过完整性校验（lessons 表 ${result.lessons} 行）`);
    console.log('');
    console.log('  提示：若使用加密的 AI Provider 凭据，请确认 ENCRYPTION_KEY 与备份时一致，');
    console.log('        否则凭据将无法解密（数据库本身不受影响）。');
  } catch (err: any) {
    console.error(`✗ 恢复中止或失败：${err.message}`);
    console.error('  原数据库未受到非预期破坏或已回滚。');
    process.exit(1);
  }
}

main();
