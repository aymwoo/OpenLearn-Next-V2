/**
 * restore-db.ts — 从备份恢复 SQLite 数据库。
 *
 * 背景：`npm run db:backup` 一直存在（scripts/backup-db.ts，基于 `VACUUM INTO`），
 * 但此前**没有任何恢复脚本**，灾备流程是不闭环的。本脚本补上恢复侧。
 *
 * 用法：
 *   npm run db:restore                        # 使用 backups/ 下最新的备份
 *   npm run db:restore -- path/to/backup.db   # 指定备份文件
 *   npm run db:restore -- --list              # 列出可用备份
 *   npm run db:restore -- --force             # 覆盖现有数据库前先留一份安全副本
 *
 * 安全设计：
 * 1. 恢复前**强制**把当前库另存为 `pre_restore_<ts>.db`，除非显式 `--force` 跳过。
 * 2. 校验目标备份是合法 SQLite 且含 `lessons` 表，避免把垃圾文件写进生产库。
 * 3. 强制校验通过才替换；失败时保持原库不动。
 * 4. 覆盖前提醒 WAL/SHM 残留会被一并清理，避免恢复后读到旧状态。
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve(
  process.cwd(),
  process.env.OPENLEARN_DB_PATH || 'packages/core/db/educational_os.db',
);
const BACKUP_DIR = path.resolve(process.cwd(), process.env.BACKUP_DIR || 'backups');

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const positional = args.filter((a) => !a.startsWith('--'));

function listBackups(): string[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => path.join(BACKUP_DIR, f))
    .sort()
    .reverse();
}

interface BackupCheck {
  ok: boolean;
  lessons?: number;
  reason?: string;
}

/** 校验候选文件确实是可用的 OpenLearn 数据库。 */
function validateBackup(file: string): BackupCheck {
  if (!fs.existsSync(file)) return { ok: false, reason: '文件不存在' };
  const stat = fs.statSync(file);
  if (stat.size === 0) return { ok: false, reason: '文件大小为 0' };

  let probe: Database.Database | null = null;
  try {
    probe = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = probe.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return { ok: false, reason: `完整性检查未通过: ${String(integrity)}` };
    const hasLessons = probe
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='lessons'`)
      .get();
    if (!hasLessons) return { ok: false, reason: '缺少 lessons 表，不是 OpenLearn 数据库' };
    const { n } = probe.prepare('SELECT COUNT(*) AS n FROM lessons').get() as { n: number };
    return { ok: true, lessons: n };
  } catch (err: any) {
    return { ok: false, reason: err.message };
  } finally {
    probe?.close();
  }
}

function main(): void {
  if (has('--list')) {
    const files = listBackups();
    if (!files.length) {
      console.log(`（${BACKUP_DIR} 下没有备份文件）`);
      return;
    }
    console.log(`可用备份（${BACKUP_DIR}）：`);
    for (const f of files) {
      const v = validateBackup(f);
      const size = (fs.statSync(f).size / 1024 / 1024).toFixed(2);
      const verdict = v.ok ? `✓ 校验通过（lessons=${v.lessons}）` : `✗ ${v.reason}`;
      console.log(`  ${path.basename(f)}  ${size}MB  ${verdict}`);
    }
    return;
  }

  const backups = listBackups();
  const target = positional[0] || backups[0];
  if (!target) {
    console.error('✗ 找不到任何备份。请先运行 `npm run db:backup`，或用 --list 查看。');
    process.exit(1);
  }
  const resolved = path.resolve(target);

  console.log('═'.repeat(64));
  console.log('数据库恢复');
  console.log('═'.repeat(64));
  console.log(`  备份源 : ${resolved}`);
  console.log(`  目标库 : ${DB_PATH}`);
  console.log('');

  const check = validateBackup(resolved);
  if (check.ok !== true) {
    console.error(`✗ 备份校验失败：${check.reason}`);
    console.error('  已中止，原数据库未做任何改动。');
    process.exit(1);
  }
  console.log(`✓ 备份校验通过（integrity_check=ok，lessons 表 ${check.lessons} 行）`);

  if (fs.existsSync(DB_PATH)) {
    if (!has('--force')) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safety = path.join(BACKUP_DIR, `pre_restore_${stamp}.db`);
      fs.mkdirSync(path.dirname(safety), { recursive: true });
      fs.copyFileSync(DB_PATH, safety);
      console.log(`✓ 已为当前数据库留存安全副本：${safety}`);
    } else {
      console.log('⚠️  --force：跳过安全副本留存');
    }
  } else {
    console.log('ℹ️  目标库不存在，将直接创建');
  }

  for (const suffix of ['-wal', '-shm']) {
    const sidecar = DB_PATH + suffix;
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
      console.log(`✓ 已清理残留 ${path.basename(sidecar)}`);
    }
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.copyFileSync(resolved, DB_PATH);

  const verify = validateBackup(DB_PATH);
  if (verify.ok !== true) {
    console.error(`✗ 恢复后校验失败：${verify.reason}`);
    console.error('  请用上面的安全副本回滚。');
    process.exit(1);
  }
  console.log(`✓ 恢复完成并通过校验（lessons 表 ${verify.lessons} 行）`);
  console.log('');
  console.log('  提示：若使用加密的 AI Provider 凭据，请确认 ENCRYPTION_KEY 与备份时一致，');
  console.log('        否则凭据将无法解密（数据库本身不受影响）。');
}

main();
