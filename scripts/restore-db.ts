/**
 * restore-db.ts — 从备份恢复 SQLite 数据库。
 *
 * 用法：
 *   pnpm run db:restore -- --list              # 列出可用备份（无需停服）
 *   pnpm run db:restore -- --i-understand-downtime [path/to/backup.db]  # 停服后恢复
 *   pnpm run db:restore -- --i-understand-downtime --force  # 覆盖前不留安全副本
 *
 * R2：恢复是停机操作（直接覆盖库文件 + 删除 -wal/-shm，带电恢复必损坏）。
 * 除 --list 外必须显式 --i-understand-downtime，并先停服（pm2 stop / Ctrl-C）。
 * 若检测到疑似运行中的服务持有库文件（fuser 有回显），直接拒绝。
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

async function main(): Promise<void> {
  if (has('--list')) {    const files = listBackups(backupDir);
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

  if (!has('--i-understand-downtime')) {
    console.error('✗ 拒绝执行：恢复是停机操作，必须先停服（pm2 stop openlearnv2 或 Ctrl-C），');
    console.error('  再显式传入 --i-understand-downtime 确认。仅查看备份请用 --list。');
    process.exit(1);
  }

  // 最佳努力检测带电恢复：fuser 能看到持有者则拒绝（无 fuser 时跳过检测）
  try {
    const { execSync } = await import('node:child_process');
    const holders = execSync(`fuser "${dbPath}" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    if (holders) {
      console.error(`✗ 检测到仍有进程持有数据库（fuser: ${holders}），请先停服再恢复。`);
      process.exit(1);
    }
  } catch {
    // 无 fuser 或检测失败时跳过，不阻断已确认的恢复
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

main().catch((err) => {
  console.error(`✗ 恢复失败：${err?.message ?? err}`);
  process.exit(1);
});
